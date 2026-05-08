/**
 * Design tokens for FS Suite — Light aviation palette
 *
 * Clean, professional light theme with aviation blue accents.
 * Ref: docs/technical-spec.md Section 12
 */

export const colors = {
  background: '#f8f9fb',
  foreground: '#1a1d26',

  surface: '#ffffff',
  surfaceMuted: '#f1f3f7',

  muted: '#e2e5eb',
  mutedForeground: '#6b7280',

  border: '#dfe2e8',
  input: '#f1f3f7',
  ring: '#2563eb',

  primary: '#2563eb',
  primaryForeground: '#ffffff',

  accent: '#0284c7',
  accentForeground: '#ffffff',

  chrome: '#6b7280',
  chromeForeground: '#ffffff',

  destructive: '#dc2626',
  destructiveForeground: '#ffffff',

  success: '#16a34a',
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
