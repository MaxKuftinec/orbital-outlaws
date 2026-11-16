from uuid import uuid4
from app.store import WorldStore


def test_encounter_restores_same_raiders_after_reconnect(postgres_url):
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    snapshot={
        't':7.5,'reinforcements':False,'nextEnemySpawn':75,
        'targetId':'raider-01',
        'enemies':[{'id':'raider-01','name':'RAIDER-01','x':280.,
                    'y':0.,'vx':0.,'vy':33.27,'alive':True},
                   {'id':'raider-02','name':'RAIDER-02','x':320.,
                    'y':0.,'vx':0.,'vy':31.13,'alive':False}],
        'ally':{'id':'ally-01','x':272.,'y':0.,'vx':0.,'vy':33.7,'alive':True},
        'pickups':[]
    }
    store.save_encounter(pilot,snapshot)
    reconnected=WorldStore(postgres_url).player_encounter(pilot)
    assert len(reconnected['snapshot']['enemies'])==2
    assert reconnected['snapshot']['enemies'][0]['id']=='raider-01'
    assert reconnected['snapshot']['enemies'][0]['x']>=0
    assert not reconnected['snapshot']['enemies'][1]['alive']
    assert reconnected['snapshot']['t']>=7.5
