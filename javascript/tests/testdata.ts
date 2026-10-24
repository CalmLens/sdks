// The one loader of the shared SDK contract fixtures that packages/sdk-contract writes to
// sdks/go/testdata. contract.test.ts and contract-client.test.ts each replay their own fixtures
// (packages/sdk-contract/README.md, "Runners") through it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const testdata = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "../../go/testdata", name), "utf8"));
