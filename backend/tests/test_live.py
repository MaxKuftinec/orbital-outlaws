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
        self.reserve_kg = 36.
        self.clock = self

    def acquire_ownership(self):
        pass

    def checkpoint_clock(self):
        pass

    def stop_clock(self):
        pass

    def ensure_world(self):
        return {'id': 'kestrel'}

    def connect_player(self, pilot_id):
        return self.get_entity('kestrel', 'pilot-'+pilot_id)

    def get_entity(self, world, entity):
        return {'id':entity,'version':self.version,'state':{
            'x':260,'heading':0,'fuel_kg':200},
            'auto_burn':getattr(self,'auto_burn',None)}

    def spawn_raider(self, pilot_id):
        return {'ship': {'id': 'raider-03', 'name': 'RAIDER-03'}, 'intent': 'orbit', 'faction': 'raider', 'ship_count': 3}

    def respawn_player(self, pilot_id):
        previous=self.hp>0
        self.hp=100
        self.credits=65;self.upgrades={}
        return {'pilot_id':pilot_id,'hp':100,'progress_preserved':False,
                'previous_ship_abandoned':previous}

    def spawn_ally(self, pilot_id):
        return {'ship': {'id': 'ally-02', 'name': 'ALLY-02'}, 'intent': 'flyby', 'faction': 'ally', 'ship_count': 1}

    def player_progress(self, pilot_id):
        return {'credits':self.credits,'upgrades':dict(self.upgrades),'reserve_kg':self.reserve_kg}

    def set_player_reserve(self,pilot_id,kg):
        if not 0 <= kg <= 200:
            raise ValueError('Invalid reserve')
        self.reserve_kg=kg
        return self.player_progress(pilot_id)

    def player_encounter(self, pilot_id):
        return {'saved_at_utc':1234, 'snapshot':{
            'version':3,'player':{'hp':self.hp,'ammo':self.ammo,'alive':True},
            'enemies':[{'id':'raider-01','alive':False}],
            'ally':{'id':'ally-01','alive':True},'shots':[],'pickups':[]}}

    def player_auto_start(self, pilot_id, **command):
        self.auto_burn={'status':'aligning','active':True,**command}
        return {'pilot_id':pilot_id,'auto_burn':self.auto_burn}

    def player_auto_abort(self, pilot_id):
        self.auto_burn={**self.auto_burn,'status':'aborted','active':False}
        return {'pilot_id':pilot_id,'auto_burn':self.auto_burn}

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
        with client.websocket_connect(f'/players/{pilot}/live') as ws:
            welcome=receive_type(ws,'welcome')
            assert welcome['progress']['credits']==65
            assert welcome['encounter']['snapshot']['enemies'][0]['alive'] is False
            ws.send_json({'type':'input','seq':17,'thrust':True,'turn':1,
                          'stabilize':False,'gimbal':0,
                          'fire':True,'repair':True,'aim_x':1,'aim_y':0})
            update=receive_type(ws,'snapshot')
            assert update['input_ack']==17
            assert update['flight']['version']>=1
            assert update['encounter']['snapshot']['player']['ammo']==35
            assert update['encounter']['snapshot']['player']['hp']==86
            ws.send_json({'type':'purchase','upgrade':'ephemeris'})
            assert receive_type(ws,'progress')['progress']['credits']==20
            ws.send_json({'type':'reserve','kg':74})
            assert receive_type(ws,'progress')['progress']['reserve_kg']==74
            ws.send_json({'type':'purchase','upgrade':'ephemeris'})
            assert receive_type(ws,'progress')['progress']['credits']==20
            ws.send_json({'type':'salvage','id':'forged-credit','credits':50})
            assert 'server-owned' in receive_type(ws,'error')['message']
        with client.websocket_connect(f'/players/{pilot}/live') as ws:
            resumed=receive_type(ws,'welcome')
            assert resumed['progress']['upgrades']['ephemeris']
            assert resumed['progress']['reserve_kg']==74
            assert resumed['encounter']['snapshot']['player']['ammo']==35


def test_websocket_denies_public_development_access(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main,'store',lambda:StubStore())
    monkeypatch.delenv('ORBITAL_DEV_COMMANDS',raising=False)
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/players/'+'b'*32+'/live'):
                pass


def test_dev_spawn_raider_is_explicitly_guarded(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, 'store', lambda: StubStore())
    url = '/dev/players/' + 'c' * 32 + '/raiders'
    with TestClient(app) as client:
        monkeypatch.delenv('ORBITAL_DEV_COMMANDS', raising=False)
        assert client.post(url).status_code == 401
        monkeypatch.setenv('ORBITAL_DEV_COMMANDS', '1')
        spawned = client.post(url)
        assert spawned.status_code == 201, spawned.text
        assert spawned.json()['ship']['id'] == 'raider-03'
        assert client.post('/dev/players/not-a-pilot/raiders').status_code == 400


def test_dev_ally_spawn_is_also_guarded(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, 'store', lambda: StubStore())
    url = '/dev/players/' + 'd' * 32 + '/allies'
    with TestClient(app) as client:
        monkeypatch.delenv('ORBITAL_DEV_COMMANDS', raising=False)
        assert client.post(url).status_code == 401
        monkeypatch.setenv('ORBITAL_DEV_COMMANDS', '1')
        response = client.post(url)
        assert response.status_code == 201
        assert response.json()['ship']['id'] == 'ally-02'
        assert response.json()['faction'] == 'ally'
        assert client.post('/dev/players/bad/allies').status_code == 400



def test_dev_respawn_requires_flag_and_replaces_live_ship(monkeypatch):
    import app.main as main
    db=StubStore()
    monkeypatch.setattr(main,'store',lambda:db)
    url='/dev/players/'+'a'*32+'/respawn'
    with TestClient(app) as client:
        monkeypatch.delenv('ORBITAL_DEV_COMMANDS',raising=False)
        assert client.post(url).status_code==401
        monkeypatch.setenv('ORBITAL_DEV_COMMANDS','1')
        assert client.post('/dev/players/wrong/respawn').status_code==400
        fresh=client.post(url)
        assert fresh.status_code==200,fresh.text
        assert fresh.json()['previous_ship_abandoned'] is True
        db.hp=0
        revived=client.post(url)
        assert revived.status_code==200,revived.text
        assert revived.json()['hp']==100
        assert revived.json()['previous_ship_abandoned'] is False
        assert revived.json()['progress_preserved'] is False


def test_websocket_routes_specific_assistance_donor_to_server(monkeypatch):
    import app.main as main
    db=StubStore()
    commands=[]
    def request_assistance(pilot, recipient='player', donor=None):
        commands.append((pilot,recipient,donor))
        return {'status':'queued','recipient':recipient,'donor':donor}
    db.request_assistance=request_assistance
    monkeypatch.setattr(main,'store',lambda:db)
    monkeypatch.setenv('ORBITAL_DEV_COMMANDS','1')
    pilot='a'*32  # Pilot IDs must be valid hexadecimal UUID strings.
    with TestClient(app) as client:
        with client.websocket_connect(f'/players/{pilot}/live') as ws:
            receive_type(ws,'welcome')
            ws.send_json({'type':'request_assistance','recipient':'player','donor':'ally-02'})
            reply=receive_type(ws,'assistance')
            assert reply['result']=={'status':'queued','recipient':'player','donor':'ally-02'}
            assert commands==[(pilot,'player','ally-02')]
            ws.send_json({'type':'request_assistance','recipient':'player'})
            receive_type(ws,'assistance')
            assert commands[-1]==(pilot,'player',None)


def test_websocket_guided_burn_accepts_commands_and_reports_status(monkeypatch):
    import app.main as main
    db=StubStore()
    monkeypatch.setattr(main,'store',lambda:db)
    monkeypatch.setenv('ORBITAL_DEV_COMMANDS','1')
    pilot='e'*32
    with TestClient(app) as client:
        with client.websocket_connect(f'/players/{pilot}/live') as ws:
            receive_type(ws,'welcome')
            ws.send_json({'type':'auto_burn_start','direction':'prograde',
                          'reference':'kestrel','cutoff':'duration',
                          'duration_s':5})
            accepted=receive_type(ws,'auto_burn')
            assert accepted['result']['auto_burn']['active'] is True
            snap=receive_type(ws,'snapshot')
            assert snap['flight']['auto_burn']['status']=='aligning'
            ws.send_json({'type':'auto_burn_abort'})
            stopped=receive_type(ws,'auto_burn')
            assert stopped['result']['auto_burn']['status']=='aborted'
            ws.send_json({'type':'auto_burn_start','direction':'prograde',
                          'cutoff':'duration','duration_s':100})
            bad=receive_type(ws,'error')
            assert 'less than or equal to 40' in bad['message']
