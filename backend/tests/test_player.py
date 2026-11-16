import time, math
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app


def test_player_persists_and_uses_lease_limited_burn(monkeypatch, postgres_url):
    import app.main as main
    monkeypatch.setenv('DATABASE_URL', postgres_url)
    monkeypatch.setenv('ORBITAL_DEV_COMMANDS', '1')
    main.store.cache_clear()
    pid = uuid4().hex
    with TestClient(app) as client:
        url = '/players/' + pid
        first = client.post(url)
        assert first.status_code == 200, first.text
        assert first.json()['state']['fuel_kg'] == 200
        state=first.json()['state']
        assert math.hypot(state['x'],state['y'])>900
        assert 20<=math.hypot(state['vx'],state['vy'])<=32
        command = {'thrust': True, 'turn': 0, 'stabilize': False, 'gimbal': 0}
        assert client.post(url+'/input', json=command).status_code == 200
        time.sleep(.12)
        released = client.post(url+'/input', json={**command, 'thrust': False})
        assert released.status_code == 200, released.text
        fuel = released.json()['state']['fuel_kg']
        assert fuel < 200
        assert client.post(url).json()['state']['fuel_kg'] == fuel
        assert client.get(url).json()['state']['fuel_kg'] == fuel
    main.store.cache_clear()
