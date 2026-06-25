# Truck Traffic PTL — PRD

## Original Problem Statement
Add PTL (Partial Truck Load) consolidation to existing Truck Traffic app.
Multiple shippers with small loads on the same route are grouped into a single
40 ft truck (20,000 kg), splitting cost proportionally by weight.

## Stack
- Frontend: React Native (Expo) — `/app/frontend/app/index.tsx`
- Backend: FastAPI + MongoDB — `/app/backend/server.py`

## Personas
- **Shipper** — has a small load (3-8 t) on a regional route, wants to share a truck
- **Transporter** — lists truck space (existing flow, unchanged)

## What's been implemented (Jan 2026)

### Iteration 1 — MVP
- Backend models, matching algorithm, 6 endpoints, indexes + TTL
- Frontend: bottom nav (3 tabs), market mode toggle, PTL group cards, post modal, group detail modal, my-PTL screen

### Iteration 2 — UX refactor (current)
- **Bottom nav**: Post Space · **Marketplace** (renamed from "Find Truck") · **Post Load** (renamed from "My PTL", now a posting form)
- **Marketplace toggle**: **Find Truck** / **Find Partial Load** (renamed from Full / Partial)
- **Removed** "Post your partial load" CTA from marketplace
- **Post Load tab** is now a full posting form (mirrors `PostLoadScreen` layout): SmartRouteInput origin/dest, cargo-type grid (Bags / Carton Box / Pipes / Drums / Fresh Produce / Others), truck-type cards (Open / Container / Trailer), loading date picker, weight (kg). Drums → HAZMAT confirmation; Fresh Produce auto-tags PERISHABLE
- **Profile page** now shows both "My Posted Truck Spaces" (existing) AND "My Posted Partial Loads" with status pills + cancel actions
- Backend `PtlLoadPost` accepts new optional fields: `truck_type`, `loading_date` (alongside legacy `ready_date`)

## Backlog
- P1: Push notifications when group hits 85% (FULL)
- P1: Cost split UI — ₹ share per member = weight_kg ÷ total_kg × truck_cost
- P2: DISPATCHED status separate from FULL
- P2: Atomic findOneAndUpdate on group capacity (race-safe matching at scale)
- P2: Map preview of pickup points
