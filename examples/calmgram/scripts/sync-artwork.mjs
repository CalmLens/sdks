import { cpSync, mkdirSync } from "node:fs";

const destination = new URL("../public/post-examples/", import.meta.url);
mkdirSync(destination, { recursive: true });
cpSync(new URL("../../../assets/post-examples/", import.meta.url), destination, {
  recursive: true,
  filter: (source) => !source.endsWith("README.md"),
});
