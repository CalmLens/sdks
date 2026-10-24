// Gives the binding tests a DOM, compiles the SDK's Svelte components, and makes the SDK's source
// use this package's copy of each UI library. The SDK itself never installs them (a copy there
// would be a second React in apps that link the SDK), and Bun doesn't run resolve hooks for bare
// imports, so the SDK's files are loaded here with their library imports pointed at this package.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";

GlobalRegistrator.register({ url: "http://localhost/" });

// Waits for DOM changes allow for a busy machine, so a slow render isn't reported as a failure.
const { configure } = await import("@testing-library/dom");
configure({ asyncUtilTimeout: 5000 });

const here = import.meta.dir;
const { compile } = await import("svelte/compiler");

const LIBRARY_IMPORT =
  /(\bfrom\s*|\bimport\s*\(?\s*)(["'])((?:react|react-dom|vue|svelte)(?:\/[^"']*)?)\2/g;
/** Points each UI library import at this package's copy, resolved with the run's conditions. */
const pinLibraries = (code: string) =>
  code.replace(LIBRARY_IMPORT, (_match, lead: string, quote: string, specifier: string) => {
    return `${lead}${quote}${Bun.resolveSync(specifier, here)}${quote}`;
  });

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  // `autoImportJSX` writes the JSX runtime import into the output, where it can be pinned too.
  tsx: new Bun.Transpiler({
    loader: "tsx",
    autoImportJSX: true,
    tsconfig: { compilerOptions: { jsx: "react-jsx", jsxImportSource: "react" } },
  } as Bun.TranspilerOptions),
};

plugin({
  name: "calmlens-ui-tests",
  setup(build) {
    build.onLoad({ filter: /\/sdks\/javascript\/src\/.*\.svelte$/ }, async ({ path }) => {
      const { js } = compile(await Bun.file(path).text(), {
        filename: path,
        generate: "client",
        dev: false,
      });
      return { contents: pinLibraries(js.code), loader: "js" };
    });
    build.onLoad(
      { filter: /\/sdks\/javascript\/src\/(?!contract\/).*\.tsx?$/ },
      async ({ path }) => {
        const transpiler = path.endsWith(".tsx") ? transpilers.tsx : transpilers.ts;
        const code = transpiler.transformSync(await Bun.file(path).text());
        return { contents: pinLibraries(code), loader: "js" };
      },
    );
    build.onLoad({ filter: /\/sdks\/javascript\/src\/svelte\/index\.js$/ }, async ({ path }) => ({
      contents: pinLibraries(await Bun.file(path).text()),
      loader: "js",
    }));
  },
});
