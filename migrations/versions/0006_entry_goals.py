"""Store the intended outcome of a map task separately from its action."""

from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("map_entries", sa.Column("goal_ciphertext", sa.LargeBinary(), nullable=True))
    # Older maps may have used the encrypted extension fields for a goal.
    import json
    from backend.core.content_crypto import encrypt, decrypt

    connection = op.get_bind()
    entries = sa.Table("map_entries", sa.MetaData(), autoload_with=connection)
    for row in connection.execute(sa.select(entries)).mappings():
        identity = "entry:" + row["id"]
        crypt_args = dict(owner=row["user_id"], row=identity, key_id=row["content_key_id"])
        raw = decrypt(row["extra_ciphertext"], field="extra", **crypt_args)
        metadata = json.loads(raw) if raw else {}
        goal = metadata.get("values", {}).get("goal")
        if isinstance(goal, str):
            connection.execute(
                entries.update()
                .where(entries.c.user_id == row["user_id"], entries.c.id == row["id"])
                .values(goal_ciphertext=encrypt(goal, field="goal", **crypt_args))
            )


def downgrade():
    op.drop_column("map_entries", "goal_ciphertext")
