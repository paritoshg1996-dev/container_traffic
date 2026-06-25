"""Backend tests for LoadLink truck load marketplace API."""
import os
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://load-grouping.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# Health
def test_health_root(s):
    r = s.get(f"{API}/", timeout=15)
    assert r.status_code == 200
    assert "message" in r.json()


# Pincode lookup
def test_pincode_valid_delhi(s):
    r = s.get(f"{API}/pincode/110001", timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["pincode"] == "110001"
    # If external API up, expect valid
    if j["valid"]:
        assert j["state"].lower().startswith("delhi")


def test_pincode_valid_mumbai(s):
    r = s.get(f"{API}/pincode/400001", timeout=15)
    assert r.status_code == 200
    j = r.json()
    if j["valid"]:
        assert "maharashtra" in j["state"].lower()


def test_pincode_5digit_returns_400(s):
    r = s.get(f"{API}/pincode/11000", timeout=15)
    assert r.status_code == 400


def test_pincode_nondigit_returns_400(s):
    r = s.get(f"{API}/pincode/ABCDEF", timeout=15)
    assert r.status_code == 400


def test_pincode_invalid_returns_valid_false(s):
    r = s.get(f"{API}/pincode/999999", timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["valid"] is False


# Loads
@pytest.fixture(scope="module")
def created_load(s):
    payload = {
        "origin_pincode": "110001",
        "origin_city": "Delhi",
        "origin_state": "Delhi",
        "destination_pincode": "400001",
        "destination_city": "Mumbai",
        "destination_state": "Maharashtra",
        "cargo_types": ["Bags", "Carton"],
        "cargo_placement": "Stackable",
        "weight_tons": 5.5,
        "space_cuft": 200.0,
        "loading_date": "2026-02-15",
        "poster_name": "TEST_Rajesh",
        "poster_phone": "9876500001",
        "poster_company": "TEST_Transport",
    }
    r = s.post(f"{API}/loads", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "id" in j and j["id"]
    assert "created_at" in j
    assert "_id" not in j
    assert j["weight_tons"] == 5.5
    return j


def test_create_load(created_load):
    assert created_load["poster_phone"] == "9876500001"
    assert created_load["cargo_types"] == ["Bags", "Carton"]


def test_list_loads_returns_created(s, created_load):
    r = s.get(f"{API}/loads", timeout=15)
    assert r.status_code == 200
    arr = r.json()
    assert isinstance(arr, list)
    ids = [x["id"] for x in arr]
    assert created_load["id"] in ids
    for item in arr:
        assert "_id" not in item


def test_list_loads_sorted_newest_first(s):
    # Create second load
    payload = {
        "origin_pincode": "560001",
        "destination_pincode": "600001",
        "cargo_types": ["Drums"],
        "cargo_placement": "Floor Only",
        "weight_tons": 2.0,
        "space_cuft": 80.0,
        "loading_date": "2026-03-01",
        "poster_name": "TEST_Second",
        "poster_phone": "9876500002",
    }
    r = s.post(f"{API}/loads", json=payload, timeout=15)
    assert r.status_code == 200
    new_id = r.json()["id"]
    r2 = s.get(f"{API}/loads", timeout=15)
    arr = r2.json()
    assert arr[0]["id"] == new_id  # newest first


def test_list_loads_filter_by_origin(s, created_load):
    r = s.get(f"{API}/loads", params={"origin": "110001"}, timeout=15)
    assert r.status_code == 200
    arr = r.json()
    assert len(arr) >= 1
    for x in arr:
        assert x["origin_pincode"] == "110001"


def test_list_loads_filter_by_destination(s, created_load):
    r = s.get(f"{API}/loads", params={"destination": "400001"}, timeout=15)
    assert r.status_code == 200
    arr = r.json()
    assert len(arr) >= 1
    for x in arr:
        assert x["destination_pincode"] == "400001"


def test_list_loads_filter_combined(s, created_load):
    r = s.get(f"{API}/loads", params={"origin": "110001", "destination": "400001"}, timeout=15)
    assert r.status_code == 200
    arr = r.json()
    assert any(x["id"] == created_load["id"] for x in arr)


def test_list_loads_filter_no_match(s):
    r = s.get(f"{API}/loads", params={"origin": "111111", "destination": "222222"}, timeout=15)
    assert r.status_code == 200
    assert r.json() == []
