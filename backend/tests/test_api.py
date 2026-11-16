import math
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app


def test_api_create_query_persist(monkeypatch, postgres_url):
    import app.main as main
    monkeypatch.setenv('DATABASE_URL', postgres_url)
    monkeypatch.setenv('ORBITAL_DEV_COMMANDS', '1')
    main.store.cache_clear()
    entity = 'test-' + uuid4().hex
    with TestClient(app) as client:
        assert client.get('/').json()['status'] == 'ok'
        v = math.sqrt(310000 / 260)
        create = client.post('/api/worlds/kestrel/entities', json={
            'id': entity, 'kind': 'ship', 'x': 260, 'y': 0, 'vx': 0, 'vy': v, 'mass_kg': 1110, 'fuel_kg': 200})
        assert create.status_code == 201, create.text
        view = client.get('/api/worlds/kestrel/viewport', params={'cx': 260, 'cy': 0, 'radius_km': 60})
        assert view.status_code == 200
        assert entity in [e['id'] for e in view.json()['entities']]
        command = {'dvx': 0, 'dvy': 1, 'idempotency_key': 'cmd-' + entity, 'reserve_kg': 36}
        a = client.post(f'/api/worlds/kestrel/entities/{entity}/impulses', json=command)
        assert a.status_code == 200, a.text
        assert a.json()['state']['fuel_kg'] < 200
        again = client.post(f'/api/worlds/kestrel/entities/{entity}/impulses', json=command)
        assert again.json()['replayed'] is True
        get = client.get(f'/api/worlds/kestrel/entities/{entity}')
        assert get.status_code == 200
        assert get.json()['version'] == 1
    main.store.cache_clear()
