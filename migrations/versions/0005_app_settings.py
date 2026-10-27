"""Persist editable application preferences independently of deployment secrets."""

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("revision", sa.Integer, nullable=False),
        sa.Column("values", sa.JSON, nullable=False),
        sa.CheckConstraint("id = 1", name="ck_app_settings_singleton"),
        sa.CheckConstraint("revision >= 1", name="ck_app_settings_revision"),
    )


def downgrade():
    op.drop_table("app_settings")
