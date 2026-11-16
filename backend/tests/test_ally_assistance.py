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
