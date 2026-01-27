import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      animation: {
        'tile-entrance': 'tile-entrance 0.4s ease-out forwards',
        'tile-match': 'tile-match 0.5s ease-out forwards',
        'tile-shake': 'tile-shake 0.4s ease-out',
        'tile-pulse': 'tile-pulse 1.5s ease-in-out infinite',
        'score-pop': 'score-pop 0.3s ease-out',
        'float': 'float 3s ease-in-out infinite',
        'confetti': 'confetti 1s ease-out forwards',
        'shimmer': 'shimmer 2s linear infinite',
        'bounce-in': 'bounce-in 0.5s ease-out',
        'slide-up': 'slide-up 0.4s ease-out forwards',
        'glow': 'glow 1.5s ease-in-out infinite',
        'sparkle': 'sparkle 0.6s ease-out forwards',
      },
      keyframes: {
        'tile-entrance': {
          '0%': { transform: 'scale(0) rotate(-10deg)', opacity: '0' },
          '60%': { transform: 'scale(1.1) rotate(2deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(0deg)', opacity: '1' },
        },
        'tile-match': {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '30%': { transform: 'scale(1.3)', opacity: '1', boxShadow: '0 0 30px rgba(34, 197, 94, 0.8)' },
          '100%': { transform: 'scale(0)', opacity: '0' },
        },
        'tile-shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-8px)' },
          '40%': { transform: 'translateX(8px)' },
          '60%': { transform: 'translateX(-6px)' },
          '80%': { transform: 'translateX(6px)' },
        },
        'tile-pulse': {
          '0%, 100%': { transform: 'scale(1.05)', boxShadow: '0 0 0 0 rgba(59, 130, 246, 0.5)' },
          '50%': { transform: 'scale(1.1)', boxShadow: '0 0 20px 5px rgba(59, 130, 246, 0.3)' },
        },
        'score-pop': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.3)' },
          '100%': { transform: 'scale(1)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'confetti': {
          '0%': { transform: 'translateY(0) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(-100px) rotate(720deg)', opacity: '0' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'bounce-in': {
          '0%': { transform: 'scale(0)', opacity: '0' },
          '50%': { transform: 'scale(1.1)' },
          '70%': { transform: 'scale(0.95)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(30px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'glow': {
          '0%, 100%': { boxShadow: '0 0 5px rgba(251, 191, 36, 0.5)' },
          '50%': { boxShadow: '0 0 25px rgba(251, 191, 36, 0.8), 0 0 50px rgba(251, 191, 36, 0.4)' },
        },
        'sparkle': {
          '0%': { transform: 'scale(0) rotate(0deg)', opacity: '0' },
          '50%': { transform: 'scale(1.2) rotate(180deg)', opacity: '1' },
          '100%': { transform: 'scale(0) rotate(360deg)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
