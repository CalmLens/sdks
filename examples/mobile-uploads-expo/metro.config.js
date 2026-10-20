const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// `@calmlens/sdk` is linked from javascript in this repo (see the README). Metro only
// bundles files it watches, so watch the SDK's real folder too.
const sdk = fs.realpathSync(path.join(__dirname, "node_modules/@calmlens/sdk"));
if (!sdk.startsWith(__dirname)) {
  config.watchFolders = [...(config.watchFolders ?? []), sdk];
  config.resolver.nodeModulesPaths = [
    path.join(__dirname, "node_modules"),
    path.join(sdk, "node_modules"),
  ];
}

module.exports = config;
