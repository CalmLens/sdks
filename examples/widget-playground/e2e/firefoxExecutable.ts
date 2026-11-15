import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { firefox } from "@playwright/test";

/**
 * On macOS, Firefox reads its profile list from `~/Library/Application Support/Firefox` at every
 * start, even when given a profile. When that folder belongs to an installed Firefox and macOS
 * keeps other apps out of it, Playwright's build can't read it and exits with "Could not find
 * profile folder". Started with `-app` and a copy of its own `application.ini` naming another
 * profile folder, it keeps its data in `~/Library/Application Support/Playwright Firefox` instead.
 * `-app` also makes the ini's folder the browser's own, so the copy sits beside a link to the
 * bundle's `omni.ja`. Firefox reads `-app` only as its first argument, after which Playwright adds
 * its own, so this returns a launcher that execs Playwright's Firefox with it. Elsewhere it returns
 * undefined, and Playwright starts its Firefox as usual.
 */
export const firefoxExecutablePath = (): string | undefined => {
  if (process.platform !== "darwin") return undefined;
  const executable = firefox.executablePath();
  const resources = join(dirname(executable), "..", "Resources");
  // Each Playwright process reads the config, so each gets a folder of its own.
  const directory = join(tmpdir(), `calmlens-widget-playground-firefox-${process.pid}`);
  const browser = join(directory, "browser");
  mkdirSync(browser, { recursive: true });
  const omni = join(browser, "omni.ja");
  rmSync(omni, { force: true });
  symlinkSync(join(resources, "browser", "omni.ja"), omni);
  const ini = join(browser, "application.ini");
  writeFileSync(
    ini,
    readFileSync(join(resources, "application.ini"), "utf8").replace(
      /^\[App\]$/m,
      "[App]\nProfile=Playwright Firefox",
    ),
  );
  const launcher = join(directory, "firefox");
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(launcher, `#!/bin/sh\nexec ${quote(executable)} -app ${quote(ini)} "$@"\n`);
  chmodSync(launcher, 0o755);
  return launcher;
};
