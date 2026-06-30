"""
Backend tests for the Bid feature.

Covers POST /api/bids (create/update/validation), GET /api/bids/check,
GET /api/bids/listing/{listing_id}, GET /api/bids/counts/{phone}, and
DELETE /api/bids/{listing_id}.

Per the review request: target the LOCAL backend at http://localhost:8001
(the prod backend referenced by the mobile app does not yet have these
endpoints).
"""
import os
import math
import time
import uuid
import pytest
import requests

# Local backend — bid endpoints are not yet deployed to the production URL
BASE_URL = "http://localhost:8001"


# --------------------------- Helpers / fixtures ----------------------------

def _rand_phone(prefix: str = "9") -> str:
    """Generate a unique 10-digit phone number for test isolation."""
    return prefix + str(uuid.uuid4().int)[-9:]


def _future_date() -> str:
    return "2026-12-31"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def poster_user(api):
    phone = _rand_phone()
    r = api.post(f"{BASE_URL}/api/users", json={
        "phone": phone, "name": "TEST_Poster", "company": "TEST_PosterCo",
    })
    assert r.status_code == 200, r.text
    return {"phone": phone, "name": "TEST_Poster", "company": "TEST_PosterCo"}


@pytest.fixture(scope="module")
def bidder_user(api):
    phone = _rand_phone()
    r = api.post(f"{BASE_URL}/api/users", json={
        "phone": phone, "name": "TEST_Bidder", "company": "TEST_BidderCo",
    })
    assert r.status_code == 200, r.text
    return {"phone": phone, "name": "TEST_Bidder", "company": "TEST_BidderCo"}


@pytest.fixture(scope="module")
def second_bidder(api):
    phone = _rand_phone()
    r = api.post(f"{BASE_URL}/api/users", json={
        "phone": phone, "name": "TEST_Bidder2", "company": "TEST_Bidder2Co",
    })
    assert r.status_code == 200, r.text
    return {"phone": phone}


@pytest.fixture(scope="module")
def truck_space_load(api, poster_user):
    """Truck-space (loads) post created by the poster user."""
    payload = {
        "origin_pincode": "400001",
        "origin_locality": "Fort",
        "origin_city": "Mumbai",
        "origin_state": "Maharashtra",
        "origin_latitude": 18.9388,
        "origin_longitude": 72.8354,
        "destination_pincode": "110001",
        "destination_locality": "Connaught Place",
        "destination_city": "New Delhi",
        "destination_state": "Delhi",
        "destination_latitude": 28.6315,
        "destination_longitude": 77.2167,
        "cargo_types": ["GENERAL"],
        "cargo_placement": "Stackable",
        "truck_type": "Container",
        "weight_tons": 10,
        "loading_date": _future_date(),
        "poster_name": poster_user["name"],
        "poster_phone": poster_user["phone"],
        "poster_company": poster_user["company"],
    }
    r = api.post(f"{BASE_URL}/api/loads", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def second_truck_load(api, poster_user):
    """A SECOND truck-space load by the same poster — used to test counts aggregation."""
    payload = {
        "origin_pincode": "560001",
        "origin_locality": "MG Road",
        "origin_city": "Bengaluru",
        "origin_state": "Karnataka",
        "origin_latitude": 12.9756,
        "origin_longitude": 77.6050,
        "destination_pincode": "600001",
        "destination_locality": "Parrys",
        "destination_city": "Chennai",
        "destination_state": "Tamil Nadu",
        "destination_latitude": 13.0925,
        "destination_longitude": 80.2840,
        "cargo_types": ["GENERAL"],
        "cargo_placement": "Stackable",
        "truck_type": "Container",
        "weight_tons": 8,
        "loading_date": _future_date(),
        "poster_name": poster_user["name"],
        "poster_phone": poster_user["phone"],
        "poster_company": poster_user["company"],
    }
    r = api.post(f"{BASE_URL}/api/loads", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def ptl_load(api, poster_user):
    """PTL (partial-load) post created by the poster."""
    payload = {
        "poster_phone": poster_user["phone"],
        "origin_locality": "Fort",
        "origin_city": "Mumbai",
        "origin_pincode": "400001",
        "origin_latitude": 18.9388,
        "origin_longitude": 72.8354,
        "destination_locality": "Connaught Place",
        "destination_city": "New Delhi",
        "destination_pincode": "110001",
        "destination_latitude": 28.6315,
        "destination_longitude": 77.2167,
        "cargo_type": "Bags",
        "cargo_category": "GENERAL",
        "weight_kg": 5000,
        "truck_type": "Container",
        "loading_date": _future_date(),
    }
    r = api.post(f"{BASE_URL}/api/ptl/loads", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "load_id" in body
    return body  # {load_id, group_id, matched}


@pytest.fixture(scope="module")
def load_with_no_coords(api, poster_user):
    """A truck-space load that omits lat/lon — used to assert deviation falls back to None."""
    payload = {
        "origin_pincode": "411001",
        "origin_locality": "Pune Camp",
        "origin_city": "Pune",
        "origin_state": "Maharashtra",
        "destination_pincode": "380001",
        "destination_locality": "Lal Darwaja",
        "destination_city": "Ahmedabad",
        "destination_state": "Gujarat",
        "cargo_types": ["GENERAL"],
        "cargo_placement": "Stackable",
        "truck_type": "Container",
        "weight_tons": 7,
        "loading_date": _future_date(),
        "poster_name": poster_user["name"],
        "poster_phone": poster_user["phone"],
        "poster_company": poster_user["company"],
    }
    r = api.post(f"{BASE_URL}/api/loads", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


# ============================ Test: create bid =============================

class TestBidCreation:
    def test_create_bid_on_truck_load(self, api, truck_space_load, bidder_user):
        """POST /api/bids — happy path on a truck-space load with full lat/lon."""
        bid_payload = {
            "listing_id": truck_space_load["id"],
            "listing_type": "load",
            "bidder_phone": bidder_user["phone"],
            "origin_locality": "Andheri",
            "origin_city": "Mumbai",
            "origin_pincode": "400053",
            "origin_latitude": 19.1197,   # ~20 km from post origin (18.9388,72.8354)
            "origin_longitude": 72.8468,
            "destination_locality": "Karol Bagh",
            "destination_city": "New Delhi",
            "destination_pincode": "110005",
            "destination_latitude": 28.6519,
            "destination_longitude": 77.1909,
            "weight_tons": 4.5,
            "cargo_type": "Bags",
        }
        r = api.post(f"{BASE_URL}/api/bids", json=bid_payload)
        assert r.status_code == 200, r.text
        body = r.json()

        assert "id" in body and isinstance(body["id"], str) and len(body["id"]) > 0
        assert body["updated"] is False
        assert body["listing_id"] == truck_space_load["id"]
        assert body["listing_type"] == "load"
        assert body["bidder_phone"] == bidder_user["phone"]
        # Bidder profile populated from /api/users at bid time
        assert body["bidder_name"] == bidder_user["name"]
        assert body["bidder_company"] == bidder_user["company"]
        # Deviation computed (both endpoints have coords)
        assert body["origin_deviation_km"] is not None
        assert body["destination_deviation_km"] is not None
        assert isinstance(body["origin_deviation_km"], (int, float))
        # Rounded to 1 decimal
        assert round(body["origin_deviation_km"], 1) == body["origin_deviation_km"]
        # Sanity: bid origin is ~20 km from post origin
        assert 0 < body["origin_deviation_km"] < 50

    def test_resubmitting_bid_updates_existing(self, api, truck_space_load, bidder_user):
        """A second POST with same (listing,bidder) should update, return updated=true and same id."""
        # Get the existing bid id first
        chk = api.get(f"{BASE_URL}/api/bids/check", params={
            "viewer_phone": bidder_user["phone"], "listing_id": truck_space_load["id"],
        })
        assert chk.status_code == 200
        existing_id = chk.json()["bid"]["id"]
        existing_updated_at = chk.json()["bid"]["updated_at"]

        time.sleep(1.1)  # ensure updated_at timestamp differs
        bid_payload = {
            "listing_id": truck_space_load["id"],
            "listing_type": "load",
            "bidder_phone": bidder_user["phone"],
            "origin_city": "Mumbai",
            "destination_city": "New Delhi",
            "weight_tons": 6.0,        # changed
            "cargo_type": "Drums",     # changed
        }
        r = api.post(f"{BASE_URL}/api/bids", json=bid_payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["updated"] is True
        assert body["id"] == existing_id
        assert body["weight_tons"] == 6.0
        assert body["cargo_type"] == "Drums"
        assert body["updated_at"] != existing_updated_at

    def test_self_bid_blocked(self, api, truck_space_load, poster_user):
        """Bidder == poster must be rejected with 400."""
        r = api.post(f"{BASE_URL}/api/bids", json={
            "listing_id": truck_space_load["id"],
            "listing_type": "load",
            "bidder_phone": poster_user["phone"],
            "weight_tons": 2.0,
            "cargo_type": "Bags",
        })
        assert r.status_code == 400, r.text
        assert "own" in r.json().get("detail", "").lower()

    def test_bid_on_ptl_load(self, api, ptl_load, second_bidder):
        """PTL listing_id must resolve via ptl_loads collection."""
        r = api.post(f"{BASE_URL}/api/bids", json={
            "listing_id": ptl_load["load_id"],
            "listing_type": "ptl",
            "bidder_phone": second_bidder["phone"],
            "origin_city": "Mumbai",
            "destination_city": "New Delhi",
            "weight_tons": 1.2,
            "cargo_type": "Carton Box",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["updated"] is False
        assert body["listing_type"] == "ptl"
        assert body["listing_id"] == ptl_load["load_id"]

    def test_invalid_weight_tons(self, api, truck_space_load, bidder_user):
        r = api.post(f"{BASE_URL}/api/bids", json={
            "listing_id": truck_space_load["id"],
            "listing_type": "load",
            "bidder_phone": bidder_user["phone"],
            "weight_tons": 0,
            "cargo_type": "Bags",
        })
        assert r.status_code == 400, r.text

    def test_missing_cargo_type(self, api, truck_space_load, bidder_user):
        r = api.post(f"{BASE_URL}/api/bids", json={
            "listing_id": truck_space_load["id"],
            "listing_type": "load",
            "bidder_phone": bidder_user["phone"],
            "weight_tons": 3,
            "cargo_type": "   ",
        })
        assert r.status_code == 400, r.text

    def test_invalid_listing_type(self, api, truck_space_load, bidder_user):
        r = api.post(f"{BASE_URL}/api/bids", json={
            "listing_id": truck_space_load["id"],
            "listing_type": "foobar",
            "bidder_phone": bidder_user["phone"],
            "weight_tons": 3,
            "cargo_type": "Bags",
        })
        assert r.status_code == 400, r.text

    def test_listing_not_found(self, api, bidder_user):
        r = api.post(f"{BASE_URL}/api/bids", json={
            "listing_id": "non-existent-id-" + uuid.uuid4().hex,
            "listing_type": "load",
            "bidder_phone": bidder_user["phone"],
            "weight_tons": 3,
            "cargo_type": "Bags",
        })
        assert r.status_code == 404, r.text


# ============================ Test: deviation ==============================

class TestDeviation:
    def test_deviation_null_when_bidder_has_no_coords(self, api, truck_space_load, second_bidder):
        """No bid lat/lon => deviation must be null even if post has coords."""
        r = api.post(f"{BASE_URL}/api/bids", json={
            "listing_id": truck_space_load["id"],
            "listing_type": "load",
            "bidder_phone": second_bidder["phone"],
            "origin_city": "Mumbai",
            "destination_city": "Delhi",
            "weight_tons": 2.0,
            "cargo_type": "Bags",
            # NO lat/lon
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["origin_deviation_km"] is None
        assert body["destination_deviation_km"] is None

    def test_deviation_null_when_post_has_no_coords(self, api, load_with_no_coords, bidder_user):
        """Post has no lat/lon => deviation must be null even if bid has coords."""
        r = api.post(f"{BASE_URL}/api/bids", json={
            "listing_id": load_with_no_coords["id"],
            "listing_type": "load",
            "bidder_phone": bidder_user["phone"],
            "origin_latitude": 18.5204,
            "origin_longitude": 73.8567,
            "destination_latitude": 23.0225,
            "destination_longitude": 72.5714,
            "weight_tons": 1.0,
            "cargo_type": "Bags",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["origin_deviation_km"] is None
        assert body["destination_deviation_km"] is None


# ============================ Test: check / listing / counts =====================

class TestBidCheck:
    def test_check_before_bid_is_false(self, api, second_truck_load, bidder_user):
        r = api.get(f"{BASE_URL}/api/bids/check", params={
            "viewer_phone": bidder_user["phone"],
            "listing_id": second_truck_load["id"],
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["bid_placed"] is False

    def test_check_after_bid_returns_bid(self, api, second_truck_load, bidder_user):
        # Place a bid first
        api.post(f"{BASE_URL}/api/bids", json={
            "listing_id": second_truck_load["id"],
            "listing_type": "load",
            "bidder_phone": bidder_user["phone"],
            "weight_tons": 3.5,
            "cargo_type": "Bags",
        })
        r = api.get(f"{BASE_URL}/api/bids/check", params={
            "viewer_phone": bidder_user["phone"],
            "listing_id": second_truck_load["id"],
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["bid_placed"] is True
        assert body["bid"] is not None
        assert body["bid"]["listing_id"] == second_truck_load["id"]
        assert body["bid"]["bidder_phone"] == bidder_user["phone"]
        assert body["bid"]["weight_tons"] == 3.5


class TestBidListing:
    def test_owner_sees_bids_sorted_newest_first(self, api, truck_space_load, poster_user, bidder_user, second_bidder):
        r = api.get(f"{BASE_URL}/api/bids/listing/{truck_space_load['id']}",
                    params={"viewer_phone": poster_user["phone"]})
        assert r.status_code == 200, r.text
        bids = r.json()
        assert isinstance(bids, list)
        assert len(bids) >= 2  # bidder_user and second_bidder from earlier tests
        phones = {b["bidder_phone"] for b in bids}
        assert bidder_user["phone"] in phones
        assert second_bidder["phone"] in phones
        # Sort newest first by created_at desc
        created_times = [b["created_at"] for b in bids]
        assert created_times == sorted(created_times, reverse=True), \
            f"Bids not sorted newest-first: {created_times}"

    def test_non_owner_forbidden(self, api, truck_space_load, bidder_user):
        r = api.get(f"{BASE_URL}/api/bids/listing/{truck_space_load['id']}",
                    params={"viewer_phone": bidder_user["phone"]})
        assert r.status_code == 403, r.text


class TestBidCounts:
    def test_counts_aggregates_across_owned_posts(self, api, truck_space_load, second_truck_load,
                                                  ptl_load, poster_user):
        r = api.get(f"{BASE_URL}/api/bids/counts/{poster_user['phone']}")
        assert r.status_code == 200, r.text
        counts = r.json()
        assert isinstance(counts, dict)
        # truck_space_load has at least 2 bids (bidder + second_bidder) from earlier tests
        assert counts.get(truck_space_load["id"], 0) >= 2
        # second_truck_load has 1 bid (placed in TestBidCheck)
        assert counts.get(second_truck_load["id"], 0) >= 1
        # ptl_load has 1 bid (from second_bidder)
        assert counts.get(ptl_load["load_id"], 0) >= 1

    def test_counts_ignores_posts_not_owned(self, api, truck_space_load, bidder_user):
        """Counts queried with a non-owner phone must NOT include the poster's listings."""
        r = api.get(f"{BASE_URL}/api/bids/counts/{bidder_user['phone']}")
        assert r.status_code == 200, r.text
        counts = r.json()
        assert isinstance(counts, dict)
        # bidder_user does not own truck_space_load; that listing_id must not appear
        assert truck_space_load["id"] not in counts


# ============================ Test: withdraw bid ==============================

class TestBidWithdraw:
    def test_withdraw_removes_bid(self, api, poster_user, bidder_user):
        """Create a fresh load + bid, withdraw, then confirm /check is false."""
        load_payload = {
            "origin_pincode": "700001",
            "origin_locality": "BBD Bagh",
            "origin_city": "Kolkata",
            "origin_state": "WB",
            "destination_pincode": "500001",
            "destination_locality": "Abids",
            "destination_city": "Hyderabad",
            "destination_state": "Telangana",
            "cargo_types": ["GENERAL"],
            "cargo_placement": "Stackable",
            "truck_type": "Container",
            "weight_tons": 5,
            "loading_date": _future_date(),
            "poster_name": poster_user["name"],
            "poster_phone": poster_user["phone"],
            "poster_company": poster_user["company"],
        }
        load = api.post(f"{BASE_URL}/api/loads", json=load_payload).json()

        bid = api.post(f"{BASE_URL}/api/bids", json={
            "listing_id": load["id"],
            "listing_type": "load",
            "bidder_phone": bidder_user["phone"],
            "weight_tons": 2.0,
            "cargo_type": "Bags",
        })
        assert bid.status_code == 200, bid.text

        # Withdraw
        r = api.delete(f"{BASE_URL}/api/bids/{load['id']}",
                       params={"phone": bidder_user["phone"]})
        assert r.status_code == 200, r.text
        assert r.json().get("withdrawn") is True

        # Verify /check now reports false
        chk = api.get(f"{BASE_URL}/api/bids/check", params={
            "viewer_phone": bidder_user["phone"], "listing_id": load["id"],
        })
        assert chk.status_code == 200
        assert chk.json()["bid_placed"] is False

        # Second withdraw should 404
        r2 = api.delete(f"{BASE_URL}/api/bids/{load['id']}",
                        params={"phone": bidder_user["phone"]})
        assert r2.status_code == 404
