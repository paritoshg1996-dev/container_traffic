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
from datetime import datetime, timezone, timedelta
import math
import re
import httpx
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


async def _unique_ptl_group_short_id() -> str:
    """Generate a short_id that doesn't already exist in the ptl_groups collection."""
    for _ in range(10):
        sid = _gen_short_id()
        if not await db.ptl_groups.find_one({"short_id": sid}, {"_id": 1}):
            return sid
    return _gen_short_id(8)
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Shared async HTTP clients for outbound calls (Nominatim, postalpincode.in,
# Mappls, TinyURL). Using httpx instead of `requests` matters here because
# these calls happen inside `async def` route handlers — a blocking
# `requests.get()` freezes the entire event loop for the call's duration
# (up to its timeout), stalling every other concurrent request the process
# is serving, not just the geocoding one. Two clients: one default (TLS
# verified) and one with verification disabled, since postalpincode.in's
# cert is expired but everything else should stay verified.
http_client: httpx.AsyncClient = None
http_client_insecure: httpx.AsyncClient = None

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
    truck_type: str = ""   # container type: "20ft" / "40ft" / "40ftHC" / "Reefer"
    vessel_name: Optional[str] = ""
    voyage_name: Optional[str] = ""
    weight_tons: float
    space_cuft: Optional[float] = None
    space_cbm: Optional[int] = None       # available space in cubic metres (max 65)
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
    verified: bool = False            # manually set by admin via PATCH /loads/{id}/verify
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
        resp = await http_client_insecure.get(
            f"https://api.postalpincode.in/pincode/{pincode}",
            headers={"User-Agent": "LoadLink/1.0"},
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
        resp = await http_client_insecure.get(
            f"https://api.postalpincode.in/postoffice/{name}",
            headers={"User-Agent": "LoadLink/1.0"},
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


async def _geocode_pincode_core(pincode: str) -> "GeoInfo":
    """Resolve an Indian pincode to lat/lon. Cached in Mongo.

    Strategy:
    1. MongoDB cache (permanent, free)
    2. Nominatim by postalcode (free, usually reliable)
    3. Nominatim by city name from postalpincode.in (fallback)
    All results cached permanently so each pincode is only ever looked up once.

    Shared by the /geocode/{pincode} endpoint and by the server-side lat/lon
    backfill in create_load / update_load, so a load posted or edited without
    lat/lon still gets it filled in at write time instead of relying on the
    client to fall back to this same lookup on every future search.
    """
    cached = await db.pincode_geo.find_one({"pincode": pincode}, {"_id": 0})
    if cached and cached.get("found"):
        return GeoInfo(**cached)

    nominatim_headers = {"User-Agent": "TruckTraffic/1.0 (trucktraffic.in)"}

    # Step 1: Nominatim by postalcode
    try:
        resp = await http_client.get(
            "https://nominatim.openstreetmap.org/search",
            params={"postalcode": pincode, "country": "India", "format": "json", "limit": 1},
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
        resp = await http_client_insecure.get(
            f"https://api.postalpincode.in/pincode/{pincode}",
            headers={"User-Agent": "LoadLink/1.0"},
        )
        data = resp.json()
        if isinstance(data, list) and data and data[0].get("Status") == "Success":
            offices = data[0].get("PostOffice") or []
            if offices:
                first = offices[0]
                city_name = first.get("District") or first.get("Block") or first.get("Name") or ""
                state_name = first.get("State") or ""
                if city_name:
                    geo_resp = await http_client.get(
                        "https://nominatim.openstreetmap.org/search",
                        params={"q": f"{city_name}, {state_name}, India", "format": "json", "limit": 1, "countrycodes": "in"},
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


@api_router.get("/geocode/{pincode}", response_model=GeoInfo)
async def geocode_pincode(pincode: str):
    """Resolve an Indian pincode to lat/lon. See _geocode_pincode_core for strategy."""
    if not (pincode.isdigit() and len(pincode) == 6):
        raise HTTPException(status_code=400, detail="Pincode must be 6 digits")
    return await _geocode_pincode_core(pincode)


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
    return await _geocode_city_core(city_name)


async def _geocode_city_core(city_name: str) -> "GeoInfo":
    """Core city-name->latlon resolution logic; shared by the /geocode-city
    endpoint and by the server-side lat/lon backfill in create_load /
    update_load (used when a load has no pincode, only a place/city name)."""
    city_name = (city_name or "").strip()
    if not city_name:
        return GeoInfo(pincode="", found=False)

    cache_key = city_name.lower()
    cached = await db.city_geo.find_one({"city": cache_key}, {"_id": 0})
    if cached:
        return GeoInfo(pincode="", lat=cached["lat"], lon=cached["lon"], found=True)

    try:
        resp = await http_client.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": f"{city_name}, India",
                "format": "json",
                "limit": 1,
                "countrycodes": "in",
            },
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


async def _resolve_missing_coords(
    pincode: str, place_name: str, city: str, full_address: str
) -> tuple:
    """Best-effort server-side lat/lon resolution for a load's origin or
    destination, mirroring the same pincode → eLoc/city-name fallback chain
    the client used to run on every search (see geocodePin/geocodeEloc in
    the app). Called from create_load and update_load so a load's coords
    get filled in once, at write time, instead of every load without stored
    lat/lon forcing a client-side geocode round-trip on every future search.

    Returns (lat, lon) or (None, None) if nothing could be resolved.
    """
    # Step 1: a valid 6-digit pincode, either the field itself or extracted
    # from the full address string (same regex the client used).
    candidate_pincode = pincode if (pincode and pincode.isdigit() and len(pincode) == 6) else None
    if not candidate_pincode and full_address:
        m = re.search(r'\b(\d{6})\b', full_address)
        if m:
            candidate_pincode = m.group(1)
    if candidate_pincode:
        info = await _geocode_pincode_core(candidate_pincode)
        if info.found:
            return info.lat, info.lon

    # Step 2: city/place name fallback (CITY-type Mappls results with no pincode)
    name = place_name or city
    if name:
        info = await _geocode_city_core(name)
        if info.found:
            return info.lat, info.lon

    return None, None


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
        resp = await http_client.get(
            "https://search.mappls.com/search/places/autosuggest/json",
            params=params,
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
            resp = await http_client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"postalcode": pincode, "country": "India", "format": "json", "limit": 1},
                headers={"User-Agent": "TruckTraffic/1.0 (trucktraffic.in)"},
            )
            data = resp.json()
            results["nominatim_by_pincode"] = data[0] if data else "no results"
        except Exception as e:
            results["nominatim_by_pincode"] = f"error: {e}"

        try:
            # Step 2: postalpincode.in (with SSL bypass)
            resp2 = await http_client_insecure.get(
                f"https://api.postalpincode.in/pincode/{pincode}",
                headers={"User-Agent": "LoadLink/1.0"},
            )
            results["postalpincode"] = resp2.json()
        except Exception as e:
            results["postalpincode"] = f"error: {e}"

    if city:
        try:
            resp3 = await http_client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": f"{city}, India", "format": "json", "limit": 1, "countrycodes": "in"},
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
        resp = await http_client.get(
            "https://search.mappls.com/search/places/autosuggest/json",
            params=params,
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
    if payload.space_cbm is None or payload.space_cbm <= 0 or payload.space_cbm > 65:
        raise HTTPException(status_code=400, detail="space_cbm is required and must be between 1 and 65")
    load = Load(**payload.dict())
    # Assign a unique short_id before inserting
    load.short_id = await _unique_short_id()

    # Ports/ICDs are matched exactly by UN/LOCODE — normalise casing, no geocoding.
    load.origin_pincode = (load.origin_pincode or "").strip().upper()
    load.destination_pincode = (load.destination_pincode or "").strip().upper()
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
        query["origin_pincode"] = origin.strip().upper()
    if destination:
        query["destination_pincode"] = destination.strip().upper()

    cursor = db.loads.find(query, {"_id": 0, "images": 0}).sort("created_at", -1).limit(500)
    docs = await cursor.to_list(500)

    ids = [d["id"] for d in docs]
    counts: dict = {}
    if ids:
        # Compute image_count with Mongo's $size instead of pulling the
        # full images array (each entry can be several MB) back over the
        # wire just to call len() on it client-side.
        cursor2 = db.loads.aggregate([
            {"$match": {"id": {"$in": ids}}},
            {"$project": {"_id": 0, "id": 1, "image_count": {"$size": {"$ifNull": ["$images", []]}}}},
        ])
        async for d in cursor2:
            counts[d["id"]] = d["image_count"]
    out = []
    for d in docs:
        d["image_count"] = counts.get(d["id"], 0)
        d["images"] = []
        out.append(d)
    return out


@api_router.get("/loads/my/{phone}")
async def get_my_loads(phone: str):
    """Return this poster's own Truck Space listings, server-filtered by phone
    (mirrors /ptl/loads/my/{phone}). Used by the My Posts screen so it doesn't
    have to fetch every truck-space listing on the platform and filter client-side.
    Returns loads WITHOUT inline image data (same as the /loads list endpoint)."""
    phone = _norm_phone(phone)
    if len(phone) != 10:
        raise HTTPException(status_code=400, detail="phone must be a 10-digit number")

    cursor = db.loads.find(
        {"poster_phone": phone}, {"_id": 0, "images": 0}
    ).sort("created_at", -1).limit(200)
    docs = await cursor.to_list(200)

    ids = [d["id"] for d in docs]
    counts: dict = {}
    if ids:
        cursor2 = db.loads.aggregate([
            {"$match": {"id": {"$in": ids}}},
            {"$project": {"_id": 0, "id": 1, "image_count": {"$size": {"$ifNull": ["$images", []]}}}},
        ])
        async for d in cursor2:
            counts[d["id"]] = d["image_count"]
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
    # $size avoids pulling the full images array back just to count it.
    count_docs = await db.loads.aggregate([
        {"$match": {"short_id": short_id}},
        {"$project": {"_id": 0, "image_count": {"$size": {"$ifNull": ["$images", []]}}}},
    ]).to_list(1)
    doc["image_count"] = count_docs[0]["image_count"] if count_docs else 0
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
    vessel_name: Optional[str] = None
    voyage_name: Optional[str] = None
    weight_tons: Optional[float] = None
    space_cuft: Optional[float] = None
    space_cbm: Optional[int] = None
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
    for k in ("origin_pincode", "destination_pincode"):
        if k in update and isinstance(update[k], str):
            update[k] = update[k].strip().upper()

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
class ContactEntry(BaseModel):
    phone: str   # normalized 10-digit
    name: str    # display name from the user's address book (may be empty string)


class UserProfile(BaseModel):
    phone: str                           # 10-digit local form, e.g. "9876543210"
    name: str
    company: Optional[str] = ""
    contacts: Optional[List[ContactEntry]] = None   # phonebook entries with name + phone
    pan_number: Optional[str] = None
    aadhar_number: Optional[str] = None


class UserProfileOut(BaseModel):
    phone: str
    name: str
    company: Optional[str] = ""
    phone_full: Optional[str] = None
    uid: Optional[str] = None
    profile_verified: bool = False
    verification_submitted: bool = False   # True once docs have been submitted
    created_at: str
    updated_at: str
    # contacts intentionally excluded from outbound profile responses
    # pan/aadhar intentionally excluded — never sent to clients


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

    # Normalize contacts: valid 10-digit numbers only, deduplicated, own number excluded
    raw_contacts = payload.contacts or []
    norm_contacts: Optional[List[dict]] = None
    if raw_contacts is not None:
        seen: set = set()
        cleaned: List[dict] = []
        for c in raw_contacts:
            digits = "".join(ch for ch in str(c.phone) if ch.isdigit())
            local = digits[-10:] if len(digits) >= 10 else digits
            if len(local) == 10 and local != phone and local not in seen:
                seen.add(local)
                cleaned.append({"phone": local, "name": (c.name or "").strip()})
        norm_contacts = cleaned

    set_fields: dict = {"name": name, "company": company, "updated_at": now}
    if norm_contacts is not None:
        set_fields["contacts"] = norm_contacts

    existing = await db.users.find_one({"phone": phone}, {"_id": 0})
    if existing:
        await db.users.update_one({"phone": phone}, {"$set": set_fields})
        raw = await db.users.find_one({"phone": phone}, {"_id": 0, "contacts": 0, "pan_number": 0, "aadhar_number": 0, "aadhar_front_img": 0, "aadhar_back_img": 0, "pan_img": 0})
        doc = raw or {}
        doc.setdefault("profile_verified", False)
        doc.setdefault("verification_submitted", False)
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
        if norm_contacts is not None:
            doc["contacts"] = norm_contacts
        await db.users.insert_one(doc)
        doc.pop("_id", None)
        doc.pop("contacts", None)
        doc.pop("pan_number", None)
        doc.pop("aadhar_number", None)
        doc.setdefault("profile_verified", False)
        doc.setdefault("verification_submitted", False)
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


class BatchMutualsRequest(BaseModel):
    viewer_phone: str
    poster_phones: List[str]   # list of poster phones to check against


class BatchMutualsResponse(BaseModel):
    # map of poster_phone → list of mutual phones (viewer resolves names client-side)
    mutuals: dict


@api_router.post("/users/mutuals/batch")
async def get_mutual_contacts_batch(payload: BatchMutualsRequest):
    """Return mutual contact phones between the viewer and multiple posters
    in a single call. Used by the load market list to show mutual counts
    on cards without N individual requests.
    Caller resolves phone → display-name using their local phonebook."""
    v = _norm_phone(payload.viewer_phone)
    if len(v) != 10:
        raise HTTPException(status_code=400, detail="viewer_phone must be 10 digits")

    # Fetch viewer's contact list once
    v_doc = await db.users.find_one({"phone": v}, {"_id": 0, "contacts": 1})
    raw_v = (v_doc or {}).get("contacts") or []
    # Support both legacy List[str] and new List[{phone, name}] formats
    v_set: set = set(
        c["phone"] if isinstance(c, dict) else c
        for c in raw_v
    )
    if not v_set:
        return BatchMutualsResponse(mutuals={})

    # Normalise poster phones, deduplicate, exclude viewer
    poster_phones = list({
        _norm_phone(p) for p in payload.poster_phones
        if len(_norm_phone(p)) == 10 and _norm_phone(p) != v
    })
    if not poster_phones:
        return BatchMutualsResponse(mutuals={})

    # Fetch all poster contact lists in one query
    cursor = db.users.find(
        {"phone": {"$in": poster_phones}},
        {"_id": 0, "phone": 1, "contacts": 1}
    )
    result: dict = {}
    async for doc in cursor:
        raw_p = doc.get("contacts") or []
        p_set: set = set(
            c["phone"] if isinstance(c, dict) else c
            for c in raw_p
        )
        mutual = list(v_set & p_set)
        if mutual:
            result[doc["phone"]] = mutual

    return BatchMutualsResponse(mutuals=result)





class MutualsResponse(BaseModel):
    mutual_phones: List[str]


@api_router.get("/users/{viewer_phone}/mutuals/{poster_phone}", response_model=MutualsResponse)
async def get_mutual_contacts(viewer_phone: str, poster_phone: str):
    """Return phones present in BOTH viewer's and poster's contact lists.
    Numbers only — caller resolves names from their own phonebook so we
    never expose the poster's contact names to a third party."""
    v = _norm_phone(viewer_phone)
    p = _norm_phone(poster_phone)
    if len(v) != 10 or len(p) != 10:
        raise HTTPException(status_code=400, detail="Both phones must be 10-digit numbers")
    if v == p:
        return MutualsResponse(mutual_phones=[])
    v_doc = await db.users.find_one({"phone": v}, {"_id": 0, "contacts": 1})
    p_doc = await db.users.find_one({"phone": p}, {"_id": 0, "contacts": 1})
    if not v_doc or not p_doc:
        return MutualsResponse(mutual_phones=[])
    raw_v = v_doc.get("contacts") or []
    raw_p = p_doc.get("contacts") or []
    v_set: set = set(c["phone"] if isinstance(c, dict) else c for c in raw_v)
    p_set: set = set(c["phone"] if isinstance(c, dict) else c for c in raw_p)
    if not v_set or not p_set:
        return MutualsResponse(mutual_phones=[])
    return MutualsResponse(mutual_phones=list(v_set & p_set))


@api_router.post("/users/{phone}/contacts")
async def update_contacts(phone: str, contacts: List[ContactEntry]):
    """Lightweight endpoint to upsert only the contacts list for a user.
    Called after login without re-sending name/company.
    Each entry carries a phone (10-digit) and name (display name from phonebook)."""
    phone = _norm_phone(phone)
    if len(phone) != 10:
        raise HTTPException(status_code=400, detail="phone must be 10 digits")
    seen: set = set()
    cleaned: List[dict] = []
    for c in contacts:
        digits = "".join(ch for ch in str(c.phone) if ch.isdigit())
        local = digits[-10:] if len(digits) >= 10 else digits
        if len(local) == 10 and local != phone and local not in seen:
            seen.add(local)
            cleaned.append({"phone": local, "name": (c.name or "").strip()})
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"phone": phone},
        {"$set": {"contacts": cleaned, "contacts_updated_at": now}},
        upsert=False,
    )
    return {"phone": phone, "contacts_saved": len(cleaned)}


class VerificationDocsRequest(BaseModel):
    pan_number: Optional[str] = None
    aadhar_number: Optional[str] = None
    aadhar_front_img: Optional[str] = None   # base64 data-URI
    aadhar_back_img: Optional[str] = None    # base64 data-URI
    pan_img: Optional[str] = None            # base64 data-URI


@api_router.post("/users/{phone}/verify-docs")
async def submit_verification_docs(phone: str, payload: VerificationDocsRequest):
    """User submits PAN + Aadhar for manual verification.
    Accepts numbers and/or document photos (base64). At least one form of
    each document is required. Marks verification_submitted=True."""
    phone = _norm_phone(phone)
    if len(phone) != 10:
        raise HTTPException(status_code=400, detail="phone must be 10 digits")

    import re as _re

    # Validate PAN if provided as text
    pan = (payload.pan_number or "").strip().upper()
    if pan and not _re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]$", pan):
        raise HTTPException(status_code=400, detail="Invalid PAN format (e.g. ABCDE1234F)")

    # Validate Aadhar number if provided as text
    aadhar = (payload.aadhar_number or "").strip().replace(" ", "")
    if aadhar and not _re.match(r"^\d{12}$", aadhar):
        raise HTTPException(status_code=400, detail="Aadhar must be 12 digits")

    # At least one form of each document must be present
    has_pan = bool(pan) or bool(payload.pan_img)
    has_aadhar = bool(aadhar) or (bool(payload.aadhar_front_img))
    if not has_pan:
        raise HTTPException(status_code=400, detail="Please provide PAN number or upload PAN card photo")
    if not has_aadhar:
        raise HTTPException(status_code=400, detail="Please provide Aadhar number or upload Aadhar front photo")

    # Validate base64 images are not too large (max 5MB each)
    MAX_IMG = 5 * 1024 * 1024 * 4 // 3  # base64 overhead ~4/3
    for field_name, img in [
        ("Aadhar front", payload.aadhar_front_img),
        ("Aadhar back", payload.aadhar_back_img),
        ("PAN card", payload.pan_img),
    ]:
        if img and len(img) > MAX_IMG:
            raise HTTPException(status_code=400, detail=f"{field_name} image is too large (max 5 MB)")

    now = datetime.now(timezone.utc).isoformat()
    set_fields: dict = {
        "verification_submitted": True,
        "verification_submitted_at": now,
        "profile_verified": False,
    }
    if pan:
        set_fields["pan_number"] = pan
    if aadhar:
        set_fields["aadhar_number"] = aadhar
    if payload.aadhar_front_img:
        set_fields["aadhar_front_img"] = payload.aadhar_front_img
    if payload.aadhar_back_img:
        set_fields["aadhar_back_img"] = payload.aadhar_back_img
    if payload.pan_img:
        set_fields["pan_img"] = payload.pan_img

    result = await db.users.update_one(
        {"phone": phone},
        {"$set": set_fields},
        upsert=False,
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"phone": phone, "verification_submitted": True,
            "message": "Documents submitted. Verification is under review."}


@api_router.patch("/users/{phone}/profile-verify")
async def set_profile_verified(phone: str, payload: dict):
    """Admin-only: approve or reject a user's profile verification."""
    import os
    admin_key = os.getenv("ADMIN_KEY", "")
    if not admin_key or payload.get("admin_key") != admin_key:
        raise HTTPException(status_code=403, detail="Invalid admin key")
    phone = _norm_phone(phone)
    verified = bool(payload.get("verified", False))
    now = datetime.now(timezone.utc).isoformat()
    result = await db.users.update_one(
        {"phone": phone},
        {"$set": {"profile_verified": verified, "profile_verified_at": now}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"phone": phone, "profile_verified": verified}


class VerifyLoadRequest(BaseModel):
    verified: bool
    admin_key: str          # simple shared secret; set ADMIN_KEY env var on Render


@api_router.patch("/loads/{load_id}/verify")
async def set_load_verified(load_id: str, payload: VerifyLoadRequest):
    """Admin-only: set or unset the verified flag on a load.
    Requires the ADMIN_KEY env var to match payload.admin_key."""
    import os
    admin_key = os.getenv("ADMIN_KEY", "")
    if not admin_key or payload.admin_key != admin_key:
        raise HTTPException(status_code=403, detail="Invalid admin key")
    result = await db.loads.update_one(
        {"id": load_id},
        {"$set": {"verified": payload.verified, "verified_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Load not found")
    return {"id": load_id, "verified": payload.verified}


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
        resp = await http_client.get(
            "https://tinyurl.com/api-create.php",
            params={"url": long_url},
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


# ============================================================================
# ===== Container LCL Consolidation =====
# ============================================================================
# Shippers with less-than-container-load (LCL) cargo on the same route post
# against a container; capacity below is tracked per-listing so multiple
# small shippers can see how much of that container is already spoken for.
#
# NOTE: removed the old CARGO_COMPATIBILITY dict here — it was defined but
# never referenced anywhere (matching is manual: browse + call/bid, not an
# automated compatibility check), so it was dead code.

# Approximate standard payload capacities (kg) by ISO container type. These
# vary by manufacturer, container age/condition and the gross-weight rating
# of the specific unit/line — treat as a sensible default, not a certified
# figure; verify against your CFS/carrier tariff before enforcing hard limits.
CONTAINER_CAPACITY_KG = {
    "20ft": 21700,
    "40ft": 26730,
    "40ftHC": 26500,
    "Reefer": 26730,
    "40HC": 26500,
}
DEFAULT_CONTAINER_CAPACITY_KG = 26730   # fallback: standard 40ft payload


def resolve_container_capacity_kg(container_type: Optional[str]) -> float:
    """Look up max payload (kg) for a container type, falling back to the
    40ft default when the type is missing or unrecognised. Case-insensitive."""
    key = (container_type or "").strip().lower()
    lookup = {k.lower(): v for k, v in CONTAINER_CAPACITY_KG.items()}
    return lookup.get(key, DEFAULT_CONTAINER_CAPACITY_KG)


class PtlLoadPost(BaseModel):
    poster_phone: str
    origin_locality: str
    origin_city: str
    origin_state: Optional[str] = ""
    origin_pincode: Optional[str] = ""
    origin_latitude: Optional[float] = None
    origin_longitude: Optional[float] = None
    destination_locality: str
    destination_city: str
    destination_state: Optional[str] = ""
    destination_pincode: Optional[str] = ""
    destination_latitude: Optional[float] = None
    destination_longitude: Optional[float] = None
    cargo_type: str          # e.g. "Bags", "Carton Box", "Drums"
    cargo_category: str      # "GENERAL" | "FRAGILE" | "HAZMAT" | "PERISHABLE"
    weight_kg: float
    space_cbm: Optional[int] = None       # available space in cubic metres (max 65)
    truck_type: Optional[str] = ""   # container type: "20ft" / "40ft" / "40HC"
                                      # (field name kept as truck_type — an
                                      # API/DB rename wasn't in scope for this pass)
    loading_date: Optional[str] = None   # YYYY-MM-DD
    ready_date: Optional[str] = None     # legacy alias for loading_date
    # Optional details (collapsible section in the UI)
    dimension_length: Optional[float] = None    # ft
    dimension_breadth: Optional[float] = None   # ft
    dimension_height: Optional[float] = None    # ft
    cargo_placement: Optional[str] = ""         # "Stackable" | "Non Stackable"
    images: Optional[List[str]] = None          # base64 data URIs (max 3)


class PtlGroupResponse(BaseModel):
    id: str
    corridor: str
    origin_display: str
    destination_display: str
    load_ids: List[str]
    total_weight_kg: float
    capacity_kg: float
    capacity_remaining_kg: float
    fill_pct: float
    cargo_categories: List[str]
    status: str
    created_at: str
    members: Optional[List[dict]] = None


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points, in kilometres."""
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def derive_corridor(code: str) -> str:
    """Normalise a UN/LOCODE (or legacy city name) to a corridor tag used for
    exact group matching."""
    return (code or "").strip().upper()


def _strip_group_internals(g: dict) -> dict:
    """Remove anchor lat/lon fields the client should not see."""
    out = {k: v for k, v in g.items() if k not in {"origin_lat", "origin_lon", "dest_lat", "dest_lon"}}
    return out


async def _create_solo_ptl_group(new_load: dict) -> str:
    """Create a standalone group containing only this load — no matching.

    Every posted partial load becomes its own listing; the group is only kept
    as a container so the existing marketplace, deep-link (`/a/{group_id}`)
    and Bids Received endpoints keep working without changes.
    """
    origin_corridor = derive_corridor(new_load["origin"]["pincode"])
    dest_corridor = derive_corridor(new_load["destination"]["pincode"])
    now_iso = datetime.now(timezone.utc).isoformat()
    gid = f"GRP-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{new_load['poster_phone'][-4:]}-{_gen_short_id(4)}"
    short_id = await _unique_ptl_group_short_id()
    cap_kg = resolve_container_capacity_kg(new_load.get("truck_type"))
    group_doc = {
        "id": gid,
        "short_id": short_id,
        "corridor": f"{origin_corridor}→{dest_corridor}",
        "origin_display": new_load["origin"]["locality"] or new_load["origin"]["city"],
        "destination_display": new_load["destination"]["locality"] or new_load["destination"]["city"],
        "origin_lat": new_load["origin"].get("latitude"),
        "origin_lon": new_load["origin"].get("longitude"),
        "dest_lat": new_load["destination"].get("latitude"),
        "dest_lon": new_load["destination"].get("longitude"),
        "load_ids": [new_load["id"]],
        "total_weight_kg": new_load["weight_kg"],
        "capacity_kg": cap_kg,
        "capacity_remaining_kg": max(0, cap_kg - new_load["weight_kg"]),
        "fill_pct": round(min(new_load["weight_kg"] / cap_kg * 100, 999.9), 1),
        "cargo_categories": [new_load["cargo_category"]],
        "status": "FORMING",
        "created_at": now_iso,
    }
    await db.ptl_groups.insert_one(group_doc)
    await db.ptl_loads.update_one(
        {"id": new_load["id"]},
        {"$set": {"group_id": gid, "status": "OPEN"}},
    )
    return gid


# ── POST a new partial load + trigger matching ─────────────────────────────
@api_router.post("/ptl/loads")
async def post_ptl_load(payload: PtlLoadPost):
    phone = _norm_phone(payload.poster_phone)
    if len(phone) != 10:
        raise HTTPException(status_code=400, detail="poster_phone must be a 10-digit number")
    if payload.weight_kg <= 0:
        raise HTTPException(status_code=400, detail="weight_kg must be > 0")
    if payload.space_cbm is None or payload.space_cbm <= 0 or payload.space_cbm > 65:
        raise HTTPException(status_code=400, detail="space_cbm is required and must be between 1 and 65")
    max_kg = resolve_container_capacity_kg(payload.truck_type)
    if payload.weight_kg > max_kg:
        raise HTTPException(
            status_code=400,
            detail=f"weight_kg cannot exceed {max_kg:.0f} kg (max payload for a {payload.truck_type or '40ft'} container)",
        )
    # cargo_category is accepted as-is (raw cargo type e.g. "Bags", "Drums",
    # "Pipes", "Carton Box", "Fresh Produce", "Others: <text>"). No
    # recategorisation is performed.

    user = await db.users.find_one({"phone": phone}, {"_id": 0, "name": 1, "company": 1})
    now = datetime.now(timezone.utc)
    load_id = f"PTL-{now.strftime('%Y%m%d%H%M%S')}-{phone[-4:]}-{_gen_short_id(4)}"

    # Ports/ICDs match exactly by UN/LOCODE — no lat/lon geocoding.
    origin_lat, origin_lon = payload.origin_latitude, payload.origin_longitude
    dest_lat, dest_lon = payload.destination_latitude, payload.destination_longitude

    doc = {
        "id": load_id,
        "poster_phone": phone,
        "poster_name": (user or {}).get("name", ""),
        "poster_company": (user or {}).get("company", ""),
        "origin": {
            "locality": payload.origin_locality,
            "city": payload.origin_city,
            "state": payload.origin_state or "",
            "pincode": payload.origin_pincode,
            "latitude": origin_lat,
            "longitude": origin_lon,
        },
        "destination": {
            "locality": payload.destination_locality,
            "city": payload.destination_city,
            "state": payload.destination_state or "",
            "pincode": payload.destination_pincode,
            "latitude": dest_lat,
            "longitude": dest_lon,
        },
        "cargo_type": payload.cargo_type,
        "cargo_category": payload.cargo_category,
        "weight_kg": payload.weight_kg,
        "space_cbm": payload.space_cbm,
        "truck_type": payload.truck_type or "",
        "loading_date": payload.loading_date or payload.ready_date,
        "ready_date": payload.ready_date,
        "dimension_length": payload.dimension_length,
        "dimension_breadth": payload.dimension_breadth,
        "dimension_height": payload.dimension_height,
        "cargo_placement": payload.cargo_placement or "",
        "images": payload.images or [],
        "status": "OPEN",
        "group_id": None,
        "posted_at": now.isoformat(),
        "expires_at": (now + timedelta(days=7)),
    }
    await db.ptl_loads.insert_one(doc)
    # No group formation / matching — each posted partial load becomes its own
    # standalone listing (a solo "group" is created purely so the existing
    # marketplace endpoints, deep-link paths and Bids Received flows keep
    # working unchanged).
    group_id = await _create_solo_ptl_group(doc)
    group_doc = await db.ptl_groups.find_one({"id": group_id}, {"_id": 0, "short_id": 1})
    return {
        "load_id": load_id,
        "group_id": group_id,
        "group_short_id": (group_doc or {}).get("short_id"),
        "matched": False,
    }


# ── GET my PTL loads ───────────────────────────────────────────────────────
@api_router.get("/ptl/loads/my/{phone}")
async def get_my_ptl_loads(phone: str):
    phone = _norm_phone(phone)
    if len(phone) != 10:
        raise HTTPException(status_code=400, detail="phone must be a 10-digit number")
    cursor = db.ptl_loads.find(
        {"poster_phone": phone, "status": {"$ne": "CANCELLED"}},
        # Exclude inline base64 images (same reasoning as /loads/my/{phone}):
        # each photo can be several MB, and the My Posts list only needs a
        # count to render the photo badge, not the bytes themselves.
        {"_id": 0, "expires_at": 0, "images": 0},
    ).sort("posted_at", -1).limit(50)
    loads = await cursor.to_list(length=50)

    ids = [l["id"] for l in loads]
    counts: dict = {}
    if ids:
        cursor2 = db.ptl_loads.aggregate([
            {"$match": {"id": {"$in": ids}}},
            {"$project": {"_id": 0, "id": 1, "image_count": {"$size": {"$ifNull": ["$images", []]}}}},
        ])
        async for d in cursor2:
            counts[d["id"]] = d["image_count"]

    # Flatten origin/destination so the frontend type matches PtlLoad
    out = []
    for l in loads:
        o = l.get("origin") or {}
        d = l.get("destination") or {}
        out.append({
            **{k: v for k, v in l.items() if k not in ("origin", "destination")},
            "origin_locality": o.get("locality", ""),
            "origin_city": o.get("city", ""),
            "origin_state": o.get("state", ""),
            "origin_pincode": o.get("pincode", ""),
            "origin_latitude": o.get("latitude"),
            "origin_longitude": o.get("longitude"),
            "destination_locality": d.get("locality", ""),
            "destination_city": d.get("city", ""),
            "destination_state": d.get("state", ""),
            "destination_pincode": d.get("pincode", ""),
            "destination_latitude": d.get("latitude"),
            "destination_longitude": d.get("longitude"),
            "image_count": counts.get(l["id"], 0),
        })
    return out


# ── DELETE a PTL load (hard delete) ────────────────────────────────────────
# Hard-deletes the load row from the DB (matches truck-space DELETE behaviour)
# and recomputes/cleans up the group it belonged to. Related bids for this
# listing are also removed so they don't linger as orphans.
@api_router.delete("/ptl/loads/{load_id}")
async def cancel_ptl_load(load_id: str, phone: str):
    load = await db.ptl_loads.find_one({"id": load_id})
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")
    if load["poster_phone"] != _norm_phone(phone):
        raise HTTPException(status_code=403, detail="Not your load")

    gid = load.get("group_id")

    # Remove the load row itself (hard delete)
    await db.ptl_loads.delete_one({"id": load_id})

    # Clean up any bids placed on this listing
    try:
        await db.bids.delete_many({"listing_id": load_id})
    except Exception:
        pass

    # Recompute group totals / clean up empty group
    if gid:
        g = await db.ptl_groups.find_one({"id": gid})
        if g:
            remaining_ids = [lid for lid in g.get("load_ids", []) if lid != load_id]
            new_total = max(0.0, g["total_weight_kg"] - load["weight_kg"])
            cap_kg = g.get("capacity_kg") or DEFAULT_CONTAINER_CAPACITY_KG
            new_rem = max(0, cap_kg - new_total)
            new_fill = (new_total / cap_kg * 100) if cap_kg else 0
            if not remaining_ids:
                # No members left — delete the group
                await db.ptl_groups.delete_one({"id": gid})
            else:
                # Recompute cargo_categories from remaining loads
                rem_loads = await db.ptl_loads.find(
                    {"id": {"$in": remaining_ids}, "status": {"$ne": "CANCELLED"}},
                    {"_id": 0, "cargo_category": 1},
                ).to_list(length=50)
                rem_cats = list({l["cargo_category"] for l in rem_loads})
                # Solo listings only — remaining loads keep the group in
                # FORMING status.
                await db.ptl_groups.update_one(
                    {"id": gid},
                    {
                        "$set": {
                            "load_ids": remaining_ids,
                            "total_weight_kg": new_total,
                            "capacity_remaining_kg": new_rem,
                            "fill_pct": round(min(new_fill, 999.9), 1),
                            "status": "FORMING",
                            "cargo_categories": rem_cats or g.get("cargo_categories", []),
                        }
                    },
                )
    return {"deleted": True}


# ── GET all FORMING / FULL groups (for browsing in the market) ─────────────
@api_router.get("/ptl/groups")
async def list_ptl_groups(
    origin_city: Optional[str] = None,
    dest_city: Optional[str] = None,
    viewer_phone: Optional[str] = None,
):
    viewer = _norm_phone(viewer_phone) if viewer_phone else ""
    # Marketplace only surfaces FORMING groups — those still looking for a
    # partner. PAIRED and CONFIRMED groups are private to their two members.
    query: dict = {"status": "FORMING"}
    if origin_city and dest_city:
        query["corridor"] = f"{derive_corridor(origin_city)}→{derive_corridor(dest_city)}"
    elif origin_city:
        query["corridor"] = {"$regex": f"^{re.escape(derive_corridor(origin_city))}→", "$options": "i"}
    elif dest_city:
        query["corridor"] = {"$regex": f"→{re.escape(derive_corridor(dest_city))}$", "$options": "i"}

    groups = await db.ptl_groups.find(query, {"_id": 0}).sort("created_at", -1).to_list(length=50)

    out: List[dict] = []
    for g in groups:
        load_ids = g.get("load_ids", [])
        members: List[dict] = []
        if load_ids:
            loads = await db.ptl_loads.find(
                {"id": {"$in": load_ids}, "status": {"$ne": "CANCELLED"}},
                {"_id": 0, "id": 1, "poster_name": 1, "poster_company": 1, "poster_phone": 1,
                 "origin": 1, "destination": 1, "weight_kg": 1, "cargo_type": 1,
                 "cargo_category": 1, "status": 1, "truck_type": 1, "loading_date": 1,
                 "dimension_length": 1, "dimension_breadth": 1, "dimension_height": 1,
                 "cargo_placement": 1, "images": 1},
            ).to_list(length=20)
            for l in loads:
                o = l.get("origin") or {}
                d = l.get("destination") or {}
                poster_phone = l.get("poster_phone", "")
                members.append({
                    "load_id": l.get("id"),
                    "name": l.get("poster_name", ""),
                    "company": l.get("poster_company", ""),
                    "origin_locality": o.get("locality", ""),
                    "origin_city": o.get("city", ""),
                    "origin_state": o.get("state", ""),
                    "origin_pincode": o.get("pincode", ""),
                    "destination_locality": d.get("locality", ""),
                    "destination_city": d.get("city", ""),
                    "destination_state": d.get("state", ""),
                    "destination_pincode": d.get("pincode", ""),
                    "weight_kg": l.get("weight_kg", 0),
                    "cargo_type": l.get("cargo_type", ""),
                    "cargo_category": l.get("cargo_category", ""),
                    "confirmed": l.get("status") == "CONFIRMED",
                    "truck_type": l.get("truck_type", ""),
                    "loading_date": l.get("loading_date"),
                    "dimension_length": l.get("dimension_length"),
                    "dimension_breadth": l.get("dimension_breadth"),
                    "dimension_height": l.get("dimension_height"),
                    "cargo_placement": l.get("cargo_placement", ""),
                    "images": l.get("images") or [],
                    "phone": poster_phone,
                    "is_me": (viewer and poster_phone == viewer) or False,
                })
        g_out = _strip_group_internals(g)
        g_out["members"] = members
        out.append(g_out)
    return out


# ── GET single group detail ────────────────────────────────────────────────
@api_router.get("/ptl/groups/{group_id}")
async def get_ptl_group(group_id: str, viewer_phone: Optional[str] = None, light: bool = False):
    # `light=true` is used by screens (like My Posts) that batch-fetch many
    # groups just to render a list/badge and don't need actual photo bytes —
    # only whether photos exist. It excludes inline base64 `images` and
    # returns `image_count` instead. Default (light unset) is unchanged so
    # existing callers like the marketplace detail view / WhatsApp share
    # links keep getting full images.
    # Accept either the full `GRP-…` id or the 6-char short_id used by
    # WhatsApp share links (`https://www.trucktraffic.in/a/{short_id}`).
    g = await db.ptl_groups.find_one(
        {"$or": [{"id": group_id}, {"short_id": group_id}]},
        {"_id": 0},
    )
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    viewer = _norm_phone(viewer_phone) if viewer_phone else ""
    load_ids = g.get("load_ids", [])
    loads = await db.ptl_loads.find(
        {"id": {"$in": load_ids}, "status": {"$ne": "CANCELLED"}},
        {"_id": 0, "images": 0} if light else {"_id": 0},
    ).to_list(length=20) if load_ids else []

    image_counts: dict = {}
    if light and load_ids:
        cursor2 = db.ptl_loads.aggregate([
            {"$match": {"id": {"$in": load_ids}, "status": {"$ne": "CANCELLED"}}},
            {"$project": {"_id": 0, "id": 1, "image_count": {"$size": {"$ifNull": ["$images", []]}}}},
        ])
        async for d in cursor2:
            image_counts[d["id"]] = d["image_count"]
    # Solo listings only — the poster's phone is exposed to the viewer once
    # they open the detail (there is no "pair" gate anymore since matching
    # was retired). This matches the behaviour of the list endpoint
    # (`GET /api/ptl/groups`), which already returns `phone` publicly, so the
    # website and app can render the "Call" button consistently on the
    # adjustment-load detail page.
    members: List[dict] = []
    for l in loads:
        members.append({
            "load_id": l.get("id"),
            "name": l.get("poster_name", ""),
            "company": l.get("poster_company", ""),
            "origin_locality": (l.get("origin") or {}).get("locality", ""),
            "origin_city": (l.get("origin") or {}).get("city", ""),
            "origin_state": (l.get("origin") or {}).get("state", ""),
            "origin_pincode": (l.get("origin") or {}).get("pincode", ""),
            "destination_locality": (l.get("destination") or {}).get("locality", ""),
            "destination_city": (l.get("destination") or {}).get("city", ""),
            "destination_state": (l.get("destination") or {}).get("state", ""),
            "destination_pincode": (l.get("destination") or {}).get("pincode", ""),
            "weight_kg": l.get("weight_kg", 0),
            "cargo_type": l.get("cargo_type", ""),
            "cargo_category": l.get("cargo_category", ""),
            "confirmed": l.get("status") == "CONFIRMED",
            "phone": l.get("poster_phone", ""),
            "is_me": (viewer and l.get("poster_phone") == viewer) or False,
            "truck_type": l.get("truck_type", ""),
            "loading_date": l.get("loading_date"),
            "dimension_length": l.get("dimension_length"),
            "dimension_breadth": l.get("dimension_breadth"),
            "dimension_height": l.get("dimension_height"),
            "cargo_placement": l.get("cargo_placement", ""),
            "images": [] if light else (l.get("images") or []),
            "image_count": image_counts.get(l.get("id"), len(l.get("images") or [])),
        })
    g_out = _strip_group_internals(g)
    g_out["members"] = members
    # Surface the primary poster's contact on the group root as well, so
    # clients that read `group.poster_phone` / `group.poster_name` directly
    # (like the website's adjustment-load detail panel) can render the
    # Call button without having to dig into `members[]`.
    if loads:
        primary_load = loads[0]
        g_out.setdefault("poster_phone", primary_load.get("poster_phone", ""))
        g_out.setdefault("poster_name", primary_load.get("poster_name", ""))
        g_out.setdefault("poster_company", primary_load.get("poster_company", ""))
    return g_out


# ============================================================================
# ===== Bids =====
# ============================================================================
# A bid is an offer placed by a non-poster user on a Truck Space (loads) or
# Partial Load (ptl_loads) listing. The bid captures the bidder's intended
# origin/destination/weight/cargo so the poster can compare each interested
# party. Exactly one active bid per (bidder_phone, listing_id) — re-submitting
# updates the existing record.

class BidCreate(BaseModel):
    listing_id: str
    listing_type: str                 # "load" (truck space) | "ptl" (partial load)
    bidder_phone: str
    origin_locality: Optional[str] = ""
    origin_city: Optional[str] = ""
    origin_pincode: Optional[str] = ""
    origin_latitude: Optional[float] = None
    origin_longitude: Optional[float] = None
    destination_locality: Optional[str] = ""
    destination_city: Optional[str] = ""
    destination_pincode: Optional[str] = ""
    destination_latitude: Optional[float] = None
    destination_longitude: Optional[float] = None
    weight_tons: float
    cargo_type: str


async def _get_listing(listing_id: str, listing_type: str):
    """Fetch the underlying listing doc and normalise its origin/destination
    + poster_phone shape. Returns None if not found."""
    if listing_type == "load":
        doc = await db.loads.find_one({"id": listing_id}, {
            "_id": 0, "id": 1, "poster_phone": 1,
            "origin_locality": 1, "origin_city": 1, "origin_pincode": 1,
            "origin_latitude": 1, "origin_longitude": 1,
            "destination_locality": 1, "destination_city": 1, "destination_pincode": 1,
            "destination_latitude": 1, "destination_longitude": 1,
        })
        if not doc:
            return None
        return {
            "id": doc["id"],
            "poster_phone": doc.get("poster_phone", ""),
            "origin_locality": doc.get("origin_locality", ""),
            "origin_city": doc.get("origin_city", ""),
            "origin_pincode": doc.get("origin_pincode", ""),
            "origin_latitude": doc.get("origin_latitude"),
            "origin_longitude": doc.get("origin_longitude"),
            "destination_locality": doc.get("destination_locality", ""),
            "destination_city": doc.get("destination_city", ""),
            "destination_pincode": doc.get("destination_pincode", ""),
            "destination_latitude": doc.get("destination_latitude"),
            "destination_longitude": doc.get("destination_longitude"),
        }
    if listing_type == "ptl":
        doc = await db.ptl_loads.find_one({"id": listing_id}, {"_id": 0})
        if not doc:
            return None
        o = doc.get("origin") or {}
        d = doc.get("destination") or {}
        return {
            "id": doc["id"],
            "poster_phone": doc.get("poster_phone", ""),
            "origin_locality": o.get("locality", ""),
            "origin_city": o.get("city", ""),
            "origin_pincode": o.get("pincode", ""),
            "origin_latitude": o.get("latitude"),
            "origin_longitude": o.get("longitude"),
            "destination_locality": d.get("locality", ""),
            "destination_city": d.get("city", ""),
            "destination_pincode": d.get("pincode", ""),
            "destination_latitude": d.get("latitude"),
            "destination_longitude": d.get("longitude"),
        }
    return None


def _deviation_km(
    bid_lat: Optional[float], bid_lon: Optional[float],
    post_lat: Optional[float], post_lon: Optional[float],
) -> Optional[float]:
    """Straight-line distance between bid endpoint and post endpoint in km,
    rounded to 1 decimal. Returns None when either side has no coordinates."""
    if bid_lat is None or bid_lon is None or post_lat is None or post_lon is None:
        return None
    return round(haversine_km(bid_lat, bid_lon, post_lat, post_lon), 1)


@api_router.post("/bids")
async def create_or_update_bid(payload: BidCreate):
    """Place (or replace) a bid on a Truck Space or Partial Load listing.
    Enforces: one bid per (bidder_phone, listing_id); bidder cannot equal poster."""
    bidder = _norm_phone(payload.bidder_phone)
    if len(bidder) != 10:
        raise HTTPException(status_code=400, detail="bidder_phone must be a 10-digit number")
    if payload.listing_type not in ("load", "ptl"):
        raise HTTPException(status_code=400, detail="listing_type must be 'load' or 'ptl'")
    if payload.weight_tons <= 0:
        raise HTTPException(status_code=400, detail="weight_tons must be > 0")
    if not (payload.cargo_type or "").strip():
        raise HTTPException(status_code=400, detail="cargo_type is required")

    listing = await _get_listing(payload.listing_id, payload.listing_type)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if listing["poster_phone"] == bidder:
        raise HTTPException(status_code=400, detail="You cannot bid on your own post")

    # Look up bidder profile for display name / company
    user = await db.users.find_one({"phone": bidder}, {"_id": 0, "name": 1, "company": 1})

    origin_dev = _deviation_km(
        payload.origin_latitude, payload.origin_longitude,
        listing.get("origin_latitude"), listing.get("origin_longitude"),
    )
    dest_dev = _deviation_km(
        payload.destination_latitude, payload.destination_longitude,
        listing.get("destination_latitude"), listing.get("destination_longitude"),
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    bid_doc = {
        "listing_id": payload.listing_id,
        "listing_type": payload.listing_type,
        "poster_phone": listing["poster_phone"],
        "bidder_phone": bidder,
        "bidder_name": (user or {}).get("name", ""),
        "bidder_company": (user or {}).get("company", ""),
        "origin_locality": payload.origin_locality or "",
        "origin_city": payload.origin_city or "",
        "origin_pincode": payload.origin_pincode or "",
        "origin_latitude": payload.origin_latitude,
        "origin_longitude": payload.origin_longitude,
        "destination_locality": payload.destination_locality or "",
        "destination_city": payload.destination_city or "",
        "destination_pincode": payload.destination_pincode or "",
        "destination_latitude": payload.destination_latitude,
        "destination_longitude": payload.destination_longitude,
        "weight_tons": payload.weight_tons,
        "cargo_type": payload.cargo_type,
        "origin_deviation_km": origin_dev,
        "destination_deviation_km": dest_dev,
        "updated_at": now_iso,
    }

    existing = await db.bids.find_one(
        {"listing_id": payload.listing_id, "bidder_phone": bidder},
        {"_id": 0, "id": 1, "created_at": 1},
    )
    if existing:
        await db.bids.update_one(
            {"listing_id": payload.listing_id, "bidder_phone": bidder},
            {"$set": bid_doc},
        )
        bid_doc["id"] = existing["id"]
        bid_doc["created_at"] = existing.get("created_at", now_iso)
        return {**bid_doc, "updated": True}
    bid_doc["id"] = str(uuid.uuid4())
    bid_doc["created_at"] = now_iso
    await db.bids.insert_one(bid_doc)
    bid_doc.pop("_id", None)
    return {**bid_doc, "updated": False}


@api_router.get("/bids/check")
async def check_bid(viewer_phone: str, listing_id: str):
    """Has this viewer already bid on this listing?"""
    v = _norm_phone(viewer_phone)
    if len(v) != 10:
        return {"bid_placed": False}
    doc = await db.bids.find_one(
        {"listing_id": listing_id, "bidder_phone": v},
        {"_id": 0},
    )
    return {"bid_placed": bool(doc), "bid": doc}


@api_router.get("/bids/listing/{listing_id}")
async def list_bids_for_listing(listing_id: str, viewer_phone: str):
    """Return all bids for a listing. Only the listing's poster can view."""
    v = _norm_phone(viewer_phone)
    if len(v) != 10:
        raise HTTPException(status_code=400, detail="viewer_phone must be 10 digits")
    # Find the listing across both collections to verify ownership
    load = await db.loads.find_one({"id": listing_id}, {"_id": 0, "poster_phone": 1})
    ptl = None
    if not load:
        ptl = await db.ptl_loads.find_one({"id": listing_id}, {"_id": 0, "poster_phone": 1})
    if not load and not ptl:
        raise HTTPException(status_code=404, detail="Listing not found")
    owner = (load or ptl).get("poster_phone", "")
    if owner != v:
        raise HTTPException(status_code=403, detail="Only the post owner can view bids")
    cursor = db.bids.find({"listing_id": listing_id}, {"_id": 0}).sort("created_at", -1)
    out = await cursor.to_list(length=500)
    return out


@api_router.get("/bids/counts/{phone}")
async def bid_counts_for_my_posts(phone: str):
    """Count of bids per listing for posts owned by `phone`.
    Returns {listing_id: count}. Used by My Posts to show a badge on each post."""
    p = _norm_phone(phone)
    if len(p) != 10:
        return {}
    pipeline = [
        {"$match": {"poster_phone": p}},
        {"$group": {"_id": "$listing_id", "count": {"$sum": 1}}},
    ]
    out: dict = {}
    async for row in db.bids.aggregate(pipeline):
        out[row["_id"]] = row["count"]
    return out


@api_router.delete("/bids/{listing_id}")
async def withdraw_bid(listing_id: str, phone: str):
    """A bidder withdraws their bid from a listing."""
    p = _norm_phone(phone)
    if len(p) != 10:
        raise HTTPException(status_code=400, detail="phone must be 10 digits")
    res = await db.bids.delete_one({"listing_id": listing_id, "bidder_phone": p})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="No bid to withdraw")
    return {"withdrawn": True}


# ── Temporary: download the updated website HTML ───────────────────────────
@api_router.get("/download/website")
async def download_website():
    from fastapi.responses import FileResponse
    path = "/app/website.html"
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type="text/html", filename="index.html")


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
    global http_client, http_client_insecure
    http_client = httpx.AsyncClient(timeout=10.0)
    http_client_insecure = httpx.AsyncClient(timeout=10.0, verify=False)
    try:
        await db.loads.create_index("short_id", unique=True, sparse=True, background=True)
        await db.loads.create_index("id", unique=True, background=True)
        # PTL indexes
        await db.ptl_loads.create_index([("poster_phone", 1), ("status", 1)], background=True)
        await db.ptl_loads.create_index([("group_id", 1)], background=True)
        await db.ptl_loads.create_index([("status", 1), ("posted_at", -1)], background=True)
        await db.ptl_loads.create_index("id", unique=True, background=True)
        await db.ptl_groups.create_index([("corridor", 1), ("status", 1)], background=True)
        await db.ptl_groups.create_index([("status", 1), ("fill_pct", -1)], background=True)
        await db.ptl_groups.create_index("id", unique=True, background=True)
        await db.ptl_groups.create_index("short_id", unique=True, sparse=True, background=True)
        # Backfill short_id on existing groups (idempotent — only touches docs missing it)
        try:
            missing = db.ptl_groups.find(
                {"$or": [{"short_id": None}, {"short_id": {"$exists": False}}]},
                {"_id": 0, "id": 1},
            )
            async for g in missing:
                sid = await _unique_ptl_group_short_id()
                await db.ptl_groups.update_one({"id": g["id"]}, {"$set": {"short_id": sid}})
        except Exception as e:
            logger.warning(f"PTL group short_id backfill skipped: {e}")
        # TTL — auto-delete expired PTL loads (expires_at is a BSON Date)
        await db.ptl_loads.create_index([("expires_at", 1)], expireAfterSeconds=0, background=True)
        # Bids — one bid per (bidder, listing); lookup by listing and by poster
        await db.bids.create_index([("listing_id", 1), ("bidder_phone", 1)], unique=True, background=True)
        await db.bids.create_index([("poster_phone", 1)], background=True)
        await db.bids.create_index([("listing_id", 1), ("created_at", -1)], background=True)
        logger.info("MongoDB indexes ensured on startup.")
    except Exception as e:
        logger.warning(f"Index creation on startup failed (non-fatal): {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    await http_client.aclose()
    await http_client_insecure.aclose()
    client.close()
