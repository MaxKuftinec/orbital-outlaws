"""Explicit PostgreSQL development resets. This command never runs on import"""
from __future__ import annotations

import argparse
import os
import re

from dotenv import load_dotenv
from sqlalchemy import delete

from .models import Entity, Event, FlightControl, PlayerProgress, SalvageClaim, EncounterSnapshot, Base, World
from .store import WorldStore

load_dotenv()


def reset_pilot(store: WorldStore, pilot_id: str):
    if not re.fullmatch(r'[a-f0-9]{32}', pilot_id):
        raise ValueError('Expected the 32-character browser pilot ID')
    entity_id = 'pilot-' + pilot_id
    with store.sessions.begin() as db:
        for model in (SalvageClaim, EncounterSnapshot, FlightControl, PlayerProgress):
            db.execute(delete(model).where(model.entity_id == entity_id))
        db.execute(delete(Event).where(Event.entity_id == entity_id))
        db.execute(delete(Entity).where(Entity.id == entity_id))


def main():
    parser = argparse.ArgumentParser(description='Destructive local-development game resets')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--pilot', help='Reset one browser pilot (ship, sector, credits and upgrades)')
    group.add_argument('--world', action='store_true', help='Reset ALL Orbital Outlaws tables and pilots')
    parser.add_argument('--confirm', required=True, help='RESET-PILOT or RESET-WORLD')
    args = parser.parse_args()

    if os.environ.get('ORBITAL_DEV_COMMANDS') != '1':
        parser.error('Requires ORBITAL_DEV_COMMANDS=1 in a trusted local environment')
    expected = 'RESET-WORLD' if args.world else 'RESET-PILOT'
    if args.confirm != expected:
        parser.error('Explicit confirmation required: --confirm '+expected)
    url = os.environ['DATABASE_URL']
    if not url.startswith(('postgresql://', 'postgresql+psycopg://')):
        parser.error('Only dedicated PostgreSQL development databases are supported')
    store = WorldStore(url)
    if args.world:
        Base.metadata.drop_all(store.engine)
        Base.metadata.create_all(store.engine)
        store.ensure_world()
        print('Entire development universe reset. All pilots and progress cleared')
    else:
        reset_pilot(store, args.pilot)
        print('Pilot reset. Reload the browser to spawn a fresh spacecraft')


if __name__ == '__main__':
    main()
