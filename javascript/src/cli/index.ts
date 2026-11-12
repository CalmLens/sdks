import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { version } from "../../package.json";
import { CLASSIFICATION_CATEGORIES } from "../contract/ModerationCategories.js";
import { CalmLensError, CalmLensServerClient } from "../server";
import { generateTestTextCode, TEST_INPUT_KEY_PATTERN } from "../test-inputs";
import {
  applyConfiguration,
  ConfigurationError,
  formatPlan,
  parseConfiguration,
  planConfiguration,
  readConfigurationState,
} from "./configuration";
import { createLocalSigningSecret, describeEventTypes, listen, unavailableWarning } from "./listen";
import {
  credentialsPath,
  DEFAULT_API_URL,
  login,
  logout,
  PROFILE_PATTERN,
  readCredentials,
} from "./login";

const HELP = `CalmLens CLI

Usage:
  calmlens login [--read-only] [--no-browser] [--profile <name>]
  calmlens logout [--profile <name>]
  calmlens listen --forward-to <url> [options]
  calmlens trigger [sexual|violence|self-harm|harassment|hate|criminal-activity|clean] [options]
  calmlens plan [--config <path>] [--prune] [--detailed-exitcode]
  calmlens apply [--config <path>] [--prune]

Install it with \`brew install calmlens/sdks/calmlens\` (after
\`brew tap calmlens/sdks https://github.com/CalmLens/sdks\`), the install script at
https://calmlens.com/install.sh, a download from https://github.com/CalmLens/sdks/releases,
or \`npm install -g calmlens\`. See https://calmlens.com/docs/guides/local-development.

Commands:
  login     Sign in through your browser and choose a project. The CLI keeps the key it
            receives, so listen and trigger need no API key or project ID.
  logout    Revoke and forget the key from login.
  listen    Forward your project's events to a local webhook handler with the same flat
            body (id, projectId, actor, type, severity, title, description, assetId,
            assetSequence, asset, facts, createdAt) and headers (x-calmlens-delivery,
            x-calmlens-timestamp, x-calmlens-signature: v1=...) as real deliveries. No
            public URL needed. Like real deliveries, network errors, timeouts, 408, 425, 429
            and 5xx responses are retried, up to 7 attempts with the same delivery ID, here
            after 1, 2, 4, 8, 15 and 30 seconds (longer if Retry-After asks, up to 60).
  trigger   Moderate a harmless test comment so CalmLens creates real events. Each trigger
            counts as one upload. Test comments other than clean are signed with the
            project's test input key (Project settings → Test inputs in the portal).
  plan      Compare calmlens.config.json with the project: its policies (by name, with the
            project's policy), upload presets (by key), lenses (by identifier), metadata
            fields (by ID) and settings. Prints what apply would change and changes nothing.
  apply     Make the changes plan prints. Each is sent with the revision just read, so a
            change made meanwhile in the portal or by another deploy is refused, not lost.
            See https://calmlens.com/docs/guides/configuration-as-code.

Options:
  --forward-to <url>     Local webhook URL, e.g. http://localhost:3000/api/webhooks/calmlens
  --events <types>       Comma-separated event types to forward (default: all)
  --secret <secret>      Signing secret (default: $CALMLENS_WEBHOOK_SECRET, or a generated one)
  --api-key <key>        Project API key (default: $CALMLENS_API_KEY, then your login)
  --project-id <id>      Project ID (default: $CALMLENS_PROJECT_ID, then your login)
  --read-only            For login: only allow the CLI to read
  --no-browser           For login: print the link instead of opening it
  --test-key <key>       Project's test input key, for trigger (default: $CALMLENS_TEST_INPUT_KEY)
  --env-file <path>      Load environment variables from a file, e.g. .env.local
  --interval <seconds>   Seconds between checks for new events (default: 2)
  --config <path>        For plan and apply: the configuration file (default: calmlens.config.json)
  --prune                For plan and apply: also delete upload presets, lenses and metadata
                         fields the file doesn't list (never policies)
  --api-url <url>        API base URL (default: $CALMLENS_BASE_URL or https://api.calmlens.com/v1)
  --profile <name>       Use, or sign in to, a named login, so several projects can be signed in
                         at once (default: $CALMLENS_PROFILE, else the default login)
  --json                 For listen, trigger, plan and apply: print JSON on stdout (listen: one
                         line per delivery attempt) and messages on stderr
  --detailed-exitcode    For plan: exit 0 with no changes, 2 with changes and 1 on an error
  --log-level <level>    Log the CLI's API requests to stderr: off, info (retries and failures)
                         or debug (every request) (default: $CALMLENS_LOG, else off)
  -v, --version          Show the CLI version
  -h, --help             Show this help
`;

const TRIGGER_KINDS = [...CLASSIFICATION_CATEGORIES, "clean"] as const;

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const LOG_LEVELS = ["off", "info", "debug"] as const;
type CliLogLevel = (typeof LOG_LEVELS)[number];

/** API request logs go to stderr, so stdout stays the command's output (and `--json`'s). */
const stderrLogger = {
  debug: (message: string) => process.stderr.write(`${message}\n`),
  info: (message: string) => process.stderr.write(`${message}\n`),
};

const printJson = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

const describeError = (error: unknown) => {
  if (error instanceof CalmLensError) {
    return `${error.message.replace(/^\[calmlens\] /, "")} (${error.code})`;
  }
  return error instanceof Error ? error.message : String(error);
};

const main = async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "forward-to": { type: "string" },
      events: { type: "string" },
      secret: { type: "string" },
      "api-key": { type: "string" },
      "project-id": { type: "string" },
      "test-key": { type: "string" },
      "env-file": { type: "string" },
      interval: { type: "string" },
      "api-url": { type: "string" },
      "read-only": { type: "boolean" },
      config: { type: "string" },
      prune: { type: "boolean" },
      "no-browser": { type: "boolean" },
      profile: { type: "string" },
      json: { type: "boolean" },
      "detailed-exitcode": { type: "boolean" },
      "log-level": { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) {
    process.stdout.write(`${version}\n`);
    return;
  }
  const [command, argument] = positionals;

  if (values.help || !command || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (values["env-file"]) {
    try {
      process.loadEnvFile(values["env-file"]);
    } catch {
      fail(`Couldn't read ${values["env-file"]}.`);
    }
  }

  const json = Boolean(values.json);
  // Human-readable messages go to stderr with --json, so stdout holds only JSON.
  const say = (text: string) => (json ? process.stderr : process.stdout).write(text);
  const profile = values.profile ?? (process.env.CALMLENS_PROFILE?.trim() || undefined);
  if (profile !== undefined && !PROFILE_PATTERN.test(profile)) {
    fail(`"${profile}" isn't a profile name: use letters, digits, - and _, up to 64 characters.`);
  }
  const logLevel = (values["log-level"] ?? process.env.CALMLENS_LOG?.trim().toLowerCase()) as
    | CliLogLevel
    | undefined;
  if (logLevel !== undefined && !LOG_LEVELS.includes(logLevel)) {
    fail(`--log-level must be one of ${LOG_LEVELS.join(", ")}.`);
  }

  if (command === "login") {
    try {
      const credentials = await login({
        profile,
        apiUrl: values["api-url"] ?? process.env.CALMLENS_BASE_URL ?? DEFAULT_API_URL,
        readOnly: Boolean(values["read-only"]),
        openBrowser: !values["no-browser"],
        write: (text) => process.stdout.write(text),
      });
      process.stdout.write(
        `Signed in to project ${credentials.projectId}. Saved to ${credentialsPath(profile)}.\n`,
      );
    } catch (error) {
      fail(`Sign-in failed: ${describeError(error)}`);
    }
    return;
  }
  if (command === "logout") {
    const result = await logout(profile);
    process.stdout.write(
      result === "revoked"
        ? "Signed out and revoked the key.\n"
        : result === "forgotten"
          ? "Signed out here, but CalmLens couldn't be reached: revoke the key in the portal under API keys.\n"
          : "You're not signed in.\n",
    );
    return;
  }

  // An explicit key or project wins; otherwise the login's key, project and API URL go together.
  const explicitKey = values["api-key"] ?? process.env.CALMLENS_API_KEY;
  const explicitProject = values["project-id"] ?? process.env.CALMLENS_PROJECT_ID;
  const stored = explicitKey || explicitProject ? undefined : await readCredentials(profile);
  if (profile !== undefined && !stored && !(explicitKey && explicitProject)) {
    fail(`No login for profile "${profile}". Run \`calmlens login --profile ${profile}\`.`);
  }
  const apiKey = explicitKey ?? stored?.apiKey;
  const projectId = explicitProject ?? stored?.projectId;
  if (!apiKey || !projectId) {
    fail(
      "Run `calmlens login`, or set CALMLENS_API_KEY and CALMLENS_PROJECT_ID (or pass --api-key and --project-id).\n" +
        "Both are on the Developer → API Keys page of the CalmLens portal.",
    );
  }
  const baseUrl = values["api-url"] ?? process.env.CALMLENS_BASE_URL ?? stored?.apiUrl;
  const client = new CalmLensServerClient({
    apiKey: apiKey as string,
    projectId: projectId as string,
    ...(baseUrl ? { baseUrl } : {}),
    logLevel: logLevel ?? "off",
    logger: stderrLogger,
  });

  if (command === "listen") {
    const forwardTo = values["forward-to"];
    if (!forwardTo)
      fail("listen needs --forward-to <url>, e.g. http://localhost:3000/api/webhooks/calmlens");
    const intervalSeconds = Number(values.interval ?? 2);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1)
      fail("--interval must be at least 1 second.");

    const configuredSecret = values.secret ?? process.env.CALMLENS_WEBHOOK_SECRET;
    const secret = configuredSecret ?? createLocalSigningSecret();
    const eventTypes = values.events
      ?.split(",")
      .map((type) => type.trim())
      .filter(Boolean);

    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    process.once("SIGTERM", () => controller.abort());

    try {
      await listen({
        client,
        forwardTo: forwardTo as string,
        secret,
        eventTypes,
        intervalMs: intervalSeconds * 1000,
        signal: controller.signal,
        ...(json && {
          // Each attempt is a JSON line on stdout; the readable lines move to stderr.
          log: (line: string) => process.stderr.write(`${line}\n`),
          onDelivery: printJson,
        }),
        // Printed only once CalmLens has accepted the key, so a bad key fails without it.
        onReady: ({ unavailableTypes }) => {
          if (json) printJson({ type: "ready", projectId, forwardTo, unavailableTypes });
          say(
            [
              `Forwarding CalmLens events for project ${projectId} to ${forwardTo}`,
              configuredSecret
                ? "Signing with your CALMLENS_WEBHOOK_SECRET."
                : `Signing secret: ${secret}\n  Set CALMLENS_WEBHOOK_SECRET to this value in your app, or pass --secret.`,
              describeEventTypes(eventTypes, unavailableTypes),
              "Upload something (or run `calmlens trigger`) to see events. Press Ctrl+C to stop.",
              "",
            ].join("\n"),
          );
          if (unavailableTypes.length) process.stderr.write(unavailableWarning(unavailableTypes));
        },
      });
    } catch (error) {
      fail(
        error instanceof CalmLensError
          ? `CalmLens rejected the request: ${describeError(error)}`
          : `Couldn't reach CalmLens: ${describeError(error)}`,
      );
    }
    return;
  }

  if (command === "trigger") {
    const kind = (argument ?? "harassment") as (typeof TRIGGER_KINDS)[number];
    if (!TRIGGER_KINDS.includes(kind))
      fail(`Unknown trigger "${kind}". Use one of: ${TRIGGER_KINDS.join(", ")}.`);
    let text = "Hello from the CalmLens CLI";
    if (kind !== "clean") {
      const testInputKey = (values["test-key"] ?? process.env.CALMLENS_TEST_INPUT_KEY)?.trim();
      if (!testInputKey)
        fail(
          `trigger ${kind} needs your project's test input key: pass --test-key <key> or set CALMLENS_TEST_INPUT_KEY.\n` +
            "Copy it from Project settings → Test inputs in the CalmLens portal.",
        );
      if (!TEST_INPUT_KEY_PATTERN.test(testInputKey as string))
        fail(
          `"${testInputKey}" isn't a test input key: it is 32 lowercase hexadecimal characters.\n` +
            "Copy it from Project settings → Test inputs in the CalmLens portal.",
        );
      text = await generateTestTextCode(kind, testInputKey as string);
    }
    try {
      const asset = await client.assets.classify({
        name: `cli-trigger-${kind}`,
        content: { plainText: text, type: "text/plain" },
      });
      if (json) printJson(asset);
      else
        process.stdout.write(
          `Created asset ${asset.id}: ${asset.classification.moderation.decision}.\n`,
        );
    } catch (error) {
      fail(`Trigger failed: ${describeError(error)}`);
    }
    return;
  }

  if (command === "plan" || command === "apply") {
    const path = values.config ?? "calmlens.config.json";
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      return fail(`Couldn't read ${path}. Pass --config <path> to use another file.`);
    }
    try {
      const config = parseConfiguration(text, path);
      const state = await readConfigurationState(client, config);
      const plan = planConfiguration(config, state, { prune: Boolean(values.prune) });
      say(formatPlan(plan));
      const applying = command === "apply" && plan.changes.length > 0;
      if (applying) {
        await applyConfiguration(client, config, state, plan, (line) => say(`${line}\n`));
        say("Applied.\n");
      }
      if (json) printJson({ changes: plan.changes, unchanged: plan.unchanged, applied: applying });
      // As Terraform's -detailed-exitcode: 2 says the plan has changes.
      if (command === "plan" && values["detailed-exitcode"] && plan.changes.length) {
        process.exitCode = 2;
      }
    } catch (error) {
      if (error instanceof CalmLensError && error.code.endsWith("/revision-conflict"))
        fail(
          `${describeError(error)}\nSomething changed since it was read. Run \`calmlens ${command}\` again to see the latest differences.`,
        );
      fail(
        error instanceof ConfigurationError
          ? error.message
          : `${command === "apply" ? "Apply" : "Plan"} failed: ${describeError(error)}`,
      );
    }
    return;
  }

  fail(`Unknown command "${command}".\n\n${HELP}`);
};

main().catch((error) => fail(describeError(error)));
