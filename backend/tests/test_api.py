import math
from fastapi.testclient import TestClient
from app.main import app, store
from app.store import WorldStore


def test_api_create_query_persist(monkeypatch,tmp_path):
    # Switch the dependency cache to an isolated on-disk database for this test
    import app.main as main
    main.store.cache_clear()
    monkeypatch.setenv('DATABASE_URL',f'sqlite:///{tmp_path}/universe.sqlite')
    monkeypatch.setenv('ORBITAL_DEV_COMMANDS','1')
    with TestClient(app) as client:
        assert client.get('/').json()['status']=='ok'
        v=math.sqrt(310000/260)
        create=client.post('/api/worlds/kestrel/entities',json={
            'id':'Kestrel-test','kind':'ship','x':260,'y':0,'vx':0,'vy':v,'mass_kg':1110,'fuel_kg':200})
        assert create.status_code==201,create.text
        view=client.get('/api/worlds/kestrel/viewport',params={'cx':260,'cy':0,'radius_km':60})
        assert view.status_code==200
        assert view.json()['entities'][0]['id']=='Kestrel-test'
        command={'dvx':0,'dvy':1,'idempotency_key':'command-1','reserve_kg':36}
        a=client.post('/api/worlds/kestrel/entities/Kestrel-test/impulses',json=command)
        assert a.status_code==200,a.text
        assert a.json()['state']['fuel_kg']<200
        again=client.post('/api/worlds/kestrel/entities/Kestrel-test/impulses',json=command)
        assert again.json()['replayed'] is True
        get=client.get('/api/worlds/kestrel/entities/Kestrel-test')
        assert get.status_code==200
        assert get.json()['version']==1
    main.store.cache_clear()
