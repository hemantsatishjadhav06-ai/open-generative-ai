/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // Dark-mode palette matched to the host app's Aquora navy surfaces.
      colors: {
        'primary': '#3898ec',
        'primary-bg': '#050b14',
        'secondary-bg': '#0f1c2e',
        'primary-text': '#eef6ff',
        'secondary-text': '#9fb3c8',
        'divider': '#1c2e45',
      },
    },
  },
  plugins: [],
}

