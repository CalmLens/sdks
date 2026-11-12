import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLI_OAUTH_CLIENT_ID,
  DEVICE_CODE_GRANT_TYPE,
} from "../../src/contract/AgentAccessConstants.js";
import { EXAMPLE_IDS } from "../../src/contract/Ids.js";
import { createMockApiKey, MockCalmLensServerClient } from "../../src/testing";
import { buildCli } from "./build";

// `calmlens login` against a stand-in OAuth server: the device flow, the stored key that later
// commands use, `logout` revoking it, and a declined sign-in.

const projectId = EXAMPLE_IDS.proj;
const issuedKey = "clsk_test_issued";

test("signs in with a device code, uses the stored key, then revokes it on logout", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "calmlens-login-test-"));
  const { command, cleanup } = await buildCli("node");
  const mock = new MockCalmLensServerClient({ apiKey: createMockApiKey(), projectId });
  const asset = await mock.assets.classify({
    name: "text",
    content: { plainText: "Hello", type: "text/plain" },
  });
  let decision: "approve" | "deny" = "approve";
  let polls = 0;
  const forms: Record<string, Record<string, string>[]> = {};
  const uploads: { path: string; key: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname.startsWith("/oauth/")) {
        const form = Object.fromEntries(new URLSearchParams(await request.text()));
        (forms[pathname] ??= []).push(form);
        if (pathname === "/oauth/device/code") {
          polls = 0;
          return Response.json({
            device_code: "device-1",
            user_code: "BCDF-GHJK",
            verification_uri: "https://calmlens.test/device",
            expires_in: 600,
            interval: 0,
          });
        }
        if (pathname === "/oauth/token") {
          polls += 1;
          if (polls === 1)
            return Response.json({ error: "authorization_pending" }, { status: 400 });
          return decision === "deny"
            ? Response.json({ error: "access_denied" }, { status: 400 })
            : Response.json({
                access_token: issuedKey,
                token_type: "Bearer",
                scope: "read",
                project_id: projectId,
              });
        }
        return new Response(null, { status: 200 });
      }
      uploads.push({ path: pathname, key: request.headers.get("x-api-key") });
      return Response.json(asset);
    },
  });
  const run = async (args: string[]) => {
    const child = Bun.spawn([...command, ...args], {
      env: {
        ...Object.fromEntries(
          Object.entries(Bun.env).filter(([key]) => !key.startsWith("CALMLENS_")),
        ),
        CALMLENS_CONFIG_DIR: configDir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  };
  const credentialsFile = join(configDir, "credentials.json");
  try {
    const apiUrl = `${server.url}v1`;
    const signedIn = await run(["login", "--read-only", "--no-browser", "--api-url", apiUrl]);
    expect(signedIn.exitCode).toBe(0);
    expect(signedIn.stdout).toContain("BCDF-GHJK");
    expect(forms["/oauth/device/code"]).toEqual([
      { client_id: CLI_OAUTH_CLIENT_ID, scope: "read" },
    ]);
    expect(forms["/oauth/token"]?.[1]).toEqual({
      grant_type: DEVICE_CODE_GRANT_TYPE,
      device_code: "device-1",
      client_id: CLI_OAUTH_CLIENT_ID,
    });
    expect(JSON.parse(await readFile(credentialsFile, "utf8"))).toEqual({
      apiKey: issuedKey,
      projectId,
      apiUrl,
    });
    // Only this account can read the key. Windows has no POSIX modes; its user profile is private.
    if (process.platform !== "win32")
      expect((await stat(credentialsFile)).mode & 0o777).toBe(0o600);

    // No key, project or API URL given: the login supplies all three.
    const triggered = await run(["trigger", "clean"]);
    expect(triggered.exitCode).toBe(0);
    expect(uploads).toEqual([{ path: `/v1/projects/${projectId}/assets`, key: issuedKey }]);

    const signedOut = await run(["logout"]);
    expect(signedOut.exitCode).toBe(0);
    expect(forms["/oauth/revoke"]).toEqual([{ token: issuedKey }]);
    expect(await Bun.file(credentialsFile).exists()).toBe(false);
    const afterLogout = await run(["trigger", "clean"]);
    expect(afterLogout.exitCode).toBe(1);
    expect(afterLogout.stderr).toContain("calmlens login");

    // A named profile keeps its own login, beside the default one.
    const profiled = await run([
      "login",
      "--profile",
      "work",
      "--read-only",
      "--no-browser",
      "--api-url",
      apiUrl,
    ]);
    expect(profiled.exitCode).toBe(0);
    expect(await Bun.file(join(configDir, "credentials-work.json")).exists()).toBe(true);
    expect(await Bun.file(credentialsFile).exists()).toBe(false);
    const profiledTrigger = await run(["trigger", "clean", "--profile", "work", "--json"]);
    expect(profiledTrigger.exitCode).toBe(0);
    expect(JSON.parse(profiledTrigger.stdout)).toMatchObject({ id: asset.id });
    expect(uploads.at(-1)).toEqual({ path: `/v1/projects/${projectId}/assets`, key: issuedKey });
    expect((await run(["trigger", "clean", "--profile", "home"])).exitCode).toBe(1);
    expect((await run(["trigger", "clean", "--profile", "../escape"])).exitCode).toBe(1);
    expect((await run(["logout", "--profile", "work"])).exitCode).toBe(0);
    expect(await Bun.file(join(configDir, "credentials-work.json")).exists()).toBe(false);

    decision = "deny";
    const declined = await run(["login", "--no-browser", "--api-url", apiUrl]);
    expect(declined.exitCode).toBe(1);
    expect(await Bun.file(credentialsFile).exists()).toBe(false);
  } finally {
    server.stop(true);
    await rm(configDir, { recursive: true, force: true });
    await cleanup();
  }
}, 60_000);
