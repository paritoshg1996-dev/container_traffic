# Truck Traffic — PRD / Working Notes

## App
Expo React Native (TypeScript) logistics marketplace (Truck Space + Partial Loads/PTL).
Main UI: `frontend/app/index.tsx`. Backend: FastAPI `backend/server.py` + MongoDB.
NOTE: The mobile app calls a REMOTE backend hardcoded at `https://ptl-market.onrender.com/api`
(see `API` const in index.tsx). The local backend here is for validation only.

## Change Log
### 2026-08-24 — Ports/ICD autocomplete + exact-match routing
Original request: replace locality autocomplete with world ports + India ICDs;
show Name/Country/UNLOCODE; match ports exactly (remove lat/long proximity filtering).

Implemented:
- `frontend/data/ports.ts` — 5542 sea ports + India ICDs, generated from the UN/LOCODE
  xlsx via `frontend/scripts/generate_ports.py`. Exposes `PORTS` and `searchPorts(query, limit)`
  (searches port NAME only, diacritic/case-insensitive, prefix-ranked).
- `RouteSearchModal` rewritten to search the local dataset (no Mappls API, no pincode mode).
  Suggestion rows + input cards show Name / Country / UNLOCODE.
  Field mapping through existing plumbing: `*_locality`=Name, `*_city`=Country, `*_pincode`=UNLOCODE.
- Filtering: removed haversineKm/geocodePin/geocodeEloc/geocodeCityName/trackDistancesKm/bearingRad.
  `applyFilter` now does EXACT origin+destination UNLOCODE match (weight/volume still apply).
  Removed distance chips + "approximate/straight-line" footer + "within 30 km" copy.
- Removed now-dead lat/long payload fields (truck post/edit, PTL post, bid body).
- Backend: `create_load`/`update_load`/`post_ptl_load` no longer geocode lat/long.
  `derive_corridor` + `_create_solo_ptl_group` now key PTL corridor by UNLOCODE, so
  `/ptl/groups?origin_city=<UNLOCODE>&dest_city=<UNLOCODE>` matches exactly.

Validated: ports.ts search; full Metro bundle compiles; TS clean in changed regions;
backend exact-match `/loads?origin&destination`, PTL corridor match, and no-geocode confirmed via curl.

## Backlog / Next
- Native UI E2E (emulator) not runnable in this env.
- Optional: prune unused StyleSheet entries (distanceRow/Chip/Text, approxNote) and dead
  `_resolve_missing_coords` / FindPtlModal.
