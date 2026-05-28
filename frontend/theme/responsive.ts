/**
 * Responsive scaling helpers for Truck Traffic PTL.
 *
 * Problem: On Android, the user's "Display size" setting (and the wide
 * variety of phone widths sold in India — 320dp budget phones up to
 * 420dp+ tablets) can make fixed font sizes / padding overflow their
 * containers. We don't want to ship a separate layout for each width,
 * so we just scale every "size" relative to a 360dp baseline and clamp
 * to a sensible range (we never grow more than 1.15× and never shrink
 * below 0.78× — that's enough to keep "Truck Traffic PTL", "Post Truck
 * Space", "07-Jun-2026" etc fitting on a 320dp phone with large display
 * size, while still looking comfortable on a 420dp phablet).
 *
 *   import { rs, rf } from "../theme/responsive";
 *   fontSize: rf(18)   // 18 on a 360dp phone, ~15 on a 300dp phone
 *   padding:  rs(16)   // 16 on a 360dp phone, ~13 on a 300dp phone
 *
 * We snap-read the window width once at module load — this matches how
 * React Native StyleSheet.create works (styles are evaluated once). For
 * phones that's fine; the device width doesn't change at runtime.
 */
import { Dimensions, PixelRatio } from "react-native";

const BASELINE_WIDTH = 360;
const MIN_SCALE = 0.78;
const MAX_SCALE = 1.15;

const { width: screenWidth } = Dimensions.get("window");

const rawScale = screenWidth / BASELINE_WIDTH;
export const SCALE = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rawScale));

/** Responsive size (paddings, margins, dimensions). Rounds to nearest pixel. */
export function rs(size: number): number {
  return PixelRatio.roundToNearestPixel(size * SCALE);
}

/** Responsive font size — a bit gentler than rs() so very small text
 *  doesn't disappear on tiny phones. */
export function rf(size: number): number {
  // For fonts we use a softer curve so we don't make tiny labels even tinier.
  const fontScale = 0.5 + SCALE * 0.5; // 0.89 at 300dp, 1.0 at 360dp, 1.075 at 430dp
  const clamped = Math.max(0.85, Math.min(1.1, fontScale));
  return PixelRatio.roundToNearestPixel(size * clamped);
}

/** Convenience: true if the device width is "narrow" (≤ 340dp). */
export const IS_NARROW = screenWidth <= 340;
