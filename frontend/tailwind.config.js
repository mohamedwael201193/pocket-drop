/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        paper: '#F6F5F3',
        stoneBg: '#F6F5F3',
        stoneCard: '#EFEDE9',
        stone2: '#EFEDE9',
        ink: '#18181B',
        live: '#0F7B5F',
        rec: '#6B5B2E',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.35' } },
        floatSlow: { '0%,100%': { transform: 'translateY(0px)' }, '50%': { transform: 'translateY(-7px)' } },
      },
      animation: { shimmer: 'shimmer 1.4s infinite', pulseDot: 'pulseDot 1.6s ease-in-out infinite', 'float-slow': 'floatSlow 5.5s ease-in-out infinite' },
    },
  },
  plugins: [],
};
