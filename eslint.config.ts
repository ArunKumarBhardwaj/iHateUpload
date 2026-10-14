import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/pdf.worker.min.mjs",
    "public/sw.js",
    // Untracked design and prototype scratch, not app code.
    ".arena-pdf-edit/**",
    ".design/**",
  ]),
]);

export default eslintConfig;
