"""Backend tests for PTL (Partial Truck Load) consolidation endpoints.

Covers: POST /api/ptl/loads (validation + matching), GET /api/ptl/loads/my/{phone},
DELETE /api/ptl/loads/{load_id}, GET /api/ptl/groups, GET /api/ptl/groups/{id},
POST /api/ptl/groups/{id}/confirm, plus a regression sanity check.

Uses local backend at http://localhost:8001/api (preview pod) since
frontend/.env points to a remote Render deployment.
"""
import os
import time
import pytest
import requests
from pymongo import MongoClient

BASE_URL = "http://localhost:8001/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "truck_traffic")

# ---- Test phones (10-digit) ----
PHONES = [f"90000000{str(i).zfill(2)}" for i in range(1, 10)]  # 9000000001..09

# ---- Anchor coordinates ----
NAVI_MUMBAI = {"lat": 19.0330, "lon": 73.0297, "locality": "Vashi", "city": "Navi Mumbai", "pincode": "400703"}
NAVI_MUMBAI_NEAR = {"lat": 19.0700, "lon": 73.0000, "locality": "Belapur", "city": "Navi Mumbai", "pincode": "400614"}  # ~5km away
NAVI_MUMBAI_FAR = {"lat": 19.4000, "lon": 73.5000, "locality": "Kalyan-ish", "city": "Navi Mumbai", "pincode": "400703"}  # >25km
PUNE = {"lat": 18.5204, "lon": 73.8567, "locality": "Shivajinagar", "city": "Pune", "pincode": "411005"}


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


@pytest.fixture(scope="module", autouse=True)
def cleanup_collections(mongo_db):
    """Wipe ptl_loads/ptl_groups for test phones before and after the run."""
    mongo_db.ptl_loads.delete_many({"poster_phone": {"$in": PHONES}})
    # Best-effort: drop all groups that reference these loads — easiest is full purge
    # of test-created groups via known load-id prefix; but at this point we just
    # delete all PTL groups (preview env is disposable).
    mongo_db.ptl_groups.delete_many({})
    # Seed user profiles so poster_name/company populate
    # Seed via the public API so created_at/updated_at + phone_full populate
    for i, p in enumerate(PHONES, start=1):
        requests.post(f"{BASE_URL}/users", json={
            "phone": p, "name": f"TEST User {i}", "company": f"TEST Co {i}"
        })
    yield
    mongo_db.ptl_loads.delete_many({"poster_phone": {"$in": PHONES}})
    mongo_db.ptl_groups.delete_many({})
    mongo_db.users.delete_many({"phone": {"$in": PHONES}, "name": {"$regex": "^TEST "}})


def _payload(phone, origin, dest, cargo_category="GENERAL", weight_kg=2000,
             cargo_type="Bags"):
    return {
        "poster_phone": phone,
        "origin_locality": origin["locality"], "origin_city": origin["city"],
        "origin_pincode": origin["pincode"],
        "origin_latitude": origin.get("lat"), "origin_longitude": origin.get("lon"),
        "destination_locality": dest["locality"], "destination_city": dest["city"],
        "destination_pincode": dest["pincode"],
        "destination_latitude": dest.get("lat"), "destination_longitude": dest.get("lon"),
        "cargo_type": cargo_type, "cargo_category": cargo_category,
        "weight_kg": weight_kg,
    }


# ============================================================================
# 1. Sanity / regression
# ============================================================================
class TestSanityRegression:
    def test_root(self):
        r = requests.get(f"{BASE_URL}/")
        assert r.status_code == 200
        assert "Truck" in r.json().get("message", "")

    def test_user_get(self):
        r = requests.get(f"{BASE_URL}/users/{PHONES[0]}")
        assert r.status_code == 200
        assert r.json()["phone"] == PHONES[0]

    def test_legacy_loads_endpoint_exists(self):
        # GET /api/loads should still respond (any 2xx/4xx, not 5xx) — regression
        r = requests.get(f"{BASE_URL}/loads")
        assert r.status_code < 500


# ============================================================================
# 2. POST /api/ptl/loads — create + matching
# ============================================================================
class TestPtlLoadsCreate:
    def test_create_first_load_creates_new_group(self, mongo_db):
        payload = _payload(PHONES[0], NAVI_MUMBAI, PUNE, weight_kg=3000)
        r = requests.post(f"{BASE_URL}/ptl/loads", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "load_id" in body and "group_id" in body
        assert body["load_id"].startswith("PTL-")
        assert body["group_id"].startswith("GRP-")

        # DB assertions
        load_doc = mongo_db.ptl_loads.find_one({"id": body["load_id"]})
        assert load_doc is not None
        assert load_doc["status"] == "MATCHED"
        assert load_doc["group_id"] == body["group_id"]

        group_doc = mongo_db.ptl_groups.find_one({"id": body["group_id"]})
        assert group_doc is not None
        assert group_doc["total_weight_kg"] == 3000
        assert group_doc["corridor"] == "NAVI MUMBAI→PUNE"
        assert group_doc["fill_pct"] == pytest.approx(15.0, abs=0.1)
        assert load_doc["id"] in group_doc["load_ids"]

        pytest.shared = {"group_id": body["group_id"], "load_id_1": body["load_id"]}

    def test_second_compatible_load_merges(self, mongo_db):
        gid = pytest.shared["group_id"]
        payload = _payload(PHONES[1], NAVI_MUMBAI_NEAR, PUNE, weight_kg=4000)
        r = requests.post(f"{BASE_URL}/ptl/loads", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["group_id"] == gid, "Should merge into the same group"

        group_doc = mongo_db.ptl_groups.find_one({"id": gid})
        assert group_doc["total_weight_kg"] == 7000
        assert group_doc["fill_pct"] == pytest.approx(35.0, abs=0.1)
        assert len(group_doc["load_ids"]) == 2
        pytest.shared["load_id_2"] = body["load_id"]

    def test_hazmat_does_not_merge_with_general(self, mongo_db):
        existing_gid = pytest.shared["group_id"]
        payload = _payload(PHONES[2], NAVI_MUMBAI, PUNE,
                           cargo_category="HAZMAT", weight_kg=2000, cargo_type="Drums")
        r = requests.post(f"{BASE_URL}/ptl/loads", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["group_id"] != existing_gid
        pytest.shared["hazmat_gid"] = r.json()["group_id"]
        pytest.shared["hazmat_load"] = r.json()["load_id"]

    def test_far_origin_does_not_merge(self, mongo_db):
        existing_gid = pytest.shared["group_id"]
        payload = _payload(PHONES[3], NAVI_MUMBAI_FAR, PUNE, weight_kg=1500)
        r = requests.post(f"{BASE_URL}/ptl/loads", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["group_id"] != existing_gid, "Origin >25km should not merge"
        pytest.shared["far_load"] = r.json()["load_id"]
        pytest.shared["far_gid"] = r.json()["group_id"]

    def test_capacity_overflow_creates_new_group(self, mongo_db):
        # current existing group has 7000 kg used → 13000 free.
        # Post a 15000 kg load — must NOT merge.
        existing_gid = pytest.shared["group_id"]
        payload = _payload(PHONES[4], NAVI_MUMBAI, PUNE, weight_kg=15000)
        r = requests.post(f"{BASE_URL}/ptl/loads", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["group_id"] != existing_gid
        pytest.shared["cap_load"] = r.json()["load_id"]
        pytest.shared["cap_gid"] = r.json()["group_id"]


# ============================================================================
# 3. POST /api/ptl/loads — validation
# ============================================================================
class TestPtlLoadsValidation:
    def test_invalid_phone(self):
        p = _payload("12345", NAVI_MUMBAI, PUNE)
        r = requests.post(f"{BASE_URL}/ptl/loads", json=p)
        assert r.status_code == 400
        assert "10-digit" in r.json().get("detail", "")

    def test_zero_weight(self):
        p = _payload(PHONES[0], NAVI_MUMBAI, PUNE, weight_kg=0)
        r = requests.post(f"{BASE_URL}/ptl/loads", json=p)
        assert r.status_code == 400
        assert "weight_kg" in r.json().get("detail", "").lower()

    def test_overweight(self):
        p = _payload(PHONES[0], NAVI_MUMBAI, PUNE, weight_kg=25000)
        r = requests.post(f"{BASE_URL}/ptl/loads", json=p)
        assert r.status_code == 400
        assert "20000" in r.json().get("detail", "")

    def test_bad_cargo_category(self):
        p = _payload(PHONES[0], NAVI_MUMBAI, PUNE)
        p["cargo_category"] = "WEIRD"
        r = requests.post(f"{BASE_URL}/ptl/loads", json=p)
        assert r.status_code == 400
        assert "cargo_category" in r.json().get("detail", "")


# ============================================================================
# 4. GET /api/ptl/groups  &  GET /api/ptl/groups/{id}  &  confirm
# ============================================================================
class TestPtlGroupsList:
    def test_list_groups_no_phone_leaked(self):
        r = requests.get(f"{BASE_URL}/ptl/groups")
        assert r.status_code == 200
        groups = r.json()
        assert isinstance(groups, list) and len(groups) >= 1
        # Marketplace now only shows FORMING groups (looking for a partner)
        for g in groups:
            assert g["status"] == "FORMING"
        # No phone leakage on list
        for g in groups:
            for m in g.get("members", []):
                assert "phone" not in m or m.get("phone") in (None, "")

    def test_list_groups_filter_by_corridor(self):
        r = requests.get(f"{BASE_URL}/ptl/groups",
                         params={"origin_city": "Navi Mumbai", "dest_city": "Pune"})
        assert r.status_code == 200
        groups = r.json()
        for g in groups:
            assert g["corridor"] == "NAVI MUMBAI→PUNE"

    def test_get_group_detail_phone_hidden_for_anonymous(self):
        gid = pytest.shared["group_id"]
        r = requests.get(f"{BASE_URL}/ptl/groups/{gid}")
        assert r.status_code == 200
        body = r.json()
        for m in body["members"]:
            assert m.get("phone") is None
            assert m["confirmed"] is False

    def test_get_group_404(self):
        r = requests.get(f"{BASE_URL}/ptl/groups/GRP-NONEXISTENT")
        assert r.status_code == 404


class TestPtlConfirm:
    def test_confirm_member1_does_not_make_full(self, mongo_db):
        gid = pytest.shared["group_id"]
        r = requests.post(f"{BASE_URL}/ptl/groups/{gid}/confirm",
                          params={"phone": PHONES[0]})
        assert r.status_code == 200
        assert r.json()["confirmed"] is True
        g = mongo_db.ptl_groups.find_one({"id": gid})
        # Pair-only: group has 2 members but only 1 confirmed → stays PAIRED
        assert g["status"] == "PAIRED"

    def test_confirm_outsider_404(self):
        gid = pytest.shared["group_id"]
        r = requests.post(f"{BASE_URL}/ptl/groups/{gid}/confirm",
                          params={"phone": PHONES[8]})  # not in this group
        assert r.status_code == 404

    def test_confirm_all_members_marks_full(self, mongo_db):
        gid = pytest.shared["group_id"]
        r = requests.post(f"{BASE_URL}/ptl/groups/{gid}/confirm",
                          params={"phone": PHONES[1]})
        assert r.status_code == 200
        g = mongo_db.ptl_groups.find_one({"id": gid})
        # Both members confirmed → group status CONFIRMED
        assert g["status"] == "CONFIRMED"

    def test_confirmed_viewer_sees_other_phone(self):
        gid = pytest.shared["group_id"]
        # PHONES[0] is now CONFIRMED in this group. Viewer = PHONES[0] should see
        # PHONES[1]'s phone (also CONFIRMED), but not their own as "phone" (is_me flag).
        r = requests.get(f"{BASE_URL}/ptl/groups/{gid}",
                         params={"viewer_phone": PHONES[0]})
        assert r.status_code == 200
        members = r.json()["members"]
        other = [m for m in members if not m["is_me"]]
        assert other, "Expected at least one other member"
        # The other CONFIRMED member should expose their phone
        confirmed_others_with_phone = [m for m in other if m["confirmed"] and m["phone"]]
        assert confirmed_others_with_phone, "CONFIRMED viewer should see other CONFIRMED member's phone"

    def test_anonymous_viewer_does_not_see_phone(self):
        gid = pytest.shared["group_id"]
        r = requests.get(f"{BASE_URL}/ptl/groups/{gid}")
        members = r.json()["members"]
        for m in members:
            assert m.get("phone") is None


# ============================================================================
# 5. GET /api/ptl/loads/my/{phone}
# ============================================================================
class TestMyLoads:
    def test_my_loads_flattened(self):
        r = requests.get(f"{BASE_URL}/ptl/loads/my/{PHONES[0]}")
        assert r.status_code == 200
        loads = r.json()
        assert len(loads) >= 1
        ld = loads[0]
        # Flattened fields
        for key in ("origin_locality", "origin_city", "origin_pincode",
                    "origin_latitude", "origin_longitude",
                    "destination_locality", "destination_city",
                    "destination_pincode", "destination_latitude",
                    "destination_longitude", "status"):
            assert key in ld, f"Missing flattened key {key}"
        # Should NOT be nested
        assert "origin" not in ld or not isinstance(ld.get("origin"), dict)
        assert "destination" not in ld or not isinstance(ld.get("destination"), dict)

    def test_my_loads_bad_phone(self):
        r = requests.get(f"{BASE_URL}/ptl/loads/my/abc")
        assert r.status_code == 400


# ============================================================================
# 6. DELETE /api/ptl/loads/{load_id}
# ============================================================================
class TestPtlCancel:
    def test_cancel_wrong_phone_403(self):
        lid = pytest.shared["load_id_2"]
        r = requests.delete(f"{BASE_URL}/ptl/loads/{lid}",
                            params={"phone": PHONES[7]})
        assert r.status_code == 403
        assert "Not your" in r.json().get("detail", "")

    def test_cancel_nonexistent_404(self):
        r = requests.delete(f"{BASE_URL}/ptl/loads/FAKE-ID",
                            params={"phone": PHONES[0]})
        assert r.status_code == 404

    def test_cancel_recomputes_group(self, mongo_db):
        # Delete PHONES[1]'s load (load_id_2). Group started with 7000kg (3000+4000).
        # After delete total=3000, fill=15%, status FORMING.
        gid = pytest.shared["group_id"]
        lid = pytest.shared["load_id_2"]
        r = requests.delete(f"{BASE_URL}/ptl/loads/{lid}",
                            params={"phone": PHONES[1]})
        assert r.status_code == 200
        assert r.json()["deleted"] is True
        # Verify load row was hard-deleted from DB
        ld = mongo_db.ptl_loads.find_one({"id": lid})
        assert ld is None
        # Verify group recomputed
        g = mongo_db.ptl_groups.find_one({"id": gid})
        assert g is not None
        assert lid not in g["load_ids"]
        assert g["total_weight_kg"] == pytest.approx(3000.0, abs=0.1)
        assert g["fill_pct"] == pytest.approx(15.0, abs=0.1)
        # Status should drop back to FORMING (was FULL after both confirmed)
        assert g["status"] == "FORMING"

    def test_cancel_last_member_deletes_group(self, mongo_db):
        # Cancel PHONES[0]'s load (load_id_1) — it's the only one left in the group.
        gid = pytest.shared["group_id"]
        lid = pytest.shared["load_id_1"]
        r = requests.delete(f"{BASE_URL}/ptl/loads/{lid}",
                            params={"phone": PHONES[0]})
        assert r.status_code == 200
        g = mongo_db.ptl_groups.find_one({"id": gid})
        assert g is None, "Group should be deleted when last member cancels"

    def test_cancelled_load_excluded_from_my_loads(self):
        r = requests.get(f"{BASE_URL}/ptl/loads/my/{PHONES[0]}")
        assert r.status_code == 200
        ids = [l["id"] for l in r.json()]
        assert pytest.shared["load_id_1"] not in ids


# ============================================================================
# 7. Pair-only architecture — a 3rd load on the same corridor must NOT merge
#    into an already-paired group (2-member cap).
# ============================================================================
class TestPairOnlyCap:
    """Smoke-test the pair-only invariant end-to-end."""

    def test_third_load_creates_new_group(self, mongo_db):
        # Use a fresh corridor so previous test data doesn't interfere.
        mongo_db.ptl_loads.delete_many({"poster_phone": {"$in": PHONES[3:6]}})
        mongo_db.ptl_groups.delete_many({"corridor": "DELHI→JAIPUR"})

        DELHI = {"lat": 28.6517, "lon": 77.1909, "locality": "Karol Bagh",
                 "city": "Delhi", "pincode": "110005"}
        JAIPUR = {"lat": 26.9124, "lon": 75.7873, "locality": "Vaishali Nagar",
                  "city": "Jaipur", "pincode": "302021"}

        # 1st load → FORMING (solo)
        r1 = requests.post(f"{BASE_URL}/ptl/loads",
                           json=_payload(PHONES[3], DELHI, JAIPUR, weight_kg=2000))
        assert r1.status_code == 200
        gid1 = r1.json()["group_id"]
        assert r1.json()["matched"] is False

        # 2nd load → MATCHED into same group → group becomes PAIRED
        r2 = requests.post(f"{BASE_URL}/ptl/loads",
                           json=_payload(PHONES[4], DELHI, JAIPUR, weight_kg=3000))
        assert r2.status_code == 200
        assert r2.json()["group_id"] == gid1
        assert r2.json()["matched"] is True
        g = mongo_db.ptl_groups.find_one({"id": gid1})
        assert g["status"] == "PAIRED"
        assert len(g["load_ids"]) == 2

        # 3rd load → MUST get its own new group, even though corridor matches
        r3 = requests.post(f"{BASE_URL}/ptl/loads",
                           json=_payload(PHONES[5], DELHI, JAIPUR, weight_kg=1500))
        assert r3.status_code == 200
        gid3 = r3.json()["group_id"]
        assert gid3 != gid1, "3rd load must NOT join an already-paired group"
        assert r3.json()["matched"] is False
        g3 = mongo_db.ptl_groups.find_one({"id": gid3})
        assert g3["status"] == "FORMING"
        assert len(g3["load_ids"]) == 1


# ============================================================================
# 8. Phones become visible as soon as group is PAIRED (no mutual-confirm gate)
# ============================================================================
class TestPairedPhoneVisibility:
    def test_paired_member_sees_partner_phone_without_confirming(self, mongo_db):
        # Use a unique corridor so we don't collide with previous tests
        mongo_db.ptl_loads.delete_many({"poster_phone": {"$in": PHONES[6:8]}})
        mongo_db.ptl_groups.delete_many({"corridor": "CHENNAI→BANGALORE"})
        ORIG = {"lat": 13.0827, "lon": 80.2707, "locality": "T Nagar",
                 "city": "Chennai", "pincode": "600017"}
        DEST = {"lat": 12.9716, "lon": 77.5946, "locality": "Indiranagar",
                   "city": "Bangalore", "pincode": "560038"}

        r1 = requests.post(f"{BASE_URL}/ptl/loads",
                           json=_payload(PHONES[6], ORIG, DEST, weight_kg=2000))
        assert r1.json()["matched"] is False
        r2 = requests.post(f"{BASE_URL}/ptl/loads",
                           json=_payload(PHONES[7], ORIG, DEST, weight_kg=2500))
        assert r2.json()["matched"] is True
        gid = r2.json()["group_id"]

        # Viewer = PHONES[6], group is PAIRED but no one has confirmed yet.
        # Per pair-only rule, partner's phone must be visible.
        r = requests.get(f"{BASE_URL}/ptl/groups/{gid}",
                         params={"viewer_phone": PHONES[6]})
        assert r.status_code == 200
        partner = next((m for m in r.json()["members"] if not m["is_me"]), None)
        assert partner is not None
        assert partner["phone"] == PHONES[7]
        assert partner["confirmed"] is False

