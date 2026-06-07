from fastapi import FastAPI, APIRouter, HTTPException, Query, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
import base64
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import re
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)  # postalpincode.in SSL cert expired

import firebase_admin
from firebase_admin import credentials as fb_credentials, auth as fb_auth


ROOT_DIR = Path(__file__).parent

import string
import random

_BASE62 = string.ascii_lowercase + string.digits  # a-z0-9  → 36 chars → 6 chars = 2.18B combos

def _gen_short_id(length: int = 6) -> str:
    """Generate a random base-36 short ID. 6 chars = 36^6 ≈ 2.18 billion combos."""
    return "".join(random.choices(_BASE62, k=length))

async def _unique_short_id() -> str:
    """Generate a short_id that doesn't already exist in the loads collection."""
    for _ in range(10):
        sid = _gen_short_id()
        if not await db.loads.find_one({"short_id": sid}, {"_id": 1}):
            return sid
    # Fallback: use 8 chars if 6-char space is somehow saturated
    return _gen_short_id(8)
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ===== Firebase Admin init =====
def _init_firebase_admin():
    """Initialize Firebase Admin SDK.

    Tries in this order:
      1) FIREBASE_SERVICE_ACCOUNT_B64 env var (base64-encoded JSON) — recommended on Render
      2) FIREBASE_SERVICE_ACCOUNT_JSON env var (raw JSON string)
      3) Local file firebase-service-account.json next to server.py
    """
    if firebase_admin._apps:
        return
    cred = None
    b64 = os.environ.get("FIREBASE_SERVICE_ACCOUNT_B64")
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    try:
        if b64:
            data = json.loads(base64.b64decode(b64).decode("utf-8"))
            cred = fb_credentials.Certificate(data)
        elif raw:
            data = json.loads(raw)
            cred = fb_credentials.Certificate(data)
        else:
            file_path = ROOT_DIR / "firebase-service-account.json"
            if file_path.exists():
                cred = fb_credentials.Certificate(str(file_path))
        if cred is not None:
            firebase_admin.initialize_app(cred)
            logger.info("Firebase Admin initialized.")
        else:
            logger.warning(
                "Firebase service account not found. Set FIREBASE_SERVICE_ACCOUNT_B64 "
                "or place firebase-service-account.json next to server.py."
            )
    except Exception as e:
        logger.error(f"Firebase Admin init failed: {e}")


_init_firebase_admin()

# ===== Models =====
# Route locations are stored in two coordinated tiers:
#   1. Display tier — locality / city / state / pincode (used by the route card)
#   2. Precision tier — place_name / full_address / lat / lon / eLoc
# The precision tier is preserved EXACTLY from Mappls and is intended for
# future route matching, distance & off-route calculations, map views and
# warehouse/factory-level search. The display tier is what the UI renders;
# it must NEVER be derived from the storage tier in a lossy way.
class LoadCreate(BaseModel):
    origin_pincode: str
    origin_locality: Optional[str] = ""
    origin_city: Optional[str] = ""
    origin_state: Optional[str] = ""
    # --- Mappls-precision fields (Phase 1 — optional, additive) ---
    origin_place_name: Optional[str] = ""
    origin_full_address: Optional[str] = ""
    origin_latitude: Optional[float] = None
    origin_longitude: Optional[float] = None
    origin_eloc: Optional[str] = ""
    destination_pincode: str
    destination_locality: Optional[str] = ""
    destination_city: Optional[str] = ""
    destination_state: Optional[str] = ""
    destination_place_name: Optional[str] = ""
    destination_full_address: Optional[str] = ""
    destination_latitude: Optional[float] = None
    destination_longitude: Optional[float] = None
    destination_eloc: Optional[str] = ""
    cargo_types: List[str] = []
    cargo_placement: str = ""
    truck_type: str = ""
    weight_tons: float
    space_cuft: Optional[float] = None
    dimension_length: Optional[float] = None
    dimension_breadth: Optional[float] = None
    dimension_height: Optional[float] = None
    price_per_ton: Optional[float] = None
    loading_date: str
    poster_name: str
    poster_phone: str
    poster_company: Optional[str] = ""
    images: List[str] = []


class Load(LoadCreate):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    short_id: Optional[str] = None   # set server-side after uniqueness check; never from client
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class PincodeInfo(BaseModel):
    pincode: str
    city: str       # District name (e.g. "Mumbai")
    state: str      # State name (e.g. "Maharashtra")
    locality: str = ""  # Most specific area name (e.g. "Bhandup West")
    valid: bool


# ===== Routes =====
@api_router.get("/")
async def root():
    return {"message": "Truck Load Marketplace API"}

@api_router.get("/pythonversion")
async def python_version():
    import sys
    return {"python": sys.version}



@api_router.get("/pincode/{pincode}", response_model=PincodeInfo)
async def lookup_pincode(pincode: str):
    """Look up Indian pincode and return city, state, and specific locality.

    locality = most specific area name from the post office list
               e.g. "Bhandup West" for 400078, not just "Mumbai"
    city     = district name e.g. "Mumbai"
    state    = state name e.g. "Maharashtra"

    Priority for locality: Head PO > Sub PO > first Branch PO
    This gives the area name the user actually knows (Bhandup West,
    Andheri East, Vashi etc.) rather than just the district.
    """
    if not (pincode.isdigit() and len(pincode) == 6):
        raise HTTPException(status_code=400, detail="Pincode must be 6 digits")
    try:
        resp = requests.get(
            f"https://api.postalpincode.in/pincode/{pincode}",
            timeout=8,
            headers={"User-Agent": "LoadLink/1.0"},
            verify=False,  # postalpincode.in SSL cert expired
        )
        data = resp.json()
        if isinstance(data, list) and data and data[0].get("Status") == "Success":
            offices = data[0].get("PostOffice") or []
            if offices:
                city  = offices[0].get("District") or offices[0].get("Block") or ""
                state = offices[0].get("State") or ""

                # Pick the most representative locality name:
                # Prefer Head PO > Sub PO > first office
                # Head/Sub POs are named after the actual area (e.g. "Bhandup West HO")
                # Branch POs are often named after small lanes/buildings
                def rank(o):
                    bt = (o.get("BranchType") or "").lower()
                    if "head" in bt:   return 0
                    if "sub" in bt:    return 1
                    return 2

                best = min(offices, key=rank)
                raw_name = best.get("Name") or ""

                # Strip common suffixes that clutter the display
                # e.g. "Bhandup West H.O" → "Bhandup West"
                #      "Andheri East S.O" → "Andheri East"
                locality = re.sub(
                    r'\s*(H\.?O\.?|S\.?O\.?|B\.?O\.?|Head\s+Post\s+Office|Sub\s+Post\s+Office|Branch\s+Post\s+Office)\s*$',
                    '', raw_name, flags=re.IGNORECASE
                ).strip()

                return PincodeInfo(
                    pincode=pincode,
                    city=city,
                    state=state,
                    locality=locality,
                    valid=True,
                )
        return PincodeInfo(pincode=pincode, city="", state="", locality="", valid=False)
    except Exception as e:
        logger.warning(f"Pincode lookup failed: {e}")
        return PincodeInfo(pincode=pincode, city="", state="", locality="", valid=False)


class CitySuggestion(BaseModel):
    name: str
    city: str
    state: str
    pincode: str


@api_router.get("/city/{name}", response_model=List[CitySuggestion])
async def search_city(name: str):
    """Search post offices / areas by name and return matching pincodes."""
    name = (name or "").strip()
    if len(name) < 3:
        return []
    try:
        resp = requests.get(
            f"https://api.postalpincode.in/postoffice/{name}",
            timeout=8,
            headers={"User-Agent": "LoadLink/1.0"},
            verify=False,  # postalpincode.in SSL cert expired
        )
        data = resp.json()
        out: List[CitySuggestion] = []
        if isinstance(data, list) and data and data[0].get("Status") == "Success":
            seen = set()
            for office in (data[0].get("PostOffice") or []):
                pin = office.get("Pincode") or ""
                area = office.get("Name") or ""
                key = (area, pin)
                if not pin or key in seen:
                    continue
                seen.add(key)
                out.append(CitySuggestion(
                    name=area,
                    city=office.get("District") or office.get("Block") or "",
                    state=office.get("State") or "",
                    pincode=pin,
                ))
                if len(out) >= 25:
                    break
        return out
    except Exception as e:
        logger.warning(f"City search failed: {e}")
        return []


class GeoInfo(BaseModel):
    pincode: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    found: bool = False


@api_router.get("/geocode/{pincode}", response_model=GeoInfo)
async def geocode_pincode(pincode: str):
    """Resolve an Indian pincode to lat/lon. Cached in Mongo.

    Strategy:
    1. MongoDB cache (permanent, free)
    2. Nominatim by postalcode (free, usually reliable)
    3. Nominatim by city name from postalpincode.in (fallback)
    All results cached permanently so each pincode is only ever looked up once.
    """
    if not (pincode.isdigit() and len(pincode) == 6):
        raise HTTPException(status_code=400, detail="Pincode must be 6 digits")

    cached = await db.pincode_geo.find_one({"pincode": pincode}, {"_id": 0})
    if cached and cached.get("found"):
        return GeoInfo(**cached)

    nominatim_headers = {"User-Agent": "TruckTraffic/1.0 (trucktraffic.in)"}

    # Step 1: Nominatim by postalcode
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"postalcode": pincode, "country": "India", "format": "json", "limit": 1},
            timeout=10,
            headers=nominatim_headers,
        )
        data = resp.json()
        if isinstance(data, list) and data:
            first = data[0]
            info = GeoInfo(pincode=pincode, lat=float(first["lat"]), lon=float(first["lon"]), found=True)
            await db.pincode_geo.update_one({"pincode": pincode}, {"$set": info.dict()}, upsert=True)
            return info
    except Exception as e:
        logger.warning(f"Nominatim postalcode lookup failed for {pincode}: {e}")

    # Step 2: Look up city name from postalpincode.in, then geocode by city name
    try:
        resp = requests.get(
            f"https://api.postalpincode.in/pincode/{pincode}",
            timeout=8,
            headers={"User-Agent": "LoadLink/1.0"},
            verify=False,  # postalpincode.in SSL cert is expired
        )
        data = resp.json()
        if isinstance(data, list) and data and data[0].get("Status") == "Success":
            offices = data[0].get("PostOffice") or []
            if offices:
                first = offices[0]
                city_name = first.get("District") or first.get("Block") or first.get("Name") or ""
                state_name = first.get("State") or ""
                if city_name:
                    geo_resp = requests.get(
                        "https://nominatim.openstreetmap.org/search",
                        params={"q": f"{city_name}, {state_name}, India", "format": "json", "limit": 1, "countrycodes": "in"},
                        timeout=10,
                        headers=nominatim_headers,
                    )
                    geo_data = geo_resp.json()
                    if isinstance(geo_data, list) and geo_data:
                        first_geo = geo_data[0]
                        info = GeoInfo(pincode=pincode, lat=float(first_geo["lat"]), lon=float(first_geo["lon"]), found=True)
                        await db.pincode_geo.update_one({"pincode": pincode}, {"$set": info.dict()}, upsert=True)
                        return info
    except Exception as e:
        logger.warning(f"Pincode city-name fallback failed for {pincode}: {e}")

    return GeoInfo(pincode=pincode, found=False)


@api_router.get("/geocode-city/{city_name}")
async def geocode_city(city_name: str):
    """Resolve an Indian city/locality name to lat/lon via Nominatim.
    Used when a CITY-type Mappls result has no pincode in placeAddress
    (e.g. Mumbai → placeAddress is just "Maharashtra" with no pincode).
    Results are cached in MongoDB permanently.
    """
    city_name = (city_name or "").strip()
    if not city_name:
        raise HTTPException(status_code=400, detail="city_name is required")

    cache_key = city_name.lower()
    cached = await db.city_geo.find_one({"city": cache_key}, {"_id": 0})
    if cached:
        return GeoInfo(pincode="", lat=cached["lat"], lon=cached["lon"], found=True)

    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": f"{city_name}, India",
                "format": "json",
                "limit": 1,
                "countrycodes": "in",
            },
            timeout=10,
            headers={"User-Agent": "LoadLink/1.0 (loadlink.app)"},
        )
        data = resp.json()
        if isinstance(data, list) and data:
            first = data[0]
            lat = float(first["lat"])
            lon = float(first["lon"])
            await db.city_geo.update_one(
                {"city": cache_key},
                {"$set": {"city": cache_key, "lat": lat, "lon": lon}},
                upsert=True,
            )
            return GeoInfo(pincode="", lat=lat, lon=lon, found=True)
        return GeoInfo(pincode="", found=False)
    except Exception as e:
        logger.warning(f"City geocode failed for {city_name}: {e}")
        return GeoInfo(pincode="", found=False)


@api_router.get("/places")
async def places_search(
    query: str = Query(..., min_length=2),
    pod: Optional[str] = Query(None),
):
    """Proxy Mappls Autosuggest.

    The frontend calls this twice in parallel (pod=CITY and pod=LC).
    Mappls only accepts a single pod value — comma-separated values return 400.
    For short queries (< 4 chars), pod=CITY often returns empty/invalid JSON,
    so we skip the pod param in that case and let the frontend filter by type.
    Always returns a valid JSON object — never a 502.
    """
    MAPPLS_KEY = os.environ.get("MAPPLS_KEY", "")
    if not MAPPLS_KEY:
        raise HTTPException(status_code=500, detail="MAPPLS_KEY not configured")
    try:
        params: dict = {
            "query": query,
            "region": "IND",
            "access_token": MAPPLS_KEY,
            "tokenizeAddress": "true",
        }
        # pod=CITY is unreliable for short queries — Mappls returns empty/invalid JSON
        if pod and len(query) >= 4:
            params["pod"] = pod
        resp = requests.get(
            "https://search.mappls.com/search/places/autosuggest/json",
            params=params,
            timeout=8,
            headers={
                "User-Agent": "TruckTraffic/1.0 (trucktraffic.in)",
                "Referer": "https://ptl-market.onrender.com",
                "Origin": "https://ptl-market.onrender.com",
            },
        )
        # Guard against empty/non-JSON responses from Mappls
        text = resp.text.strip()
        if not text:
            return {"suggestedLocations": [], "userAddedLocations": []}
        return resp.json()
    except ValueError:
        # Mappls returned non-JSON (e.g. empty body for short pod=CITY queries)
        return {"suggestedLocations": [], "userAddedLocations": []}
    except Exception as e:
        logger.warning(f"Places search failed: {e}")
        return {"suggestedLocations": [], "userAddedLocations": []}


@api_router.get("/testgeocode")
async def test_geocode(
    pincode: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
):
    """Test both geocoding paths — verify before deploying.

    Test pincode geocoding (used for LC locality selections):
      GET /api/testgeocode?pincode=400053   (Andheri West)
      GET /api/testgeocode?pincode=562123   (Nelamangala)

    Test city-name geocoding (used for CITY selections like Mumbai):
      GET /api/testgeocode?city=Mumbai
      GET /api/testgeocode?city=Nelamangala
      GET /api/testgeocode?city=Bengaluru
    """
    results = {}
    if pincode:
        try:
            # Step 1: Nominatim by postalcode
            resp = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={"postalcode": pincode, "country": "India", "format": "json", "limit": 1},
                timeout=10,
                headers={"User-Agent": "TruckTraffic/1.0 (trucktraffic.in)"},
            )
            data = resp.json()
            results["nominatim_by_pincode"] = data[0] if data else "no results"
        except Exception as e:
            results["nominatim_by_pincode"] = f"error: {e}"

        try:
            # Step 2: postalpincode.in (with SSL bypass)
            resp2 = requests.get(
                f"https://api.postalpincode.in/pincode/{pincode}",
                timeout=8,
                headers={"User-Agent": "LoadLink/1.0"},
                verify=False,
            )
            results["postalpincode"] = resp2.json()
        except Exception as e:
            results["postalpincode"] = f"error: {e}"

    if city:
        try:
            resp3 = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": f"{city}, India", "format": "json", "limit": 1, "countrycodes": "in"},
                timeout=10,
                headers={"User-Agent": "TruckTraffic/1.0 (trucktraffic.in)"},
            )
            data3 = resp3.json()
            results["nominatim_by_city"] = data3[0] if data3 else "no results"
        except Exception as e:
            results["nominatim_by_city"] = f"error: {e}"

    if not pincode and not city:
        results["usage"] = "Pass ?pincode=400053 or ?city=Mumbai"

    return results


@api_router.get("/testmappls")
async def test_mappls(
    query: str = Query(default="Mumbai"),
    pod: Optional[str] = Query(default=None),
    tokenizeAddress: Optional[str] = Query(default=None),
    extra: Optional[str] = Query(default=None),
):
    """
    Browser-testable Mappls Autosuggest debug endpoint.

    Test from any browser or curl — no app rebuild needed:

      # Basic query
      GET /api/testmappls?query=Mumbai

      # With tokenizeAddress
      GET /api/testmappls?query=Andheri&tokenizeAddress=true

      # With pod (single value)
      GET /api/testmappls?query=Mumbai&pod=CITY

      # With pod (multiple — test if comma-separated works)
      GET /api/testmappls?query=Andheri&pod=SLC,LC,CITY

      # Any arbitrary extra param (e.g. filter=bounds:...)
      GET /api/testmappls?query=Mumbai&extra=filter%3Dcop%3AYMCZ0J

    Returns: raw Mappls response + the exact params sent + result summary.
    """
    MAPPLS_KEY = os.environ.get("MAPPLS_KEY", "NOT_SET")
    params: dict = {
        "query": query,
        "region": "IND",
        "access_token": MAPPLS_KEY,
    }
    if tokenizeAddress:
        params["tokenizeAddress"] = tokenizeAddress
    if pod:
        params["pod"] = pod

    # `extra` lets you inject any raw param for experimentation
    # Format: key=value  e.g. extra=filter%3Dcop%3AYMCZ0J → filter=cop:YMCZ0J
    if extra and "=" in extra:
        k, v = extra.split("=", 1)
        params[k] = v

    try:
        resp = requests.get(
            "https://search.mappls.com/search/places/autosuggest/json",
            params=params,
            timeout=8,
            headers={
                "User-Agent": "TruckTraffic/1.0 (trucktraffic.in)",
                "Referer": "https://ptl-market.onrender.com",
                "Origin": "https://ptl-market.onrender.com",
            },
        )
        data = resp.json()
        results = data.get("suggestedLocations", []) + data.get("userAddedLocations", [])

        return {
            "status_code": resp.status_code,
            "key_used": MAPPLS_KEY[:10] + "...",
            "params_sent": {k: v for k, v in params.items() if k != "access_token"},
            "result_count": len(results),
            "result_summary": [
                {
                    "placeName": r.get("placeName"),
                    "type": r.get("type"),
                    "eLoc": r.get("eLoc"),
                    "latitude": r.get("latitude"),
                    "longitude": r.get("longitude"),
                    "pincode": (r.get("addressTokens") or {}).get("pincode"),
                    "city": (r.get("addressTokens") or {}).get("city"),
                    "state": (r.get("addressTokens") or {}).get("state"),
                }
                for r in results
            ],
            "raw_response": data,
        }
    except Exception as e:
        return {"error": str(e), "params_sent": {k: v for k, v in params.items() if k != "access_token"}}


@api_router.post("/loads", response_model=Load)
async def create_load(payload: LoadCreate):
    load = Load(**payload.dict())
    # Assign a unique short_id before inserting
    load.short_id = await _unique_short_id()
    doc = load.dict()
    await db.loads.insert_one(doc)
    return load


@api_router.get("/loads")
async def list_loads(
    origin: Optional[str] = Query(None),
    destination: Optional[str] = Query(None),
):
    today_str = datetime.now(timezone.utc).date().isoformat()
    await db.loads.delete_many({"loading_date": {"$lt": today_str}})

    query = {}
    if origin:
        query["origin_pincode"] = origin
    if destination:
        query["destination_pincode"] = destination

    cursor = db.loads.find(query, {"_id": 0, "images": 0}).sort("created_at", -1).limit(500)
    docs = await cursor.to_list(500)

    ids = [d["id"] for d in docs]
    counts: dict = {}
    if ids:
        cursor2 = db.loads.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "images": 1})
        async for d in cursor2:
            counts[d["id"]] = len(d.get("images") or [])
    out = []
    for d in docs:
        d["image_count"] = counts.get(d["id"], 0)
        d["images"] = []
        out.append(d)
    return out


@api_router.get("/loads/s/{short_id}")
async def get_load_by_short_id(short_id: str):
    """Resolve a short_id (6-char slug) to a full load. Used by the website
    deep-link handler when the URL is /l/{short_id}.
    Returns the load WITHOUT inline image data (same as list endpoint)."""
    short_id = (short_id or "").strip().lower()
    if not short_id:
        raise HTTPException(status_code=400, detail="short_id is required")
    doc = await db.loads.find_one({"short_id": short_id}, {"_id": 0, "images": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Load not found")
    doc["image_count"] = await db.loads.count_documents({"short_id": short_id})
    # image_count is approximate here; patch it properly
    full = await db.loads.find_one({"short_id": short_id}, {"_id": 0, "id": 1, "images": 1})
    if full:
        doc["image_count"] = len(full.get("images") or [])
    return doc


@api_router.get("/loads/{load_id}/full")
async def get_load_full(load_id: str):
    """Return one load INCLUDING its inline images as data URIs. Used by the
    edit screen so the user can add/remove photos without losing the existing
    ones."""
    doc = await db.loads.find_one({"id": load_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Load not found")
    return doc


class LoadUpdate(BaseModel):
    origin_pincode: Optional[str] = None
    origin_locality: Optional[str] = None
    origin_city: Optional[str] = None
    origin_state: Optional[str] = None
    origin_place_name: Optional[str] = None
    origin_full_address: Optional[str] = None
    origin_latitude: Optional[float] = None
    origin_longitude: Optional[float] = None
    origin_eloc: Optional[str] = None
    destination_pincode: Optional[str] = None
    destination_locality: Optional[str] = None
    destination_city: Optional[str] = None
    destination_state: Optional[str] = None
    destination_place_name: Optional[str] = None
    destination_full_address: Optional[str] = None
    destination_latitude: Optional[float] = None
    destination_longitude: Optional[float] = None
    destination_eloc: Optional[str] = None
    cargo_types: Optional[List[str]] = None
    cargo_placement: Optional[str] = None
    truck_type: Optional[str] = None
    weight_tons: Optional[float] = None
    space_cuft: Optional[float] = None
    dimension_length: Optional[float] = None
    dimension_breadth: Optional[float] = None
    dimension_height: Optional[float] = None
    price_per_ton: Optional[float] = None
    loading_date: Optional[str] = None
    images: Optional[List[str]] = None


@api_router.patch("/loads/{load_id}")
async def update_load(load_id: str, payload: LoadUpdate):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.loads.update_one({"id": load_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Load not found")
    doc = await db.loads.find_one({"id": load_id}, {"_id": 0, "images": 0})
    return doc


@api_router.delete("/loads/{load_id}")
async def delete_load(load_id: str):
    res = await db.loads.delete_one({"id": load_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Load not found")
    return {"deleted": True}


@api_router.get("/loads/{load_id}/image/{idx}")
async def get_load_image(load_id: str, idx: int):
    doc = await db.loads.find_one({"id": load_id}, {"_id": 0, "images": 1})
    imgs = (doc or {}).get("images") or []
    if not doc or idx < 0 or idx >= len(imgs):
        raise HTTPException(status_code=404, detail="Image not found")
    data_url = imgs[idx]
    if "," in data_url:
        header, b64 = data_url.split(",", 1)
        mime = "image/jpeg"
        if header.startswith("data:") and ";" in header:
            mime = header[5:].split(";")[0] or "image/jpeg"
    else:
        b64 = data_url
        mime = "image/jpeg"
    try:
        img_bytes = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=500, detail="Bad image data")
    return Response(
        content=img_bytes,
        media_type=mime,
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ===== User Profile =====
class UserProfile(BaseModel):
    phone: str                     # 10-digit local form, e.g. "9876543210"
    name: str
    company: Optional[str] = ""


class UserProfileOut(UserProfile):
    phone_full: Optional[str] = None
    uid: Optional[str] = None
    created_at: str
    updated_at: str


def _norm_phone(p: str) -> str:
    digits = "".join(ch for ch in (p or "") if ch.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits


@api_router.post("/users", response_model=UserProfileOut)
async def upsert_user(payload: UserProfile):
    """Create or update a user profile keyed by 10-digit phone."""
    phone = _norm_phone(payload.phone)
    if len(phone) != 10:
        raise HTTPException(status_code=400, detail="phone must be a 10-digit number")
    name = (payload.name or "").strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="name is required")
    company = (payload.company or "").strip()
    now = datetime.now(timezone.utc).isoformat()

    existing = await db.users.find_one({"phone": phone}, {"_id": 0})
    if existing:
        await db.users.update_one(
            {"phone": phone},
            {"$set": {"name": name, "company": company, "updated_at": now}},
        )
        doc = await db.users.find_one({"phone": phone}, {"_id": 0})
    else:
        doc = {
            "phone": phone,
            "phone_full": f"+91{phone}",
            "name": name,
            "company": company,
            "uid": None,
            "created_at": now,
            "updated_at": now,
        }
        await db.users.insert_one(doc)
        doc.pop("_id", None)
    return UserProfileOut(**doc)


@api_router.get("/users/{phone}", response_model=UserProfileOut)
async def get_user(phone: str):
    phone = _norm_phone(phone)
    if len(phone) != 10:
        raise HTTPException(status_code=400, detail="phone must be a 10-digit number")
    doc = await db.users.find_one({"phone": phone}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    return UserProfileOut(**doc)


@api_router.post("/admin/backfill-short-ids")
async def backfill_short_ids():
    """One-time migration: assign short_id to every load that doesn't have one.
    Call once after deploying this version. Safe to call multiple times — skips
    loads that already have a short_id."""
    cursor = db.loads.find(
        {"$or": [{"short_id": None}, {"short_id": {"$exists": False}}]},
        {"_id": 1, "id": 1}
    )
    updated = 0
    async for doc in cursor:
        sid = await _unique_short_id()
        await db.loads.update_one(
            {"_id": doc["_id"]},
            {"$set": {"short_id": sid}}
        )
        updated += 1
    # Ensure MongoDB index on short_id for fast lookups
    await db.loads.create_index("short_id", unique=True, sparse=True, background=True)
    return {"backfilled": updated, "message": "short_id index created on loads collection"}


class ShortenRequest(BaseModel):
    url: str


class ShortenResponse(BaseModel):
    url: str
    short: str


@api_router.post("/shorten", response_model=ShortenResponse)
async def shorten_url(payload: ShortenRequest):
    """Shorten a URL via TinyURL (free, no auth). Cached in Mongo."""
    long_url = payload.url
    cached = await db.short_urls.find_one({"url": long_url}, {"_id": 0})
    if cached and cached.get("short"):
        return ShortenResponse(**cached)
    try:
        resp = requests.get(
            "https://tinyurl.com/api-create.php",
            params={"url": long_url},
            timeout=8,
            headers={"User-Agent": "LoadLink/1.0"},
        )
        text = (resp.text or "").strip()
        if resp.status_code == 200 and text.startswith("http"):
            await db.short_urls.insert_one({"url": long_url, "short": text})
            return ShortenResponse(url=long_url, short=text)
    except Exception as e:
        logger.warning(f"Shorten failed: {e}")
    return ShortenResponse(url=long_url, short=long_url)


# ===== Firebase Phone Auth =====
class VerifyTokenRequest(BaseModel):
    id_token: str


class VerifyTokenResponse(BaseModel):
    uid: str
    phone_number: str           # e.g. "+919876543210"
    phone_local: str            # 10-digit local form, e.g. "9876543210"
    verified_at: str


@api_router.post("/auth/verify-token", response_model=VerifyTokenResponse)
async def verify_firebase_token(payload: VerifyTokenRequest):
    """Verify a Firebase ID token (obtained after phone OTP sign-in)
    and return the verified phone number.
    """
    if not firebase_admin._apps:
        raise HTTPException(
            status_code=500,
            detail="Firebase Admin not initialized on server",
        )
    token = (payload.id_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="id_token is required")
    try:
        # check_revoked=False — we just need to confirm the OTP sign-in is valid
        decoded = fb_auth.verify_id_token(token, check_revoked=False)
    except fb_auth.ExpiredIdTokenError:
        raise HTTPException(status_code=401, detail="Token expired")
    except fb_auth.RevokedIdTokenError:
        raise HTTPException(status_code=401, detail="Token revoked")
    except fb_auth.InvalidIdTokenError as e:
        logger.warning(f"Invalid Firebase id_token: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        logger.error(f"Firebase verify_id_token error: {e}")
        raise HTTPException(status_code=401, detail="Token verification failed")

    phone = decoded.get("phone_number") or ""
    uid = decoded.get("uid") or decoded.get("sub") or ""
    if not phone:
        raise HTTPException(
            status_code=400,
            detail="Token has no phone_number claim. Make sure the user signed in with phone.",
        )
    # Strip "+91" prefix to get the 10-digit local form used by the app/profile.
    digits = "".join(ch for ch in phone if ch.isdigit())
    phone_local = digits[-10:] if len(digits) >= 10 else digits

    # Track this verified phone in the users collection so we can later attach
    # a profile (name/company) to it. We do NOT overwrite an existing profile.
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        await db.users.update_one(
            {"phone": phone_local},
            {
                "$set": {
                    "uid": uid,
                    "phone_full": phone or f"+91{phone_local}",
                    "last_verified_at": now_iso,
                    "updated_at": now_iso,
                },
                "$setOnInsert": {
                    "phone": phone_local,
                    "name": "",
                    "company": "",
                    "created_at": now_iso,
                },
            },
            upsert=True,
        )
    except Exception as e:
        logger.warning(f"Failed to upsert user on verify: {e}")

    return VerifyTokenResponse(
        uid=uid,
        phone_number=phone,
        phone_local=phone_local,
        verified_at=datetime.now(timezone.utc).isoformat(),
    )


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    """Ensure indexes exist on startup. Idempotent — safe to run every time."""
    try:
        await db.loads.create_index("short_id", unique=True, sparse=True, background=True)
        await db.loads.create_index("id", unique=True, background=True)
        logger.info("MongoDB indexes ensured on startup.")
    except Exception as e:
        logger.warning(f"Index creation on startup failed (non-fatal): {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
