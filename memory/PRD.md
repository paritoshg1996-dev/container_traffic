# Truck Traffic PTL — PRD

## Original problem statement (latest)
Route Location Normalization & Storage Refactor — separate storage model (exact Mappls data) from display model (standardized 3-line UI), fix `Vashi / 400703 / 400703` bug, preserve precision for future route matching. Mobile autosuggest must mirror the website's autocomplete exactly.

## Architecture
- **Frontend**: Expo / React Native (`/app/frontend/app/index.tsx`)
- **Backend**: FastAPI (`/app/backend/server.py`) + MongoDB (`db.loads`)
- **Mappls**: Autosuggest proxied through `/api/places`; pincode enrichment via postalpincode.in proxied through `/api/pincode/{pin}`.

## What's been implemented (2026-05-29)

### Storage model — Mappls precision tier (additive)
Each `Load` document stores both:
- **Display tier**: `origin_locality`, `origin_city`, `origin_state`, `origin_pincode` and dest equivalents
- **Precision tier** (optional fields): `origin_place_name`, `origin_full_address`, `origin_latitude`, `origin_longitude`, `origin_eloc` and dest equivalents

Models updated: `LoadCreate`, `LoadUpdate`, `Load` — all new fields Optional → no migration needed.

### Display model — 3-line route card
`SmartRouteInput` (post & find) and `LoadCard`:
- **L1** — Locality/Area (largest, bold)
- **L2** — `City, ST` (medium, with state abbreviation via `stateAbbr()`)
- **L3** — Pincode (smallest, muted)

Per-line adaptive font shrinking on overflow.

### Mappls autosuggest parser — `addressTokens`-first
- `addressTokens` is the canonical source for locality/city/state/pincode.
- `placeAddress` comma-split is a last-resort fallback, with hard guards: state can never equal the pincode (fixed the `Vashi/400703/400703` bug).
- `placeName`, `placeAddress`, `latitude`, `longitude`, `eLoc` captured into `RouteInfo` and forwarded into the load payload on save.

### Legacy data sanitization
`sanitizeStateForDisplay()` / `sanitizeCityForDisplay()` defend against legacy docs where `state == pincode`. Bad fields are dropped at the display layer.

## What's been implemented (2026-01) — final autosuggest behaviour

### Mappls Autosuggest — website parity (final)
The mobile autocomplete must behave exactly like the TruckTraffic website. Two earlier client-side approaches (3-tier soft rank, then a strict CITY/LOCALITY whitelist) were both rolled back — they diverged the mobile candidate set from the web's. The mobile flow now does:

1. `GET /api/places?query=…` — FastAPI proxy to Mappls Autosuggest, unchanged.
2. `const all = [...suggestedLocations, ...userAddedLocations]` — concatenation in Mappls' returned order, identical to the website.
3. Map the first 7 items to `CitySuggestion` via `addressTokens` (canonical), with `placeAddress` comma-split as last-resort fallback (only when `tokens.state` / `tokens.city` are missing).
4. `.filter((s) => s.pincode)` — drop only items that can't be resolved to a 6-digit pincode. This is the **only** filter applied, matching the web app's "keep what we can geocode" rule.
5. Display in Mappls' native order. No re-ranking, no type whitelist, no POI exclusion, no industrial-area heuristics.

Code lives in `RouteSearchModal`'s autosuggest `useEffect` in `/app/frontend/app/index.tsx`.

### Saved Pickups removed (UI + storage)
Removed below-search-bar `Saved Pickups` section. `Recent Searches` does the same job. Storage layer (`SAVED_PICKUPS_KEY`, `bumpSavedPickup`, `getSavedPickups`, `SavedPickup` type, `useCountPill`/`useCountText` styles, all `section === "saved"` branches) deleted as dead code.

### Possible remaining mobile↔web differences (web source not in this repo — flagged for verification)
- **Backend Mappls params** (`/app/backend/server.py` lines 265-274): the proxy sends only `query`, `region=IND`, `access_token`. If the website passes additional autosuggest params — `location` (user lat/lon to bias results), `tokenizeAddress=true`, `pod`, `filter`, `bridge` — result sets will differ even with identical client-side handling. User asked to keep backend untouched, so this is left as-is.
- **Display limit**: mobile slices to **first 7** items (predates these changes). If the website renders more or fewer, this can be adjusted in `RouteSearchModal` — single number to change.
- **Pincode-validity filter**: mobile drops items where neither `addressTokens.pincode` nor a `\b\d{6}\b` regex on `placeAddress` yields a pincode. If the website additionally round-trips through `/api/pincode/{pin}` to rescue items without an inline pincode, a small minority will differ.
- **Recents / dedup**: mobile shows up-to-5 recents on empty input. Independent of Mappls — does not affect parity for typed queries.

### Files touched (latest iteration)
- `/app/frontend/app/index.tsx` — removed `MAPPLS_ALLOWED_TYPES`, `INDUSTRIAL_AREA_HINT_RX`, `normMapplsType`, `isIndustrialEstateName`, `isAllowedMapplsResult`, `mapplsRankTier`, `mapplsTieBreak`, `rankMapplsSuggestions`. Simplified dev log to `{ type, name }`. Consolidated double `.slice(0, 7)`.

### Verified
- Backend round-trips full payload incl. lat/lon/eLoc/place_name/full_address.
- Sanitization handles legacy bad records (`state == pincode`).
- TypeScript compiles cleanly (one pre-existing duplicate-property warning on the `phoneInput` style is unrelated and untouched).

## Next action items
1. Hot-reload Expo and search **Kolkata / Mumbai / Rewari / Vashi / Taloja / Pimpri** on both Origin and Destination. Compare row-by-row with the website's autocomplete:
   - If mobile order matches the website's → parity achieved.
   - If different → the gap is almost certainly in the backend's Mappls params (see "Possible remaining differences"). Share the website's network-tab call to `search.mappls.com/.../autosuggest/json` and we can align the proxy.
2. Confirm Metro logs show `[Mappls] q="…" types=[{type,name}, …]` for each query — useful evidence when comparing with the website's network panel.

## Backlog / future
- Phase 2: Mappls Place Detail API for richer precision when an autosuggest item has `eLoc` but no `addressTokens`.
- Map view using stored `latitude` / `longitude`.
- Route matching, truck-load matching, distance/off-route scoring — all unblocked by the precision tier already in storage.
- Warehouse/factory search using `place_name` / `full_address`.
- One-time migration to flag/clear legacy `state == pincode` records.
