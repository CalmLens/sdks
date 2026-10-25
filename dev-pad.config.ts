import { fileURLToPath } from "node:url";
import { defineConfig, type Service } from "dev-pad";
import { expo } from "dev-pad/expo";

const exampleCommand = (id: string) => ["bun", "scripts/example-local.ts", id];

/**
 * Whether the examples run their offline demos or against a local CalmLens development instance,
 * which only the CalmLens team runs (see scripts/example-local.ts). Press `m` to switch;
 * `CALMLENS_EXAMPLE_MODE=local` starts the dashboard in local mode.
 */
let exampleMode: "local" | "mock" =
  process.env.CALMLENS_EXAMPLE_MODE === "local" ? "local" : "mock";
/** The examples running now, which a mode switch restarts. */
const runningExamples = new Set<string>();

/**
 * An example, started on demand through scripts/example-local.ts, which runs its offline demo in
 * mock mode, or provisions it on the local instance and waits for that instance in local mode.
 */
const example = (
  id: string,
  name: string,
  ports: number[],
  url?: string,
  args: string[] = [],
  { mock = true } = {},
): Service => ({
  id,
  name,
  command: [...exampleCommand(id), ...args],
  ports,
  url,
  autostart: false,
  // Read at every start, so a restart picks up the current mode.
  env: () => ({ CALMLENS_EXAMPLE_MODE: mock ? exampleMode : "local" }),
  start: async () => {
    runningExamples.add(id);
  },
  stop: async () => {
    runningExamples.delete(id);
  },
});

export default defineConfig({
  title: "CalmLens SDK examples",
  cwd: fileURLToPath(new URL(".", import.meta.url)),
  services: [
    example("calmgram", "Calmgram", [6408], "http://127.0.0.1:6408"),
    example("link-board-python", "Calmboard (Python)", [6401], "http://127.0.0.1:6401"),
    example("voice-clips-go", "Calmclips (Go)", [6402], "http://127.0.0.1:6402"),
    example("comment-thread-ruby", "Calmthread (Ruby)", [6403], "http://127.0.0.1:6403"),
    example("marketplace-listing-java", "Calmmarket (Java)", [6404], "http://127.0.0.1:6404"),
    example("media-library-rust", "Calmlibrary (Rust)", [6405], "http://127.0.0.1:6405"),
    example("widget-playground", "Widget playground", [6410], "http://localhost:6410"),
    {
      // A static page that uploads through the preset ID in app.js; it has no API key to provision.
      id: "feedback-form-static",
      name: "Calmform (static)",
      command: ["bun", "run", "--cwd", "examples/feedback-form-static", "dev"],
      ports: [6406],
      url: "http://localhost:6406",
      autostart: false,
    },
    {
      // React, Vue, Svelte and plain JavaScript demo pages for the components the docs show.
      id: "ui-components",
      name: "UI components",
      command: ["bun", "run", "--cwd", "examples/ui-components", "dev", "--port", "6412"],
      ports: [6412],
      url: "http://localhost:6412/react.html",
      autostart: false,
    },
    example("chirp-php", "Chirp (PHP)", [6407], "http://127.0.0.1:6407"),
    expo({
      ...example(
        "mobile-uploads-expo",
        "Mobile uploads (Expo)",
        [8081, 6411],
        "http://localhost:8081",
        [],
        // It has no offline demo, so it always uses the local instance.
        { mock: false },
      ),
      terminal: true,
      // Without Metro's key input, start Expo Go on the simulator or emulator directly.
      launch: (platform) => [
        ...exampleCommand("mobile-uploads-expo"),
        "start",
        `--${platform}`,
        "--port",
        "8081",
      ],
    }),
  ],
  actions: [
    {
      key: "m",
      label: "switch examples between mock and local",
      run: async (ctx) => {
        exampleMode = exampleMode === "mock" ? "local" : "mock";
        ctx.log("supervisor", `Examples now run in ${exampleMode} mode`);
        await Promise.all([...runningExamples].map((id) => ctx.restart(id)));
      },
    },
  ],
  status: () => [
    { label: "Examples", value: exampleMode === "mock" ? "Mock" : "Local", tone: "info" },
  ],
  theme: {
    background: "#08131f",
    border: "#29465b",
    danger: "#fb7185",
    foreground: "#edf7f5",
    info: "#7dd3fc",
    muted: "#7896a4",
    panel: "#0d2030",
    primary: "#5eead4",
    success: "#4ade80",
    warning: "#fbbf24",
  },
});
