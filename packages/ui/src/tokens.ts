/**
 * Design tokens for FS Suite — Aviation/cockpit aesthetic
 *
 * Palette derived from the Simulando channel brand assets (logo.png).
 * Background: near-black cockpit (#0d0f14), chrome silver accents, aviation blue primary.
 *
 * Ref: docs/technical-spec.md Section 12
 */

export const colors = {
  // Dark cockpit background palette
  background: '#0d0f14',
  foreground: '#e8eaf0',

  surface: '#161a24',
  surfaceMuted: '#1e2333',

  muted: '#2a3048',
  mutedForeground: '#8892a4',

  border: '#2a3048',
  input: '#1e2333',
  ring: '#2a7dc9',

  // Aviation blue — derived from Simulando logo sky/globe
  primary: '#2a7dc9',
  primaryForeground: '#ffffff',

  // HUD accent — electric cyan for data highlights
  accent: '#00d4ff',
  accentForeground: '#0d0f14',

  // Chrome metallic — logo wings/badge framing
  chrome: '#a0aabb',
  chromeForeground: '#0d0f14',

  destructive: '#e05c5c',
  destructiveForeground: '#ffffff',

  success: '#4caf7d',
  successForeground: '#ffffff',
} as const;

export const typography = {
  fontSans: '"Inter", system-ui, sans-serif',
  fontMono: '"JetBrains Mono", monospace',
  scale: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
  },
} as const;

export const spacing = {
  base: '4px',
} as const;

export const radius = {
  card: '0.5rem',
  button: '0.375rem',
  sm: '0.25rem',
  lg: '0.75rem',
  full: '9999px',
} as const;
