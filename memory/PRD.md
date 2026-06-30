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

### Iter 4 — Pair-only architecture
Backend: PTL_MAX_MEMBERS=2 cap, FORMING→PAIRED→CONFIRMED, group reverts on cancel, marketplace surfaces only FORMING groups.
Frontend: redesigned PtlGroupDetailModal (your-load / co-loader cards, big green call button), simplified marketplace card, MyPtlLoadsList status pills.

### Iter 5 — Bid feature (current)
**Original brief:** Non-poster users can place a structured Bid on any Truck
Space or Partial Load detail screen. Posters see all incoming bids per post
under a new "Bids Received" button on their My Posts cards.

**Backend (`/app/backend/server.py`)**
- New collection `bids` with unique compound index `(listing_id, bidder_phone)`.
- `BidCreate` model: listing_id, listing_type ('load' | 'ptl'), bidder_phone,
  origin (locality/city/pincode/lat/lon), destination (same), weight_tons,
  cargo_type.
- `POST /api/bids` — creates or updates the caller's bid (one bid per listing
  per phone). Self-bid blocked (400). 404 if listing missing. Server-side
  haversine deviation between bid endpoint and post endpoint stored on the
  bid (`origin_deviation_km`, `destination_deviation_km`).
- `GET /api/bids/check?viewer_phone=&listing_id=` — has-the-viewer-bid?
- `GET /api/bids/listing/{listing_id}?viewer_phone=` — list of all bids on
  a listing. Only the poster (viewer == owner) can call; otherwise 403.
- `GET /api/bids/counts/{phone}` — `{listing_id: count}` aggregate for posts
  owned by phone (drives the badge on My Posts).
- `DELETE /api/bids/{listing_id}?phone=` — withdraw a bid.
- Indexes: `(listing_id, bidder_phone)` unique, `(poster_phone)`, `(listing_id, created_at)`.

**Frontend (`/app/frontend/app/index.tsx`)**
- `BidFormModal` — bottom-sheet form (origin pincode+city, destination
  pincode+city, weight tons, cargo type pills: Bags, Carton Box, Pipes,
  Drums, Fresh Produce, Others). Auto-fills city/locality via `/api/pincode/{pin}`.
  Geocodes both endpoints via `/api/geocode/{pin}` before submit so backend
  can compute deviation.
- `BidsReceivedModal` — full-screen list. Each card: bidder avatar+name+company,
  Call button (tel: link), origin+destination route, weight + cargo chips,
  amber deviation banner showing `origin X km · dest Y km`.
- `ListingDetailModal` (Truck Space & Partial Load detail) — bottom CTA bar
  now shows a primary **Bid** button (testID `open-bid-form`) for non-poster
  viewers; flips to "Bid Placed · Edit" once the viewer has bid. Call shortcut
  remains alongside. The poster never sees the Bid CTA.
- `MyTruckSpacePostsList` + `MyPtlLoadsList` — each post card gains a
  **Bids Received** orange button (testID `bids-received-{id}`) with a count
  pill (powered by `/api/bids/counts`). Tap opens `BidsReceivedModal`.

**Tests**
- `/app/backend/tests/test_bids_api.py` — 17 tests, all passing (covers
  create, update, validation, self-bid block, missing-listing 404, deviation
  math, check, owner-only listing, non-owner 403, counts aggregation, withdraw).

## Backlog
- P1: Notify poster when a new bid arrives (push / in-app notification).
- P1: Bidder withdraws bid via UI (endpoint exists; no frontend control yet).
- P2: Poster shortlist / accept-reject flow on a bid card.
- P2: Sort / filter bids (by smallest deviation, lowest weight, newest).
- P3: Move bids router into its own module — server.py is ~2k lines.
- P3: Push notification on PTL pair formation (currently requires refresh).
