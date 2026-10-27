#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

/**
 * Marks each output directory's module format so Node loads `esm/*.js` as ES modules and
 * `cjs/*.js` as CommonJS, without changing the published file names.
 */
function writeModuleTypeMarkers() {
  for (const [targetDir, type] of [
    ["esm", "module"],
    ["cjs", "commonjs"],
  ]) {
    fs.writeFileSync(
      path.join(__dirname, "..", targetDir, "package.json"),
      `${JSON.stringify({ type }, null, 2)}\n`,
    );
  }
}

/**
 * rolldown-plugin-dts only emits declarations for ES module builds. The bundled declarations
 * contain no format-specific syntax, so copies beside the CommonJS files give `require`
 * consumers (e.g. `moduleResolution: node16`) declarations that TypeScript treats as CommonJS.
 */
function copyDeclarationsToCjs() {
  const esmDir = path.join(__dirname, "..", "esm");
  const cjsDir = path.join(__dirname, "..", "cjs");
  for (const file of fs.readdirSync(esmDir)) {
    if (file.endsWith(".d.ts")) {
      fs.copyFileSync(path.join(esmDir, file), path.join(cjsDir, file));
    }
  }
}

const TESTING_EXPORTS = [
  "MockCalmLensServerClient",
  "MockCalmLensAppClient",
  "createMockApiKey",
  "MOCK_API_KEY_PREFIX",
  "InMemoryMockDatabaseStorage",
  "InMemoryMockImageStorage",
  "toWebhookEventPayload",
  "createWebhookHeaders",
  "signUploadToken",
  "generateMediaTestCode",
  "MEDIA_TEST_SIGNALS",
];

/**
 * Svelte components ship as source, as Svelte libraries do, so the consumer's Svelte compiler
 * builds them. They import the core from `../ui.js`, which sits beside them in `esm/`.
 */
function copySvelteComponents() {
  const sourceDir = path.join(__dirname, "..", "src", "svelte");
  const targetDir = path.join(__dirname, "..", "esm", "svelte");
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of fs.readdirSync(sourceDir)) {
    fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
  }
}

/** Source modules each production entry must not bundle, by the module markers rolldown writes. */
const FORBIDDEN_MODULES = {
  index: [/^src\/testing/, /CalmLensServerClient\.ts$/, /CalmLensAppClient\.ts$/],
  server: [/^src\/testing/, /CalmLensAppClient\.ts$/],
  // Browsers and apps download this entry, so it carries uploads only.
  app: [
    /^src\/testing/,
    /CalmLensServerClient\.ts$/,
    /CalmLensWebhooks\.ts$/,
    /CalmLensUploadTokens\.ts$/,
    /UploadToken\.ts$/,
    /CryptoUtils\.ts$/,
  ],
};
const PEER_ENTRIES = new Set(["react", "vue"]);
// The UI entries run in browsers too, so they carry no more than the app entry.
for (const entry of ["ui", "react", "vue", "elements"])
  FORBIDDEN_MODULES[entry] = FORBIDDEN_MODULES.app;

/** The source modules bundled into an entry and every chunk it imports. */
function bundledModules(buildDir, entryFile) {
  const modules = new Set();
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = fs.readFileSync(file, "utf8");
    // Rolldown marks each module with `// <path>` (before 1.2.15, `//#region <path>`).
    for (const [, name] of source.matchAll(/^\/\/(?:#region)? (\S+\.[cm]?[jt]sx?)$/gm)) {
      modules.add(name.replace(/^(?:\.\.\/)+/, ""));
    }
    for (const [, specifier] of source.matchAll(/(?:from|require\()\s*"(\.\/[^"]+)"/g)) {
      visit(path.join(buildDir, specifier));
    }
  };
  visit(path.join(buildDir, entryFile));
  return modules;
}

function checkProductionEntries(targetDir) {
  const buildDir = path.join(__dirname, "..", targetDir);
  for (const [entry, forbidden] of Object.entries(FORBIDDEN_MODULES)) {
    const modules = bundledModules(buildDir, `${entry}.js`);
    if (!modules.has("src/client/CalmLensError.ts")) {
      throw new Error(`Could not read the modules bundled into ${targetDir}/${entry}.js`);
    }
    for (const name of modules) {
      if (forbidden.some((pattern) => pattern.test(name))) {
        throw new Error(`${targetDir}/${entry}.js must not bundle ${name}`);
      }
    }
    // Entries for an optional peer dependency need the host app's copy of it to load.
    if (targetDir !== "cjs" || PEER_ENTRIES.has(entry)) continue;
    const entryExports = require(path.join(buildDir, `${entry}.js`));
    for (const name of TESTING_EXPORTS) {
      if (name in entryExports) {
        throw new Error(`Testing export ${name} must only be available from @calmlens/sdk/testing`);
      }
    }
  }
}

function runMockClientSanityCheck(targetDir) {
  if (targetDir !== "cjs") {
    return;
  }

  const testingEntry = path.join(__dirname, "..", targetDir, "testing.js");
  const {
    MockCalmLensServerClient,
    InMemoryMockDatabaseStorage,
    InMemoryMockImageStorage,
    createMockApiKey,
  } = require(testingEntry);

  const projectId = "proj_8fK2mQx7Lp4NvB3tRz9Y";
  const client = new MockCalmLensServerClient({
    apiKey: createMockApiKey([
      { actions: ["assets:download"], folderId: null, includeSubfolders: true },
    ]),
    projectId,
    mockOptions: {
      createId: (prefix) => `${prefix}_987fcdeb51a243d7b890`,
      now: () => 1700000000000,
      databaseStorage: new InMemoryMockDatabaseStorage(),
      imageStorage: new InMemoryMockImageStorage(),
    },
  });

  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  return client.assets
    .create({
      name: "sanity.png",
      content: {
        base64: pngBase64,
        type: "image/png",
      },
    })
    .then(async (asset) => {
      if (asset.id !== "asset_987fcdeb51a243d7b890") {
        throw new Error("Mock asset ID sanity check failed");
      }
      const retrieved = await client.assets.retrieve({ assetId: asset.id });
      if (retrieved.id !== asset.id) {
        throw new Error("Mock retrieve sanity check failed");
      }
      const response = await client.cdn.serve({ assetIdentifier: asset.id });
      if (response.status !== 200) {
        throw new Error(`Mock CDN sanity check failed with status ${response.status}`);
      }
    });
}

/** The components' stylesheet as a file, for pages whose CSP refuses injected styles. */
function writeStylesheet() {
  const { CALMLENS_STYLES } = require(path.join(__dirname, "..", "cjs", "ui.js"));
  fs.writeFileSync(path.join(__dirname, "..", "esm", "styles.css"), `${CALMLENS_STYLES.trim()}\n`);
}

writeModuleTypeMarkers();
copyDeclarationsToCjs();
copySvelteComponents();
writeStylesheet();
checkProductionEntries("esm");
checkProductionEntries("cjs");
Promise.resolve(runMockClientSanityCheck("cjs")).catch((error) => {
  console.error(error);
  process.exit(1);
});
