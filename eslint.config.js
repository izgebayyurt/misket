import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist", "target", "src-tauri", "crates", "node_modules", "e2e"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // src/core is pure logic: no React, no Tauri, no API layer.
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*"],
              message: "src/core must stay framework-free",
            },
            { group: ["@tauri-apps/*"], message: "src/core must not talk to Tauri" },
            {
              group: ["@/api", "@/api/*", "../api", "../api/*", "../../api/*"],
              message: "src/core must not call the API layer (type-only imports are fine)",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
);
