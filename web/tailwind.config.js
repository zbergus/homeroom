/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#040711", // Deep rink canvas
          900: "#090e1b", // Tactical panel surface
          800: "#0f172a", // Elevated panel / card
          700: "#172138", // Raised container / interactive header
          600: "#222f4c", // Subdued border / switch off
        },
        accent: {
          DEFAULT: "#00d4ff", // Ice cyan tactical signature
          soft: "#4ce2ff",
        },
        goal: {
          DEFAULT: "#ff9f1c", // Goal lamp amber
          glow: "#ffb74d",
        },
        puck: {
          DEFAULT: "#e63946", // Goal alert / red line
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Barlow Condensed", "Oswald", "Impact", "Arial Narrow", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        led: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        tactical: "inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 4px 16px rgba(0, 0, 0, 0.4)",
        "tactical-sm": "inset 0 1px 0 rgba(255, 255, 255, 0.07)",
        "lamp-glow": "0 0 20px rgba(255, 159, 28, 0.4)",
        "ice-glow": "0 0 20px rgba(0, 212, 255, 0.35)",
      },
    },
  },
  plugins: [],
};
