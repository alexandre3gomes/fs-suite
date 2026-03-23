/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('nativewind/preset')],
  content: [],
  theme: {
    extend: {
      colors: {
        // Aviation-themed palette — tokens defined in packages/ui/src/tokens.ts
        background: '#0d0f14',
        foreground: '#e8eaf0',
        surface: {
          DEFAULT: '#161a24',
          muted: '#1e2333',
        },
        muted: {
          DEFAULT: '#2a3048',
          foreground: '#8892a4',
        },
        border: '#2a3048',
        input: '#1e2333',
        ring: '#4a90e2',
        primary: {
          DEFAULT: '#4a90e2',
          foreground: '#ffffff',
        },
        accent: {
          DEFAULT: '#00d4ff',
          foreground: '#0d0f14',
        },
        destructive: {
          DEFAULT: '#e05c5c',
          foreground: '#ffffff',
        },
        success: {
          DEFAULT: '#4caf7d',
          foreground: '#ffffff',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        card: '8px',
        button: '6px',
        sm: '4px',
        lg: '12px',
        full: '9999px',
      },
      spacing: {
        // 4px base grid
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '20px',
        6: '24px',
        8: '32px',
        10: '40px',
        12: '48px',
        16: '64px',
        20: '80px',
        24: '96px',
      },
    },
  },
  plugins: [],
};
