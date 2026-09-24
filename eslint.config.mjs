import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  {
    ignores: [
      ".next/**", "out/**", "dist/**", "release/**", "build/**",
      "electron/**", "src/**", "public/**", "**/dist/**", "**/node_modules/**",
      "packages/Vibe-Workflow/**", "packages/Open-Poe-AI/**", "packages/Open-AI-Design-Agent/**",
    ],
  },
  // REQUIRED: ESLint 9 skips .jsx by default; without this the studio .jsx
  // files are silently not linted.
  { files: ["**/*.{js,jsx,mjs,cjs}"] },
  ...compat.extends("next/core-web-vitals"),
];
