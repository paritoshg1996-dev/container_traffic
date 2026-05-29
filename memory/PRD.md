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

### Mappls Autosuggest client-side ranking + Saved Pickups removal
Mappls returned POIs (Kolkata Airport, Kolkata Port) before the actual city
(Kolkata) for plain city queries. Backend storage is unchanged — this is a
display-only re-ranking using the `type` and `addressTokens` fields already in
the response.

- **New helpers in `RouteSearchModal`**: `mapplsRankTier`, `mapplsNameMatchScore`,
  `rankMapplsSuggestions` — three-tier stable sort:
  - **P1** — `type === City | District | SubDistrict | State | Country`, or
    `placeName` exactly matches the query (case-insensitive).
  - **P2** — Localities/sub-localities/villages/towns.
  - **P3** — POIs / Airports / Ports / Railway Stations / Landmarks / unknown.
  - Within a tier: exact placeName → exact token match → prefix → substring →
    original Mappls index. Stable, so Mappls' own ordering wins ties.
- **Dev-only logging** (`__DEV__` guarded `console.log`) of every Mappls item's
  `type` so result classifications can be verified during tuning. Stripped from
  production bundles automatically by Metro.
- **Saved Pickups section removed** (UI + storage) — the recent-search list
  serves the same purpose. Removed: `SAVED_PICKUPS_KEY`, `SavedPickup` type,
  `getSavedPickups`, `bumpSavedPickup`, `savedPickupKey`, `savedPickups` state,
  `useCountPill` / `useCountText` styles, and all `section === "saved"` branches
  in row rendering.

### Files touched
- `/app/frontend/app/index.tsx` — `RouteSearchModal` ranking/dev-log added,
  Saved Pickups infrastructure deleted.

### Verified
- Unit-tested ranking with synthetic Mappls payload: queries "kolkata" with
  POI-first response returns `[Kolkata, Kolkata Salt Lake (Locality),
  New Kolkata Township (SubLocality), Kolkata Airport (POI), Kolkata Port (POI)]`
  — exactly the spec example.
- TypeScript: no new errors introduced (one pre-existing duplicate-key error
  on line 3248 in `phoneInput` style is unrelated).

## Next action items
1. **Manual visual verification on device** — install/hot-reload Expo build and:
   - Search "kolkata", "mumbai", "delhi" → confirm city appears first.
   - Confirm Saved Pickups section no longer appears below the search bar.
   - Watch Metro logs for `[Mappls] q="…" types=[…]` while searching to verify
     the actual `type` classifications Mappls returns in production.
2. **Optional Phase 2 — Mappls Place Detail API** for richer precision when an
   autosuggest item has `eLoc` but lacks `addressTokens`.

## Backlog / future
- Route matching, truck-load matching, distance/off-route — all unblocked by the precision tier now available in storage.
- Map view using stored `latitude`/`longitude`.
- Warehouse/factory-level search using `place_name`/`full_address`.
- Historical data migration (one-time job) to flag/clear bad legacy state==pincode records.
