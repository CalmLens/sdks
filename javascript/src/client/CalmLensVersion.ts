import { version } from "../../package.json";

/** This SDK's version, from its package.json. */
export const SDK_VERSION: string = version;

const runtimeName = (): string => {
  const runtime = globalThis as {
    Bun?: { version?: string };
    Deno?: { version?: { deno?: string } };
    navigator?: { userAgent?: string };
    process?: { versions?: { node?: string } };
  };
  if (isReactNativeRuntime()) return "react-native";
  if (runtime.Bun?.version) return `bun/${runtime.Bun.version}`;
  if (runtime.Deno?.version?.deno) return `deno/${runtime.Deno.version.deno}`;
  if (runtime.navigator?.userAgent === "Cloudflare-Workers") return "workerd";
  if (runtime.process?.versions?.node) return `node/${runtime.process.versions.node}`;
  return "unknown";
};

/** The `User-Agent` the SDK sends from server runtimes, e.g. `calmlens-js/0.10.0 (node/22.12.0)`. */
export const getUserAgent = (): string => `calmlens-js/${SDK_VERSION} (${runtimeName()})`;

/** True in a web page, where API keys would be visible to every visitor. */
export const isBrowserRuntime = (): boolean =>
  typeof (globalThis as { window?: unknown }).window !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined";

/** True in a React Native app, where an API key ships inside the app for anyone to extract. */
export const isReactNativeRuntime = (): boolean =>
  (globalThis as { navigator?: { product?: string } }).navigator?.product === "ReactNative";
