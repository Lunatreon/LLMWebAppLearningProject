"""Generate the full schema reference from application metadata; no DB connection."""

import argparse
from pathlib import Path
from sqlalchemy import ForeignKeyConstraint, UniqueConstraint, CheckConstraint
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable, CreateIndex
from backend.db.base import Base
from backend import models  # noqa: F401
from migrations.map_schema_v3 import category_rows

ROOT = Path(__file__).resolve().parents[1]


def generate():
    tables = Base.metadata.sorted_tables
    dialect = postgresql.dialect()
    diagram = ["erDiagram"]
    edges = set()
    for table in tables:
        for fk in table.foreign_key_constraints:
            parent = next(iter(fk.elements)).column.table.name
            nullable = any(c.nullable for c in fk.columns)
            columns = {c.name for c in fk.columns}
            unique = columns == {c.name for c in table.primary_key} or any(
                isinstance(item, UniqueConstraint) and columns == {c.name for c in item.columns}
                for item in table.constraints
            )
            line = f"    {parent} {'o|' if nullable else '||'}--{'o|' if unique else 'o{'} {table.name} : {next(iter(fk.columns)).name}"
            if line not in edges:
                diagram.append(line)
                edges.add(line)
    for table in tables:
        diagram.append(f"    {table.name} {{")
        fk_cols = {c.name for fk in table.foreign_key_constraints for c in fk.columns}
        for c in table.columns:
            flags = (["PK"] if c.primary_key else []) + (["FK"] if c.name in fk_cols else [])
            kind = str(c.type.compile(dialect=dialect)).split("(")[0].replace(" ", "_").lower()
            diagram.append(f"        {kind} {c.name}" + (" " + ",".join(flags) if flags else ""))
        diagram.append("    }")
    doc = [
        "# FeelY database schema",
        "",
        "Generated from SQLAlchemy metadata by `python -m scripts.database_schema`.",
        "Run this inside the backend image with a repository bind mount when host Python is unavailable.",
        "The versioned schema is managed by Alembic; generated SQL is a reference, not an upgrade script.",
        "",
        f"{len(tables)} application tables, plus Alembic's `alembic_version` table.",
        "",
        "```mermaid",
        *diagram,
        "```",
        "",
    ]
    sql = [
        "-- Generated PostgreSQL schema reference. Apply upgrades through Alembic, not this file.",
        "",
    ]
    for table in tables:
        sql.append(str(CreateTable(table).compile(dialect=dialect)) + ";")
        for index in sorted(table.indexes, key=lambda i: i.name):
            sql.append(str(CreateIndex(index).compile(dialect=dialect)) + ";")
        doc.extend(
            [
                f"## {table.name}",
                "",
                "| Column | PostgreSQL type | Nullable | Key |",
                "| --- | --- | --- | --- |",
            ]
        )
        for c in table.columns:
            refs = [f"{fk.column.table.name}.{fk.column.name}" for fk in c.foreign_keys]
            keys = (["PK"] if c.primary_key else []) + refs
            doc.append(
                f"| `{c.name}` | `{c.type.compile(dialect=dialect)}` | {'yes' if c.nullable else 'no'} | {', '.join(keys)} |"
            )
        doc.append("")
        for constraint in sorted(
            table.constraints,
            key=lambda c: (
                type(c).__name__,
                c.name or ",".join(sorted(column.name for column in c.columns)),
            ),
        ):
            if isinstance(constraint, CheckConstraint):
                doc.append(f"- Check: `{constraint.sqltext}`.")
            if isinstance(constraint, UniqueConstraint):
                doc.append(
                    "- Unique: " + ", ".join(f"`{c.name}`" for c in constraint.columns) + "."
                )
            if isinstance(constraint, ForeignKeyConstraint):
                doc.append(
                    "- Foreign key: "
                    + ", ".join(
                        f"`{e.parent.name}` ? `{e.column.table.name}.{e.column.name}`"
                        for e in constraint.elements
                    )
                    + f"; delete: {constraint.ondelete or 'NO ACTION'}."
                )
        for index in sorted(table.indexes, key=lambda i: i.name):
            doc.append(
                f"- Index `{index.name}`: " + ", ".join(f"`{c.name}`" for c in index.columns) + "."
            )
        doc.append("")
    doc.extend(
        [
            "## Design review and encryption",
            "",
            "See [the database review](DATABASE_REVIEW.md) for remaining JSON fields, sensitive plaintext outside the map, retention concerns and recommended follow-up work.",
            "See [map storage](MAP_DATABASE_SCHEMA.md) for migration, categories, completion and key handling.",
            "",
        ]
    )
    (ROOT / "docs/DATABASE_SCHEMA.md").write_text("\n".join(doc), encoding="utf-8")
    (ROOT / "docs/database-schema.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
    print(f"Generated schema reference for {len(tables)} application tables.")


if __name__ == "__main__":
    generate()
