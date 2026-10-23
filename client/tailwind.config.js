/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "#1d2939",
        darkbg: "#101828",
        gold: "#d4af37",
      },
    },
  },
  plugins: [],
};
