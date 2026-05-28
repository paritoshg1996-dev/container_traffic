"""
Backend tests for user profile persistence (POST /api/users, GET /api/users/{phone}).

Also includes regression checks for existing endpoints:
- GET /api/
- GET /api/pincode/{pincode}
- POST/GET /api/loads
- POST /api/auth/verify-token (should exist; reject invalid token)

Per agent_to_agent_context_note: backend testing in preview pod uses http://localhost:8001 directly,
because frontend .env points to a separate production deployment.
"""
import os
import time
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

TEST_PHONES = ["9876543210", "9876543211", "9000000099", "9000000088"]


@pytest.fixture(scope="module", autouse=True)
def cleanup_users():
    """Remove any test users before & after running this module."""
    async def _clean():
        c = AsyncIOMotorClient(MONGO_URL)
        db = c[DB_NAME]
        await db.users.delete_many({"phone": {"$in": TEST_PHONES}})
        c.close()
    asyncio.get_event_loop().run_until_complete(_clean())
    yield
    asyncio.get_event_loop().run_until_complete(_clean())


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------- Health / root ---------------- #
class TestRoot:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json().get("message") == "Truck Load Marketplace API"


# ---------------- POST /api/users ---------------- #
class TestUsersUpsert:
    def test_create_user_returns_persisted_doc(self, api):
        payload = {"phone": "9876543210", "name": "Ravi Kumar", "company": "Acme Logistics"}
        r = api.post(f"{BASE_URL}/api/users", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["phone"] == "9876543210"
        assert data["name"] == "Ravi Kumar"
        assert data["company"] == "Acme Logistics"
        assert data["phone_full"] == "+919876543210"
        assert "created_at" in data and "updated_at" in data
        # initial: created_at == updated_at
        assert data["created_at"] == data["updated_at"]

    def test_upsert_updates_existing_user(self, api):
        # Create first
        r1 = api.post(f"{BASE_URL}/api/users",
                      json={"phone": "9876543211", "name": "Old Name", "company": "OldCo"})
        assert r1.status_code == 200, r1.text
        first = r1.json()
        created_at_1 = first["created_at"]

        # small sleep so updated_at differs
        time.sleep(1.1)

        # Update with same phone
        r2 = api.post(f"{BASE_URL}/api/users",
                      json={"phone": "9876543211", "name": "New Name", "company": "NewCo"})
        assert r2.status_code == 200, r2.text
        second = r2.json()
        assert second["phone"] == "9876543211"
        assert second["name"] == "New Name"
        assert second["company"] == "NewCo"
        # created_at must be preserved
        assert second["created_at"] == created_at_1
        # updated_at must change
        assert second["updated_at"] != created_at_1

        # GET should reflect updated values (persistence check)
        rg = api.get(f"{BASE_URL}/api/users/9876543211")
        assert rg.status_code == 200
        g = rg.json()
        assert g["name"] == "New Name"
        assert g["company"] == "NewCo"
        assert g["created_at"] == created_at_1

    def test_phone_normalisation_plus91(self, api):
        # Input with +91 prefix should be normalised to last 10 digits
        r = api.post(f"{BASE_URL}/api/users",
                     json={"phone": "+919000000099", "name": "Norm User", "company": "NC"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["phone"] == "9000000099"
        assert data["phone_full"] == "+919000000099"

        # Retrievable by normalised 10-digit form
        rg = api.get(f"{BASE_URL}/api/users/9000000099")
        assert rg.status_code == 200
        assert rg.json()["phone"] == "9000000099"

    def test_phone_normalisation_91prefix(self, api):
        r = api.post(f"{BASE_URL}/api/users",
                     json={"phone": "919000000088", "name": "Norm Two", "company": ""})
        assert r.status_code == 200, r.text
        assert r.json()["phone"] == "9000000088"

    def test_short_phone_rejected(self, api):
        r = api.post(f"{BASE_URL}/api/users",
                     json={"phone": "123", "name": "X User", "company": ""})
        assert r.status_code == 400
        assert "phone" in r.text.lower()

    def test_empty_name_rejected(self, api):
        r = api.post(f"{BASE_URL}/api/users",
                     json={"phone": "9876543210", "name": "", "company": "X"})
        assert r.status_code == 400
        assert "name" in r.text.lower()

    def test_short_name_rejected(self, api):
        r = api.post(f"{BASE_URL}/api/users",
                     json={"phone": "9876543210", "name": "A", "company": "X"})
        assert r.status_code == 400


# ---------------- GET /api/users/{phone} ---------------- #
class TestGetUser:
    def test_get_existing_user(self, api):
        # Ensure the user exists first
        api.post(f"{BASE_URL}/api/users",
                 json={"phone": "9876543210", "name": "Ravi Kumar", "company": "Acme Logistics"})
        r = api.get(f"{BASE_URL}/api/users/9876543210")
        assert r.status_code == 200
        data = r.json()
        assert data["phone"] == "9876543210"
        assert data["name"]  # non-empty
        assert "created_at" in data

    def test_get_missing_user(self, api):
        r = api.get(f"{BASE_URL}/api/users/9111111111")
        assert r.status_code == 404

    def test_get_invalid_phone(self, api):
        r = api.get(f"{BASE_URL}/api/users/123")
        assert r.status_code == 400


# ---------------- Mongo persistence check ---------------- #
class TestPersistence:
    def test_user_actually_stored_in_mongo(self, api):
        api.post(f"{BASE_URL}/api/users",
                 json={"phone": "9876543210", "name": "Ravi Kumar", "company": "Acme Logistics"})

        async def _check():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            doc = await db.users.find_one({"phone": "9876543210"})
            c.close()
            return doc

        doc = asyncio.get_event_loop().run_until_complete(_check())
        assert doc is not None
        assert doc["phone"] == "9876543210"
        assert doc["name"] == "Ravi Kumar"
        assert doc["company"] == "Acme Logistics"
        assert doc.get("phone_full") == "+919876543210"
        assert "created_at" in doc and "updated_at" in doc


# ---------------- Regression on existing endpoints ---------------- #
class TestRegression:
    def test_pincode_lookup(self, api):
        r = api.get(f"{BASE_URL}/api/pincode/110001")
        assert r.status_code == 200
        d = r.json()
        assert d["pincode"] == "110001"
        # valid should be True for a real pincode (if external API up); accept either
        assert "valid" in d

    def test_pincode_invalid_length(self, api):
        r = api.get(f"{BASE_URL}/api/pincode/123")
        assert r.status_code == 400

    def test_loads_create_and_list(self, api):
        payload = {
            "origin_pincode": "110001",
            "destination_pincode": "400001",
            "cargo_types": ["TEST_CARGO"],
            "cargo_placement": "Full",
            "truck_type": "Open",
            "weight_tons": 10.5,
            "loading_date": "2026-12-31",
            "poster_name": "TEST_Poster",
            "poster_phone": "9876543210",
            "poster_company": "TEST_Co",
        }
        r = api.post(f"{BASE_URL}/api/loads", json=payload)
        assert r.status_code == 200, r.text
        load = r.json()
        assert load["origin_pincode"] == "110001"
        assert "id" in load
        load_id = load["id"]

        r2 = api.get(f"{BASE_URL}/api/loads")
        assert r2.status_code == 200
        loads = r2.json()
        assert isinstance(loads, list)
        ids = [l["id"] for l in loads]
        assert load_id in ids

        # cleanup
        api.delete(f"{BASE_URL}/api/loads/{load_id}")

    def test_verify_token_endpoint_exists(self, api):
        # Firebase Admin may not be initialised in preview env -> 500
        # If initialised, invalid token -> 401. Either way, endpoint must exist (not 404).
        r = api.post(f"{BASE_URL}/api/auth/verify-token", json={"id_token": "invalid.token.xxx"})
        assert r.status_code in (400, 401, 500)
        assert r.status_code != 404
