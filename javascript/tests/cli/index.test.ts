import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../../package.json";
import { EXAMPLE_IDS } from "../../src/contract/Ids.js";
import { detectTestTrigger } from "../../src/test-inputs";
import { createMockApiKey, MockCalmLensServerClient } from "../../src/testing";
import { buildCli } from "./build";

// Both builds: the npm entry under Node.js, and the standalone executable.
for (const kind of ["node", "binary"] as const) {
  test(`the ${kind} build supports help, version, environment files and real HTTP uploads`, async () => {
    const { command, cleanup } = await buildCli(kind);
    const run = async (args: string[]) => {
      const process = Bun.spawn([...command, ...args], {
        env: Object.fromEntries(
          Object.entries(Bun.env).filter(([key]) => !key.startsWith("CALMLENS_")),
        ),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);
      return { stdout, stderr, exitCode };
    };
    expect(await run(["--version"])).toEqual({ stdout: `${version}\n`, stderr: "", exitCode: 0 });
    expect((await run(["--help"])).stdout).toContain("calmlens listen");
    const directory = await mkdtemp(join(tmpdir(), "calmlens-cli-test-"));
    const projectId = EXAMPLE_IDS.proj;
    const mock = new MockCalmLensServerClient({ apiKey: createMockApiKey(), projectId });
    const asset = await mock.assets.classify({
      name: "text",
      content: { plainText: "Hello", type: "text/plain" },
    });
    let received:
      | { path: string; upload: string | null; body: string; key: string | null }
      | undefined;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        received = {
          path: new URL(request.url).pathname,
          upload: request.headers.get("x-calmlens-upload"),
          body: await request.text(),
          key: request.headers.get("x-api-key"),
        };
        return Response.json(asset);
      },
    });
    try {
      const envFile = join(directory, ".env");
      await Bun.write(
        envFile,
        `CALMLENS_API_KEY=offline-test\nCALMLENS_PROJECT_ID=${projectId}\nCALMLENS_API_URL=${server.url}v1\n`,
      );
      // Exercise the runtime's environment-file loader as well as the SDK transport.
      const result = await run(["trigger", "clean", "--env-file", envFile]);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(asset.id);
      expect(result.stdout).toContain(asset.classification.moderation.status);
      expect(received).toEqual({
        path: `/v1/projects/${projectId}/assets`,
        upload: "content",
        body: "Hello from the CalmLens CLI",
        key: "offline-test",
      });
      const invalid = await run([
        "trigger",
        "unknown",
        "--api-key",
        "offline-test",
        "--project-id",
        projectId,
      ]);
      expect(invalid.exitCode).toBe(1);
      expect(invalid.stderr).toContain("Unknown trigger");

      const credentials = ["--api-key", "offline-test", "--project-id", projectId];
      // Test codes carry the project's secret key, never its ID.
      const missingKey = await run(["trigger", "hate", ...credentials]);
      expect(missingKey.exitCode).toBe(1);
      expect(missingKey.stderr).toContain("--test-key");
      expect(missingKey.stderr).toContain("CALMLENS_TEST_INPUT_KEY");
      const badKey = await run(["trigger", "hate", "--test-key", projectId, ...credentials]);
      expect(badKey.exitCode).toBe(1);
      expect(badKey.stderr).toContain(projectId);

      received = undefined;
      const keyed = await run([
        "trigger",
        "hate",
        "--test-key",
        "5e1f0c2a5e1f0c2a5e1f0c2a5e1f0c2a",
        "--env-file",
        envFile,
      ]);
      expect(keyed.exitCode).toBe(0);
      // `received` is set by the server callback, which TypeScript can't see.
      const keyedBody = (received as { body: string } | undefined)?.body ?? "";
      // The upload is a test input for this key only.
      expect(await detectTestTrigger(keyedBody, "5e1f0c2a5e1f0c2a5e1f0c2a5e1f0c2a")).toEqual({
        instances: [{ category: "hate", qualifiers: [] }],
      });
      expect(await detectTestTrigger(keyedBody, projectId.slice(-8))).toBeUndefined();
    } finally {
      server.stop(true);
      await rm(directory, { recursive: true, force: true });
      await cleanup();
    }
  }, 60_000);
}
