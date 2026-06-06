import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Travel Insured International brand palette (adjust to brand guide)
        tii: {
          navy: "#0b2545",
          blue: "#1769aa",
          accent: "#13a3b5",
        },
      },
    },
  },
  plugins: [typography],
};

export default config;
