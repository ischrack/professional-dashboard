/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#1a1a1a',
        surface: '#252525',
        'surface-2': '#2e2e2e',
        'surface-3': '#383838',
        accent: '#7c6af7',
        'accent-hover': '#9080ff',
        'accent-dim': '#4a3f9e',
        text: '#e8e8e8',
        'text-muted': '#9e9e9e',
        'text-dim': '#6b6b6b',
        success: '#4caf82',
        warning: '#f5a623',
        error: '#e05252',
        gold: '#f5c842',
        border: '#3a3a3a',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
