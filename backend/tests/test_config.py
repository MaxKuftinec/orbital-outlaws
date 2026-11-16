from pathlib import Path
from unittest.mock import Mock


def test_database_url_is_required_and_passed_to_store(monkeypatch):
    import app.main as main
    expected = 'postgresql+psycopg://user:pass@localhost:5432/test'
    monkeypatch.setenv('DATABASE_URL', expected)
    factory = Mock()
    monkeypatch.setattr(main, 'WorldStore', factory)
    main.store.cache_clear()
    main.store()
    factory.assert_called_once_with(expected)
    main.store.cache_clear()


def test_default_env_file_location():
    import app.main as main
    assert (Path(main.__file__).resolve().parents[1] / '.env.example').exists()
