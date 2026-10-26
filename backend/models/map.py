"""Relational map entities; API JSON is assembled at the storage boundary."""

from sqlalchemy import event, Column, Boolean, false
from backend.db.base import Base
from migrations.map_schema_v3 import build_tables, category_rows

TABLES = build_tables(Base.metadata)
TABLES["map_entries"].append_column(
    Column("working_on", Boolean, nullable=False, server_default=false())
)


class MapCategory(Base):
    __table__ = TABLES["map_categories"]


class UserMap(Base):
    __table__ = TABLES["user_maps"]


class MapTopic(Base):
    __table__ = TABLES["map_topics"]


class MapEntry(Base):
    __table__ = TABLES["map_entries"]


class MapTopicRelation(Base):
    __table__ = TABLES["map_topic_relations"]


class MapTopicSource(Base):
    __table__ = TABLES["map_topic_sources"]


@event.listens_for(MapCategory.__table__, "after_create")
def seed_categories(table, connection, **kwargs):
    connection.execute(table.insert(), category_rows())
