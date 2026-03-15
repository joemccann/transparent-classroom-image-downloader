/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      letterSpacing: {
        tighter: "-0.03em",
      },
      colors: {
        surface: "rgb(24 24 27)", // zinc-900
        border: "rgb(39 39 42)", // zinc-800
      },
      boxShadow: {
        inset: "inset 0 1px 3px 0 rgb(0 0 0 / 0.3)",
      },
      backdropBlur: {
        glass: "20px",
      },
    },
  },
  plugins: [],
};
