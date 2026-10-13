"""Phase 7 fixture: disposable DB, local Siteverify double, captured email, real auth routes."""
import argparse
import asyncio
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
from threading import Thread
from urllib.parse import parse_qs

parser = argparse.ArgumentParser()
parser.add_argument('--verified', action='store_true', help='Model verification-disabled registration.')
parser.add_argument('--activation', action='store_true', help='Enable real activation/resend rate limits on port 18010.')
parser.add_argument('--recovery', action='store_true', help='Capture real reset emails and enable recovery contracts on port 18011.')
parser.add_argument('--password-change', action='store_true', help='Exercise authenticated password contracts on port 18012.')
parser.add_argument('--journal', action='store_true', help='Exercise premium-gated Journal with mock analysis on port 18013.')
parser.add_argument('--map', action='store_true', help='Exercise real Map and Journal integration contracts on port 18014.')
parser.add_argument('--reflection', action='store_true', help='Exercise atomic Practice/Reflection contracts on port 18015.')
parser.add_argument('--chat', action='store_true', help='Exercise real Chat streams/history/source contracts on port 18016.')
options = parser.parse_args()
port = 18016 if options.chat else 18015 if options.reflection else 18014 if options.map else 18013 if options.journal else 18012 if options.password_change else 18011 if options.recovery else 18010 if options.activation else 18008 if options.verified else 18007
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
os.environ['ENVIRONMENT'] = 'local'
os.environ['SECRET_KEY'] = 'isolated-registration-key-never-for-deployment'
for name in ['LLM_PROVIDER', 'CHAT_LLM_PROVIDER', 'TOPIC_LLM_PROVIDER', 'JOURNAL_LLM_PROVIDER']:
    os.environ[name] = 'mock'

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException
from app.api.dependencies import get_db
from app.api.routes import auth as auth_routes
from app.core.config import settings
from app.services import password_reset
from app.core.rate_limit import rate_limiter
from app.core.security import create_access_token
from app.db.base import Base
from app.main import create_app
from app.models.user import User, utc_now
from app.models.billing import BillingSubscription
import uvicorn

settings.basic_auth_enabled = False
settings.captcha_enabled = True
settings.captcha_provider = 'turnstile'
settings.turnstile_site_key = 'isolated-public-site-key'
settings.turnstile_secret_key = 'isolated-siteverify-secret'
settings.turnstile_action = 'register'
settings.email_verification_enabled = not (options.verified or options.recovery or options.password_change or options.journal or options.map or options.reflection or options.chat)
settings.email_verification_required = not (options.verified or options.recovery or options.password_change or options.journal or options.map or options.reflection or options.chat)
settings.feedback_enabled = True
settings.feedback_email_to = None
settings.terms_version = 'isolated-registration-v1'
settings.terms_document_url = 'https://example.com/agb/isolated-registration-v1.pdf'
settings.terms_document_sha256 = 'a' * 64
settings.stripe_enabled = False
settings.premium_features_enabled = options.journal or options.map or options.reflection or options.chat
settings.rate_limit_enabled = options.activation or options.recovery or options.password_change or options.chat
if options.activation or options.recovery or options.password_change or options.chat:
    # Keep the actual per-email resend/confirm limits; avoid unrelated IP quotas.
    settings.rate_limit_auth_ip_per_minute = 1000
if options.chat:
    settings.rate_limit_llm_user_per_minute = 1000
    settings.rate_limit_llm_user_per_day = 1000
    settings.rate_limit_llm_free_user_per_day = 2
    from app.api.routes import llm as chat_routes
    original_chat_factory = chat_routes.get_chat_llm_client
    chat_delay = [0]
    class DelayedMockChat:
        async def respond(self, **kwargs):
            if chat_delay[0]:
                await asyncio.sleep(chat_delay[0] / 1000)
            return await original_chat_factory().respond(**kwargs)
    chat_routes.get_chat_llm_client = lambda: DelayedMockChat()
    settings.rate_limit_api_per_minute = 1000
    settings.rate_limit_register_ip_per_hour = 1000
settings.ollama_prewarm = False
settings.webmail_enabled = False
if options.password_change:
    settings.rate_limit_http_per_minute = 1000
reset_messages = {}
if options.recovery:
    settings.password_reset_enabled = True
    settings.public_app_url = 'http://127.0.0.1:5500'
    settings.smtp_host = 'isolated-mail.example.invalid'
    settings.smtp_port = 587
    settings.smtp_from_email = 'noreply@example.com'
    settings.smtp_username = None
    settings.smtp_password = None

    def capture_reset_message(message):
        reset_messages.setdefault(message['To'], []).append(message.get_content())

    # Keep the real email/token/link construction; replace only delivery transport.
    password_reset.send_mail = capture_reset_message

class Siteverify(BaseHTTPRequestHandler):
    def do_POST(self):
        values = parse_qs(self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode())
        assert values.get('secret') == ['isolated-siteverify-secret']
        challenge = values.get('response', [''])[0]
        result = {'success': challenge in {'contract-solved', 'wrong-action'},
                  'action': 'other' if challenge == 'wrong-action' else 'register'}
        body = json.dumps(result).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass  # Never emit CAPTCHA data or secrets.

provider = ThreadingHTTPServer(('127.0.0.1', 0), Siteverify)
Thread(target=provider.serve_forever, daemon=True).start()
settings.turnstile_verify_url = f'http://127.0.0.1:{provider.server_port}/siteverify'
pins = {}

def capture_email(user, pin):
    if user.email.startswith('delivery-fails'):
        raise HTTPException(502, 'Isolated delivery failure')
    pins[user.email] = pin

# Patch only the isolated process's transport; registration/verification logic stays real.
auth_routes.send_email_verification_message = capture_email
with tempfile.TemporaryDirectory(prefix='feely-registration-contract-') as scratch:
    engine = create_engine(f'sqlite:///{Path(scratch) / "contract.db"}', connect_args={'check_same_thread': False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    application = create_app(init_database=False)

    def isolated_db():
        with Session() as db:
            yield db

    application.dependency_overrides[get_db] = isolated_db

    @application.get('/__contract/fixture')
    def fixture():
        return {'isolated': True, 'verification_enabled': settings.email_verification_enabled}

    @application.get('/__contract/pin')
    def captured_pin(email: str):
        return {'pin': pins[email]}

    @application.get('/__contract/account-exists')
    def account_exists(email: str):
        with Session() as db:
            return {'exists': db.scalar(select(User.id).where(User.email == email)) is not None}

    if options.recovery:
        @application.get('/__contract/reset-email')
        def reset_email(email: str):
            return {'messages': reset_messages.get(email, [])}

    if options.password_change:
        @application.get('/__contract/token')
        def fixture_token(email: str):
            # Mint only disposable fixture-user tokens, including passwordless users.
            with Session() as db:
                user = db.scalar(select(User).where(User.email == email))
                return {'access_token': create_access_token(str(user.id), expires_delta=timedelta(minutes=5))}

    if options.activation or options.recovery or options.password_change or options.journal or options.map or options.reflection or options.chat:
        @application.post('/__contract/state')
        def fixture_state(payload: dict):
            # Only this disposable fixture can expire/disable synthetic accounts
            # and change its process-local publication. Never a production route.
            if payload.get('terms_version'):
                settings.terms_version = payload['terms_version']
            if 'auth_limit' in payload:
                settings.rate_limit_auth_ip_per_minute = payload['auth_limit']
                rate_limiter.reset()
            if 'reset_enabled' in payload:
                settings.password_reset_enabled = payload['reset_enabled']
            if 'http_limit' in payload:
                settings.rate_limit_http_per_minute = payload['http_limit']
                rate_limiter.reset()
            if options.chat and 'chat_delay_ms' in payload:
                chat_delay[0] = payload['chat_delay_ms']
            if options.chat and 'chat_minute_limit' in payload:
                settings.rate_limit_llm_user_per_minute = payload['chat_minute_limit']
                rate_limiter.reset()
            if payload.get('email'):
                with Session() as db:
                    user = db.scalar(select(User).where(User.email == payload['email']))
                    if payload.get('expire'):
                        user.email_verification_sent_at = utc_now() - timedelta(hours=1)
                    if payload.get('disable'):
                        user.is_active = False
                    if payload.get('expire_reset'):
                        user.password_reset_sent_at = utc_now() - timedelta(hours=2)
                    if payload.get('passwordless'):
                        user.hashed_password = ''
                        user.auth_provider = 'external'
                    if 'premium' in payload:
                        subscription = db.scalar(select(BillingSubscription).where(BillingSubscription.user_id == user.id))
                        if subscription is None:
                            subscription = BillingSubscription(user_id=user.id)
                            db.add(subscription)
                        subscription.status = 'active' if payload['premium'] else 'canceled'
                        subscription.current_period_end = utc_now() + timedelta(days=30) if payload['premium'] else utc_now() - timedelta(days=1)
                    db.commit()
            return {'updated': True}

    try:
        uvicorn.run(application, host='127.0.0.1', port=port, log_level='warning')
    finally:
        provider.shutdown()
        provider.server_close()
        engine.dispose()
