import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from app.main import app


class StubStore:
    def __init__(self):
        self.credits = 65
        self.upgrades = {}
        self.version = 0
        self.ammo = 36
        self.hp = 85

    def ensure_world(self):
        return {'id': 'kestrel'}

    def connect_player(self, pilot_id):
        return self.get_entity('kestrel', 'pilot-'+pilot_id)

    def get_entity(self, world, entity):
        return {'id':entity,'version':self.version,'state':{
            'x':260,'heading':0,'fuel_kg':200}}

    def spawn_raider(self, pilot_id):
        return {'enemy': {'id': 'raider-03', 'name': 'RAIDER-03'}, 'enemy_count': 3}

    def player_progress(self, pilot_id):
        return {'credits':self.credits,'upgrades':dict(self.upgrades)}

    def player_encounter(self, pilot_id):
        return {'saved_at_utc':1234, 'snapshot':{
            'version':3,'player':{'hp':self.hp,'ammo':self.ammo,'alive':True},
            'enemies':[{'id':'raider-01','alive':False}],
            'ally':{'id':'ally-01','alive':True},'shots':[],'pickups':[]}}

    def player_input(self, pilot_id, thrust, turn, stabilize, gimbal):
        self.version += 1

    def player_fire(self, pilot_id, dx, dy):
        self.ammo -= 1
        return True

    def player_repair(self, pilot_id):
        self.hp = min(100,self.hp+1)
        return True

    def player_purchase(self, pilot_id, upgrade):
        prices={'predictive':40,'trajectory':25,'nav':60,'ephemeris':45}
        if upgrade not in prices:raise ValueError('Unknown upgrade')
        if upgrade not in self.upgrades:
            if self.credits<prices[upgrade]:raise ValueError('Insufficient credits')
            self.credits-=prices[upgrade]
            self.upgrades[upgrade]=True
        return self.player_progress(pilot_id)


def receive_type(ws,kind):
    for _ in range(12):
        packet=ws.receive_json()
        if packet['type']==kind:return packet
    raise AssertionError('Missing WebSocket packet '+kind)


def test_websocket_sector_combat_and_ephemeris(monkeypatch):
    import app.main as main
    db=StubStore()
    monkeypatch.setattr(main,'store',lambda:db)
    monkeypatch.setenv('ORBITAL_DEV_COMMANDS','1')
    pilot='a'*32
    with TestClient(app) as client:
        assert client.get('/').json()['status']=='ok'
        with client.websocket_connect(f'/api/players/{pilot}/live') as ws:
            welcome=receive_type(ws,'welcome')
            assert welcome['progress']['credits']==65
            assert welcome['encounter']['snapshot']['enemies'][0]['alive'] is False
            ws.send_json({'type':'input','thrust':True,'turn':1,
                          'stabilize':False,'gimbal':0,
                          'fire':True,'repair':True,'aim_x':1,'aim_y':0})
            update=receive_type(ws,'snapshot')
            assert update['flight']['version']>=1
            assert update['encounter']['snapshot']['player']['ammo']==35
            assert update['encounter']['snapshot']['player']['hp']==86
            ws.send_json({'type':'purchase','upgrade':'ephemeris'})
            assert receive_type(ws,'progress')['progress']['credits']==20
            ws.send_json({'type':'purchase','upgrade':'ephemeris'})
            assert receive_type(ws,'progress')['progress']['credits']==20
            ws.send_json({'type':'salvage','id':'forged-credit','credits':50})
            assert 'server-owned' in receive_type(ws,'error')['message']
        with client.websocket_connect(f'/api/players/{pilot}/live') as ws:
            resumed=receive_type(ws,'welcome')
            assert resumed['progress']['upgrades']['ephemeris']
            assert resumed['encounter']['snapshot']['player']['ammo']==35


def test_websocket_denies_public_development_access(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main,'store',lambda:StubStore())
    monkeypatch.delenv('ORBITAL_DEV_COMMANDS',raising=False)
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/api/players/'+'b'*32+'/live'):
                pass


def test_dev_spawn_raider_is_explicitly_guarded(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, 'store', lambda: StubStore())
    url = '/api/dev/players/' + 'c' * 32 + '/raiders'
    with TestClient(app) as client:
        monkeypatch.delenv('ORBITAL_DEV_COMMANDS', raising=False)
        assert client.post(url).status_code == 403
        monkeypatch.setenv('ORBITAL_DEV_COMMANDS', '1')
        spawned = client.post(url)
        assert spawned.status_code == 201, spawned.text
        assert spawned.json()['enemy']['id'] == 'raider-03'
        assert client.post('/api/dev/players/not-a-pilot/raiders').status_code == 400
