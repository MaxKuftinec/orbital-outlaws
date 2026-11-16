import math
import pytest
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



def test_random_launch_velocity_is_independent_of_position_and_can_be_retrograde():
    from app.universe import incoming_ship, resolve_arrival
    from app.physics import orbital_envelope
    mu = 310000
    directions = [0., math.pi/2, math.pi, 3*math.pi/2]
    for direction in directions:
        visitor=incoming_ship('raider-09', 0.6, 'flyby', velocity_angle=direction,
                              velocity_speed=27.)
        assert math.isclose(math.atan2(visitor['vy'],visitor['vx'])%(2*math.pi),
                            direction,abs_tol=1e-10)
        assert math.isclose(math.hypot(visitor['vx'],visitor['vy']),27.,abs_tol=1e-10)
        assert visitor['arrivalPhase']=='launch'
        assert math.hypot(visitor['x'],visitor['y'])>900
    cw=incoming_ship('ally-07', 0., 'orbit', True,
                     velocity_angle=-math.pi/2,velocity_speed=26.)
    ccw=incoming_ship('ally-08', 0., 'orbit', True,
                      velocity_angle=math.pi/2,velocity_speed=26.)
    assert cw['orbitDirection']==-1
    assert ccw['orbitDirection']==1
    sector={'events':[]}
    from app.npc_guidance import move_with_burn
    for vessel in (cw,ccw):
        start_v=(vessel['vx'],vessel['vy'])
        initial_fuel=vessel['fuel']
        resolve_arrival(sector,vessel,mu,3.)
        assert vessel['arrivalPhase'] in ('course_burn','failed')
        assert vessel['fuel']==initial_fuel  # planning is not a free impulse
        assert (vessel['vx'],vessel['vy'])==start_v
        if vessel['arrivalPhase']=='course_burn':
            result=move_with_burn(vessel, .25, mu)
            assert result.fuel_kg < initial_fuel
            assert result.mass_kg-result.fuel_kg==pytest.approx(vessel['dryMass'])


def test_flyby_does_not_capture_after_its_course_adjustment():
    from app.universe import incoming_ship, resolve_arrival
    flyby=incoming_ship('raider-06',-.25,'flyby',
                        velocity_angle=2.7,velocity_speed=25.)
    sector={'events':[]}
    resolve_arrival(sector,flyby,310000,3.)
    assert flyby['arrivalPhase'] in ('course_burn','failed')
    assert flyby['fuel']==420.  # queued burn has no immediate effect
    flyby.pop('burn',None)
    flyby['arrivalPhase']='approach'
    flyby['x'],flyby['y']=720.,0.
    flyby['vx'],flyby['vy']=25.,3.
    resolve_arrival(sector,flyby,310000,33.)
    assert flyby['arrivalPhase']=='departed'
    assert flyby['fuel']==420.


def test_salvage_events_report_exact_amounts_and_capacity_limited_gains():
    from app.universe import new_sector, advance_sector
    import math
    initial=pilot()
    sector=new_sector(0)
    sector['enemies']=[]
    sector['ally']['alive']=False
    sector['pickups']=[
        {'id':'fuel-1','type':'fuel','amount':55,'alive':True,'phase':0,
         'x':initial.x,'y':initial.y,'vx':initial.vx,'vy':initial.vy},
        {'id':'wreck-1','type':'wreck','amount':50,'alive':True,'phase':0,
         'x':initial.x,'y':initial.y,'vx':initial.vx,'vy':initial.vy},
        {'id':'parts-1','type':'parts','amount':10,'alive':True,'phase':0,
         'x':initial.x,'y':initial.y,'vx':initial.vx,'vy':initial.vy},
    ]
    sector['player']['repairParts']=22
    state,effects=advance_sector(sector,.25,initial)
    messages=[event['message'] for event in state['events']]
    assert any('+50 ¤' in msg and '+12 rounds' in msg and '+2.0 kg spare parts' in msg for msg in messages)
    assert not any('recovered fuel' in msg for msg in messages)  # Full tanks: no phantom gain.
    assert not any('recovered parts' in msg for msg in messages)
    assert state['player']['repairParts']==24
    assert any(p['id']=='fuel-1' for p in state['pickups'])
    assert any(p['id']=='parts-1' for p in state['pickups'])



def test_incoming_ship_arrival_is_finite_and_does_not_grant_free_capture():
    from app.universe import incoming_ship
    sector=new_sector(0)
    sector['enemies']=[]
    sector['ally']['alive']=False
    sector['pickups']=[]
    orbiter=incoming_ship('ally-02', 1.0, 'orbit', True,
                          velocity_angle=1.0+2.4, velocity_speed=26.)
    visitor=incoming_ship('ally-03', -1.1, 'flyby', True,
                          velocity_angle=-1.1+2.4, velocity_speed=26.)
    sector['allies']=[orbiter,visitor]
    updated,_=advance_sector(sector,110,pilot())
    arrived,passing=updated['allies']
    assert arrived['arrivalIntent']=='orbit'
    assert passing['arrivalIntent']=='flyby'
    for vessel in (arrived,passing):
        assert vessel['fuel']<420.
        assert vessel['fuel']>=0.
        assert math.hypot(vessel['x'],vessel['y'])>91. or not vessel['alive']
    assert arrived['arrivalPhase']!='launch'
    assert passing['arrivalPhase']!='launch'


def test_existing_orbit_insertions_require_a_real_finite_burn():
    from app.universe import incoming_ship
    start=incoming_ship('ally-02',0.,'orbit',True,
                        velocity_angle=math.pi/2,velocity_speed=30.)
    radius=start['insertionRadius']
    speed=math.sqrt(310000./radius)
    start.update(x=radius+15.,y=0.,vx=-8.,vy=speed,
                 arrivalPhase='approach',nextArrivalDecision=0.,fuel=220.)
    sector=new_sector(0.)
    sector['allies']=[start]
    sector['enemies']=[]
    sector['ally']['alive']=False
    sector['pickups']=[]
    result,_=advance_sector(sector,25.,pilot())
    inserted=result['allies'][0]
    assert inserted['fuel']<220.  # insertions consume mass over simulated time
    assert inserted['arrivalPhase'] in ('orbiting','approach','insertion_burn','insertion_trim')
    if inserted['arrivalPhase']=='orbiting':
        peri,apo=__import__('app.physics',fromlist=['orbital_envelope']).orbital_envelope(
            State(inserted['x'],inserted['y'],inserted['vx'],inserted['vy']),310000.)
        assert apo is not None and peri>103.
