/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // 13 px floor: the smallest utility is 13 px.
      fontSize: { xs: ['13px', { lineHeight: '18px' }] },
      fontFamily: {
        // Direction B "Obsidian console": Funnel Display for headings, Funnel Sans for text, DM Mono for data.
        serif: ['"Funnel Display"', 'system-ui', 'sans-serif'],
        display: ['"Funnel Display"', 'system-ui', 'sans-serif'],
        sans: ['"Funnel Sans"', 'system-ui', 'sans-serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'Menlo', 'monospace'],
        // The owner's voice: Instrument Serif stays on big amounts and the wordmark.
        money: ['"Instrument Serif"', 'Georgia', 'serif'],
      },
      colors: {
        paper: '#F6F5F3',
        stoneBg: '#F6F5F3',
        stoneCard: '#EFEDE9',
        stone2: '#EFEDE9',
        ink: '#18181B',
        live: '#0F7B5F',
        rec: '#6B5B2E',
        obsidian: '#18181B',
        obsidian2: '#252427',
        accent: '#0B6B4B',
        accentHover: '#095A3F',
        liveBright: '#10B981',
        invMuted: '#A9A7A3',
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
