import math
from app.physics import State
from app.universe import (new_sector, advance_sector, player_fire, hit_swept, fire)


def pilot():
    angle=-.67
    r=260
    speed=math.sqrt(310000/r)
    return State(r*math.cos(angle),r*math.sin(angle),
                 -speed*math.sin(angle),speed*math.cos(angle),1110,200)


def test_sector_npcs_decide_fire_and_resolve_projectiles_without_a_browser():
    sector=new_sector(0)
    result,effects=advance_sector(sector,20,pilot())
    assert result['t']==20
    assert result['ally']['ammo']<120
    assert any(e['ammo']<999 for e in result['enemies'])
    assert isinstance(result['events'],list)
    assert effects['credits']>=0


def test_fast_projectiles_cannot_tunnel_through_target():
    projectile_start={'x':0,'y':0}
    projectile_end={'x':300,'y':0}
    target_start={'x':140,'y':5}
    target_end={'x':150,'y':5}
    assert hit_swept(projectile_start,projectile_end,target_start,target_end,14)
    assert not hit_swept(projectile_start,projectile_end,
                         {'x':140,'y':45},{'x':150,'y':45},14)


def test_projectiles_are_server_generated_with_ammunition_and_cooldowns():
    sector=new_sector(0)
    start=pilot()
    assert player_fire(sector,start,0,1,0)
    assert len(sector['shots'])==1
    assert sector['player']['ammo']==35
    assert not player_fire(sector,start,.1,1,0)
    assert sector['shots'][0]['id'].startswith('shot-')


def test_combat_is_repeatable_given_the_same_world_time_and_initial_state():
    one=advance_sector(new_sector(0),10,pilot())[0]
    two=advance_sector(new_sector(0),10,pilot())[0]
    assert one==two
