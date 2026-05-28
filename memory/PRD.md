# Truck Traffic PTL — Product Requirements

## Original problem statement (this session)
> Is info of the user being stored in the backend, If not ensure that the user profile info gets stored.

## App overview
Truck Traffic PTL is a React Native / Expo Android app + FastAPI backend + MongoDB. Truckers and load posters can:
- Verify phone via Firebase Phone OTP
- Set up a profile (name, phone, company)
- Post truck loads (origin/destination pincodes, cargo, weight, photos, price)
- Browse the marketplace and contact posters

The frontend is hard-coded to call the production backend at `https://ptl-market.onrender.com/api`; the preview pod hosts an equivalent backend at `http://localhost:8001/api` for development/testing.

## Architecture
- **Backend**: FastAPI (`/app/backend/server.py`), Motor (async Mongo driver), Firebase Admin for OTP token verification.
- **Frontend**: Expo Router app (`/app/frontend/app/index.tsx`), React Native 0.81, Firebase Auth (native), AsyncStorage for local state.
- **DB collections**: `loads`, `pincode_geo`, `short_urls`, **`users`** (new this session).

## User personas
- **Load poster** — wants to advertise an outgoing load. Needs name + company shown to truckers.
- **Truck owner / driver** — browses loads and calls the poster.

## Core (static) requirements
- Phone-OTP login (Firebase, native Android).
- Profile (name, 10-digit phone, optional company) — phone is verified and locked.
- Loads must be searchable by origin/destination pincode and auto-purged after the loading date.

## What's implemented
- **2026-05-28** Added backend user persistence:
  - `POST /api/users` — upsert profile keyed by normalised 10-digit phone. Validates phone (10 digits) and name (≥2 chars).
  - `GET /api/users/{phone}` — fetch profile (404 if absent, 400 if phone invalid).
  - `/api/auth/verify-token` now also upserts a `users` row on first phone verification (records uid + last_verified_at without overwriting an existing name/company).
  - Frontend `saveProfile` POSTs to `/api/users` on every save/edit; `saveVerification` fetches `/api/users/{phone}` after OTP so a reinstalled user gets their name & company restored.
  - Restored corrupted `/app/backend/.env` (MONGO_URL, DB_NAME) and `/app/frontend/.env`.
  - 16/16 backend tests pass (creation, upsert, validation, phone normalisation, persistence, regression on existing endpoints).
- Pre-existing (not changed): Loads CRUD, pincode/city lookup, geocode cache, Mappls places proxy, URL shortener, Firebase ID-token verification.

## Backlog / future work
- **P1** Gate `POST /api/users` behind a verified Firebase id_token so only the phone owner can edit its profile.
- **P1** Add a unique index on `users.phone` to prevent race-condition duplicates.
- **P2** Have `GET /api/users/{phone}` return 404 when `name` is empty (verify-token side-effect creates an empty profile shell). Frontend already guards.
- **P2** Return 201 vs 200 on create vs update from `POST /api/users`.
- **P2** Split `server.py` (~600 lines) into routers (users, loads, geo, shorten, auth).
- **P3** Profile picture upload, per-user load history (`GET /api/users/{phone}/loads`).

## Next tasks
- Add Firebase id_token auth gate + unique index on `users.phone` (P1).
