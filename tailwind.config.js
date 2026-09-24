/** @type {import('tailwindcss').Config} */

// Aquora brand tokens.
// Turquoise is the primary; "Pop" electric blue is the accent. Surfaces are a
// deep navy. Text on turquoise fills uses #04121a; text on blue fills is white;
// blue *text* on dark surfaces uses pop-400 (#60a5fa) for AA contrast.
// Keep these values in sync with app/globals.css.
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

const surface = {
    app: '#050b14',
    panel: '#0a1422',
    card: '#0f1c2e',
    raised: '#15253b',
    hover: '#1a2d47',
    border: 'rgba(148, 197, 255, 0.10)',
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
                'on-brand': '#04121a',
                secondary: '#9fb3c8',
                muted: '#5b7089',
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
                'glow': '0 0 20px rgba(46, 230, 214, 0.4)',
                'glow-accent': '0 0 20px rgba(59, 130, 246, 0.4)',
                '3xl': '0 35px 60px -15px rgba(0, 0, 0, 0.8)',
            },
            backgroundImage: {
                'brand-gradient': 'linear-gradient(135deg, #2ee6d6 0%, #3b82f6 100%)',
            },
        },
    },
    plugins: [],
}
