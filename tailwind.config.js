/** @type {import('tailwindcss').Config} */

// Creator Agency brand tokens.
// "Volt" lime is the primary; "Pop" magenta is the accent. Surfaces are a
// violet-tinted near-black. Keep these values in sync with app/globals.css.
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

const surface = {
    app: '#08060f',
    panel: '#0e0b18',
    card: '#151021',
    raised: '#1c1730',
    border: 'rgba(255, 255, 255, 0.07)',
};

module.exports = {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
        "./app/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./packages/studio/src/**/*.{js,jsx}",
        "./packages/Open-AI-Design-Agent/packages/design-agent/src/**/*.{js,jsx}",
        "./packages/Open-Poe-AI/packages/agents/src/**/*.{js,jsx,ts,tsx}",
        "./packages/Vibe-Workflow/packages/workflow-builder/src/**/*.{js,jsx,ts,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                brand,
                pop,
                // Legacy alias kept for existing `primary` utilities.
                primary: {
                    DEFAULT: brand.DEFAULT,
                    hover: brand.hover,
                },
                surface,
                'app-bg': surface.app,
                'panel-bg': surface.panel,
                'card-bg': surface.card,
                secondary: '#a8a3bd',
                muted: '#5c566f',
            },
            fontFamily: {
                sans: ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
                display: ['var(--font-display)', 'Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
            },
            borderRadius: {
                'xl': '1rem',
                '2xl': '1.5rem',
                '3xl': '2rem',
            },
            boxShadow: {
                'glow': '0 0 20px rgba(198, 241, 53, 0.4)',
                'glow-accent': '0 0 20px rgba(255, 60, 172, 0.4)',
                '3xl': '0 35px 60px -15px rgba(0, 0, 0, 0.8)',
            },
            backgroundImage: {
                'brand-gradient': 'linear-gradient(135deg, #c6f135 0%, #ff3cac 100%)',
            },
        },
    },
    plugins: [],
}
