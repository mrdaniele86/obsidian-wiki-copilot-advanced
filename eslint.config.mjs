import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores([
    "node_modules",
    "coverage",
    "main.js",
    "esbuild.config.mjs",
    "eslint.config.mjs",
    "scripts",
    "tests",
    "vitest.config.ts",
    "versions.json"
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      // The interface is Chinese and "Wiki Copilot" is a product name; the English
      // sentence-case fixer would rewrite intentional user-facing terminology.
      "obsidianmd/ui/sentence-case": "off"
    }
  }
);
