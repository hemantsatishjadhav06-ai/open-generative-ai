/** @type {import('tailwindcss').Config} */

// Aquora brand tokens.
// Turquoise is the primary; "Pop" muted blue is the accent. Surfaces are a
// deep navy. Text on turquoise fills uses #102721; text on blue fills is white;
// blue *text* on dark surfaces uses pop-400 (#94b7dd) for AA contrast.
// Keep these values in sync with app/globals.css.
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

const surface = {
    app: '#0b141c',
    panel: '#111e28',
    card: '#162630',
    raised: '#1d303c',
    hover: '#243b48',
    border: 'rgba(181, 202, 216, 0.14)',
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
                'on-brand': '#102721',
                secondary: '#a8bac5',
                muted: '#849aa9',
            },
            fontFamily: {
                sans: ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
                display: ['var(--font-display)', 'Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
            },
            // w-18/h-18/h-22 are used by the studio hero collages.
            spacing: {
                18: '4.5rem',
                22: '5.5rem',
            },
            borderRadius: {
                'xl': '1rem',
                '2xl': '1.5rem',
                '3xl': '2rem',
            },
            boxShadow: {
                'glow': '0 4px 14px rgba(0, 0, 0, 0.12)',
                'glow-accent': '0 4px 14px rgba(0, 0, 0, 0.12)',
                '3xl': '0 35px 60px -15px rgba(0, 0, 0, 0.8)',
            },
            backgroundImage: {
                'brand-gradient': 'linear-gradient(135deg, #96e2d4 0%, #7bd9c8 100%)',
            },
        },
    },
    plugins: [],
}
