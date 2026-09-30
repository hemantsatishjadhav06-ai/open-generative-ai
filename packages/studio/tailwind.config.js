/** @type {import('tailwindcss').Config} */

// Aquora brand tokens (turquoise primary, electric-blue accent, deep-navy
// surfaces). Keep in sync with the root tailwind.config.js.
const brand = {
  50: '#effefb',
  100: '#c9fef4',
  200: '#94fbea',
  300: '#96e2d4',
  400: '#7bd9c8',
  500: '#0dc9bc',
  600: '#06a29a',
  700: '#0a817c',
  800: '#0e6663',
  900: '#115552',
  950: '#033332',
  DEFAULT: '#7bd9c8',
  hover: '#96e2d4',
};

const pop = {
  50: '#eff6ff',
  100: '#dbeafe',
  200: '#bfdbfe',
  300: '#93c5fd',
  400: '#94b7dd',
  500: '#608fc8',
  600: '#3e6c9f',
  700: '#1d4ed8',
  800: '#1e40af',
  900: '#1e3a8a',
  950: '#172554',
  DEFAULT: '#608fc8',
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
          app: '#0b141c',
          panel: '#111e28',
          card: '#162630',
          raised: '#1d303c',
          hover: '#243b48',
          border: 'rgba(181, 202, 216, 0.14)',
        },
        'app-bg': '#0b141c',
        'panel-bg': '#111e28',
        'card-bg': '#162630',
        'raised-bg': '#1d303c',
        'on-brand': '#102721',
        secondary: '#a8bac5',
        muted: '#849aa9',
      },
      spacing: {
        18: '4.5rem',
        22: '5.5rem',
      },
      borderColor: {
        subtle: 'rgba(148,197,255,0.10)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #96e2d4 0%, #7bd9c8 100%)',
      },
      boxShadow: {
        glow: '0 4px 14px rgba(0, 0, 0, 0.12)',
        'glow-accent': '0 4px 14px rgba(0, 0, 0, 0.12)',
      },
    },
  },
  plugins: [],
}
