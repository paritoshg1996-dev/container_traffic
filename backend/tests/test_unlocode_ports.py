"""Backend tests for the UN/LOCODE (sea port / ICD) migration.

Covers:
  * POST /api/loads  — stores UN/LOCODE in origin/destination_pincode, no geocoding
  * GET  /api/loads  — EXACT origin+destination UNLOCODE matching, past-date purge
  * PATCH /api/loads/{id} — no geocode backfill / no error
  * POST /api/ptl/loads + GET /api/ptl/groups — corridor keyed by UN/LOCODE
"""
import os
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "https://ports-exact-match.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

FUTURE_DATE = "2026-12-01"
PAST_DATE = "2020-01-01"
TEST_PHONE = "9000000123"
TEST_PHONE_2 = "9000000124"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def mongo():
    cli = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    yield cli[os.environ.get("DB_NAME", "ptl_market")]
    cli.close()


def _load_payload(origin, destination, **kw):
    p = {
        "origin_pincode": origin,
        "origin_locality": "TEST Port Origin",
        "origin_city": "India",
        "destination_pincode": destination,
        "destination_locality": "TEST Port Dest",
        "destination_city": "Singapore",
        "cargo_types": ["Bags"],
        "truck_type": "40ft",
        "weight_tons": 10,
        "loading_date": FUTURE_DATE,
        "poster_name": "TEST Tester",
        "poster_phone": TEST_PHONE,
        "poster_company": "TEST Co",
    }
    p.update(kw)
    return p


@pytest.fixture(scope="module")
def created_load_ids():
    return []


@pytest.fixture(scope="module", autouse=True)
def cleanup(s, mongo, created_load_ids):
    yield
    for lid in created_load_ids:
        s.delete(f"{API}/loads/{lid}", timeout=20)
    mongo.loads.delete_many({"poster_phone": {"$in": [TEST_PHONE, TEST_PHONE_2]}})
    ptl_ids = [d["id"] for d in mongo.ptl_loads.find(
        {"poster_phone": {"$in": [TEST_PHONE, TEST_PHONE_2]}}, {"id": 1})]
    mongo.ptl_loads.delete_many({"poster_phone": {"$in": [TEST_PHONE, TEST_PHONE_2]}})
    if ptl_ids:
        mongo.ptl_groups.delete_many({"load_ids": {"$in": ptl_ids}})
    mongo.users.delete_many({"phone": {"$in": [TEST_PHONE, TEST_PHONE_2]}})


# ===== 1. POST /api/loads stores UNLOCODE, no lat/lon =====
class TestLoadCreateUnlocode:
    def test_create_load_stores_unlocode_without_coords(self, s, created_load_ids, mongo):
        r = s.post(f"{API}/loads", json=_load_payload("INNSA", "SGSIN"), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        created_load_ids.append(j["id"])

        assert j["origin_pincode"] == "INNSA"
        assert j["destination_pincode"] == "SGSIN"
        assert j["origin_latitude"] is None, f"origin_latitude got geocoded: {j['origin_latitude']}"
        assert j["origin_longitude"] is None
        assert j["destination_latitude"] is None
        assert j["destination_longitude"] is None
        assert isinstance(j["id"], str)
        assert j.get("short_id")

        # persistence check in DB
        doc = mongo.loads.find_one({"id": j["id"]}, {"_id": 0})
        assert doc is not None
        assert doc["origin_pincode"] == "INNSA"
        assert doc["destination_pincode"] == "SGSIN"
        assert doc["origin_latitude"] is None
        assert doc["destination_longitude"] is None

    def test_create_load_passes_through_client_coords(self, s, created_load_ids):
        """If the client sends coords they are stored verbatim (no server geocode)."""
        r = s.post(
            f"{API}/loads",
            json=_load_payload("INNSA", "SGSIN", origin_latitude=18.95, origin_longitude=72.95),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        created_load_ids.append(j["id"])
        assert j["origin_latitude"] == 18.95
        assert j["origin_longitude"] == 72.95


# ===== 2. GET /api/loads exact origin+destination matching =====
class TestLoadExactMatchFilter:
    @pytest.fixture(scope="class", autouse=True)
    def seed(self, s, created_load_ids):
        for o, d in [("INNSA", "SGSIN"), ("INMAA", "NLRTM"), ("INNSA", "NLRTM"), ("INMAA", "SGSIN")]:
            r = s.post(f"{API}/loads", json=_load_payload(o, d), timeout=30)
            assert r.status_code == 200, r.text
            created_load_ids.append(r.json()["id"])

    def test_exact_pair_filter(self, s):
        r = s.get(f"{API}/loads", params={"origin": "INNSA", "destination": "SGSIN"}, timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 1
        for row in rows:
            assert row["origin_pincode"] == "INNSA"
            assert row["destination_pincode"] == "SGSIN"
        # INMAA->NLRTM must not leak in
        assert not any(x["origin_pincode"] == "INMAA" for x in rows)
        assert not any(x["destination_pincode"] == "NLRTM" for x in rows)

    def test_origin_only_filter(self, s):
        r = s.get(f"{API}/loads", params={"origin": "INMAA"}, timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 2
        assert all(x["origin_pincode"] == "INMAA" for x in rows)

    def test_no_match_returns_empty(self, s):
        r = s.get(f"{API}/loads", params={"origin": "ZZZZZ", "destination": "YYYYY"}, timeout=30)
        assert r.status_code == 200
        assert r.json() == []

    def test_lowercase_query_case_sensitivity(self, s):
        """Documented behaviour check: /loads filter is case-sensitive."""
        r = s.get(f"{API}/loads", params={"origin": "innsa", "destination": "sgsin"}, timeout=30)
        assert r.status_code == 200
        assert r.json() == [], "lowercase now matches — behaviour changed"

    def test_list_no_filter_includes_images_stripped(self, s):
        r = s.get(f"{API}/loads", timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and rows
        assert "_id" not in rows[0]
        assert rows[0]["images"] == []
        assert isinstance(rows[0]["image_count"], int)

    def test_past_loading_date_auto_deleted(self, s, mongo):
        r = s.post(f"{API}/loads", json=_load_payload("INNSA", "SGSIN", loading_date=PAST_DATE), timeout=30)
        assert r.status_code == 200
        lid = r.json()["id"]
        # list endpoint purges past-dated loads
        r2 = s.get(f"{API}/loads", params={"origin": "INNSA", "destination": "SGSIN"}, timeout=30)
        assert r2.status_code == 200
        assert lid not in [x["id"] for x in r2.json()]
        assert mongo.loads.find_one({"id": lid}) is None


# ===== 3. PATCH /api/loads/{id} location update — no geocoding =====
class TestLoadPatch:
    def test_patch_location_fields(self, s, created_load_ids):
        r = s.post(f"{API}/loads", json=_load_payload("INNSA", "SGSIN"), timeout=30)
        assert r.status_code == 200
        lid = r.json()["id"]
        created_load_ids.append(lid)

        patch = {
            "origin_pincode": "INMAA",
            "origin_locality": "Chennai",
            "destination_pincode": "NLRTM",
            "destination_locality": "Rotterdam",
        }
        r2 = s.patch(f"{API}/loads/{lid}", json=patch, timeout=30)
        assert r2.status_code == 200, r2.text
        j = r2.json()
        assert j["origin_pincode"] == "INMAA"
        assert j["destination_pincode"] == "NLRTM"
        assert j["origin_latitude"] is None
        assert j["destination_latitude"] is None

        # verify persisted via exact filter
        r3 = s.get(f"{API}/loads", params={"origin": "INMAA", "destination": "NLRTM"}, timeout=30)
        assert lid in [x["id"] for x in r3.json()]

    def test_patch_unknown_load_404(self, s):
        r = s.patch(f"{API}/loads/{uuid.uuid4()}", json={"origin_pincode": "INNSA"}, timeout=30)
        assert r.status_code == 404

    def test_patch_empty_body_400(self, s, created_load_ids):
        r = s.post(f"{API}/loads", json=_load_payload("INNSA", "SGSIN"), timeout=30)
        lid = r.json()["id"]
        created_load_ids.append(lid)
        r2 = s.patch(f"{API}/loads/{lid}", json={}, timeout=30)
        assert r2.status_code == 400


# ===== 4. PTL: corridor keyed by UN/LOCODE =====
class TestPtlUnlocodeCorridor:
    @pytest.fixture(scope="class", autouse=True)
    def user(self, s):
        r = s.post(f"{API}/users", json={"name": "TEST PTL User", "phone": TEST_PHONE, "company": "TEST Co"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["phone"] == TEST_PHONE
        return r.json()

    @pytest.fixture(scope="class")
    def ptl_group(self, s):
        payload = {
            "poster_phone": TEST_PHONE,
            "origin_locality": "Nhava Sheva (Jawaharlal Nehru)",
            "origin_city": "India",
            "origin_pincode": "INNSA",
            "destination_locality": "Singapore",
            "destination_city": "Singapore",
            "destination_pincode": "SGSIN",
            "cargo_type": "Bags",
            "cargo_category": "Bags",
            "weight_kg": 5000,
            "truck_type": "40ft",
            "loading_date": FUTURE_DATE,
        }
        r = s.post(f"{API}/ptl/loads", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def test_solo_group_created_with_unlocode_corridor(self, s, ptl_group, mongo):
        assert ptl_group.get("load_id")
        gid = ptl_group.get("group_id")
        assert gid
        g = mongo.ptl_groups.find_one({"id": gid}, {"_id": 0})
        assert g is not None
        assert g["corridor"] == "INNSA→SGSIN", g["corridor"]
        assert g["origin_display"] == "Nhava Sheva (Jawaharlal Nehru)"
        assert g["destination_display"] == "Singapore"
        assert g["status"] == "FORMING"
        assert g["load_ids"] == [ptl_group["load_id"]]

    def test_ptl_load_stores_unlocode_pincode_no_geocode(self, mongo, ptl_group):
        doc = mongo.ptl_loads.find_one({"id": ptl_group["load_id"]}, {"_id": 0})
        assert doc["origin"]["pincode"] == "INNSA"
        assert doc["destination"]["pincode"] == "SGSIN"
        assert doc["origin"]["latitude"] is None
        assert doc["destination"]["longitude"] is None

    def test_groups_exact_corridor_match(self, s, ptl_group):
        r = s.get(f"{API}/ptl/groups", params={"origin_city": "INNSA", "dest_city": "SGSIN",
                                              "viewer_phone": TEST_PHONE}, timeout=30)
        assert r.status_code == 200
        groups = r.json()
        ids = [g["id"] for g in groups]
        assert ptl_group["group_id"] in ids
        for g in groups:
            assert g["corridor"] == "INNSA→SGSIN"
            assert "origin_lat" not in g and "dest_lon" not in g
        mine = [g for g in groups if g["id"] == ptl_group["group_id"]][0]
        assert mine["members"], "members missing"
        m = mine["members"][0]
        assert m["origin_pincode"] == "INNSA"
        assert m["destination_pincode"] == "SGSIN"
        assert m["is_me"] is True

    def test_groups_other_corridor_returns_zero(self, s, ptl_group):
        r = s.get(f"{API}/ptl/groups", params={"origin_city": "INMAA", "dest_city": "NLRTM"}, timeout=30)
        assert r.status_code == 200
        assert r.json() == []

    def test_groups_lowercase_corridor_query(self, s, ptl_group):
        """derive_corridor uppercases, so lowercase query should still match."""
        r = s.get(f"{API}/ptl/groups", params={"origin_city": "innsa", "dest_city": "sgsin"}, timeout=30)
        assert r.status_code == 200
        assert ptl_group["group_id"] in [g["id"] for g in r.json()]

    def test_groups_origin_only_prefix_match(self, s, ptl_group):
        r = s.get(f"{API}/ptl/groups", params={"origin_city": "INNSA"}, timeout=30)
        assert r.status_code == 200
        ids = [g["id"] for g in r.json()]
        assert ptl_group["group_id"] in ids

    def test_ptl_cancel_load(self, s, ptl_group):
        r = s.delete(f"{API}/ptl/loads/{ptl_group['load_id']}", params={"phone": TEST_PHONE}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("deleted") is True
        r2 = s.get(f"{API}/ptl/groups", params={"origin_city": "INNSA", "dest_city": "SGSIN"}, timeout=30)
        assert ptl_group["group_id"] not in [g["id"] for g in r2.json()]


# ===== 5. Bids on a UN/LOCODE load (deviation_km must be null, not an error) =====
class TestBidOnUnlocodeLoad:
    def test_bid_on_unlocode_load(self, s, created_load_ids, mongo):
        s.post(f"{API}/users", json={"name": "TEST Bidder", "phone": TEST_PHONE_2, "company": "TEST B"}, timeout=30)
        r = s.post(f"{API}/loads", json=_load_payload("INNSA", "SGSIN"), timeout=30)
        lid = r.json()["id"]
        created_load_ids.append(lid)

        bid = {
            "listing_id": lid,
            "listing_type": "load",
            "bidder_phone": TEST_PHONE_2,
            "origin_locality": "Nhava Sheva",
            "origin_city": "India",
            "origin_pincode": "INNSA",
            "destination_locality": "Singapore",
            "destination_city": "Singapore",
            "destination_pincode": "SGSIN",
            "weight_tons": 5,
            "cargo_type": "Bags",
        }
        rb = s.post(f"{API}/bids", json=bid, timeout=30)
        assert rb.status_code in (200, 201), rb.text
        j = rb.json()
        assert j.get("origin_pincode") == "INNSA" or j.get("bid", {}).get("origin_pincode") == "INNSA", j
        mongo.bids.delete_many({"bidder_phone": TEST_PHONE_2})
