/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#07090f", 900: "#0b0e16", 800: "#121723", 700: "#1a2133", 600: "#252e45" },
        accent: { DEFAULT: "#1f7bff", soft: "#4c97ff" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Barlow Condensed", "Oswald", "Impact", "Arial Narrow", "sans-serif"],
        led: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
