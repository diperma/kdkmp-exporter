import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GitHub Pages serves a project site from /<repo>/, so the bundle needs a
 * matching base path. The deploy workflow sets VITE_BASE; local dev keeps "/".
 */
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? "/",
  build: { outDir: "dist" },
});
