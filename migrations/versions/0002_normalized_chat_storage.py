"""Store conversation fields in columns and user/assistant exchanges in chat_turns."""

from alembic import op
from migrations.chat_storage_v2 import upgrade_chat_storage

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    upgrade_chat_storage(op)


def downgrade():
    # Refuse to discard potentially unlimited history or pending/failed inputs.
    raise RuntimeError(
        "Chat storage downgrade requires a reviewed export/restore; automatic truncation is not supported."
    )
