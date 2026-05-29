# Truck Traffic PTL — PRD

## Original problem statement (latest)
Route Location Normalization & Storage Refactor — separate storage model (exact Mappls data) from display model (standardized 3-line UI), fix `Vashi / 400703 / 400703` bug, preserve precision for future route matching.

## Architecture
- **Frontend**: Expo / React Native (`/app/frontend/app/index.tsx`)
- **Backend**: FastAPI (`/app/backend/server.py`) + MongoDB (`db.loads`)
- **Mappls**: Autosuggest proxied through `/api/places`; pincode enrichment via postalpincode.in proxied through `/api/pincode/{pin}`.

## What's been implemented (2026-05-29)

### Storage model — Mappls precision tier (new, additive)
Each `Load` document now stores both:
- **Display tier** (existing): `origin_locality`, `origin_city`, `origin_state`, `origin_pincode` and dest equivalents
- **Precision tier** (new optional fields): `origin_place_name`, `origin_full_address`, `origin_latitude`, `origin_longitude`, `origin_eloc` and dest equivalents

Models updated: `LoadCreate`, `LoadUpdate`, `Load` — all new fields Optional → no migration needed.

### Display model — standardized 3-line route card
Layout used consistently in `SmartRouteInput` (post & find) and `LoadCard`:
- **L1 — Locality/Area** (largest, bold)
- **L2 — `City, ST`** (medium, with state abbreviation via `stateAbbr()` helper)
- **L3 — Pincode** (smallest, muted)

Per-line adaptive font shrinking on overflow (length-based ladder, since Android `adjustsFontSizeToFit` is unreliable).

### Mappls autosuggest parser — rewritten
- Now uses **`addressTokens`** (the canonical Mappls structured payload) as the primary source for locality/city/state/pincode.
- Comma-split of `placeAddress` is only a last-resort fallback, with hard guards: state can never equal the pincode.
- `placeName`, `placeAddress`, `latitude`, `longitude`, `eLoc` are now captured into `RouteInfo` and forwarded into the load payload on save.

### Legacy data sanitization
`sanitizeStateForDisplay()` and `sanitizeCityForDisplay()` defend against legacy Mongo docs where `state == pincode` (root cause of the original bug). Bad fields are simply dropped at the display layer so the corrupted L2 line collapses gracefully.

### Bug fix — `Vashi / 400703 / 400703`
Root cause: `RouteSearchModal` was deriving `state` by splitting `placeAddress` on commas and taking the last segment, which for `"Vashi, Navi Mumbai, 400703"` produced `state="400703"`. The pincode-API fallback didn't always overwrite when postalpincode returned `valid:false`. Fixed by: (a) using `addressTokens.state` first, (b) explicit `state ≠ pincode` guard at every layer.

### Files touched
- `/app/backend/server.py` — `LoadCreate`, `LoadUpdate` extended with precision fields.
- `/app/frontend/app/index.tsx` — `Load`/`RouteInfo`/`CitySuggestion` types extended; `RouteSearchModal` parser & `pick()` rewritten; `SmartRouteInput` display rewritten to L1/L2/L3 with `City, ST` on L2; `LoadCard` route block rewritten to render same standardized layout; Post Load & Edit Load `save()` updated to send the new fields; WhatsApp share text updated to the same 3-line format.

## Verified end-to-end
- Backend round-trips full payload incl. lat/lon/eLoc/place_name/full_address (`POST /api/loads` → `GET /api/loads`).
- Sanitization handles legacy bad records (state=pincode).
- TypeScript compiles cleanly (no new errors).

## What's been implemented (2026-01)

### Mappls Autosuggest: strict whitelist + freight-grade ranking (revised)
For a freight marketplace, route endpoints are settlements (city / locality /
village / industrial estate), **never** POIs. Mappls' default response mixes in
airports, railway stations, hotels, factories and shops, so we now filter the
response with a strict whitelist BEFORE ranking. Backend storage is unchanged —
precision tier (place_name / full_address / lat-lon / eLoc) flows through
untouched.

Implementation lives at the top of `RouteSearchModal` in
`/app/frontend/app/index.tsx`:

- **Whitelist** (`MAPPLS_ALLOWED_TYPES`):
  `CITY`, `LOCALITY`, `SUB_LOCALITY`, `VILLAGE`, `ADMIN_AREA`,
  `ADMINISTRATIVE_AREA`, `INDUSTRIAL_AREA`. Type comparison is normalised
  (uppercase, underscore/space/hyphen stripped) so `SUB_LOCALITY` ≡
  `SubLocality` ≡ `sublocality`.
- **Industrial-estate heuristic** (`INDUSTRIAL_AREA_HINT_RX`): a placeName /
  placeAddress containing `MIDC`, `GIDC`, `SIDC`, `UPSIDC`, `RIICO`, `KIADB`,
  `APIIC`, or `Industrial (Area|Estate|Park|Township|Zone)` is allowed even
  when Mappls returns it as POI — covers Taloja MIDC, Bhosari MIDC, etc.
- **Explicit deny** (everything else): `STATE`, `DISTRICT`, `SUB_DISTRICT`,
  `POI`, `AIRPORT`, `RAILWAY_STATION`, `HOTEL`, `RESTAURANT`,
  `TOURIST_ATTRACTION`, `BUSINESS`, `LANDMARK`, `PORT`, `SHOPPING`, and any
  unknown type without an industrial-estate hint.
- **Ranking after filter**:
  - **T1** — exact CITY match (`placeName == query` or `addressTokens.city == query`)
  - **T2** — exact LOCALITY / SUB_LOCALITY match
  - **T3** — any LOCALITY / SUB_LOCALITY / INDUSTRIAL_AREA
  - **T4** — VILLAGE
  - **T5** — other allowed admin areas (non-exact CITY etc.)
  - Within a tier: prefix-match → substring → no match → original Mappls index.
    Stable sort preserves Mappls' ordering on ties.
- **Dev log** (`__DEV__` only): for every Mappls response, prints every item
  with `{ type, name, kept }` so unmapped types that should be allowed can be
  discovered and added to the whitelist later. Stripped from production bundles
  by Metro.

Unit-tested with synthetic payloads matching the spec examples — all 6
real-world queries pass:
- Kolkata → `Kolkata [CITY]` first; airport, port, Taj Bengal dropped.
- Rewari → `Rewari [CITY, Haryana]` first; Rewari [VILLAGE, Jaisalmer]
  demoted to T4; Junction railway station dropped.
- Taloja → `Taloja [LOCALITY]` first, `Taloja MIDC` second; JSW Steel,
  Reliance plants dropped.
- Pimpri → `Pimpri [LOCALITY]` first; Tata Motors, Bajaj Auto dropped.
- Vashi → `Vashi [SUB_LOCALITY]` only; Vashi Railway Station, Inorbit Mall
  dropped.
- Mumbai → `Mumbai [CITY]` first, `Navi Mumbai [CITY]` second; airport,
  Mumbai Central, university dropped.

### Saved Pickups removed (UI + storage)
Removed below-search-bar `Saved Pickups` section since `Recent Searches` does
the same job. Storage layer (`SAVED_PICKUPS_KEY`, `bumpSavedPickup`,
`getSavedPickups`, `SavedPickup` type, `useCountPill`/`useCountText` styles, all
`section === "saved"` branches) deleted as dead code.

### Files touched
- `/app/frontend/app/index.tsx` — `RouteSearchModal` filter+ranking helpers,
  dev log, and removed Saved Pickups.

## Next action items
1. Hot-reload the Expo build, search for **Kolkata / Mumbai / Rewari / Vashi /
   Taloja / Pimpri** in both Origin and Destination pickers, and confirm:
   - The expected city/locality is the first row.
   - No airports / railway stations / hotels / factories appear.
   - Metro console shows `[Mappls] q="…" results=[{type, name, kept}, …]` —
     any allowlist-relevant `kept: false` items (e.g. Mappls returning a new
     type string) can be added to `MAPPLS_ALLOWED_TYPES` later.
2. (Optional) Once production data confirms no surprises in `type` strings,
   tighten the dev log to only print items where `kept` is false and remove
   the `__DEV__` print entirely after a stable cycle.

## Backlog / future
- Phase 2: Mappls Place Detail API for richer precision when an autosuggest
  item has `eLoc` but no `addressTokens`.
- Map view using stored `latitude` / `longitude`.
- Route matching, truck-load matching, distance/off-route — unblocked by the
  precision tier already in storage.
- Warehouse/factory search using `place_name` / `full_address`.
- One-time migration to flag/clear legacy `state == pincode` records.

## Backlog / future
- Route matching, truck-load matching, distance/off-route — all unblocked by the precision tier now available in storage.
- Map view using stored `latitude`/`longitude`.
- Warehouse/factory-level search using `place_name`/`full_address`.
- Historical data migration (one-time job) to flag/clear bad legacy state==pincode records.
