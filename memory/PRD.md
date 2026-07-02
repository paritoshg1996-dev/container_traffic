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

## 2026-01 — Partial Load posting: WhatsApp share flow (no group modal)
- Removed the post-submit group formation modal (`PtlGroupDetailModal`) from
  `PostPtlLoadScreen` (3rd bottom-nav tab / Post → Adjustment).
- On successful POST `/ptl/loads`, the app now opens WhatsApp with a
  pre-filled "Partial Load Available - Truck Traffic" message (route, weight,
  cargo, loading date, poster contact) — mirroring the Truck Space "Post &
  Share" flow.
- Renamed primary CTA from **Post & find a group** → **Post & Share on
  WhatsApp** (green WhatsApp style + logo icon). TestID `ptl-post-submit-btn`
  preserved.
- Kept the individual-load 20-ton cap on the form (weight stepper + modal
  validation). Only the *group-combined* 20-ton concept is no longer shown to
  the poster on submit.
- Marketplace / Find Partial Loads and existing PTL group internals were
  intentionally left untouched.

## 2026-01 — Partial Load posting: solo listings + deep-link share
Second iteration on top of the earlier "no group modal" change.

**Backlog 1 done — backend no longer auto-groups posted PTL loads.**
- `POST /api/ptl/loads` now calls new helper `_create_solo_ptl_group()` in
  place of `match_ptl_load()`. Each posted partial load creates its own
  standalone group (1 load = 1 group), so no more auto-pairing with existing
  FORMING groups. Response still returns `{load_id, group_id, matched:false}`
  so the frontend and existing marketplace/deep-link endpoints keep working
  unchanged.
- `match_ptl_load()` retained in code (dead-code for now) but no longer
  called from the post endpoint. Kept for a future opt-in matching feature.

**Backlog 2 done — shareable deep link in WhatsApp messages.**
- Post Partial Load screen → WhatsApp text now includes
  `🔗 More info: https://www.trucktraffic.in/a/{group_id}` (falls back to
  `https://www.trucktraffic.in` only if the backend didn't return a
  group_id).
- Marketplace `PtlGroupCard.shareOnWhatsApp` and `ListingDetailModal.
  shareDetailOnWhatsApp` also switched from the bare website URL to
  `/a/{group.id}` so any share of an existing partial load opens straight
  to its detail panel on trucktraffic.in (mirrors the truck-space
  `/l/{short_id}` behaviour).

**Verified**
- Two identical-route PTL loads posted back-to-back → each got its own
  `group_id`, both with `matched:false`.
- Group retrievable via `GET /api/ptl/groups/{group_id}` (same endpoint the
  website's `/a/{group_id}` deep link handler uses).

## 2026-01 — PTL group-formation dead-code cleanup
Removed ~485 lines of unreachable code from the retired auto-pairing flow.

**Backend (`/app/backend/server.py`)**
- Deleted `match_ptl_load()` (127 LoC), `confirm_group_membership` endpoint
  (`POST /ptl/groups/{group_id}/confirm`, 21 LoC), and the pair-only
  constants `PROXIMITY_KM` / `PTL_MAX_MEMBERS`.
- `cancel_ptl_load` now always sets remaining groups to `FORMING` (no more
  PAIRED branch); `get_ptl_group` no longer gates phone visibility on
  `PAIRED`/`CONFIRMED` — the poster's phone is exposed to any viewer opening
  the detail.

**Frontend (`/app/frontend/app/index.tsx`)**
- Deleted the entire `PtlGroupDetailModal` component (252 LoC) — no longer
  rendered anywhere.
- Removed `handleAccept`, `handleDecline`, the `PTL_PAIR_REQUEST /
  ACCEPTED / DECLINED` notification cards, and the local `notifications /
  notifLoading` state that only fed them.
- Dropped `PTL_PAIR_*` variants and pair-request-only fields
  (`requester_*`, `pending_load_id`) from the `AppNotification` type.
- Removed the unreachable `<PostPtlModal visible={showPostPtl}/>` in the
  marketplace and its dead `showPostPtl` state (that modal is now only
  rendered for the *edit* flow from `MyPtlLoadsList`).
- Simplified `PostPtlModal`'s "Find me a group" branch → since it's only
  ever invoked with `editLoad`, the button now unconditionally reads
  "Save changes" and the success message is a neutral "Your partial load
  is now listed."

**Verified**
- Backend restarts clean, `POST /ptl/loads` still returns `{load_id,
  group_id, matched:false}` and creates a solo group.
- Removed `POST /ptl/groups/{group_id}/confirm` now returns HTTP 404.
- TypeScript check passes on the modified regions.
