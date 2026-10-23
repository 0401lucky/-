import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "**/.next/**",
    "**/.open-next/**",
    "**/.wrangler/**",
    "**/.claude/**",
    "**/.tmp/**",
    "**/backups/**",
    "**/out/**",
    "**/build/**",
  ]),
  {
    rules: {
      "react-hooks/purity": "off",
      // Keep Compiler readiness checks advisory during the runtime upgrade.
      // The project does not enable React Compiler; core Hooks checks remain enabled.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "prefer-const": "off",
    },
  },
]);
