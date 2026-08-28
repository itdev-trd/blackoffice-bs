/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./*.jsx", "./lib/**/*.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans Thai"', "Noto Sans Thai", "sans-serif"],
      },
    },
  },
  plugins: [],
};
