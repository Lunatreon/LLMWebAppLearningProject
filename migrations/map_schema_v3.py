"""Frozen relational-map schema and category seeds for revision 0003."""

import sqlalchemy as sa

DEFAULT_CATEGORIES = [
    ("topic", "person", "Person", "People and interpersonal relationships.", False, True),
    ("topic", "trait", "Trait", "Personal characteristics and patterns.", False, True),
    ("topic", "experience", "Experience", "Life experiences and situations.", False, True),
    ("topic", "other", "Other", "Topics outside the other categories.", False, True),
    (
        "entry",
        "inherited_script",
        "Inherited script",
        "An expectation learned from others.",
        False,
        True,
    ),
    ("entry", "own_perception", "Own perception", "The person's own perspective.", False, True),
    ("entry", "value", "Value", "Something the person values.", False, True),
    ("entry", "body_signal", "Body signal", "A noticed physical sensation.", False, True),
    ("entry", "practice", "Practice", "An optional experiment or practice.", True, True),
    ("entry", "evidence", "Evidence", "An observation supporting an insight.", False, True),
    ("entry", "task", "Task", "An optional task with completion progress.", True, True),
    (
        "entry",
        "merged_topic",
        "Merged topic",
        "Source content retained after a topic merge.",
        False,
        False,
    ),
]


def category_rows():
    return [
        dict(
            kind=k,
            key=key,
            label=label,
            description=description,
            supports_completion=progress,
            llm_enabled=llm,
            active=True,
            position=i,
        )
        for i, (k, key, label, description, progress, llm) in enumerate(DEFAULT_CATEGORIES)
    ]


def build_tables(metadata):
    c = sa.Column
    tables = {}
    tables["map_categories"] = sa.Table(
        "map_categories",
        metadata,
        c("kind", sa.String(16), primary_key=True),
        c("key", sa.String(64), primary_key=True),
        c("label", sa.String(120), nullable=False),
        c("description", sa.Text, nullable=False),
        c("active", sa.Boolean, nullable=False, server_default=sa.true()),
        c("llm_enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        c("supports_completion", sa.Boolean, nullable=False, server_default=sa.false()),
        c("position", sa.Integer, nullable=False, server_default="0"),
        sa.CheckConstraint("kind IN ('topic','entry')", name="ck_map_category_kind"),
    )
    tables["user_maps"] = sa.Table(
        "user_maps",
        metadata,
        c(
            "user_id",
            sa.Integer,
            sa.ForeignKey("user_profiles.user_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        c("revision", sa.Integer, nullable=False, server_default="1"),
        c("updated_at", sa.DateTime(timezone=True), nullable=False),
        c("extra_ciphertext", sa.LargeBinary),
        c("content_key_id", sa.String(80), nullable=False),
    )
    tables["map_topics"] = sa.Table(
        "map_topics",
        metadata,
        c(
            "user_id",
            sa.Integer,
            sa.ForeignKey("user_maps.user_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        c("id", sa.String(64), primary_key=True),
        c("parent_topic_id", sa.String(64)),
        c("category_kind", sa.String(16), nullable=False, server_default="topic"),
        c("category", sa.String(64), nullable=False),
        c("position", sa.Integer, nullable=False),
        c("content_key_id", sa.String(80), nullable=False),
        c("title_ciphertext", sa.LargeBinary, nullable=False),
        c("description_ciphertext", sa.LargeBinary, nullable=False),
        c("created_at", sa.DateTime(timezone=True)),
        c("updated_at", sa.DateTime(timezone=True)),
        c("extra_ciphertext", sa.LargeBinary),
        sa.ForeignKeyConstraint(
            ["category_kind", "category"], ["map_categories.kind", "map_categories.key"]
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "parent_topic_id"],
            ["map_topics.user_id", "map_topics.id"],
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.CheckConstraint(
            "parent_topic_id IS NULL OR parent_topic_id <> id", name="ck_map_parent_self"
        ),
        sa.CheckConstraint("category_kind = 'topic'", name="ck_map_topic_kind"),
    )
    tables["map_entries"] = sa.Table(
        "map_entries",
        metadata,
        c(
            "user_id",
            sa.Integer,
            sa.ForeignKey("user_maps.user_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        c("id", sa.String(64), primary_key=True),
        c("topic_id", sa.String(64)),
        c("category_kind", sa.String(16), nullable=False, server_default="entry"),
        c("category", sa.String(64), nullable=False),
        c("position", sa.Integer, nullable=False),
        c("completion_percent", sa.Integer),
        c("practice_status", sa.String(16)),
        c("content_key_id", sa.String(80), nullable=False),
        c("text_ciphertext", sa.LargeBinary, nullable=False),
        c("reason_ciphertext", sa.LargeBinary),
        c("reflection_ciphertext", sa.LargeBinary),
        c("source_topic_title_ciphertext", sa.LargeBinary),
        c("source_user_id", sa.Integer),
        c("source_chat_id", sa.String(120)),
        c("source_chat_reference", sa.String(120)),
        c("source_topic_reference", sa.String(64)),
        c("created_at", sa.DateTime(timezone=True)),
        c("updated_at", sa.DateTime(timezone=True)),
        c("extra_ciphertext", sa.LargeBinary),
        sa.ForeignKeyConstraint(
            ["category_kind", "category"], ["map_categories.kind", "map_categories.key"]
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "topic_id"],
            ["map_topics.user_id", "map_topics.id"],
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(
            ["source_user_id", "source_chat_id"],
            ["chat_sessions.user_id", "chat_sessions.chat_id"],
            ondelete="SET NULL",
        ),
        sa.CheckConstraint("category_kind = 'entry'", name="ck_map_entry_kind"),
        sa.CheckConstraint(
            "source_user_id IS NULL OR source_user_id = user_id", name="ck_map_entry_source_owner"
        ),
        sa.CheckConstraint(
            "(source_user_id IS NULL) = (source_chat_id IS NULL)", name="ck_map_entry_source_pair"
        ),
        sa.CheckConstraint(
            "completion_percent IS NULL OR completion_percent BETWEEN 0 AND 100",
            name="ck_map_completion",
        ),
        sa.CheckConstraint(
            "practice_status IS NULL OR practice_status IN ('active','paused','completed')",
            name="ck_map_practice_status",
        ),
    )
    tables["map_topic_relations"] = sa.Table(
        "map_topic_relations",
        metadata,
        c("user_id", sa.Integer, primary_key=True),
        c("topic_a_id", sa.String(64), primary_key=True),
        c("topic_b_id", sa.String(64), primary_key=True),
        sa.ForeignKeyConstraint(
            ["user_id", "topic_a_id"], ["map_topics.user_id", "map_topics.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "topic_b_id"], ["map_topics.user_id", "map_topics.id"], ondelete="CASCADE"
        ),
        sa.CheckConstraint("topic_a_id < topic_b_id", name="ck_map_relation_order"),
    )
    tables["map_topic_sources"] = sa.Table(
        "map_topic_sources",
        metadata,
        c("user_id", sa.Integer, primary_key=True),
        c("topic_id", sa.String(64), primary_key=True),
        c("kind", sa.String(16), primary_key=True),
        c("reference", sa.String(120), primary_key=True),
        c("position", sa.Integer, nullable=False),
        c("source_user_id", sa.Integer),
        c("source_chat_id", sa.String(120)),
        sa.ForeignKeyConstraint(
            ["user_id", "topic_id"], ["map_topics.user_id", "map_topics.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["source_user_id", "source_chat_id"],
            ["chat_sessions.user_id", "chat_sessions.chat_id"],
            ondelete="SET NULL",
        ),
        sa.CheckConstraint("kind IN ('chat','journal')", name="ck_map_source_kind"),
        sa.CheckConstraint(
            "source_user_id IS NULL OR source_user_id = user_id", name="ck_map_source_owner"
        ),
        sa.CheckConstraint(
            "(source_user_id IS NULL) = (source_chat_id IS NULL)", name="ck_map_source_pair"
        ),
    )
    tables["user_maps"].append_constraint(
        sa.CheckConstraint("revision >= 1", name="ck_map_revision")
    )
    for name in ("map_categories", "map_topics", "map_entries", "map_topic_sources"):
        tables[name].append_constraint(
            sa.CheckConstraint("position >= 0", name=f"ck_{name}_position")
        )
    tables["map_categories"].append_constraint(
        sa.CheckConstraint(
            "length(key) > 0 AND length(trim(label)) > 0", name="ck_map_category_label"
        )
    )
    tables["map_topic_sources"].append_constraint(
        sa.CheckConstraint(
            "source_chat_id IS NULL OR (kind = 'chat' AND source_chat_id = reference)",
            name="ck_map_source_reference",
        )
    )
    tables["map_entries"].append_constraint(
        sa.CheckConstraint(
            "source_chat_id IS NULL OR source_chat_id = source_chat_reference",
            name="ck_map_entry_reference",
        )
    )
    for name in ("user_maps", "map_topics", "map_entries"):
        table = tables[name]
        table.append_constraint(
            sa.CheckConstraint("length(content_key_id) > 0", name=f"ck_{name}_key_id")
        )
        if "id" in table.c:
            table.append_constraint(sa.CheckConstraint("length(id) > 0", name=f"ck_{name}_id"))
        for column in table.c:
            if column.name.endswith("_ciphertext"):
                table.append_constraint(
                    sa.CheckConstraint(
                        f"length({column.name}) >= 28", name=f"ck_{name}_{column.name}_length"
                    )
                )
    sa.Index(
        "ix_map_topics_parent",
        tables["map_topics"].c.user_id,
        tables["map_topics"].c.parent_topic_id,
    )
    sa.Index(
        "ix_map_entries_topic",
        tables["map_entries"].c.user_id,
        tables["map_entries"].c.topic_id,
        tables["map_entries"].c.position,
    )
    sa.Index(
        "ix_map_entries_progress",
        tables["map_entries"].c.user_id,
        tables["map_entries"].c.category,
        tables["map_entries"].c.completion_percent,
    )
    sa.Index(
        "ix_map_relations_reverse",
        tables["map_topic_relations"].c.user_id,
        tables["map_topic_relations"].c.topic_b_id,
    )
    sa.Index(
        "ix_map_sources_chat",
        tables["map_topic_sources"].c.source_user_id,
        tables["map_topic_sources"].c.source_chat_id,
    )
    sa.Index(
        "ix_map_topics_category", tables["map_topics"].c.user_id, tables["map_topics"].c.category
    )
    sa.Index(
        "ix_map_entries_source_chat",
        tables["map_entries"].c.source_user_id,
        tables["map_entries"].c.source_chat_id,
    )
    return tables
