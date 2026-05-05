from app.db.base import Base
from app.db.session import engine
from app.models import user  # noqa: F401


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
