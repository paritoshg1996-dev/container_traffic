# Truck Traffic PTL — PRD

## Original Problem Statement
Add PTL (Partial Truck Load) consolidation to existing Truck Traffic app.
Multiple shippers with small loads on the same route are grouped into a single
40 ft truck (20,000 kg / 20 t), splitting cost proportionally by weight.

## Stack
- Frontend: React Native (Expo) — `/app/frontend/app/index.tsx`
- Backend: FastAPI + MongoDB — `/app/backend/server.py`

## What's been implemented (Jan 2026)

### Iter 1 — MVP
PTL models, matching algorithm, 6 endpoints, frontend tabs + cards + modals.

### Iter 2 — UX refactor
Bottom-nav rename, market-mode rename, post-load tab introduced, profile shows both lists.

### Iter 3 — Post Load form polish (current)
- **Post Load tab** now mirrors **Post Space** exactly:
  1. Origin / Destination (SmartRouteInput)
  2. **Loading Date** — `−/+` stepper with calendar tap-to-pick (same component as Post Space)
  3. **Weight in Tons** — `−/+` stepper + tap-to-enter modal with preset chips (1, 2, 3, 5, 8, 12, 18 T)
  4. **Product Type** — `cargoStyles` grid (Bags / Carton Box / Pipes / Drums / Fresh Produce / Others)
- **Add more details (optional)** — collapsible sections:
  a. Available Space (L × B × H ft, same validation as Post Space: max 40 / 8 / 9)
  b. Truck Preference (Open / Container / Trailer)
  c. Cargo Placement (Stackable / Non Stackable)
  d. Photos (up to 3, 50 MB each)
- **Backend** now accepts `dimension_length / _breadth / _height`, `cargo_placement`, `images` (all optional)
- **`POST /api/ptl/loads`** response includes `matched: bool` so the client can distinguish match-existing vs new-group
- **After submit** — opens `PtlGroupDetailModal` with a top banner:
  - `matched=true`  → green "Matched to an existing group" banner
  - `matched=false` → blue  "No existing group found — new group created" banner
- Drums → HAZMAT prompt preserved; Fresh Produce → PERISHABLE auto-tag preserved
- Race-safe load_id / group_id (4-char random suffix prevents same-second collisions)

## Backlog
- P1: Push notifications at 85% fill
- P1: Cost split UI (₹ share = weight ÷ total × truck cost)
- P2: DISPATCHED state separate from FULL
- P2: Atomic findOneAndUpdate for race-safe matching at scale
- P2: Map preview of pickup points
