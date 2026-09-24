/** @type {import('tailwindcss').Config} */

// Aquora brand tokens (turquoise primary, electric-blue accent, deep-navy
// surfaces). Keep in sync with the root tailwind.config.js.
const brand = {
  50: '#effefb',
  100: '#c9fef4',
  200: '#94fbea',
  300: '#57f0dc',
  400: '#2ee6d6',
  500: '#0dc9bc',
  600: '#06a29a',
  700: '#0a817c',
  800: '#0e6663',
  900: '#115552',
  950: '#033332',
  DEFAULT: '#2ee6d6',
  hover: '#57f0dc',
};

const pop = {
  50: '#eff6ff',
  100: '#dbeafe',
  200: '#bfdbfe',
  300: '#93c5fd',
  400: '#60a5fa',
  500: '#3b82f6',
  600: '#2563eb',
  700: '#1d4ed8',
  800: '#1e40af',
  900: '#1e3a8a',
  950: '#172554',
  DEFAULT: '#3b82f6',
};

module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        display: ["var(--font-display)", "Space Grotesk", "var(--font-inter)", "Inter", "sans-serif"],
      },
      colors: {
        brand,
        pop,
        primary: { DEFAULT: brand.DEFAULT, hover: brand.hover },
        accent: { DEFAULT: pop.DEFAULT, hover: pop[400] },
        surface: {
          app: '#050b14',
          panel: '#0a1422',
          card: '#0f1c2e',
          raised: '#15253b',
          hover: '#1a2d47',
          border: 'rgba(148, 197, 255, 0.10)',
        },
        'app-bg': '#050b14',
        'panel-bg': '#0a1422',
        'card-bg': '#0f1c2e',
        'raised-bg': '#15253b',
        'on-brand': '#04121a',
        secondary: '#9fb3c8',
        muted: '#5b7089',
      },
      spacing: {
        18: '4.5rem',
        22: '5.5rem',
      },
      borderColor: {
        subtle: 'rgba(148,197,255,0.10)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #2ee6d6 0%, #3b82f6 100%)',
      },
      boxShadow: {
        glow: '0 0 20px rgba(46, 230, 214, 0.4)',
        'glow-accent': '0 0 20px rgba(59, 130, 246, 0.4)',
      },
    },
  },
  plugins: [],
}
