# Truck Traffic PTL — Truck Space Marketplace

## Overview
Mobile app (Expo React Native) for Indian truck operators to monetize excess truck space by posting available truck space and finding truck space from others. Branded as **Truck Traffic PTL**.

## Tech Stack
- Frontend: Expo (React Native), expo-router, AsyncStorage, @react-native-community/datetimepicker, @expo/vector-icons.
- Backend: FastAPI + MongoDB (motor), deployed on Render at https://ptl-market.onrender.com.
- External APIs: api.postalpincode.in (free), Mappls Autosuggest, OpenStreetMap Nominatim geocode.

## Screens
- **Phone OTP Verification** (Firebase Phone Auth) — first launch only.
- **Profile Setup** — Name + auto-filled verified phone + optional company.
- **Post Truck Space** (renamed from "Post Space"):
  - Field order: Route → Loading Date → Truck Type → Available Load Capacity (weight) → Available Space (dimensions) → Pricing → Cargo Placement → Photos.
  - Mandatory: Route, Loading Date, Truck Type, Weight. Optional: Dimensions, Price, Cargo Placement, Photos.
  - Loading Date opens calendar limited to a 2-week window from today.
  - Dimensions: 3 whole-number side-by-side inputs (L max 40, B max 8, H max 9 ft).
  - Price/ton: numeric whole, ₹ prefix, "/ ton" suffix.
  - Filled fields get a green border (cargo placement keeps its own green/red).
  - Cargo placement: tap selected option again to deselect.
- **Find Truck Space** (renamed from "Load Market"):
  - Header button renamed to **Filter** (was "Find Space").
  - Filter popup is full-screen with back arrow (eliminates keyboard overlap).
  - Cargo weight input is in **tons**, not kg.
  - Load cards now show: truck miniature image + weight + dimensions + price + date + placement on **one horizontally-scrollable line**.
  - Images don't auto-load; tap **Show Images** to lazy-load thumbnails.
- **Tab navigation**: Post Truck Space ⇄ Find Truck Space — state is preserved across switches; swipe left/right gestures also switch tabs.
- **Profile**: "Total ft³" stat removed; phone/avatar/edit retained.

## Route Input Display (Post + Find)
Each route box now shows three lines: **Pincode** / **Area or locality** / **City, State**.

## Branding
- App name: **Truck Traffic PTL** (was "LoadLink"). Reflected in header, profile welcome, WhatsApp share text, app.json `name`/`slug`.
- Logo: New custom logo (orange/yellow truck with ₹ coin on black background) used in header, profile screen, app icon, and Android adaptive icon.

## API Endpoints
- `GET /api/` — health check
- `GET /api/pincode/{pincode}` — `{pincode, city, state, valid}`
- `GET /api/city/{name}` — city search via India Post
- `GET /api/places?query=...` — Mappls Autosuggest proxy
- `GET /api/geocode/{pincode}` — lat/lon (Nominatim, cached)
- `POST /api/loads` — create load (now accepts `dimension_length`, `dimension_breadth`, `dimension_height`, `price_per_ton` as optional fields)
- `GET /api/loads?origin=&destination=` — list loads (newest first)
- `PATCH /api/loads/{id}` — edit own load
- `DELETE /api/loads/{id}` — delete own load
- `GET /api/loads/{id}/image/{idx}` — load image (cached 24h)
- `POST /api/auth/verify-token` — verify Firebase ID token

## Data Model (`loads` collection)
```
id, origin_pincode, origin_locality, origin_city, origin_state,
destination_pincode, destination_locality, destination_city, destination_state,
cargo_types[], cargo_placement, truck_type,
weight_tons, space_cuft,
dimension_length, dimension_breadth, dimension_height, price_per_ton,
loading_date, poster_name, poster_phone, poster_company, created_at, images[]
```

## Recent Changes (May 2026)
- Renamed app to "Truck Traffic PTL" with new logo across header / profile / OTP screens.
- App icon, adaptive icon, splash, favicon and app-image all updated to new logo. App.json `name` set to `Truck Traffic PTL` (device drawer will show this after APK rebuild).
- Removed logo image from in-app header (now header shows only "Truck Traffic PTL" text + greeting).
- Tab labels renamed (Post Truck Space / Find Truck Space) with state preserved + swipe gesture.
- Added Pricing/ton (₹), Dimensions (L/B/H ft) inputs.
- Loading Date now opens a calendar picker constrained to today → today+14 days. Added matching -/+ stepper buttons (same size as Available Load Capacity).
- Field re-ordering: Route → Loading Date → Available Load Capacity → Truck Type → optional sections (Available Space / Pricing / Cargo Placement / Photos).
- All four optional inputs are now **collapsible accordion sections** (dashed border when empty, solid green when filled, with inline summary). The clutter-free "Add more details (optional)" heading sits above them — no `(optional)` repeated on each title.
- Dimensions inputs: `ft` suffix lives inside each input box; the `(max 40/8/9)` text was removed (constraints still applied).
- Filled inputs get green borders.
- Cargo placement supports deselect (tap selected option to clear).
- Removed "Total ft³" from profile stats.
- Find Truck Space: Filter modal made full-screen, cargo weight switched to tons, button renamed to "Filter".
- LoadCard: truck miniature image instead of text chip; dimensions + price displayed; single-line horizontal-scroll meta row.
- LoadCard: photos lazy-loaded via "Show Images" button to avoid slow list rendering.
- Backend: added optional fields `dimension_length`, `dimension_breadth`, `dimension_height`, `price_per_ton` to `LoadCreate`. **NOTE: backend on Render needs redeploy for new fields to persist; pydantic silently drops unknown extras on old backend.**

## Backlog / Next Action Items
- Deploy backend (server.py changes) to Render so dimension/price fields persist.
- Optionally extend EditLoadModal to also support dimensions + price + cargo deselect.
- Consider showing price total (= weight × price/ton) directly in LoadCard as a quick highlight.
