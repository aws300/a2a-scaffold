/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "primary": "#ee2b6c",
        "background-light": "#f8f6f6",
        "background-dark": "#221016",
        "glass-border": "rgba(255, 255, 255, 0.4)",
        "glass-bg": "rgba(255, 255, 255, 0.3)",
        "glass-bg-strong": "rgba(255, 255, 255, 0.6)",
        "text-primary": "#1b0d12",
        "text-secondary": "#5f303f",
        "text-muted": "#9a4c66",
      },
      fontFamily: {
        "display": ["Inter", "sans-serif"],
      },
      borderRadius: {
        "DEFAULT": "0.5rem",
        "lg": "1rem",
        "xl": "1.5rem",
        "2xl": "2rem",
        "3xl": "2.5rem",
        "full": "9999px",
      },
      backgroundImage: {
        'mesh-gradient': 'radial-gradient(at 0% 0%, hsla(335,90%,88%,1) 0, transparent 50%), radial-gradient(at 50% 0%, hsla(250,60%,94%,1) 0, transparent 50%), radial-gradient(at 100% 0%, hsla(340,100%,92%,1) 0, transparent 50%), radial-gradient(at 0% 100%, hsla(280,60%,94%,1) 0, transparent 50%), radial-gradient(at 80% 100%, hsla(335,80%,90%,1) 0, transparent 50%), radial-gradient(at 0% 50%, hsla(340,100%,96%,1) 0, transparent 50%)',
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'pulse-soft': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 1.5s infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
  ],
};
