/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './mobile.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: '#FAF7F2', 2: '#F2EEE5', 3: '#EAE5D9' },
        surface: { DEFAULT: '#FFFFFF', 2: '#FFFDF8' },
        ink: { DEFAULT: '#1C1917', 2: '#292524', 3: '#44403C' },
        mute: { DEFAULT: '#78716C', 2: '#A8A29E' },
        hair: { DEFAULT: '#D6D3D1', 2: '#E7E5E4' },
        gold: { DEFAULT: '#B8935A', dark: '#A07F48' },
        up: '#4A7C59',
        down: '#9E4A3E',
        dark: '#1A1816',
      },
      fontFamily: {
        serif: ['Georgia', '"Times New Roman"', 'serif'],
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"',
          '"Segoe UI"', 'system-ui', 'sans-serif',
        ],
      },
      borderRadius: {
        card: '24px',
        pill: '999px',
      },
      boxShadow: {
        cta: 'inset 0 1px 0 rgba(255,255,255,.08), 0 10px 28px rgba(28,25,23,.14), 0 2px 5px rgba(28,25,23,.06)',
        card: '0 1px 3px rgba(28,25,23,.06)',
      },
    },
  },
  plugins: [],
}
