import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from app.main import app


class StubStore:
    def __init__(self):
        self.credits = 65
        self.upgrades = {}
        self.claims = set()
        self.version = 0

    def ensure_world(self):
        return {'id': 'kestrel'}

    def connect_player(self, pilot_id):
        return self.get_entity('kestrel','pilot-'+pilot_id)

    def get_entity(self, world, entity):
        return {'id':entity,'version':self.version,'state':{'x':260,'heading':0,'fuel_kg':200}}

    def player_progress(self, pilot_id):
        return {'credits':self.credits,'upgrades':dict(self.upgrades)}

    def player_input(self, pilot_id, thrust, turn, stabilize, gimbal):
        self.version += 1
        return self.get_entity('kestrel','pilot-'+pilot_id)

    def player_purchase(self, pilot_id, upgrade):
        prices={'predictive':40,'trajectory':25,'nav':60}
        if upgrade not in prices:
            raise ValueError('Unknown upgrade')
        if upgrade not in self.upgrades:
            if self.credits<prices[upgrade]:
                raise ValueError('Insufficient credits')
            self.credits-=prices[upgrade]
            self.upgrades[upgrade]=True
        return self.player_progress(pilot_id)

    def player_salvage(self, pilot_id, claim_id, amount):
        if claim_id not in self.claims:
            self.credits+=amount
            self.claims.add(claim_id)
        return self.player_progress(pilot_id)


def receive_type(ws,kind):
    for _ in range(8):
        packet=ws.receive_json()
        if packet['type']==kind:return packet
    raise AssertionError('Missing WebSocket packet type '+kind)


def test_websocket_stream_and_economy(monkeypatch):
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
            ws.send_json({'type':'input','thrust':True,'turn':1,'stabilize':False,'gimbal':0})
            assert receive_type(ws,'snapshot')['flight']['version']>=1
            ws.send_json({'type':'purchase','upgrade':'predictive'})
            assert receive_type(ws,'progress')['progress']['credits']==25
            ws.send_json({'type':'purchase','upgrade':'predictive'})
            assert receive_type(ws,'progress')['progress']['credits']==25
            ws.send_json({'type':'salvage','id':'starter-credits-0','credits':24})
            assert receive_type(ws,'progress')['progress']['credits']==49
            ws.send_json({'type':'salvage','id':'starter-credits-0','credits':24})
            assert receive_type(ws,'progress')['progress']['credits']==49
        with client.websocket_connect(f'/api/players/{pilot}/live') as ws:
            restored=receive_type(ws,'welcome')
            assert restored['progress']['credits']==49
            assert restored['progress']['upgrades']['predictive']


def test_websocket_requires_local_dev_mode(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main,'store',lambda:StubStore())
    monkeypatch.delenv('ORBITAL_DEV_COMMANDS',raising=False)
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/api/players/'+'b'*32+'/live'):
                pass
