import daisyui from "daisyui";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', '"Manrope"', "sans-serif"],
        mono: ['"Space Mono"', '"Courier New"', "monospace"],
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        truespec: {
          primary: "#f97316",
          secondary: "#38bdf8",
          accent: "#2dd4bf",
          neutral: "#0f1724",
          "base-100": "#0a0d12",
          "base-200": "#0f1724",
          "base-300": "#1e293b",
          info: "#38bdf8",
          success: "#22c55e",
          warning: "#f59e0b",
          error: "#f87171",
          "--rounded-box": "1.25rem",
          "--rounded-btn": "0.9rem",
          "--rounded-badge": "9999px",
          "--animation-btn": "0.2s",
          "--animation-input": "0.2s",
        },
      },
    ],
    darkTheme: "truespec",
  },
};
