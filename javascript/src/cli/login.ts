import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  CLI_OAUTH_CLIENT_ID,
  DEVICE_CODE_GRANT_TYPE,
  DEVICE_POLL_INTERVAL_SECONDS,
} from "../contract/AgentAccessConstants.js";

// `calmlens login` signs in through the browser with the OAuth device flow and keeps the key it
// receives (a project API key holding part of the person's access) in the user's config directory.

export const DEFAULT_API_URL = "https://api.calmlens.com/v1";

export interface StoredCredentials {
  apiKey: string;
  projectId: string;
  apiUrl: string;
}

export const credentialsPath = () => {
  const base =
    process.env.CALMLENS_CONFIG_DIR ??
    (process.platform === "win32"
      ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "calmlens")
      : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "calmlens"));
  return join(base, "credentials.json");
};

export const readCredentials = async (): Promise<StoredCredentials | undefined> => {
  try {
    const stored = JSON.parse(await readFile(credentialsPath(), "utf8")) as StoredCredentials;
    return stored.apiKey && stored.projectId && stored.apiUrl ? stored : undefined;
  } catch {
    return undefined;
  }
};

const writeCredentials = async (credentials: StoredCredentials) => {
  const path = credentialsPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  // writeFile keeps an existing file's mode.
  await chmod(path, 0o600);
};

/** The OAuth endpoints sit at the API's origin, beside `/v1`. */
const oauthUrl = (apiUrl: string, path: string) => new URL(path, new URL(apiUrl).origin).toString();

/**
 * Opens an HTTP(S) URL in the default browser. The URL comes from the server, so anything else is
 * refused, and on Windows it goes to the URL handler directly: `cmd /c start` would parse `&` in it
 * as another command.
 */
const openBrowser = (value: string) => {
  let url: string;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
    url = parsed.toString();
  } catch {
    return;
  }
  const [command, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["rundll32", "url.dll,FileProtocolHandler", url]
        : ["xdg-open", url];
  try {
    spawn(command!, args, { stdio: "ignore", detached: true })
      .on("error", () => {})
      .unref();
  } catch {}
};

const post = async (url: string, form: Record<string, string>) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, any>;
  return { ok: response.ok, body };
};

export const login = async (options: {
  apiUrl: string;
  readOnly: boolean;
  openBrowser: boolean;
  write: (text: string) => void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<StoredCredentials> => {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = await post(oauthUrl(options.apiUrl, "/oauth/device/code"), {
    client_id: CLI_OAUTH_CLIENT_ID,
    scope: options.readOnly ? "read" : "read write",
  });
  if (!started.ok)
    throw new Error(started.body.error_description ?? "CalmLens didn't start the sign-in.");
  const { device_code, user_code, verification_uri } = started.body;
  // The person types the code on the page, so they approve only a sign-in they started here.
  options.write(
    [
      `Your code: ${user_code}`,
      `Enter it at ${verification_uri}`,
      "Waiting for approval…",
      "",
    ].join("\n"),
  );
  if (options.openBrowser) openBrowser(verification_uri);

  let interval = Number(started.body.interval ?? DEVICE_POLL_INTERVAL_SECONDS);
  for (;;) {
    await sleep(interval * 1000);
    const polled = await post(oauthUrl(options.apiUrl, "/oauth/token"), {
      grant_type: DEVICE_CODE_GRANT_TYPE,
      device_code,
      client_id: CLI_OAUTH_CLIENT_ID,
    });
    if (polled.ok) {
      const credentials = {
        apiKey: polled.body.access_token as string,
        projectId: polled.body.project_id as string,
        apiUrl: options.apiUrl,
      };
      await writeCredentials(credentials);
      return credentials;
    }
    if (polled.body.error === "authorization_pending") continue;
    if (polled.body.error === "slow_down") {
      interval += 5;
      continue;
    }
    throw new Error(
      polled.body.error === "access_denied"
        ? "The sign-in was declined."
        : polled.body.error === "expired_token"
          ? "The code expired. Run `calmlens login` again."
          : (polled.body.error_description ?? "The sign-in failed."),
    );
  }
};

/**
 * Revokes the stored key (it lasts until revoked) and forgets it. `forgotten` means CalmLens
 * couldn't be reached, so the key still works until it's revoked in the portal.
 */
export const logout = async (): Promise<"revoked" | "forgotten" | "signed-out"> => {
  const stored = await readCredentials();
  if (!stored) return "signed-out";
  const revoked = await post(oauthUrl(stored.apiUrl, "/oauth/revoke"), { token: stored.apiKey })
    .then((result) => result.ok)
    .catch(() => false);
  await rm(credentialsPath(), { force: true });
  return revoked ? "revoked" : "forgotten";
};
