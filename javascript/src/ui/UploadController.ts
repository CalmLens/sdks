import CalmLensAppClient from "../client/CalmLensAppClient";
import { CalmLensError, SDK_ERROR_CODES } from "../client/CalmLensError";
import type { AssetModerationStatus, CalmLensAppClientOptions } from "../client/CalmLensTypes";
import { createProgressFetch } from "./ProgressFetch";

/**
 * Where a file is in the upload: picked and waiting for `start()` (with `autoUpload: false`),
 * waiting its turn, sending bytes, being moderated, or finished.
 */
export type UploadStage = "selected" | "queued" | "uploading" | "checking" | "complete" | "failed";

/** One file the uploader has picked, as the components render it. */
export interface UploadItem {
  /** A local ID for the file in this uploader, not the asset ID. */
  readonly key: string;
  readonly file: File;
  readonly stage: UploadStage;
  /** Sent bytes as a fraction from 0 to 1 while uploading, `null` when unknown. */
  readonly progress: number | null;
  /** An object URL for image files, for a local preview while the photo is checked. */
  readonly previewUrl?: string;
  readonly assetId?: string;
  /** The moderation status, when the upload preset shows decisions to the uploader. */
  readonly status?: AssetModerationStatus;
  /**
   * Why the file failed: a `CalmLensError` code, or `file/not-accepted` and `file/too-large` when
   * the uploader refused the file before sending it.
   */
  readonly errorCode?: string;
}

/** A finished upload that wasn't blocked, which your app saves with its record. */
export interface CalmLensUpload {
  assetId: string;
  /** `undefined` when the upload preset doesn't show decisions to the uploader. */
  status?: AssetModerationStatus;
  file: File;
}

export interface UploadSnapshot {
  readonly items: readonly UploadItem[];
  /** Whether any file is still waiting, uploading or being checked. */
  readonly busy: boolean;
}

/** The part of `CalmLensAppClient` the uploader uses, which `MockCalmLensAppClient` also has. */
export interface UploadClient {
  assets: Pick<CalmLensAppClient["assets"], "create" | "retrieve">;
}

/** What a custom `upload` function returns for each file. */
export interface CustomUploadResult {
  assetId: string;
  /** The moderation status, if your API returns it. */
  status?: AssetModerationStatus;
}

export interface CustomUploadContext {
  /** Aborted when the uploader cancels or removes the file. */
  signal: AbortSignal;
  /** Reports sent bytes, for the progress bar. `createProgressFetch` reports them for you. */
  onProgress: (sentBytes: number, totalBytes: number) => void;
}

export interface UploadControllerOptions {
  /** The upload preset the files upload through. Not needed with `upload`. */
  uploadPresetId?: string;
  /**
   * Uploads each file your own way instead of through an upload preset, for example through your
   * app's API, which creates the asset with its API key. The uploader still shows progress, the
   * decision and errors: throw a `CalmLensError` to show its code's message.
   */
  upload?: (file: File, context: CustomUploadContext) => Promise<CustomUploadResult>;
  /**
   * Checks a pending upload made with `upload`, returning its current moderation status. Without
   * it, a pending upload finishes as pending.
   */
  checkStatus?: (
    assetId: string,
    context: { signal: AbortSignal },
  ) => Promise<AssetModerationStatus | undefined>;
  /**
   * The upload token, or a function that returns a fresh one for each file. Leave it out for
   * presets that anyone can upload to.
   */
  token?: string | ((file: File) => string | Promise<string>);
  /**
   * An endpoint on your server that returns `{ token }` for each file. It receives a `POST` with
   * the file's `{ name, type, size }` as JSON. Use `token` instead for anything more custom.
   */
  tokenUrl?: string;
  /** File types to accept, as in an `<input accept>`: `image/*`, `.png`, `video/mp4`. */
  accept?: string;
  /** The largest file to accept, in bytes. Your preset's own limit still applies. */
  maxFileSize?: number;
  /**
   * Upload files as soon as they're picked. Defaults to `true`. With `false`, picked files wait in
   * the `selected` stage until you call `start()`, for example when a form is submitted.
   */
  autoUpload?: boolean;
  /** Accept more than one file. Defaults to `false`; a new file then replaces the last one. */
  multiple?: boolean;
  /** The most files kept at once when `multiple` is on. Defaults to 10. */
  maxFiles?: number;
  /** How many files upload at the same time. Defaults to 3. */
  concurrency?: number;
  /**
   * How long to keep checking for a moderation decision, in milliseconds. Defaults to 15
   * seconds; anything still pending after that is settled by your server's webhook.
   */
  decisionTimeoutMs?: number;
  /** The CalmLens API base URL, for local development. */
  baseUrl?: string;
  /**
   * Creates the client for each upload. Defaults to `CalmLensAppClient`; tests can return a
   * `MockCalmLensAppClient` from `@calmlens/sdk/testing` instead.
   */
  createClient?: (options: CalmLensAppClientOptions) => UploadClient;
  /** Called for each finished upload that wasn't blocked or purged. */
  onUploaded?: (upload: CalmLensUpload) => void;
  /** Called when moderation blocks or purges a file. */
  onRejected?: (item: UploadItem) => void;
  /** Called when a file couldn't be uploaded. */
  onFailed?: (item: UploadItem) => void;
  /** Called when the uploader removes a file, including a finished upload. */
  onRemoved?: (item: UploadItem) => void;
}

const DEFAULT_MAX_FILES = 10;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_DECISION_TIMEOUT_MS = 15_000;

/** Whether a file matches an `accept` list such as `image/*,.pdf`. */
export const isFileAccepted = (file: Pick<File, "name" | "type">, accept?: string): boolean => {
  const patterns = (accept ?? "")
    .split(",")
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean);
  if (patterns.length === 0) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return patterns.some((pattern) => {
    if (pattern === "*" || pattern === "*/*") return true;
    if (pattern.endsWith("/*")) return type.startsWith(pattern.slice(0, -1));
    if (pattern.startsWith(".")) return name.endsWith(pattern);
    return type === pattern;
  });
};

const isRejected = (status: AssetModerationStatus | undefined) =>
  status === "blocked" || status === "purged";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

let nextKey = 0;

/**
 * Uploads files through an upload preset and tracks each one until it has a moderation
 * decision. It holds no UI: the React, Vue, Svelte and web components render its snapshot, and
 * you can render your own with `subscribe`, which also makes it a Svelte store.
 */
export class UploadController {
  #options: UploadControllerOptions;
  #snapshot: UploadSnapshot = { items: [], busy: false };
  readonly #listeners = new Set<(snapshot: UploadSnapshot) => void>();
  readonly #aborts = new Map<string, AbortController>();

  constructor(options: UploadControllerOptions) {
    this.#options = options;
  }

  /** The current options. */
  get options(): Readonly<UploadControllerOptions> {
    return this.#options;
  }

  /** Replaces the options, for example when a component's props change. */
  setOptions(options: UploadControllerOptions): void {
    this.#options = options;
  }

  getSnapshot = (): UploadSnapshot => this.#snapshot;

  /**
   * Calls `listener` with the current snapshot now and after every change, and returns a
   * function that stops. This is the Svelte store contract, and works with React's
   * `useSyncExternalStore`.
   */
  subscribe = (listener: (snapshot: UploadSnapshot) => void): (() => void) => {
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Adds files from a file input, a drop or a paste, and starts uploading them, or keeps them
   * `selected` with `autoUpload: false`.
   */
  addFiles(files: Iterable<File> | ArrayLike<File>): void {
    const {
      multiple = false,
      maxFiles = DEFAULT_MAX_FILES,
      accept,
      maxFileSize,
      autoUpload = true,
    } = this.#options;
    let picked = Array.from(files as ArrayLike<File>);
    if (picked.length === 0) return;
    if (!multiple) {
      picked = picked.slice(0, 1);
      for (const item of this.#snapshot.items) this.remove(item.key);
    }
    const room = (multiple ? maxFiles : 1) - this.#snapshot.items.length;
    const added = picked.slice(0, Math.max(0, room)).map((file): UploadItem => {
      const key = `upload-${++nextKey}`;
      const previewUrl =
        file.type.startsWith("image/") && typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(file)
          : undefined;
      const errorCode = !isFileAccepted(file, accept)
        ? "file/not-accepted"
        : maxFileSize !== undefined && file.size > maxFileSize
          ? "file/too-large"
          : undefined;
      return errorCode
        ? { key, file, previewUrl, stage: "failed", progress: null, errorCode }
        : { key, file, previewUrl, stage: autoUpload ? "queued" : "selected", progress: null };
    });
    this.#set([...this.#snapshot.items, ...added]);
    for (const item of added) if (item.stage === "failed") this.#options.onFailed?.(item);
    this.#pump();
  }

  /** Uploads every `selected` file, for an uploader with `autoUpload: false`. */
  start(): void {
    for (const item of this.#snapshot.items) {
      if (item.stage === "selected") this.#update(item.key, { stage: "queued" });
    }
    this.#pump();
  }

  /** Uploads a failed file again. */
  retry(key: string): void {
    const item = this.#find(key);
    if (item?.stage !== "failed" || item.errorCode?.startsWith("file/")) return;
    this.#update(key, { stage: "queued", progress: null, errorCode: undefined });
    this.#pump();
  }

  /**
   * Stops a queued or running file and keeps it in the list as failed with `sdk/cancelled`, so
   * `retry` can upload it again. Finished files are left as they are.
   */
  cancel(key: string): void {
    const item = this.#find(key);
    if (
      !item ||
      (item.stage !== "queued" && item.stage !== "uploading" && item.stage !== "checking")
    )
      return;
    this.#aborts.get(key)?.abort();
    this.#aborts.delete(key);
    this.#update(key, { stage: "failed", progress: null, errorCode: SDK_ERROR_CODES.CANCELLED });
    this.#pump();
  }

  /** Cancels a file's upload if it's running and removes it from the list. */
  remove(key: string): void {
    const item = this.#find(key);
    if (!item) return;
    this.#aborts.get(key)?.abort();
    this.#aborts.delete(key);
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    this.#set(this.#snapshot.items.filter((other) => other.key !== key));
    this.#options.onRemoved?.(item);
    this.#pump();
  }

  /** Cancels every upload and empties the list, without calling `onRemoved`. */
  clear(): void {
    for (const abort of this.#aborts.values()) abort.abort();
    this.#aborts.clear();
    for (const item of this.#snapshot.items) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    this.#set([]);
  }

  #find(key: string) {
    return this.#snapshot.items.find((item) => item.key === key);
  }

  #set(items: UploadItem[]) {
    const busy = items.some(
      (item) => item.stage === "queued" || item.stage === "uploading" || item.stage === "checking",
    );
    this.#snapshot = { items, busy };
    for (const listener of this.#listeners) listener(this.#snapshot);
  }

  #update(key: string, changes: Partial<UploadItem>) {
    if (!this.#find(key)) return;
    this.#set(
      this.#snapshot.items.map((item) => (item.key === key ? { ...item, ...changes } : item)),
    );
  }

  #pump() {
    const limit = this.#options.concurrency ?? DEFAULT_CONCURRENCY;
    for (const item of this.#snapshot.items) {
      if (this.#aborts.size >= limit) return;
      if (item.stage === "queued" && !this.#aborts.has(item.key)) void this.#upload(item);
    }
  }

  async #upload({ key, file }: UploadItem) {
    const abort = new AbortController();
    this.#aborts.set(key, abort);
    this.#update(key, { stage: "uploading", progress: 0 });
    const options = this.#options;
    try {
      const onProgress = (sent: number, total: number) => {
        if (!abort.signal.aborted) this.#update(key, { progress: total ? sent / total : null });
      };
      const client = await this.#clientFor(file, abort.signal, onProgress);
      let asset = await client.create();
      this.#update(key, { stage: "checking", progress: null, assetId: asset.id });
      const deadline = Date.now() + (options.decisionTimeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS);
      for (
        let delay = 1000;
        asset.status === "pending" && client.retrieve && Date.now() < deadline;
        delay *= 2
      ) {
        await sleep(Math.min(delay, Math.max(0, deadline - Date.now())), abort.signal);
        if (abort.signal.aborted) return;
        asset = await client.retrieve(asset.id);
      }
      if (abort.signal.aborted) return;
      this.#update(key, { stage: "complete", status: asset.status });
      const item = this.#find(key);
      if (!item) return;
      if (isRejected(asset.status)) options.onRejected?.(item);
      else options.onUploaded?.({ assetId: asset.id, status: asset.status, file });
    } catch (error) {
      if (abort.signal.aborted) return;
      const errorCode = CalmLensError.isCalmLensError(error)
        ? error.code
        : SDK_ERROR_CODES.TRANSPORT_ERROR;
      this.#update(key, { stage: "failed", progress: null, errorCode });
      const item = this.#find(key);
      if (item) options.onFailed?.(item);
    } finally {
      if (this.#aborts.get(key) === abort) this.#aborts.delete(key);
      this.#pump();
    }
  }

  /** Creates and checks one file's upload, through `upload` or the upload preset. */
  async #clientFor(
    file: File,
    signal: AbortSignal,
    onProgress: (sent: number, total: number) => void,
  ): Promise<{
    create: () => Promise<{ id: string; status?: AssetModerationStatus }>;
    retrieve?: (assetId: string) => Promise<{ id: string; status?: AssetModerationStatus }>;
  }> {
    const { upload, checkStatus, uploadPresetId, createClient, baseUrl } = this.#options;
    if (upload) {
      return {
        create: async () => {
          const { assetId, status } = await upload(file, { signal, onProgress });
          return { id: assetId, status };
        },
        retrieve: checkStatus
          ? async (assetId) => ({ id: assetId, status: await checkStatus(assetId, { signal }) })
          : undefined,
      };
    }
    if (!uploadPresetId) {
      throw new CalmLensError(SDK_ERROR_CODES.INVALID_CONFIG, {
        message: "The uploader needs an uploadPresetId or an upload function",
      });
    }
    const options = {
      uploadPresetId,
      token: await this.#tokenFor(file, signal),
      baseUrl,
      signal,
      uploadFetch: createProgressFetch(onProgress) as typeof fetch,
    };
    const client = createClient ? createClient(options) : new CalmLensAppClient(options);
    return {
      create: () =>
        client.assets.create({
          name: file.name,
          content: { data: file, type: file.type || "application/octet-stream" },
        }),
      retrieve: (assetId) => client.assets.retrieve({ assetId }),
    };
  }

  async #tokenFor(file: File, signal: AbortSignal): Promise<string | undefined> {
    const { token, tokenUrl } = this.#options;
    if (typeof token === "function") return await token(file);
    if (token !== undefined) return token;
    if (!tokenUrl) return undefined;
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
      credentials: "same-origin",
      signal,
    });
    const body = (await response.json().catch(() => ({}))) as { token?: unknown; code?: unknown };
    if (!response.ok || typeof body.token !== "string") {
      throw new CalmLensError(typeof body.code === "string" ? body.code : "upload-token/refused", {
        message: `Your token endpoint answered ${response.status} without a token`,
      });
    }
    return body.token;
  }
}

export const createUploadController = (options: UploadControllerOptions): UploadController =>
  new UploadController(options);
