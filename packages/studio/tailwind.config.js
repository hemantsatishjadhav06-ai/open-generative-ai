/** @type {import('tailwindcss').Config} */

// Creator Agency brand tokens. Keep in sync with the root tailwind.config.js.
const brand = {
  50: '#f8ffe5',
  100: '#eeffc4',
  200: '#dfff8e',
  300: '#d3fb5f',
  400: '#c6f135',
  500: '#aedb1e',
  600: '#6b8f0f',
  700: '#557311',
  800: '#435a12',
  900: '#384a14',
  950: '#1c2906',
  DEFAULT: '#c6f135',
  hover: '#d6fb5a',
};

const pop = {
  50: '#fff0f8',
  100: '#ffe3f2',
  200: '#ffc6e6',
  300: '#ff98d1',
  400: '#ff5fbd',
  500: '#ff3cac',
  600: '#e01f92',
  700: '#bf0f78',
  800: '#9c0e62',
  900: '#811153',
  950: '#4f0230',
  DEFAULT: '#ff3cac',
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
          app: '#08060f',
          panel: '#0e0b18',
          card: '#151021',
          raised: '#1c1730',
          hover: '#272040',
          border: 'rgba(255, 255, 255, 0.07)',
        },
        'app-bg': '#08060f',
        'panel-bg': '#0e0b18',
        'card-bg': '#151021',
        'raised-bg': '#1c1730',
        secondary: '#a8a3bd',
        muted: '#5c566f',
      },
      spacing: {
        18: '4.5rem',
        22: '5.5rem',
      },
      borderColor: {
        subtle: 'rgba(255,255,255,0.07)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #c6f135 0%, #ff3cac 100%)',
      },
      boxShadow: {
        glow: '0 0 20px rgba(198, 241, 53, 0.4)',
        'glow-accent': '0 0 20px rgba(255, 60, 172, 0.4)',
      },
    },
  },
  plugins: [],
}
