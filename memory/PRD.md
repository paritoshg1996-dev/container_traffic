# Truck Traffic PTL — PRD

## Original Problem Statement
Add PTL (Partial Truck Load) consolidation to existing Truck Traffic app.
Two shippers with small loads on the same route are matched into a single
truck and split the cost. **Pair-only**: exactly 2 shippers per group, no more.

## Stack
- Frontend: React Native (Expo) — `/app/frontend/app/index.tsx`
- Backend: FastAPI + MongoDB — `/app/backend/server.py`

## What's been implemented (Jan 2026)

### Iter 1 — MVP
Backend models, N-member matching, 6 endpoints. Frontend tabs + cards + modals.

### Iter 2 — UX refactor
Bottom-nav rename; "Post Load" becomes a dedicated tab; profile shows both lists.

### Iter 3 — Post Load form polish
Mirrors Post Space 1:1 (stepper UI, optional collapsibles, photos, dim validation).

### Iter 4 — Pair-only architecture (current)
**Backend**
- `PTL_MAX_MEMBERS = 2` constant; matching enforces it via `$expr` `$size < 2`
- Group statuses now: **FORMING** (1 member) → **PAIRED** (2 members, awaiting confirms) → **CONFIRMED** (both confirmed). No DISPATCHED.
- Weight cap on combined pair **removed** (per product decision 2b) — two shippers can pair regardless of summed weight; only single-load > 20 t is rejected
- Tie-breaker: best match = closest origin+destination distance to the existing load (was: highest fill %)
- `GET /api/ptl/groups` now returns **only FORMING** groups (the marketplace is for finding a partner; paired groups are private to their two members)
- `GET /api/ptl/groups/{id}` exposes partner's phone the moment the group reaches PAIRED (no mutual-confirm gate) — `viewer_phone` must still belong to the group
- Cancel: 1 of 2 cancels → group reverts to FORMING with the remaining 1 load; 2 of 2 cancel → group is deleted
- 30/30 backend tests pass, including new `TestPairOnlyCap` and `TestPairedPhoneVisibility`

**Frontend**
- **PtlGroupDetailModal redesigned** — removed fill bar, compatibility list, members list, WhatsApp coordinator. Now shows only:
  - Header: corridor + status pill (Waiting for partner / Paired / Confirmed)
  - "Your load" card (blue tint)
  - "Co-loader" card with **big green Call button** (tel: link) OR "Waiting for a co-loader…" empty state
  - Confirm my spot button (when paired) + Cancel my load
- **PtlGroupCard** (marketplace) — simplified to show the solo poster's name/company + cargo + weight + "1 SPOT LEFT" pill + "Join as co-loader" CTA
- **MyPtlLoadsList** — status pills updated: "Searching for partner…" / "Paired · View & call" / "Confirmed ✓"; fill bar replaced with "Paired with {name}" line

## Backlog
- P1: Push notification on pair formation (currently user has to refresh)
- P1: Cost split UI — ₹ share per member
- P2: WhatsApp share group link to invite a known shipper into a FORMING group
- P2: Atomic findOneAndUpdate on group capacity for race-safe matching at scale
