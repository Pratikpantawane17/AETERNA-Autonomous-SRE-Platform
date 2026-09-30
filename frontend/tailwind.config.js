/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#080B14',
          surface: '#0D1117',
          border: '#1C2333',
          cyan: '#00D4FF',
          purple: '#7C3AED',
          danger: '#FF3B5C',
          warning: '#FF9500',
          success: '#22C55E',
          high: '#FF6B35',
        },
      },
      fontFamily: {
        ui: ['system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        glow: {
          '0%, 100%': {
            boxShadow: '0 0 8px 2px rgba(0, 212, 255, 0.3)',
          },
          '50%': {
            boxShadow: '0 0 24px 6px rgba(0, 212, 255, 0.7)',
          },
        },
        'glow-purple': {
          '0%, 100%': {
            boxShadow: '0 0 8px 2px rgba(124, 58, 237, 0.3)',
          },
          '50%': {
            boxShadow: '0 0 24px 6px rgba(124, 58, 237, 0.7)',
          },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'float-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-slow': 'pulse-slow 3s ease-in-out infinite',
        glow: 'glow 2s ease-in-out infinite',
        'glow-purple': 'glow-purple 2s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
        'float-up': 'float-up 0.3s ease-out forwards',
      },
      backgroundImage: {
        shimmer:
          'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)',
      },
      backgroundSize: {
        shimmer: '200% 100%',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
