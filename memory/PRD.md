# Truck Traffic PTL — PRD

## Original problem statement (current iteration)
Verify two commits (05142fa & 9dcae73) cover:
1. App-drawer icon getting cut on phones that apply a circular mask
2. Route input 2nd line font getting cut for long localities
3. Profile post edit must allow editing images

## Architecture
- React Native + Expo (Android-first), expo-router, TypeScript
- FastAPI + MongoDB backend, hosted at ptl-market.onrender.com
- Native Firebase Phone Auth (Android) for OTP login

## Status of the 3 requested changes
1. **App icon (drawer cutoff)** — DONE
   - Regenerated `frontend/assets/images/{icon,adaptive-icon,favicon,splash-image}.png`
   - `adaptive-icon.png`: 1024×1024, transparent bg, content fits inside 62% center (Android adaptive-icon safe-zone spec)
   - `icon.png` / `splash-image.png`: 1024×1024, solid black bg, content within 78% center
   - Verified via simulated circular crop — 0 pixels of visible content lost
2. **Route input 2nd line — adaptive font** — DONE
   - `frontend/app/index.tsx` `SmartRouteInput`: replaced unreliable `adjustsFontSizeToFit` with a deterministic length-based size tier (17px → 10px). Short localities match line 1’s 17px; long ones step down to fit on one line.
3. **Profile post edit — edit images** — Already shipped in commit 9dcae73 (verified)
   - `EditLoadModal` fetches existing images via `GET /api/loads/{id}/full`, allows add (≤3) / remove, and submits `images` in `PATCH /api/loads/{id}`. Backend `LoadUpdate.images` and PATCH handler are in place.

## Backlog / future
- Add server-side image compression/resize at upload
- Persist user-preferred locality language for the 2nd line
- Auto-screenshot diff for app-icon regression
