"""Normalize maps and add editable category catalogs and completion percentages."""

from alembic import op
from migrations.map_storage_v3 import upgrade as upgrade_maps

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    upgrade_maps(op.get_bind())


def downgrade():
    raise RuntimeError(
        "Map downgrade requires a verified export/restore; encrypted map rows cannot be discarded."
    )
