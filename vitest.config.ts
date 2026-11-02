import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["generator/src/**/*.test.ts", "web/src/**/*.test.ts"],
    environment: "node",
  },
});
