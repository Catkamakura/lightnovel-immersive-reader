from bridge.store import Store


def test_upsert_and_get_book(tmp_path):
    s = Store(tmp_path / "s.sqlite3")
    s.upsert_book("1144697", title="T", author="A", translator="Tr", lk_url="u", series="S", volume=2)
    b = s.get_book("1144697")
    assert b["title"] == "T" and b["translator"] == "Tr" and b["series"] == "S"
    # re-import updates fields, keeps a calibre_id we don't re-supply (COALESCE)
    s.upsert_book("1144697", calibre_id=42)
    s.upsert_book("1144697", title="T2", author="A", translator="Tr2", lk_url="u", series="S", volume=2)
    b2 = s.get_book("1144697")
    assert b2["title"] == "T2" and b2["calibre_id"] == 42


def test_list_books(tmp_path):
    s = Store(tmp_path / "s.sqlite3")
    assert s.list_books() == []
    s.upsert_book("1", title="A")
    s.upsert_book("2", title="B")
    assert {b["aid"] for b in s.list_books()} == {"1", "2"}


def test_missing_book_is_none(tmp_path):
    s = Store(tmp_path / "s.sqlite3")
    assert s.get_book("nope") is None
