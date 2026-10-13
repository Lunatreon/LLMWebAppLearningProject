"""Phase 6 contract fixture: unchanged backend routes, disposable DB, no emails/LLM/billing."""
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
os.environ['ENVIRONMENT'] = 'local'
os.environ['SECRET_KEY'] = 'isolated-auth-contract-key-never-for-deployment'
for name in ['LLM_PROVIDER', 'CHAT_LLM_PROVIDER', 'TOPIC_LLM_PROVIDER', 'JOURNAL_LLM_PROVIDER']:
    os.environ[name] = 'mock'

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.api.dependencies import get_db
from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base
from app.main import create_app
from app.models.user import User
import uvicorn

settings.basic_auth_enabled = False
settings.captcha_enabled = False
settings.email_verification_enabled = True
settings.email_verification_required = True
settings.feedback_enabled = True
settings.feedback_email_to = None
settings.terms_version = 'isolated-login-v1'
settings.terms_document_url = 'https://example.com/agb/isolated-login-v1.pdf'
settings.terms_document_sha256 = 'a' * 64
settings.stripe_enabled = False
settings.premium_features_enabled = False
settings.rate_limit_enabled = False
settings.ollama_prewarm = False
settings.webmail_enabled = False

with tempfile.TemporaryDirectory(prefix='feely-auth-contract-') as scratch:
    engine = create_engine(f'sqlite:///{Path(scratch) / "contract.db"}', connect_args={'check_same_thread': False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        for name, active, verified in [('contract-member', True, True), ('contract-disabled', False, True), ('contract-unverified', True, False)]:
            db.add(User(email=f'{name}@example.com', username=name,
                        hashed_password=hash_password('Isolated-contract-password'),
                        is_active=active, is_email_verified=verified))
        db.commit()
    application = create_app(init_database=False)

    def isolated_db():
        with Session() as db:
            yield db

    application.dependency_overrides[get_db] = isolated_db
    try:
        uvicorn.run(application, host='127.0.0.1', port=18006, log_level='warning')
    finally:
        engine.dispose()
