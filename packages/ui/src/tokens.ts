/**
 * Design tokens for FS Suite — Modernist, cool blue
 *
 * Hex mirror of the HSL variables in apps/app/global.css. Keep the two in
 * step: global.css is the runtime source of truth for NativeWind classes,
 * this file is for inline style props and non-Tailwind consumers.
 * Ref: docs/technical-spec.md Section 12
 */

export const colors = {
  background: '#f0f2f6',
  foreground: '#16203a',

  surface: '#f7f8fb',
  surfaceMuted: '#e6e9f0',

  muted: '#e6e9f0',
  mutedForeground: '#5d6579',

  border: '#dde1ea',
  input: '#e6e9f0',
  ring: '#1a4fd8',

  primary: '#1a4fd8',
  primaryForeground: '#ffffff',

  accent: '#123593',
  accentForeground: '#ffffff',

  chrome: '#5d6579',
  chromeForeground: '#ffffff',

  destructive: '#dc2626',
  destructiveForeground: '#ffffff',

  success: '#16a34a',
  successForeground: '#ffffff',

  /** 2px structural dividers — the layout is carried by these, not shadows. */
  rule: '#16203a',
  ruleSoft: '#b9c0cf',
} as const;

/** Tonal ramp for the primary — 100-300 for tints, 700-900 for text on tints. */
export const primaryRamp = {
  100: '#e8edfb',
  200: '#c6d4f5',
  300: '#93aeec',
  400: '#4f7ae2',
  500: '#1a4fd8',
  600: '#1642b5',
  700: '#123593',
  800: '#0e2870',
  900: '#0a1c4f',
} as const;

export const typography = {
  fontSans: '"Archivo", system-ui, sans-serif',
  fontHeading: '"Archivo", system-ui, sans-serif',
  fontMono: '"JetBrains Mono", monospace',
  /** Three steps, deliberately. Label / body / display. */
  scale: {
    label: '0.6875rem',  // 11px uppercase, tracked
    xs: '0.75rem',
    sm: '0.8125rem',
    base: '0.9375rem',
    lg: '1.0625rem',
    xl: '1.25rem',
    '2xl': '1.625rem',
    '3xl': '2.125rem',
    '4xl': '3rem',
  },
  tracking: {
    label: '0.12em',
    kicker: '0.16em',
    brand: '0.18em',
    display: '-0.02em',
  },
} as const;

export const spacing = {
  base: '4px',
} as const;

/** Modernist: nothing is rounded. `full` is kept for avatars only. */
export const radius = {
  card: '0px',
  button: '0px',
  sm: '0px',
  lg: '0px',
  full: '9999px',
} as const;

/** 2px for structure, 1px for row separation. */
export const rules = {
  structure: 2,
  row: 1,
} as const;
