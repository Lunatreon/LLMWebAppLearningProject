import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.terms import TermsAcceptance
from tests.test_email_and_feedback import database


def account(client, name):
    assert client.post('/api/v1/auth/register', json={
        'username': name, 'email': name+'@example.com', 'password': 'testing-password',
    }).status_code == 201
    token = client.post('/api/v1/auth/login', json={
        'email_or_username': name, 'password': 'testing-password',
    }).json()['access_token']
    return {'Authorization': 'Bearer '+token}


@pytest.fixture
def document(monkeypatch):
    monkeypatch.setattr(settings, 'terms_version', 'v1')
    monkeypatch.setattr(settings, 'terms_document_url', 'https://example.com/agb/v1.pdf')
    monkeypatch.setattr(settings, 'terms_document_sha256', 'a'*64)


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


def test_android_discovery_reuses_verified_google_audience(client, monkeypatch):
    monkeypatch.setattr(settings,'android_app_enabled',True)
    monkeypatch.setattr(settings,'android_package_name','com.example.feely')
    monkeypatch.setattr(settings,'google_auth_enabled',True)
    monkeypatch.setattr(settings,'google_client_id','web-client.apps.googleusercontent.com')
    config = client.get('/api/v1/auth/android/config').json()
    assert config['google']['server_client_id'] == settings.google_client_id
    assert config['password_login_enabled'] is True
    assert config['package_name'] == 'com.example.feely'
    for path in config['endpoints'].values():
        assert path in client.app.openapi()['paths']
    monkeypatch.setattr(settings,'android_app_enabled',False)
    disabled = client.get('/api/v1/auth/android/config').json()
    assert disabled['google'] == {'enabled':False,'server_client_id':None}
