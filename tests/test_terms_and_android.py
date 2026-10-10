import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.terms import TermsAcceptance
from tests.test_email_and_feedback import database


def account(client, name):
    # These tests model accounts created before terms publication.
    version = settings.terms_version
    settings.terms_version = ''
    try:
        assert client.post('/api/v1/auth/register', json={
            'username': name, 'email': name+'@example.com', 'password': 'testing-password',
        }).status_code == 201
    finally:
        settings.terms_version = version
    token = client.post('/api/v1/auth/login', json={
        'email_or_username': name, 'password': 'testing-password',
    }).json()['access_token']
    return {'Authorization': 'Bearer '+token}


@pytest.fixture
def document(monkeypatch):
    monkeypatch.setattr(settings, 'terms_version', 'v1')
    monkeypatch.setattr(settings, 'terms_document_url', 'https://example.com/agb/v1.pdf')
    monkeypatch.setattr(settings, 'terms_document_sha256', 'a'*64)


def test_registration_requires_explicit_current_terms_and_stores_acceptance(client, document):
    payload = {'username':'newterms','email':'newterms@example.com','password':'testing-password'}
    for extra, status in [({},422), ({'terms_accepted':'true'},422),
                          ({'terms_accepted':True,'terms_version':'old','terms_document_sha256':'a'*64},409)]:
        assert client.post('/api/v1/auth/register', json={**payload, **extra}).status_code == status
    with database(client) as db:
        from app.models.user import User
        assert db.scalar(select(User).where(User.username == 'newterms')) is None
    accepted = {**payload,'terms_accepted':True,'terms_version':'v1','terms_document_sha256':'a'*64}
    assert client.post('/api/v1/auth/register', json=accepted).status_code == 201
    token = client.post('/api/v1/auth/login',json={'email_or_username':'newterms','password':'testing-password'}).json()['access_token']
    result = client.get('/api/v1/terms/me',headers={'Authorization':'Bearer '+token}).json()
    assert result['accepted_current'] is True
    assert len(result['acceptances']) == 1
    assert result['acceptances'][0]['document_sha256'] == 'a'*64


def test_terms_explicit_versioned_isolated_and_deleted(client, monkeypatch, document):
    first = account(client, 'first')
    second = account(client, 'second')
    assert client.get('/api/v1/terms/me').status_code == 401
    assert client.get('/api/v1/terms/me', headers=first).json()['accepted_current'] is False
    payload = {'accepted': True, 'version': 'v1', 'client': 'android'}
    assert client.post('/api/v1/terms/accept', headers=first, json={**payload,'accepted':False}).status_code == 400
    assert client.post('/api/v1/terms/accept', headers=first, json={**payload,'accepted':'true'}).status_code == 422
    assert client.post('/api/v1/terms/accept', headers=first, json={**payload,'version':'old'}).status_code == 409
    accepted = client.post('/api/v1/terms/accept', headers=first, json=payload).json()
    assert accepted['document_sha256'] == 'a'*64
    assert accepted['accepted_at'].endswith('Z') or accepted['accepted_at'].endswith('+00:00')
    assert client.post('/api/v1/terms/accept', headers=first, json=payload).json() == accepted
    assert client.get('/api/v1/terms/me', headers=second).json()['acceptances'] == []
    monkeypatch.setattr(settings, 'terms_document_sha256', 'b'*64)
    assert client.post('/api/v1/terms/accept', headers=first, json=payload).status_code == 409
    monkeypatch.setattr(settings, 'terms_version', 'v2')
    assert client.get('/api/v1/terms/me', headers=first).json()['accepted_current'] is False
    assert client.post('/api/v1/terms/accept', headers=first, json={**payload,'version':'v2'}).status_code == 200
    assert len(client.get('/api/v1/terms/me', headers=first).json()['acceptances']) == 2
    assert client.request('DELETE','/api/v1/users/me/account', headers=first,json={'password':'testing-password'}).status_code == 204
    with database(client) as db:
        assert list(db.scalars(select(TermsAcceptance))) == []


def test_unpublished_terms_do_not_record_acceptance(client, monkeypatch):
    monkeypatch.setattr(settings,'terms_version','')
    h = account(client,'unpublished')
    assert client.get('/api/v1/terms/config').json()['configured'] is False
    assert client.post('/api/v1/terms/accept',headers=h,json={'accepted':True,'version':'v1'}).status_code == 503


def test_android_discovery_exposes_password_login(client, monkeypatch):
    monkeypatch.setattr(settings,'android_app_enabled',True)
    monkeypatch.setattr(settings,'android_package_name','com.example.feely')
    config = client.get('/api/v1/auth/android/config').json()
    assert 'google' not in config
    assert 'google' not in config['endpoints']
    assert config['password_login_enabled'] is True
    assert config['package_name'] == 'com.example.feely'
    for path in config['endpoints'].values():
        assert path in client.app.openapi()['paths']
    monkeypatch.setattr(settings,'android_app_enabled',False)
    disabled = client.get('/api/v1/auth/android/config').json()
    assert disabled['password_login_enabled'] is False


def test_published_terms_gate_features_and_revisions(client, monkeypatch, document):
    headers = account(client, 'gated')
    assert client.get('/api/v1/terms/config').json()['enforced'] is True
    assert client.get('/api/v1/users/me/profile', headers=headers).status_code == 423
    assert client.get('/api/v1/users/me/account', headers=headers).status_code == 200
    assert client.get('/api/v1/billing/subscription', headers=headers).status_code == 200
    payload = {'accepted': True, 'version': 'v1', 'document_sha256': 'b'*64, 'client': 'web'}
    assert client.post('/api/v1/terms/accept', headers=headers, json=payload).status_code == 409
    assert client.get('/api/v1/terms/me', headers=headers).json()['accepted_current'] is False
    payload['document_sha256'] = 'a'*64
    assert client.post('/api/v1/terms/accept', headers=headers, json=payload).status_code == 200
    assert client.get('/api/v1/users/me/profile', headers=headers).status_code == 200
    monkeypatch.setattr(settings, 'terms_version', 'v2')
    assert client.get('/api/v1/users/me/profile', headers=headers).status_code == 423
    assert client.get('/api/v1/terms/me', headers=headers).json()['accepted_current'] is False
    assert client.request('DELETE', '/api/v1/users/me/account', headers=headers,
                          json={'password': 'testing-password'}).status_code == 204


def test_publish_terms_preserves_versions_and_other_settings(tmp_path):
    import hashlib
    from scripts.publish_terms import publish
    draft = tmp_path / 'working.html'
    draft.write_text('<html>ENTWURF</html>', encoding='utf-8')
    env = tmp_path / '.env'
    env.write_text('KEEP_ME="unchanged"\nTERMS_VERSION="old"\n', encoding='utf-8')
    with pytest.raises(ValueError):
        publish(draft, 'v1', 'https://app.example.com', tmp_path)
    assert 'TERMS_VERSION="old"' in env.read_text()
    draft.write_text('<html>Finished sample terms</html>', encoding='utf-8')
    result = publish(draft, 'v1', 'https://app.example.com', tmp_path)
    assert result.read_bytes() == draft.read_bytes()
    config = env.read_text()
    assert 'KEEP_ME="unchanged"' in config
    assert hashlib.sha256(draft.read_bytes()).hexdigest() in config
    assert 'https://app.example.com/legal/agb/v1.html' in config
    draft.write_text('<html>Changed terms</html>', encoding='utf-8')
    with pytest.raises(FileExistsError):
        publish(draft, 'v1', 'https://app.example.com', tmp_path)
    assert env.read_text() == config
