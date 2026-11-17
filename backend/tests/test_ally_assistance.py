"""End-to-end request flow for any living allied recipient."""
import copy
from uuid import uuid4

from app.models import EncounterSnapshot
from app.store import WorldStore


def test_manual_assistance_can_target_a_newly_spawned_friendly_ship(postgres_url):
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    store.player_encounter(pilot)
    spawned=store.spawn_ally(pilot)
    target=spawned['ship']['id']
    with store.sessions.begin() as session:
        saved=session.get(EncounterSnapshot,'pilot-'+pilot)
        snap=copy.deepcopy(saved.snapshot)
        selected=next(a for a in snap['allies'] if a['id']==target)
        selected['fuel']=120.  # below capacity but above NPC's automatic distress threshold
        snap['assistance']=[]
        saved.snapshot=snap
    result=store.request_assistance(pilot,target)
    assert result=={'status':'queued','recipient':target}
    sector=store.player_encounter(pilot)['snapshot']
    assert any(o['recipient']==target for o in sector['assistance'])
    assert any(a['id']==target for a in sector['allies'])


def _fuel_short_player_with_two_allies(store, pilot):
    """Prepare realistic selected-donor orders independent of NPC arrival randomness."""
    from app.models import Entity, World
    eid='pilot-'+pilot
    with store.sessions.begin() as db:
        saved=db.get(EncounterSnapshot,eid)
        sector=copy.deepcopy(saved.snapshot)
        sector['ally']['fuel']=140.
        sector['ally']['arrivalPhase']='orbiting'
        new=next(a for a in sector['allies'] if a['id']=='ally-02')
        new['arrivalPhase']='orbiting'
        new['fuel']=150.
        sector['assistance']=[]
        saved.snapshot=sector
        ship=db.get(Entity,eid)
        state=dict(ship.checkpoint)
        old_fuel=state['fuel_kg']
        state['fuel_kg']=55.
        state['mass_kg']+=55.-old_fuel
        ship.checkpoint=state
        world=db.get(World,'kestrel')
        ship.checkpoint_s=store.now(world)


def test_user_can_choose_second_ally_then_reassign_first_as_fuel_donor(postgres_url):
    import pytest
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    store.player_encounter(pilot)
    assert store.spawn_ally(pilot)['ship']['id']=='ally-02'
    _fuel_short_player_with_two_allies(store,pilot)

    queued=store.request_assistance(pilot,'player','ally-02')
    assert queued=={'status':'queued','recipient':'player','donor':'ally-02'}
    state=store.player_encounter(pilot)['snapshot']
    request=next(o for o in state['assistance'] if o['recipient']=='player')
    assert request['donor']=='ally-02'
    assert request['manualDonor'] is True
    with pytest.raises(ValueError,match='already assigned'):
        store.request_assistance(pilot,'player','ally-02')

    reassigned=store.request_assistance(pilot,'player','ally-01')
    assert reassigned['donor']=='ally-01'
    state=store.player_encounter(pilot)['snapshot']
    orders=[o for o in state['assistance'] if o['recipient']=='player']
    assert len(orders)==1
    assert orders[0]['donor']=='ally-01'
    assert orders[0]['manualDonor'] is True
    assert any('AEGIS-01' in e['message'] for e in state['events'])


def test_selected_donor_rejects_unavailable_or_ineligible_allies(postgres_url):
    import pytest
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    store.player_encounter(pilot)
    store.spawn_ally(pilot)
    _fuel_short_player_with_two_allies(store,pilot)
    with pytest.raises(ValueError,match='not a living friendly'):
        store.request_assistance(pilot,'player','raider-01')
    with store.sessions.begin() as db:
        saved=db.get(EncounterSnapshot,'pilot-'+pilot)
        sector=copy.deepcopy(saved.snapshot)
        sector['allies'][0]['fuel']=35.
        saved.snapshot=sector
    with pytest.raises(ValueError,match='more than 55 kg'):
        store.request_assistance(pilot,'player','ally-02')
    with store.sessions.begin() as db:
        saved=db.get(EncounterSnapshot,'pilot-'+pilot)
        sector=copy.deepcopy(saved.snapshot)
        sector['allies'][0]['fuel']=140.
        sector['allies'][0]['arrivalPhase']='insertion_burn'
        saved.snapshot=sector
    with pytest.raises(ValueError,match='still arriving'):
        store.request_assistance(pilot,'player','ally-02')
