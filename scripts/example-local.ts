import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Runs an SDK example in its offline demo, or against a local CalmLens development instance:
 *
 *   bun scripts/example-local.ts <example> [--dry-run] [--mock] [args passed to the example]
 *
 * `--mock`, or `CALMLENS_EXAMPLE_MODE=mock` (the dev pad's default, switched with its `m` key),
 * starts the example's own dev command in its offline demo mode (`CALMLENS_DEMO=1`), with no
 * credentials and no API.
 *
 * Local mode needs a CalmLens development instance on localhost:6110 (API) and localhost:6130
 * (CDN) with dev sign-in, which only the CalmLens team runs. It signs in to that instance, finds or
 * creates a "<Example> (local)" project, keeps an API key with only the example's grants in
 * `.local/<example>/state.json` (and an upload preset when the example needs one), then starts the
 * example's dev command with its environment variables. Secrets are passed through the child's
 * environment (or an ignored mode-600 file for Wrangler), never through argv or tracked files.
 * To try an example against your own CalmLens project instead, follow its README.
 */

// Fixed loopback origins: this bootstrap must never provision a deployed project.
const api = "http://localhost:6110";
const cdn = "http://localhost:6130";
for (const origin of [api, cdn]) {
  const { hostname } = new URL(origin);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error(`Refusing to provision through ${origin}: only a loopback API is allowed.`);
  }
}

const root = fileURLToPath(new URL("..", import.meta.url));
const examplesDirectory = `${root}examples/`;

type Action =
  | "assets:read"
  | "assets:download"
  | "assets:create"
  | "assets:update"
  | "assets:delete"
  | "assets:share"
  | "folders:read"
  | "folders:create"
  | "folders:update"
  | "folders:delete"
  | "lenses:write";

/** The fields this launcher sets on an upload preset, as the private API accepts them. */
type PresetSettings = {
  access: "token" | "anyone";
  allowedContentTypes: string[];
  maxSizeInBytes: number;
  visibility: "private" | "public";
  processingOptions: { keepContentAfterProcessing: boolean };
  revealDecision: boolean;
  allowedOrigins: string[];
};

type Provisioned = {
  projectId: string;
  keyId: string;
  key: string;
  testInputKey: string;
  uploadPresetId?: string;
};

type Run = {
  cwd: string;
  command: string[];
  env: Record<string, string>;
  /** Extra commands started alongside `command`, such as a token server. */
  companions?: string[][];
  /** Prepared before starting, after provisioning (files, dependency checks). */
  prepare?: () => Promise<void>;
};

type Example = {
  /** The app's name; the project is called "<name> (local)". */
  name: string;
  grants: Action[];
  preset?: PresetSettings;
  run: (credentials: Provisioned, args: string[], stateDirectory: string) => Run;
  /**
   * Environment for the offline demo, on top of `CALMLENS_DEMO=1` (a value of undefined removes a
   * variable), or false for an example without one.
   */
  mock?: false | Record<string, string | undefined>;
  /** The offline demo's command, when it differs from the live one; it skips `prepare`. */
  mockCommand?: (args: string[]) => string[];
};

/** The environment every live example reads: credentials, local URLs and demo mode off. */
const calmlensEnv = (credentials: Provisioned): Record<string, string> => ({
  CALMLENS_API_KEY: credentials.key,
  CALMLENS_PROJECT_ID: credentials.projectId,
  CALMLENS_API_URL: `${api}/v1`,
  CALMLENS_CDN_URL: `${cdn}/v1`,
  CALMLENS_DEMO: "0",
});

/** Homebrew's Ruby, ahead of macOS's Ruby 2.6, which can't run the Ruby SDK. */
const rubyPath = () =>
  ["/opt/homebrew/opt/ruby/bin", "/usr/local/opt/ruby/bin"]
    .filter((directory) => existsSync(directory))
    .concat(process.env.PATH ?? "")
    .join(":");

/** Resolves the executable on the child's own PATH, which may differ from the launcher's. */
const resolveCommand = (
  [executable, ...rest]: string[],
  env: Record<string, string | undefined>,
) => [Bun.which(executable!, { PATH: env.PATH ?? "" }) ?? executable!, ...rest];

const run = async (command: string[], options: { cwd: string; env?: Record<string, string> }) => {
  const env = { ...process.env, ...options.env };
  const child = Bun.spawn(resolveCommand(command, env), {
    cwd: options.cwd,
    env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
};

/** Calmgram's Worker, always on 127.0.0.1:6408. */
const calmgramDev = ["bun", "x", "wrangler", "dev", "--ip", "127.0.0.1", "--port", "6408"];

export const examples: Record<string, Example> = {
  calmgram: {
    name: "Calmgram",
    // Its demo runs Wrangler with CALMLENS_DEMO as a Worker var, without the secrets file.
    mock: {},
    mockCommand: (args) => [...calmgramDev, "--var", "CALMLENS_DEMO:1", ...args],
    grants: [
      "assets:read",
      "assets:download",
      "assets:create",
      "assets:update",
      "assets:delete",
      "assets:share",
      "lenses:write",
    ],
    run: (credentials, args, stateDirectory) => {
      // Wrangler loads Worker vars from a file, so they go in an ignored local-only one.
      const varsFile = `${stateDirectory}worker.vars`;
      return {
        cwd: `${examplesDirectory}calmgram`,
        command: [...calmgramDev, "--env-file", varsFile, ...args],
        env: {},
        prepare: () =>
          writeFile(
            varsFile,
            Object.entries({
              ...calmlensEnv(credentials),
              CALMLENS_TEST_INPUT_KEY: credentials.testInputKey,
            })
              .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
              .join("\n"),
            { mode: 0o600 },
          ),
      };
    },
  },
  "chirp-php": {
    name: "Chirp",
    // The demo keeps its own data in the example's var/ folder.
    mock: { CHIRP_DEMO: "1", CHIRP_DATA_DIR: undefined },
    // Text and image moderation, public images, deletion and the chirp-feed lens.
    grants: ["assets:read", "assets:create", "assets:delete", "assets:share", "lenses:write"],
    run: (credentials, args, stateDirectory) => ({
      cwd: `${examplesDirectory}chirp-php`,
      command: ["composer", "start", ...args],
      // Live local data stays apart from the demo's var/ folder.
      env: { ...calmlensEnv(credentials), CHIRP_DEMO: "0", CHIRP_DATA_DIR: `${stateDirectory}var` },
    }),
  },
  "comment-thread-ruby": {
    name: "Calmthread",
    // Text moderation, review decisions from the events feed and deleting held content.
    grants: ["assets:read", "assets:create", "assets:delete"],
    run: (credentials, args) => {
      const cwd = `${examplesDirectory}comment-thread-ruby`;
      const env = { ...calmlensEnv(credentials), PATH: rubyPath(), BUNDLE_FROZEN: "true" };
      return {
        cwd,
        command: ["bundle", "exec", "ruby", "app.rb", ...args],
        env,
        prepare: async () => {
          if ((await run(["bundle", "check"], { cwd, env })) === 0) return;
          if ((await run(["bundle", "install"], { cwd, env })) !== 0) {
            throw new Error("bundle install failed for comment-thread-ruby.");
          }
        },
      };
    },
  },
  "link-board-python": {
    name: "Calmboard",
    // Note moderation, URL submissions, reading pages and their parts, and removal.
    grants: ["assets:read", "assets:create", "assets:delete"],
    run: (credentials, args) => ({
      cwd: `${examplesDirectory}link-board-python`,
      // The SDK has no runtime dependencies, so it runs from source without a virtualenv.
      command: ["python3", "app.py", ...args],
      env: {
        ...calmlensEnv(credentials),
        PYTHONPATH: `${root}python`,
        PYTHONDONTWRITEBYTECODE: "1",
      },
    }),
  },
  "marketplace-listing-java": {
    name: "Calmmarket",
    // Listing moderation, private photos with signed lens URLs, withdrawal and the events feed.
    grants: ["assets:read", "assets:create", "assets:delete", "assets:share", "lenses:write"],
    run: (credentials, args) => ({
      cwd: `${examplesDirectory}marketplace-listing-java`,
      command: [
        "mvn",
        "-q",
        "compile",
        "exec:java",
        ...(args.length ? [`-Dexec.args=${args.join(" ")}`] : []),
      ],
      env: calmlensEnv(credentials),
    }),
  },
  "media-library-rust": {
    name: "Calmlibrary",
    // Folders, uploads with metadata, signed lens URLs, content deletion and removal.
    grants: [
      "assets:read",
      "assets:create",
      "assets:update",
      "assets:delete",
      "assets:share",
      "folders:read",
      "folders:create",
      "folders:update",
      "folders:delete",
      "lenses:write",
    ],
    run: (credentials, args) => ({
      cwd: `${examplesDirectory}media-library-rust`,
      command: ["cargo", "run", ...(args.length ? ["--", ...args] : [])],
      env: calmlensEnv(credentials),
    }),
  },
  "voice-clips-go": {
    name: "Calmclips",
    // Signing upload tokens, retrieving, retrying and deleting clips, and signed playback URLs.
    grants: ["assets:read", "assets:create", "assets:update", "assets:delete", "assets:share"],
    preset: {
      access: "token",
      allowedContentTypes: ["audio/*", "video/*"],
      maxSizeInBytes: 50 * 1024 * 1024,
      visibility: "private",
      processingOptions: { keepContentAfterProcessing: true },
      revealDecision: false,
      allowedOrigins: ["http://127.0.0.1:6402"],
    },
    run: (credentials) => ({
      cwd: `${examplesDirectory}voice-clips-go`,
      // The app always listens on 127.0.0.1:6402.
      command: ["go", "run", "."],
      env: {
        ...calmlensEnv(credentials),
        CALMLENS_UPLOAD_PRESET_ID: credentials.uploadPresetId ?? "",
      },
    }),
  },
  "widget-playground": {
    name: "Widget playground",
    // Signing upload tokens for a public preset, which needs the share permission too.
    grants: ["assets:create", "assets:share"],
    preset: {
      access: "token",
      allowedContentTypes: ["image/*", "video/*", "audio/*"],
      maxSizeInBytes: 25 * 1024 * 1024,
      visibility: "public",
      processingOptions: { keepContentAfterProcessing: true },
      revealDecision: true,
      allowedOrigins: ["http://localhost:6410"],
    },
    // Without credentials the playground answers the upload API and CDN with the SDK's mocks.
    mock: {},
    run: (credentials, args) => ({
      cwd: `${examplesDirectory}widget-playground`,
      command: ["bun", "run", "dev", "--port", "6410", "--strictPort", ...args],
      env: {
        ...calmlensEnv(credentials),
        CALMLENS_UPLOAD_PRESET_ID: credentials.uploadPresetId ?? "",
      },
    }),
  },
  "mobile-uploads-expo": {
    name: "Mobile uploads",
    mock: false,
    // The token server signs upload tokens; uploads need assets:create in the preset's folder.
    grants: ["assets:create"],
    preset: {
      access: "token",
      allowedContentTypes: ["image/*"],
      maxSizeInBytes: 20 * 1024 * 1024,
      visibility: "private",
      processingOptions: { keepContentAfterProcessing: false },
      revealDecision: true,
      // Mobile apps send no Origin header, so the preset must not list allowed sites.
      allowedOrigins: [],
    },
    run: (credentials, args) => {
      const cwd = `${examplesDirectory}mobile-uploads-expo`;
      return {
        cwd,
        // Metro inlines EXPO_PUBLIC_ values into the app; only the preset ID and API URL are public.
        command: ["bun", "x", "expo", ...(args.length ? args : ["start", "--port", "8081"])],
        env: {
          CALMLENS_API_KEY: credentials.key,
          CALMLENS_PROJECT_ID: credentials.projectId,
          CALMLENS_UPLOAD_PRESET_ID: credentials.uploadPresetId ?? "",
          // The iOS Simulator reaches the Mac at 127.0.0.1.
          EXPO_PUBLIC_CALMLENS_BASE_URL: "http://127.0.0.1:6110/v1",
          EXPO_PUBLIC_CALMLENS_UPLOAD_PRESET_ID: credentials.uploadPresetId ?? "",
          EXPO_PUBLIC_TOKEN_SERVER_URL: "http://127.0.0.1:6411/upload-token",
        },
        // The token server on 127.0.0.1:6411.
        companions: [["bun", "run", "server"]],
      };
    },
  },
};

const waitForApi = async () => {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const response = await fetch(`${api}/v1/health-check`, {
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
    } catch {}
    if (Date.now() > deadline) {
      throw new Error(
        `The local CalmLens API at ${api} isn't answering. Local mode needs a CalmLens development instance; switch the dev pad to mock mode with m.`,
      );
    }
    await Bun.sleep(1_000);
  }
};

type SavedState = { projectId: string; keyId: string; key: string; grants?: Action[] };

/** Finds or creates the example's local project, key and upload preset. */
export async function provisionLocalExample(id: string): Promise<Provisioned> {
  const example = examples[id];
  if (!example) throw new Error(`Unknown example ${id}.`);
  const projectName = `${example.name} (local)`;
  const stateDirectory = `${root}.local/${id}/`;
  const stateFile = `${stateDirectory}state.json`;

  await waitForApi();
  const signIn = await fetch(`${api}/internal/v1/auth/dev-sign-in`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!signIn.ok)
    throw new Error(
      `Local dev sign-in failed (${signIn.status}). Local mode needs a CalmLens development instance.`,
    );
  const cookie = signIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const request = async <T>(path: string, body?: unknown, method?: string): Promise<T> => {
    const response = await fetch(`${api}/internal/v1${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Local CalmLens ${path} failed (${response.status}).`);
    return response.json() as Promise<T>;
  };
  const find = async <T>(path: string, match: (item: T) => boolean): Promise<T | undefined> => {
    for (let pageIndex = 0; ; pageIndex++) {
      const page = await request<{ items: T[]; hasMore: boolean }>(
        `${path}?pageIndex=${pageIndex}&pageSize=100`,
      );
      const item = page.items.find(match);
      if (item || !page.hasMore) return item;
    }
  };

  type Project = { id: string; name: string; testInputKey?: string | null };
  const project =
    (await find<Project>("/projects/page", (item) => item.name === projectName)) ??
    (
      await request<{ project: Project }>("/projects", {
        name: projectName,
        description: `Automatically provisioned for the local ${example.name} example.`,
      })
    ).project;

  let uploadPresetId: string | undefined;
  if (example.preset) {
    const presetName = `${example.name} local uploads`;
    const settings = { name: presetName, enabled: true, folderId: null, ...example.preset };
    const existing = await find<{ id: string; name: string }>(
      `/projects/${project.id}/upload-presets/page`,
      (item) => item.name === presetName,
    );
    // Updating an existing preset keeps it in line with the settings above.
    uploadPresetId = existing
      ? (await request<{ id: string }>(`/upload-presets/${existing.id}`, settings, "PATCH")).id
      : (await request<{ id: string }>(`/projects/${project.id}/upload-presets`, settings)).id;
  }

  let saved: SavedState | undefined;
  try {
    saved = JSON.parse(await readFile(stateFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const sameGrants = (grants?: Action[]) =>
    // State written before grants were recorded belongs to Calmgram's original key.
    grants === undefined
      ? id === "calmgram"
      : [...grants].sort().join() === [...example.grants].sort().join();
  let credentials: SavedState | undefined;
  if (saved?.projectId === project.id && sameGrants(saved.grants)) {
    const key = await find<{ id: string; status: string }>(
      `/projects/${project.id}/api-keys`,
      (item) => item.id === saved?.keyId && item.status === "active",
    );
    if (key) credentials = { ...saved, grants: example.grants };
  }
  if (!credentials) {
    const { apiKey } = await request<{ apiKey: { id: string; key: string } }>(
      `/projects/${project.id}/api-keys`,
      {
        name: `${example.name} local development`,
        role: "custom",
        grants: [{ actions: example.grants, folderId: null, includeSubfolders: true }],
      },
    );
    credentials = {
      projectId: project.id,
      keyId: apiKey.id,
      key: apiKey.key,
      grants: example.grants,
    };
  }
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await writeFile(stateFile, JSON.stringify(credentials), { mode: 0o600 });
  return {
    projectId: credentials.projectId,
    keyId: credentials.keyId,
    key: credentials.key,
    testInputKey: project.testInputKey ?? "",
    uploadPresetId,
  };
}

if (import.meta.main) {
  const [id, ...rest] = process.argv.slice(2);
  const example = id ? examples[id] : undefined;
  if (!id || !example) {
    process.stderr.write(
      `Usage: bun scripts/example-local.ts <example> [--dry-run] [args]\nExamples: ${Object.keys(examples).join(", ")}\n`,
    );
    process.exit(2);
  }
  const dryRun = rest[0] === "--dry-run";
  const mock = rest.includes("--mock") || process.env.CALMLENS_EXAMPLE_MODE === "mock";
  const args = (dryRun ? rest.slice(1) : rest).filter((arg) => arg !== "--mock");
  const stateDirectory = `${root}.local/${id}/`;
  if (mock && example.mock === false) {
    process.stderr.write(
      `${example.name} has no offline demo mode; switch the dev pad to local.\n`,
    );
    process.exit(2);
  }

  const credentials: Provisioned =
    dryRun || mock
      ? {
          projectId: "<project-id>",
          keyId: "<key-id>",
          key: "<api-key>",
          testInputKey: "<test-input-key>",
          uploadPresetId: example.preset ? "<upload-preset-id>" : undefined,
        }
      : await provisionLocalExample(id);
  const livePlan = example.run(credentials, args, stateDirectory);
  const plan: Run =
    mock && !dryRun && example.mockCommand
      ? { ...livePlan, command: example.mockCommand(args), prepare: undefined }
      : livePlan;
  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          project: `${example.name} (local)`,
          grants: example.grants,
          preset: example.preset,
          cwd: plan.cwd,
          command: plan.command,
          companions: plan.companions,
          env: Object.keys(plan.env),
        },
        null,
        2,
      )}\n`,
    );
    process.exit(0);
  }

  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await plan.prepare?.();
  let env: Record<string, string | undefined> = { ...process.env, ...plan.env };
  if (mock) {
    // No credentials or local URLs reach the demo, which refuses to start with them.
    env = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("CALMLENS_")));
    Object.assign(env, { CALMLENS_DEMO: "1" }, example.mock);
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
    process.stdout.write(`${example.name} is running its offline demo (mock mode).\n`);
  } else {
    process.stdout.write(
      `${example.name} is using the ${example.name} (local) project on ${api}.\n`,
    );
    if (credentials.uploadPresetId)
      process.stdout.write(`Upload preset: ${credentials.uploadPresetId}\n`);
  }
  const children = [
    ...(plan.companions ?? []).map((command) =>
      Bun.spawn(resolveCommand(command, env), {
        cwd: plan.cwd,
        env,
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      }),
    ),
    // The main command keeps stdin, so interactive dev servers (Expo's i/a keys) still work.
    Bun.spawn(resolveCommand(plan.command, env), {
      cwd: plan.cwd,
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  ];
  // Wrappers such as `go run` and `composer start` don't pass signals on to the server they start,
  // so every process under each child is signalled, deepest first.
  const descendants = (pid: number): number[] =>
    Bun.spawnSync(["pgrep", "-P", String(pid)])
      .stdout.toString()
      .split("\n")
      .filter(Boolean)
      .flatMap((child) => [...descendants(Number(child)), Number(child)]);
  const stop = (signal: NodeJS.Signals) => {
    for (const child of children) {
      if (child.exitCode !== null) continue;
      for (const pid of descendants(child.pid)) {
        try {
          process.kill(pid, signal);
        } catch {}
      }
      child.kill(signal);
    }
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  // When any process exits, stop the others and exit with its code.
  const code = await Promise.race(children.map((child) => child.exited));
  stop("SIGTERM");
  await Promise.all(children.map((child) => child.exited));
  process.exit(code);
}
