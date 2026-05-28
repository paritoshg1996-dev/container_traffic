"""Backend tests for geocoding endpoint and Find Space filter support."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://mobile-layout-adapt.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ===== Geocode endpoint =====
def test_geocode_valid_pincode_delhi(s):
    r = s.get(f"{API}/geocode/110001", timeout=20)
    assert r.status_code == 200
    j = r.json()
    assert j["pincode"] == "110001"
    if j["found"]:
        assert isinstance(j["lat"], (int, float))
        assert isinstance(j["lon"], (int, float))
        # Delhi area
        assert 28.0 < j["lat"] < 29.5
        assert 76.5 < j["lon"] < 78.0


def test_geocode_valid_pincode_mumbai(s):
    r = s.get(f"{API}/geocode/400001", timeout=20)
    assert r.status_code == 200
    j = r.json()
    if j["found"]:
        assert 18.5 < j["lat"] < 19.5
        assert 72.5 < j["lon"] < 73.5


def test_geocode_5digit_returns_400(s):
    r = s.get(f"{API}/geocode/11000", timeout=15)
    assert r.status_code == 400


def test_geocode_nondigit_returns_400(s):
    r = s.get(f"{API}/geocode/ABCDEF", timeout=15)
    assert r.status_code == 400


def test_geocode_unknown_returns_found_false(s):
    # 999999 likely not a real pincode in Nominatim
    r = s.get(f"{API}/geocode/999999", timeout=20)
    assert r.status_code == 200
    j = r.json()
    assert j["pincode"] == "999999"
    assert j["found"] is False


def test_geocode_caches_result(s):
    """Second hit on same pincode should be fast (cache hit)."""
    pin = "110001"
    # First hit (might be cached from prior tests)
    s.get(f"{API}/geocode/{pin}", timeout=20)
    # Second hit
    t0 = time.time()
    r = s.get(f"{API}/geocode/{pin}", timeout=20)
    dt = time.time() - t0
    assert r.status_code == 200
    j = r.json()
    if j["found"]:
        # Cache hit should be much faster than external API
        assert dt < 2.0, f"Expected cache hit < 2s, got {dt:.2f}s"


def test_geocode_no_mongo_id_leak(s):
    r = s.get(f"{API}/geocode/110001", timeout=20)
    assert r.status_code == 200
    assert "_id" not in r.json()


# ===== Seed loads for Find Space filter testing =====
@pytest.fixture(scope="module")
def seeded_loads(s):
    """Create loads for filter testing with varied pincodes and cargo types."""
    items = [
        {
            "origin_pincode": "110001", "destination_pincode": "400001",
            "cargo_types": ["Bags", "Boxes"], "cargo_placement": "Stackable",
            "truck_type": "Container", "weight_tons": 5.0, "space_cuft": 300.0,
            "loading_date": "2026-02-15",
            "poster_name": "TEST_FS_Delhi_Mumbai", "poster_phone": "9000000001",
        },
        {
            "origin_pincode": "110002", "destination_pincode": "400002",
            "cargo_types": ["Pipes"], "cargo_placement": "Floor Only",
            "truck_type": "Open", "weight_tons": 10.0, "space_cuft": 500.0,
            "loading_date": "2026-02-16",
            "poster_name": "TEST_FS_Delhi2_Mumbai2", "poster_phone": "9000000002",
        },
        {
            "origin_pincode": "560001", "destination_pincode": "600001",
            "cargo_types": ["Drums"], "cargo_placement": "Stackable",
            "truck_type": "Trailer", "weight_tons": 2.0, "space_cuft": 80.0,
            "loading_date": "2026-02-17",
            "poster_name": "TEST_FS_Bangalore_Chennai", "poster_phone": "9000000003",
        },
    ]
    created = []
    for p in items:
        r = s.post(f"{API}/loads", json=p, timeout=15)
        assert r.status_code == 200, r.text
        created.append(r.json())
    return created


def test_seed_loads_created(seeded_loads):
    assert len(seeded_loads) == 3
    for ld in seeded_loads:
        assert "id" in ld
        assert "_id" not in ld


def test_loads_list_includes_seeded(s, seeded_loads):
    r = s.get(f"{API}/loads", timeout=15)
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    for ld in seeded_loads:
        assert ld["id"] in ids
