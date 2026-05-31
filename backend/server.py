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
import requests

import firebase_admin
from firebase_admin import credentials as fb_credentials, auth as fb_auth


ROOT_DIR = Path(__file__).parent
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
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class PincodeInfo(BaseModel):
    pincode: str
    city: str
    state: str
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
    """Look up Indian pincode and return city/state."""
    if not (pincode.isdigit() and len(pincode) == 6):
        raise HTTPException(status_code=400, detail="Pincode must be 6 digits")
    try:
        resp = requests.get(
            f"https://api.postalpincode.in/pincode/{pincode}",
            timeout=8,
            headers={"User-Agent": "LoadLink/1.0"},
        )
        data = resp.json()
        if isinstance(data, list) and data and data[0].get("Status") == "Success":
            offices = data[0].get("PostOffice") or []
            if offices:
                first = offices[0]
                return PincodeInfo(
                    pincode=pincode,
                    city=first.get("District") or first.get("Block") or "",
                    state=first.get("State") or "",
                    valid=True,
                )
        return PincodeInfo(pincode=pincode, city="", state="", valid=False)
    except Exception as e:
        logger.warning(f"Pincode lookup failed: {e}")
        return PincodeInfo(pincode=pincode, city="", state="", valid=False)


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
    """Resolve an Indian pincode to lat/lon. Cached in Mongo."""
    if not (pincode.isdigit() and len(pincode) == 6):
        raise HTTPException(status_code=400, detail="Pincode must be 6 digits")

    cached = await db.pincode_geo.find_one({"pincode": pincode}, {"_id": 0})
    if cached:
        return GeoInfo(**cached)

    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"postalcode": pincode, "country": "India", "format": "json", "limit": 1},
            timeout=10,
            headers={"User-Agent": "LoadLink/1.0 (loadlink.app)"},
        )
        data = resp.json()
        if isinstance(data, list) and data:
            first = data[0]
            info = GeoInfo(
                pincode=pincode,
                lat=float(first["lat"]),
                lon=float(first["lon"]),
                found=True,
            )
            await db.pincode_geo.insert_one(info.dict())
            return info
        return GeoInfo(pincode=pincode, found=False)
    except Exception as e:
        logger.warning(f"Geocode failed for {pincode}: {e}")
        return GeoInfo(pincode=pincode, found=False)


@api_router.get("/places")
async def places_search(query: str = Query(..., min_length=2)):
    """Proxy Mappls Autosuggest — clean proxy with no extra filtering params.

    tokenizeAddress=true is always sent so the frontend receives structured
    addressTokens for parsing. Type filtering (areas only) is done client-side
    using the `type` field in each result — no pod param is sent to Mappls
    as it caused empty results in testing.
    """
    MAPPLS_KEY = os.environ.get("MAPPLS_KEY", "")
    if not MAPPLS_KEY:
        raise HTTPException(status_code=500, detail="MAPPLS_KEY not configured")
    try:
        resp = requests.get(
            "https://search.mappls.com/search/places/autosuggest/json",
            params={
                "query": query,
                "region": "IND",
                "access_token": MAPPLS_KEY,
                "tokenizeAddress": "true",
            },
            timeout=8,
            headers={
                "User-Agent": "TruckTraffic/1.0 (trucktraffic.in)",
                "Referer": "https://ptl-market.onrender.com",
                "Origin": "https://ptl-market.onrender.com",
            },
        )
        return resp.json()
    except Exception as e:
        logger.warning(f"Places search failed: {e}")
        raise HTTPException(status_code=502, detail="Places search unavailable")


@api_router.get("/places/detail/{eloc}")
async def places_detail(eloc: str):
    """Resolve a Mappls eLoc to full place detail including lat/lon.

    Mappls Autosuggest intentionally omits coordinates for city/locality-level
    results (podCity, podLocality, podSubLocality) because those cover a broad
    area and have no single representative point in the autosuggest response.
    The Place Detail API always returns a centroid lat/lon for every eLoc, so
    we call it here whenever the frontend picks a suggestion without coords.

    Results are cached in MongoDB (eloc_geo collection) to avoid redundant
    Mappls API calls — an eLoc never changes for a given place.
    """
    eloc = (eloc or "").strip().upper()
    if not eloc:
        raise HTTPException(status_code=400, detail="eLoc is required")

    # Serve from cache if available
    cached = await db.eloc_geo.find_one({"eloc": eloc}, {"_id": 0})
    if cached:
        return cached

    MAPPLS_KEY = os.environ.get("MAPPLS_KEY", "")
    if not MAPPLS_KEY:
        raise HTTPException(status_code=500, detail="MAPPLS_KEY not configured")

    try:
        resp = requests.get(
            "https://apis.mappls.com/advancedmaps/v1/{key}/place_detail".format(key=MAPPLS_KEY),
            params={"place_id": eloc},
            timeout=8,
            headers={
                "User-Agent": "TruckTraffic/1.0 (trucktraffic.in)",
                "Referer": "https://ptl-market.onrender.com",
            },
        )
        data = resp.json()

        # Mappls Place Detail wraps results under different keys depending on version
        place = (
            data.get("place_details")
            or data.get("placeDetails")
            or data.get("results", [{}])[0]
            or data
        )

        lat = place.get("latitude") or place.get("lat")
        lon = place.get("longitude") or place.get("lng") or place.get("lon")

        if lat is None or lon is None:
            logger.warning(f"Place detail for eLoc {eloc} returned no coords: {data}")
            raise HTTPException(status_code=404, detail="Coordinates not found for this eLoc")

        result = {
            "eloc": eloc,
            "latitude": float(lat),
            "longitude": float(lon),
            "placeName": place.get("placeName") or place.get("place_name") or "",
            "city": place.get("city") or "",
            "state": place.get("state") or "",
            "pincode": place.get("pincode") or place.get("pin_code") or "",
        }

        # Cache forever — eLoc→coords never change
        await db.eloc_geo.update_one(
            {"eloc": eloc},
            {"$set": result},
            upsert=True,
        )
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Place detail lookup failed for eLoc {eloc}: {e}")
        raise HTTPException(status_code=502, detail="Place detail unavailable")


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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
