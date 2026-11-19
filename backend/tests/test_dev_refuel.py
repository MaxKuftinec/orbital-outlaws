"""Dev refueling is capped, mass-conserving, and unavailable to dead pilots."""
import copy
import time
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import EncounterSnapshot, Entity, Event, World
from app.physics import State


def test_dev_refuel_api_fills_tank_and_records_authoritative_events(monkeypatch, postgres_url):
    import app.main as main

    monkeypatch.setenv('DATABASE_URL', postgres_url)
    monkeypatch.setenv('ORBITAL_DEV_COMMANDS', '1')
    main.store.cache_clear()
    pilot = uuid4().hex
    url = f'/dev/players/{pilot}/refuel'

    try:
        with TestClient(app) as client:
            assert client.post(f'/players/{pilot}').status_code == 200
            database = main.store()
            database.player_encounter(pilot)
            entity_id = 'pilot-' + pilot

            # Prepare a partially empty 200 kg tank without a timing-sensitive burn.
            with database.sessions.begin() as db:
                entity = db.get(Entity, entity_id)
                world = db.get(World, 'kestrel')
                original = State(**entity.checkpoint)
                reduced = replace(original, fuel_kg=100., mass_kg=original.mass_kg - 100.)
                entity.checkpoint = reduced.as_dict()
                entity.checkpoint_s = database.now(world)

            response = client.post(url, json={'kg': 25})
            assert response.status_code == 200, response.text
            first = response.json()
            assert first['added_kg'] == pytest.approx(25.)
            assert first['fuel_kg'] == pytest.approx(125.)
            assert first['fuel_capacity_kg'] == 200.
            assert first['state']['mass_kg'] == pytest.approx(original.mass_kg - 75.)

            response = client.post(url)  # No payload means fill completely.
            assert response.status_code == 200, response.text
            filled = response.json()
            assert filled['added_kg'] == pytest.approx(75.)
            assert filled['fuel_kg'] == pytest.approx(200.)
            assert filled['state']['mass_kg'] == pytest.approx(original.mass_kg)
            assert filled['state']['mass_kg'] - filled['state']['fuel_kg'] == pytest.approx(
                original.mass_kg - original.fuel_kg)
            assert client.get(f'/players/{pilot}').json()['state']['fuel_kg'] == pytest.approx(200.)

            full = client.post(url)
            assert full.status_code == 200
            assert full.json()['added_kg'] == 0.
            assert full.json()['version'] == filled['version']

            with database.sessions() as db:
                events = list(db.scalars(select(Event).where(
                    Event.entity_id == entity_id, Event.kind == 'dev_refuel'
                ).order_by(Event.id)))
                assert len(events) == 2
                assert events[0].payload['added_kg'] == pytest.approx(25.)
                assert events[1].payload['added_kg'] == pytest.approx(75.)

            assert client.post(url, json={'kg': 0}).status_code == 422
            assert client.post(url, json={'kg': -2}).status_code == 422
            assert client.post('/dev/players/not-a-valid-id/refuel').status_code == 400
            assert client.post(f'/dev/players/{uuid4().hex}/refuel').status_code == 404

            with database.sessions.begin() as db:
                saved = db.get(EncounterSnapshot, entity_id)
                snapshot = copy.deepcopy(saved.snapshot)
                snapshot['player']['alive'] = False
                snapshot['player']['hp'] = 0
                saved.snapshot = snapshot
                saved.saved_at_utc = time.time()
            assert client.post(url).status_code == 409

            monkeypatch.setenv('ORBITAL_DEV_COMMANDS', '0')
            assert client.post(url).status_code == 401
    finally:
        main.store.cache_clear()
