import { isAbsolute } from "node:path";
import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

// `shared` is a private workspace package that is never published, so its source is
// bundled into the SDK, as are the syntax-lowering helpers from `@oxc-project/runtime`.
// Every other package stays an import and must be listed in `dependencies`;
// scripts/verify-package.mjs enforces both rules after the build.
const BUNDLED_PACKAGES = /^(?:shared|zod-meta|@oxc-project\/runtime)(?:\/|$)/;

const external = (id) =>
  !id.startsWith(".") && !id.startsWith("\0") && !isAbsolute(id) && !BUNDLED_PACKAGES.test(id);

// Database imports from shared schema helpers are unused by the public SDK, and the lens
// transform types the SDK declares itself replace json-schema-to-ts.
const SIDE_EFFECT_FREE = new Set(["zodbase", "json-schema-to-ts"]);
const treeshake = { moduleSideEffects: (id) => !SIDE_EFFECT_FREE.has(id) };

const input = {
  index: "src/index.ts",
  server: "src/server.ts",
  app: "src/app.ts",
  ui: "src/ui.ts",
  react: "src/react.tsx",
  vue: "src/vue.ts",
  elements: "src/elements.ts",
  testing: "src/testing.ts",
  "test-inputs": "src/test-inputs.ts",
};

const output = (dir, format) => ({
  dir,
  format,
  entryFileNames: "[name].js",
  chunkFileNames: "[name]-[hash].js",
});

export default defineConfig([
  {
    input,
    external,
    treeshake,
    resolve: { mainFields: ["module", "main"] },
    platform: "neutral",
    tsconfig: "tsconfig.json",
    transform: { target: "es2022" },
    plugins: [dts({ tsconfig: "tsconfig.json" })],
    output: output("esm", "esm"),
  },
  {
    input,
    external,
    treeshake,
    resolve: { mainFields: ["module", "main"] },
    platform: "neutral",
    tsconfig: "tsconfig.json",
    transform: { target: "es2022" },
    output: output("cjs", "cjs"),
  },
]);
