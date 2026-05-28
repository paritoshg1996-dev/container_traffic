# Truck Traffic PTL — PRD

## Architecture
- React Native + Expo (Android-first), expo-router, TypeScript
- FastAPI + MongoDB backend (ptl-market.onrender.com)
- Native Firebase Phone Auth (Android) for OTP login
- Centralized design tokens in `frontend/theme/index.ts`
- Inter font family loaded via `@expo-google-fonts/inter`, applied globally in `_layout.tsx`

## Completed iterations

### Iter 1 — Polish patches for last two commits (May 26)
1. **App icon (drawer cutoff)** — icon.png/adaptive-icon.png/favicon.png/splash-image.png regenerated with proper safe-zone padding (62% for adaptive, 78% for legacy). Verified zero pixel-loss against worst-case circular crop.
2. **Route-input 2nd line adaptive font** — replaced unreliable `adjustsFontSizeToFit` with deterministic length-based size tiers (17px → 10px).
3. **Profile post — image editable** — confirmed already shipped in commit 9dcae73 (EditLoadModal fetches existing photos, allows add/remove, PATCHes with `images` array).

### Iter 2 — Typography & visual-polish overhaul (May 26)
- Installed `@expo-google-fonts/inter` (Regular/Medium/SemiBold/Bold)
- Created `frontend/theme/index.ts` — central tokens for FONTS, TYPO, PALETTE, RADIUS, SPACING
- Loaded Inter in `_layout.tsx` via `useFonts`; set Inter as the **default fontFamily** for every `<Text>` and `<TextInput>` (via `defaultProps`) so the whole app inherits it
- Modernized color palette (slate-gray text, soft borders):
  - text #1A1A1A → **#1F2937**, textMuted #6C757D → **#6B7280**, textSubtle #ADB5BD → **#9CA3AF**
  - success #248232 → **#16A34A**, danger #DC3545 → **#DC2626**, border #DEE2E6 → **#E5E7EB**, bg #F8F9FA → **#F9FAFB**
- Mapped every `fontWeight` to an explicit `fontFamily` token (90 entries) — required for Android, which cannot synthesize Inter bold weights
- Softened corners app-wide: 10→12, 12→14, 14→16
- Polished hierarchy: bumped line-heights, added letterSpacing on headings/buttons/labels, reduced excessive bolding in body text, increased form/card padding, added subtle card elevation

### Iter 3 — Responsive UI for all Indian smartphone widths (Jan 26, 2026)
- New `frontend/theme/responsive.ts` exports `rs(n)` (sizes/padding) and `rf(n)` (fonts) that scale every dimension relative to a 360dp baseline, clamped to 0.78×–1.15× so we never grow on tablets nor shrink to unreadability on tiny phones. Reads `Dimensions.get('window').width` once at module load.
- Applied `rs()` to `header`, `tabs`, `formWrap`, `stepperRow`, `stepperBtn`, `truckCard`, `truckImg`, `routeInputsRow`, `profileWrap`, `collapseHeader`, `optionalHeading`, `input` padding, etc. and `rf()` to every fixed `fontSize`/`lineHeight` that appeared in the user-reported overflow screenshot.
- Added `numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6-0.8} allowFontScaling={false}` on critical text that was overflowing: header title "Truck Traffic PTL", tab labels "Post Truck Space" / "Find Truck Space", stepper date "07-Jun-2026", stepper weight value, truck type labels, section titles, field labels, SmartRouteInput pin/locality/cityState, LoadCard route pin-city composite text, poster name & company.
- Added `flexShrink: 1` / `minWidth: 0` to tab buttons, stepper centers, tabText and primary button text so they can compress inside their containers rather than overflowing.
- Reduced fixed padding/minHeight on `SmartRouteInput` card (104→96), `stepperRow` (padding 10→8), and `input` (minHeight 56→52) so cards don't stretch the layout on narrow screens.

## Backlog
- Replace inline COLORS with PALETTE token usage everywhere (currently both coexist)
- Server-side image compression at upload
- App-wide haptic feedback on primary actions
