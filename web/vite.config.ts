import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves project sites from /<repo>/; CI sets BASE_PATH accordingly.
  base: process.env.BASE_PATH || "./",
  server: {
    // Allow importing the shared zod schema from ../generator/src.
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
});
