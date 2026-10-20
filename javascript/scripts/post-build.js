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
  "createMockApiKey",
  "MOCK_API_KEY_PREFIX",
  "InMemoryMockDatabaseStorage",
  "InMemoryMockImageStorage",
  "toWebhookEventPayload",
  "createWebhookHeaders",
  "generateMediaTestCode",
  "MEDIA_TEST_SIGNALS",
];

/** Source modules each production entry must not bundle, by the `//#region` rolldown writes. */
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

/** The source modules bundled into an entry and every chunk it imports. */
function bundledModules(buildDir, entryFile) {
  const modules = new Set();
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const [, name] of source.matchAll(/^\/\/#region (\S+)/gm)) {
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
    if (targetDir !== "cjs") continue;
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

  const projectId = "123e4567-e89b-12d3-a456-426614174000";
  const client = new MockCalmLensServerClient({
    apiKey: createMockApiKey([
      { actions: ["assets:download"], folderId: null, includeSubfolders: true },
    ]),
    projectId,
    mockOptions: {
      createId: () => "987fcdeb-51a2-43d7-b890-123456789abc",
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
      if (asset.id !== "987fcdeb-51a2-43d7-b890-123456789abc") {
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

writeModuleTypeMarkers();
copyDeclarationsToCjs();
checkProductionEntries("esm");
checkProductionEntries("cjs");
Promise.resolve(runMockClientSanityCheck("cjs")).catch((error) => {
  console.error(error);
  process.exit(1);
});
