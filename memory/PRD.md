# Truck Traffic PTL — PRD

## Original Problem Statement
Add PTL (Partial Truck Load) consolidation feature to existing Truck Traffic app.
Multiple shippers with small loads on the same route are grouped into a single
40 ft truck (20,000 kg), splitting cost proportionally by weight.

## Stack
- Frontend: React Native (Expo) — `/app/frontend/app/index.tsx`
- Backend: FastAPI + MongoDB — `/app/backend/server.py`

## Personas
- **Shipper** — has a small load (3-8 t) on a regional route, wants to share a truck
- **Transporter** — lists truck space (existing flow, unchanged)

## What's been implemented (Jan 2026)
### Backend (`server.py`)
- `PtlLoadPost`, `PtlGroupResponse` Pydantic models
- Matching algorithm: corridor + cargo compat + 20 t capacity + 25 km proximity
- Endpoints:
  - POST `/api/ptl/loads` — post a partial load, auto-matches to FORMING group
  - GET `/api/ptl/loads/my/{phone}` — list a shipper's own loads
  - DELETE `/api/ptl/loads/{load_id}?phone=` — cancel (auto-recomputes group)
  - GET `/api/ptl/groups` — list FORMING / FULL groups (optional `origin_city`, `dest_city`)
  - GET `/api/ptl/groups/{id}?viewer_phone=` — single group detail (phone exposed only to confirmed mutual members)
  - POST `/api/ptl/groups/{id}/confirm?phone=` — confirm membership; group → FULL when all confirm
- Indexes on poster_phone, group_id, status+posted_at, corridor+status, fill_pct
- TTL index on `expires_at` (7-day auto-expiry)

### Frontend (`index.tsx`)
- Bottom navigation with 3 tabs: Post Space · Find Truck · My PTL
- LoadMarketScreen has a Full Truck / Partial Load segmented toggle
- `PtlGroupCard`, `PostPtlModal` (reuses `SmartRouteInput`), `PtlGroupDetailModal`, `MyPtlScreen`
- Fill-bar color logic: green <60%, amber 60-85%, orange >85%
- Drum-cargo HAZMAT confirmation prompt

## Backlog
- P1: Push notifications when a group reaches 85% (FULL)
- P1: Cost split UI (per-member ₹ share = weight_kg / total_kg × truck_cost)
- P2: Map preview of pickup points
- P2: Dispatcher assignment + handover flow
