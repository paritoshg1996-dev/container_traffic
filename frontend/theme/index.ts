/**
 * Centralized design tokens for Truck Traffic PTL.
 *
 * One source of truth for:
 *   - typography (Inter family + scale)
 *   - color palette (modern slate-gray text + brand)
 *   - spacing
 *   - corner radius
 *
 * Used by the global Text/TextInput defaults in `app/_layout.tsx` and
 * referenced from styles throughout `app/index.tsx`.
 */

export const FONTS = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

// Typographic scale — keeps sizes consistent across the whole app.
// lineHeight is roughly fontSize * 1.4 for body, tighter for headings.
export const TYPO = {
  // Headings
  display: { fontFamily: FONTS.bold, fontSize: 32, lineHeight: 40, letterSpacing: -0.4 },
  h1:      { fontFamily: FONTS.bold, fontSize: 24, lineHeight: 32, letterSpacing: -0.2 },
  h2:      { fontFamily: FONTS.semibold, fontSize: 20, lineHeight: 28, letterSpacing: -0.1 },
  h3:      { fontFamily: FONTS.semibold, fontSize: 18, lineHeight: 26 },

  // Body & UI
  body:       { fontFamily: FONTS.regular, fontSize: 16, lineHeight: 22, letterSpacing: 0.1 },
  bodyMedium: { fontFamily: FONTS.medium, fontSize: 16, lineHeight: 22, letterSpacing: 0.1 },
  small:      { fontFamily: FONTS.regular, fontSize: 14, lineHeight: 20, letterSpacing: 0.1 },
  smallMedium:{ fontFamily: FONTS.medium, fontSize: 14, lineHeight: 20, letterSpacing: 0.1 },
  caption:    { fontFamily: FONTS.regular, fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
  captionMedium: { fontFamily: FONTS.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
  label:      { fontFamily: FONTS.medium, fontSize: 13, lineHeight: 18, letterSpacing: 0.3 },

  // Buttons
  button:     { fontFamily: FONTS.semibold, fontSize: 16, lineHeight: 22, letterSpacing: 0.2 },
  buttonSmall:{ fontFamily: FONTS.semibold, fontSize: 14, lineHeight: 20, letterSpacing: 0.2 },
} as const;

// Brand + neutrals (Tailwind-style slate/gray for text — far less harsh than #000)
export const PALETTE = {
  // Brand
  primary:   "#0A2463",
  secondary: "#FF6B35",
  success:   "#16A34A",
  danger:    "#DC2626",
  warning:   "#F59E0B",

  // Surfaces
  bg:       "#F9FAFB",
  surface:  "#FFFFFF",
  surfaceAlt: "#F3F4F6",

  // Text — modern slate-gray (not pure black)
  textPrimary:   "#1F2937",
  textSecondary: "#6B7280",
  textLight:     "#9CA3AF",

  // Borders / hairlines
  border:     "#E5E7EB",
  borderStrong: "#D1D5DB",
} as const;

export const RADIUS = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 20,
  pill: 100,
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;
