"""Backend tests for the vessel_name / voyage_name + REEFER / 40ftHC container change.

Covers:
  * POST /api/loads   — vessel_name / voyage_name persisted + returned; truck_type verbatim
  * GET  /api/loads   — new fields surfaced; EXACT (case-insensitive) UN/LOCODE match regression
  * PATCH /api/loads/{id} — update vessel/voyage; partial update must NOT wipe them
  * POST /api/ptl/loads + GET /api/ptl/groups — Reefer capacity + UN/LOCODE corridor regression
"""
import os

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "https://volume-capacity-tool.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

FUTURE_DATE = "2026-12-01"
PHONE = "9000000771"

CREATED_LOADS = []
CREATED_PTL = []


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session", autouse=True)
def cleanup(s):
    yield
    for lid in CREATED_LOADS:
        s.delete(f"{API}/loads/{lid}", timeout=30)
    for pid in CREATED_PTL:
        s.delete(f"{API}/ptl/loads/{pid}", params={"phone": PHONE}, timeout=30)


def _payload(origin="INNSA", destination="SGSIN", **kw):
    p = {
        "origin_pincode": origin,
        "origin_locality": "TEST Nhava Sheva",
        "origin_city": "India",
        "destination_pincode": destination,
        "destination_locality": "TEST Singapore",
        "destination_city": "Singapore",
        "cargo_types": ["Bags"],
        "truck_type": "Reefer",
        "vessel_name": "TEST MV MAERSK SEVILLE",
        "voyage_name": "TEST VOY-448W",
        "weight_tons": 12,
        "loading_date": FUTURE_DATE,
        "poster_name": "TEST Tester",
        "poster_phone": PHONE,
        "poster_company": "TEST Co",
    }
    p.update(kw)
    return p


def _create(s, **kw):
    r = s.post(f"{API}/loads", json=_payload(**kw), timeout=30)
    assert r.status_code == 200, r.text[:400]
    doc = r.json()
    CREATED_LOADS.append(doc["id"])
    return doc


# ── POST /api/loads : vessel_name / voyage_name ────────────────────────────
class TestVesselVoyageCreate:
    def test_create_returns_vessel_voyage(self, s):
        doc = _create(s)
        assert doc["vessel_name"] == "TEST MV MAERSK SEVILLE"
        assert doc["voyage_name"] == "TEST VOY-448W"
        assert doc["truck_type"] == "Reefer"
        assert doc["origin_pincode"] == "INNSA"
        assert doc["destination_pincode"] == "SGSIN"
        assert "_id" not in doc
        assert isinstance(doc["id"], str) and doc["id"]

    def test_vessel_voyage_persisted_and_listed(self, s):
        doc = _create(s, vessel_name="TEST MV EVER GIVEN", voyage_name="TEST VOY-902E")
        r = s.get(f"{API}/loads", params={"origin": "INNSA", "destination": "SGSIN"}, timeout=30)
        assert r.status_code == 200
        rows = [d for d in r.json() if d["id"] == doc["id"]]
        assert len(rows) == 1, "created load missing from exact-match list"
        row = rows[0]
        assert row["vessel_name"] == "TEST MV EVER GIVEN"
        assert row["voyage_name"] == "TEST VOY-902E"
        assert "_id" not in row

    def test_get_single_load_has_vessel_voyage(self, s):
        doc = _create(s)
        r = s.get(f"{API}/loads/{doc['id']}/full", timeout=30)
        assert r.status_code == 200
        got = r.json()
        assert got["vessel_name"] == "TEST MV MAERSK SEVILLE"
        assert got["voyage_name"] == "TEST VOY-448W"

    def test_vessel_voyage_omitted_defaults_to_empty(self, s):
        """Backend treats them as optional even though mobile marks them compulsory."""
        p = _payload()
        p.pop("vessel_name")
        p.pop("voyage_name")
        r = s.post(f"{API}/loads", json=p, timeout=30)
        assert r.status_code == 200, r.text[:300]
        doc = r.json()
        CREATED_LOADS.append(doc["id"])
        assert doc["vessel_name"] == ""
        assert doc["voyage_name"] == ""


# ── POST /api/loads : container types ──────────────────────────────────────
class TestContainerTypes:
    @pytest.mark.parametrize("ttype", ["40ftHC", "Reefer", "20ft", "40ft"])
    def test_truck_type_stored_verbatim(self, s, ttype):
        doc = _create(s, truck_type=ttype)
        assert doc["truck_type"] == ttype
        r = s.get(f"{API}/loads/{doc['id']}/full", timeout=30)
        assert r.status_code == 200
        assert r.json()["truck_type"] == ttype


# ── GET /api/loads : exact-match regression ───────────────────────────────
class TestExactMatchRegression:
    def test_exact_match_only(self, s):
        want = _create(s, origin="INNSA", destination="SGSIN")
        other1 = _create(s, origin="INMAA", destination="SGSIN")
        other2 = _create(s, origin="INNSA", destination="NLRTM")
        r = s.get(f"{API}/loads", params={"origin": "INNSA", "destination": "SGSIN"}, timeout=30)
        assert r.status_code == 200
        ids = {d["id"] for d in r.json()}
        assert want["id"] in ids
        assert other1["id"] not in ids
        assert other2["id"] not in ids
        for d in r.json():
            assert d["origin_pincode"] == "INNSA"
            assert d["destination_pincode"] == "SGSIN"

    def test_case_insensitive_query(self, s):
        want = _create(s, origin="INNSA", destination="SGSIN")
        r = s.get(f"{API}/loads", params={"origin": "innsa", "destination": " sgsin "}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert want["id"] in {d["id"] for d in r.json()}

    def test_lowercase_write_normalised(self, s):
        doc = _create(s, origin="inmaa", destination="nlrtm")
        assert doc["origin_pincode"] == "INMAA"
        assert doc["destination_pincode"] == "NLRTM"
        r = s.get(f"{API}/loads", params={"origin": "INMAA", "destination": "NLRTM"}, timeout=30)
        assert doc["id"] in {d["id"] for d in r.json()}

    def test_unknown_corridor_empty(self, s):
        r = s.get(f"{API}/loads", params={"origin": "ZZZZZ", "destination": "YYYYY"}, timeout=30)
        assert r.status_code == 200
        assert r.json() == []


# ── PATCH /api/loads/{id} ────────────────────────────────────────────────
class TestPatchVesselVoyage:
    def test_patch_updates_vessel_voyage(self, s):
        doc = _create(s)
        r = s.patch(
            f"{API}/loads/{doc['id']}",
            json={"vessel_name": "TEST MV CMA CGM", "voyage_name": "TEST VOY-777N"},
            timeout=30,
        )
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body["vessel_name"] == "TEST MV CMA CGM"
        assert body["voyage_name"] == "TEST VOY-777N"
        got = s.get(f"{API}/loads/{doc['id']}/full", timeout=30).json()
        assert got["vessel_name"] == "TEST MV CMA CGM"
        assert got["voyage_name"] == "TEST VOY-777N"

    def test_partial_patch_does_not_wipe_vessel_voyage(self, s):
        doc = _create(s)
        r = s.patch(f"{API}/loads/{doc['id']}", json={"weight_tons": 18.5}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body["weight_tons"] == 18.5
        assert body["vessel_name"] == "TEST MV MAERSK SEVILLE"
        assert body["voyage_name"] == "TEST VOY-448W"

    def test_patch_truck_type_to_reefer(self, s):
        doc = _create(s, truck_type="40ft")
        r = s.patch(f"{API}/loads/{doc['id']}", json={"truck_type": "Reefer"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["truck_type"] == "Reefer"

    def test_patch_unknown_id_404(self, s):
        r = s.patch(f"{API}/loads/does-not-exist-xyz", json={"vessel_name": "X"}, timeout=30)
        assert r.status_code == 404

    def test_patch_empty_body_400(self, s):
        doc = _create(s)
        r = s.patch(f"{API}/loads/{doc['id']}", json={}, timeout=30)
        assert r.status_code == 400


# ── PTL regression with Reefer ───────────────────────────────────────────
class TestPtlReefer:
    def test_create_user(self, s):
        r = s.post(f"{API}/users", json={"phone": PHONE, "name": "TEST PTL User", "company": "TEST Co"}, timeout=30)
        assert r.status_code == 200, r.text[:300]

    def test_ptl_reefer_group_forming(self, s):
        s.post(f"{API}/users", json={"phone": PHONE, "name": "TEST PTL User", "company": "TEST Co"}, timeout=30)
        payload = {
            "poster_phone": PHONE,
            "origin_locality": "TEST Nhava Sheva",
            "origin_city": "India",
            "origin_pincode": "INNSA",
            "destination_locality": "TEST Singapore",
            "destination_city": "Singapore",
            "destination_pincode": "SGSIN",
            "cargo_type": "Fresh Produce",
            "cargo_category": "PERISHABLE",
            "weight_kg": 9000,
            "truck_type": "Reefer",
            "loading_date": FUTURE_DATE,
        }
        r = s.post(f"{API}/ptl/loads", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:400]
        body = r.json()
        assert "load_id" in body
        CREATED_PTL.append(body["load_id"])

        g = s.get(f"{API}/ptl/groups", params={"origin_city": "INNSA", "dest_city": "SGSIN",
                                              "viewer_phone": PHONE}, timeout=30)
        assert g.status_code == 200, g.text[:300]
        groups = [x for x in g.json() if body["load_id"] in [m["load_id"] for m in x.get("members", [])]]
        assert len(groups) == 1, f"group not found for corridor INNSA->SGSIN: {g.text[:400]}"
        grp = groups[0]
        assert grp["corridor"] == "INNSA→SGSIN"
        assert grp["status"] == "FORMING"
        assert grp["capacity_kg"] == 26730, "Reefer capacity should resolve to 26730 kg"
        assert grp["capacity_remaining_kg"] == 26730 - 9000
        assert "_id" not in grp

    def test_ptl_groups_lowercase_corridor_query(self, s):
        g = s.get(f"{API}/ptl/groups", params={"origin_city": "innsa", "dest_city": "sgsin"}, timeout=30)
        assert g.status_code == 200
        assert any(x["corridor"] == "INNSA→SGSIN" for x in g.json())

    def test_ptl_groups_other_corridor_excluded(self, s):
        g = s.get(f"{API}/ptl/groups", params={"origin_city": "INMAA", "dest_city": "NLRTM"}, timeout=30)
        assert g.status_code == 200
        assert all(x["corridor"] == "INMAA→NLRTM" for x in g.json())

    def test_ptl_reefer_over_capacity_rejected(self, s):
        payload = {
            "poster_phone": PHONE,
            "origin_locality": "TEST Nhava Sheva",
            "origin_city": "India",
            "origin_pincode": "INNSA",
            "destination_locality": "TEST Singapore",
            "destination_city": "Singapore",
            "destination_pincode": "SGSIN",
            "cargo_type": "Fresh Produce",
            "cargo_category": "PERISHABLE",
            "weight_kg": 30000,
            "truck_type": "Reefer",
            "loading_date": FUTURE_DATE,
        }
        r = s.post(f"{API}/ptl/loads", json=payload, timeout=30)
        assert r.status_code == 400, r.text[:300]
        assert "26730" in r.json().get("detail", "")

    def test_ptl_40fthc_capacity(self, s):
        payload = {
            "poster_phone": PHONE,
            "origin_locality": "TEST Nhava Sheva",
            "origin_city": "India",
            "origin_pincode": "INNSA",
            "destination_locality": "TEST Rotterdam",
            "destination_city": "Netherlands",
            "destination_pincode": "NLRTM",
            "cargo_type": "Bags",
            "cargo_category": "GENERAL",
            "weight_kg": 10000,
            "truck_type": "40ftHC",
            "loading_date": FUTURE_DATE,
        }
        r = s.post(f"{API}/ptl/loads", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:400]
        CREATED_PTL.append(r.json()["load_id"])
        g = s.get(f"{API}/ptl/groups", params={"origin_city": "INNSA", "dest_city": "NLRTM"}, timeout=30)
        grp = [x for x in g.json() if r.json()["load_id"] in [m["load_id"] for m in x.get("members", [])]]
        assert len(grp) == 1
        assert grp[0]["capacity_kg"] == 26500, "40ftHC capacity should resolve to 26500 kg"
