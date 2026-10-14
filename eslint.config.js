import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";

export default defineConfig([
  { ignores: ["build/"] },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
]);
