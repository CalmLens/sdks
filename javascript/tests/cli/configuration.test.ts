import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyConfiguration,
  ConfigurationError,
  type ConfigurationFile,
  parseConfiguration,
  planConfiguration,
  readConfigurationState,
} from "../../src/cli/configuration";
import { EXAMPLE_IDS } from "../../src/contract/Ids.js";
import { CalmLensError } from "../../src/server";
import { createMockApiKey, MockCalmLensServerClient } from "../../src/testing";

const newClient = () =>
  new MockCalmLensServerClient({ apiKey: createMockApiKey(), projectId: EXAMPLE_IDS.proj });

const config: ConfigurationFile = {
  policies: { "Kids section": { presetId: "children-platform" } },
  policy: "Kids section",
  uploadPresets: {
    avatars: { name: "Avatars", allowedContentTypes: ["image/*"], policy: "Kids section" },
    feedback: { name: "Feedback", access: "anyone", dailyUploadLimit: 20 },
  },
  lenses: { card: { name: "Card", transform: { width: 640, format: "webp" } } },
  metadataFields: {
    userId: { title: "User", type: "string", icon: "user", color: "#2563eb" },
  },
  settings: { blockUnmoderatedAssets: false },
};

const apply = async (client: MockCalmLensServerClient, file: ConfigurationFile, prune = false) => {
  const state = await readConfigurationState(client, file);
  const plan = planConfiguration(file, state, { prune });
  await applyConfiguration(client, file, state, plan);
  return plan;
};

test("apply makes what the file lists, then plan finds nothing to change", async () => {
  const client = newClient();
  const first = planConfiguration(config, await readConfigurationState(client, config));
  expect(first.changes.map(({ kind, action, name }) => `${action} ${kind} ${name}`)).toEqual([
    "create policy Kids section",
    "update assignment Kids section",
    "create metadataField userId",
    "update settings settings",
    "create lens card",
    "create uploadPreset avatars",
    "create uploadPreset feedback",
  ]);

  await apply(client, config);

  const kids = (await client.policies.retrieveAssigned()).id;
  expect((await client.policies.retrieveAssigned()).name).toBe("Kids section");
  const presets = (await client.uploadPresets.list()).items;
  expect(presets.map(({ key, policyId }) => [key, policyId])).toEqual([
    ["avatars", kids],
    ["feedback", null],
  ]);
  expect((await client.lenses.list()).items.map(({ identifier }) => identifier)).toEqual(["card"]);
  expect((await client.metadataFields.list()).fields.map(({ id }) => id)).toEqual(["userId"]);
  expect((await client.projectSettings.get()).settings.blockUnmoderatedAssets).toBe(false);

  const again = planConfiguration(config, await readConfigurationState(client, config));
  expect(again.changes).toEqual([]);
  expect(again.unchanged).toBe(7);
});

test("a changed file updates only what differs, and prune deletes only when asked", async () => {
  const client = newClient();
  await apply(client, config);
  const changed: ConfigurationFile = {
    ...config,
    uploadPresets: { avatars: { ...config.uploadPresets!.avatars!, name: "Profile pictures" } },
    lenses: {},
  };

  const kept = await apply(client, changed);
  expect(
    kept.changes.map(({ action, kind, name, fields }) => [action, kind, name, fields]),
  ).toEqual([["update", "uploadPreset", "avatars", ["name"]]]);
  expect((await client.uploadPresets.list()).items.map(({ key }) => key)).toEqual([
    "avatars",
    "feedback",
  ]);
  expect((await client.uploadPresets.list()).items[0]).toMatchObject({
    name: "Profile pictures",
    revision: 2,
  });

  await apply(client, changed, true);
  expect((await client.uploadPresets.list()).items.map(({ key }) => key)).toEqual(["avatars"]);
  expect((await client.lenses.list()).items).toEqual([]);
  // Policies are never pruned: other projects may use them.
  expect((await client.policies.list()).items.map(({ name }) => name)).toContain("Kids section");
});

test("apply refuses a change made after the project was read", async () => {
  const client = newClient();
  await apply(client, config);
  const changed: ConfigurationFile = {
    uploadPresets: { avatars: { name: "From the file" } },
    settings: { blockUnmoderatedAssets: true },
  };
  const state = await readConfigurationState(client, changed);
  const plan = planConfiguration(changed, state);
  // Someone saves in the meantime.
  await client.uploadPresets.ensure({
    uploadPresets: [{ key: "avatars", name: "From the portal" }],
  });

  const error = await applyConfiguration(client, changed, state, plan).catch((caught) => caught);
  expect(error).toBeInstanceOf(CalmLensError);
  expect((error as CalmLensError).code).toBe("upload-preset/revision-conflict");
  expect((await client.uploadPresets.list()).items[0]?.name).toBe("From the portal");
});

test("the file must name known sections and policies", async () => {
  expect(() => parseConfiguration('{"presets": {}}')).toThrow(ConfigurationError);
  expect(() => parseConfiguration("[]")).toThrow(ConfigurationError);
  expect(() => parseConfiguration('{"policies": {"Empty": {}}}')).toThrow(ConfigurationError);
  const file = { uploadPresets: { avatars: { name: "A", policy: "Missing" } } };
  const state = await readConfigurationState(newClient(), file);
  expect(() => planConfiguration(file, state)).toThrow(ConfigurationError);
});

test("the CLI's plan prints the differences and changes nothing", async () => {
  const { buildCli } = await import("./build");
  const { command, cleanup } = await buildCli("node");
  const directory = await mkdtemp(join(tmpdir(), "calmlens-plan-test-"));
  const requests: string[] = [];
  const settings = {
    projectId: EXAMPLE_IDS.proj,
    revision: 1,
    settings: { blockUnmoderatedAssets: true },
  };
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      requests.push(`${request.method} ${pathname}`);
      if (pathname.endsWith("/settings")) return Response.json(settings);
      if (pathname.endsWith("/metadata-fields"))
        return Response.json({ projectId: EXAMPLE_IDS.proj, revision: 1, fields: [] });
      if (pathname.endsWith("/policy")) return Response.json({ id: "pol_1", name: "General" });
      return Response.json({ items: [], hasMore: false, nextCursor: null });
    },
  });
  try {
    const file = join(directory, "calmlens.config.json");
    await Bun.write(file, JSON.stringify({ settings: { blockUnmoderatedAssets: false } }));
    const process = Bun.spawn([...command, "plan", "--config", file], {
      env: {
        PATH: Bun.env.PATH ?? "",
        CALMLENS_API_KEY: "offline-test",
        CALMLENS_PROJECT_ID: EXAMPLE_IDS.proj,
        CALMLENS_API_URL: `${server.url}v1`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      process.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("project settings (blockUnmoderatedAssets)");
    // A file listing only settings reads and changes nothing else, so a narrow key is enough.
    expect(requests).toEqual([`GET /v1/projects/${EXAMPLE_IDS.proj}/settings`]);
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
    await cleanup();
  }
}, 120_000);
