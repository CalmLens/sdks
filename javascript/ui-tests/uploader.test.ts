import { afterEach, describe, expect, it, mock } from "bun:test";
import { waitFor, within } from "@testing-library/dom";
import { MockCalmLensAppClient } from "../src/testing";
import {
  type CalmLensUpload,
  createUploadController,
  type UploaderProps,
  type UploadItem,
} from "../src/ui";
import { BINDINGS, type Mounted } from "./bindings";

const PRESET_ID = "8f0f6a8e-2c1e-4c7a-9d55-0b6f4c1a2e10";

// Messages named after their keys, so the tests check which message shows without pinning copy.
const messages = {
  allowed: "msg:allowed",
  blocked: "msg:blocked",
  pending: "msg:pending",
  failed: "msg:failed",
  "file/too-large": "msg:too-large",
  chooseFile: "msg:choose",
  chooseFiles: "msg:choose",
  chooseAnother: "msg:choose-another",
  retry: "msg:retry",
  remove: "msg:remove {name}",
  cancel: "msg:cancel {name}",
};

const photo = (name = "photo.png", size = 3) =>
  new File([new Uint8Array(size)], name, { type: "image/png" });

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** Picks files with the uploader's file input, as the browser's picker does. */
const pick = (container: HTMLElement, files: File[]) => {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("The uploader has no file input");
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

/** Drops files on the drop zone, the element around the choose button. */
const drop = (container: HTMLElement, files: File[]) => {
  const zone = within(container).getByRole("button", { name: messages.chooseFiles }).parentElement;
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  zone?.dispatchEvent(event);
};

const statuses = (container: HTMLElement) =>
  within(container)
    .queryAllByRole("status")
    .map((status) => status.textContent);

/** A preset client on the SDK's mock, deciding every upload as `outcome`. */
const mockPreset = (
  outcome: "allowed" | "blocked",
  preset: ConstructorParameters<typeof MockCalmLensAppClient>[0]["mockOptions"] = {},
): Pick<UploaderProps, "uploadPresetId" | "token" | "createClient"> => ({
  uploadPresetId: PRESET_ID,
  token: "clut_test",
  createClient: (options) =>
    new MockCalmLensAppClient({
      ...options,
      mockOptions: { queuedOutcome: outcome, preset: { requireToken: true }, ...preset },
    }),
});

for (const binding of BINDINGS) {
  describe(`${binding.name} uploader`, () => {
    it("uploads a picked file through the upload preset and reports the decision", async () => {
      const uploaded: CalmLensUpload[] = [];
      mounted = binding.mountUploader({
        ...mockPreset("allowed"),
        messages,
        onUploaded: (upload) => uploaded.push(upload),
      });
      pick(mounted.container, [photo()]);

      await waitFor(() => expect(statuses(mounted!.container)).toEqual(["msg:allowed"]));
      expect(uploaded.map(({ status, file }) => [status, file.name])).toEqual([
        ["allowed", "photo.png"],
      ]);
      expect(uploaded[0]?.assetId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("shows a blocked file as refused without reporting it as uploaded", async () => {
      const uploaded = mock();
      const rejected: UploadItem[] = [];
      mounted = binding.mountUploader({
        ...mockPreset("blocked"),
        messages,
        onUploaded: uploaded,
        onRejected: (item) => rejected.push(item),
      });
      pick(mounted.container, [photo("bad.png")]);

      await waitFor(() => expect(statuses(mounted!.container)).toEqual(["msg:blocked"]));
      expect(rejected.map((item) => item.status)).toEqual(["blocked"]);
      expect(uploaded).not.toHaveBeenCalled();
    });

    it("refuses a file over the size limit without sending it, and removes it", async () => {
      const upload = mock(async () => ({ assetId: "a1" }));
      const removed: UploadItem[] = [];
      mounted = binding.mountUploader({
        upload,
        maxFileSize: 2,
        messages,
        onRemoved: (item) => removed.push(item),
      });
      pick(mounted.container, [photo("big.png", 3)]);

      await waitFor(() => expect(statuses(mounted!.container)).toEqual(["msg:too-large"]));
      const view = within(mounted.container);
      expect(view.queryByRole("button", { name: messages.retry })).toBeNull();
      view.getByRole("button", { name: "msg:remove big.png" }).click();

      await waitFor(() => expect(statuses(mounted!.container)).toEqual([]));
      expect(removed.map((item) => item.file.name)).toEqual(["big.png"]);
      expect(upload).not.toHaveBeenCalled();
    });

    it("swaps the drop zone for the picked file, and back once it is removed", async () => {
      mounted = binding.mountUploader({
        upload: async () => ({ assetId: "a1", status: "allowed" }),
        messages,
      });
      const view = within(mounted.container);
      pick(mounted.container, [photo("first.png")]);

      await waitFor(() => expect(statuses(mounted!.container)).toEqual(["msg:allowed"]));
      expect(view.queryByRole("button", { name: messages.chooseFile })).toBeNull();
      expect(
        (view.getByRole("button", { name: messages.chooseAnother }) as HTMLButtonElement).disabled,
      ).toBe(false);

      pick(mounted.container, [photo("second.png")]);
      await waitFor(() =>
        expect(view.queryByRole("button", { name: "msg:remove second.png" })).not.toBeNull(),
      );
      expect(view.queryByRole("button", { name: "msg:remove first.png" })).toBeNull();
      view.getByRole("button", { name: "msg:remove second.png" }).click();

      await waitFor(() =>
        expect(view.queryByRole("button", { name: messages.chooseFile })).not.toBeNull(),
      );
      expect(view.queryByRole("button", { name: messages.chooseAnother })).toBeNull();
    });

    it("keeps picked files until start() with autoUpload off", async () => {
      const upload = mock(async () => ({ assetId: "a1", status: "allowed" as const }));
      const controller = createUploadController({ upload, autoUpload: false });
      mounted = binding.mountUploader({ controller, messages });
      pick(mounted.container, [photo()]);

      await waitFor(() =>
        expect(controller.getSnapshot().items.map((item) => item.stage)).toEqual(["selected"]),
      );
      within(mounted.container).getByRole("button", { name: "msg:remove photo.png" });
      expect(upload).not.toHaveBeenCalled();
      expect(statuses(mounted.container)).toEqual([]);

      controller.start();
      await waitFor(() => expect(statuses(mounted!.container)).toEqual(["msg:allowed"]));
      expect(upload).toHaveBeenCalledTimes(1);
      controller.clear();
    });

    it("leaves the uploads of a controller it was given running when it unmounts", async () => {
      let signal: AbortSignal | undefined;
      const controller = createUploadController({
        upload: (_file, context) => {
          signal = context.signal;
          return new Promise(() => {});
        },
      });
      mounted = binding.mountUploader({ controller, messages });
      pick(mounted.container, [photo()]);
      await waitFor(() => expect(signal).toBeDefined());
      mounted.unmount();
      mounted = undefined;

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(signal?.aborted).toBe(false);
      controller.clear();
      expect(signal?.aborted).toBe(true);
    });

    it("retries a failed upload", async () => {
      let attempts = 0;
      mounted = binding.mountUploader({
        upload: async () => {
          if (++attempts === 1) throw new Error("Network down");
          return { assetId: "a1", status: "allowed" };
        },
        messages,
      });
      pick(mounted.container, [photo()]);

      await waitFor(() => expect(statuses(mounted!.container)).toEqual(["msg:failed"]));
      within(mounted.container).getByRole("button", { name: messages.retry }).click();

      await waitFor(() => expect(statuses(mounted!.container)).toEqual(["msg:allowed"]));
      expect(attempts).toBe(2);
    });

    it("shows the bytes sent while a file uploads", async () => {
      let finish = () => {};
      mounted = binding.mountUploader({
        upload: (_file, { onProgress }) => {
          onProgress(1, 4);
          return new Promise((resolve) => {
            finish = () => resolve({ assetId: "a1", status: "allowed" });
          });
        },
        messages,
      });
      pick(mounted.container, [photo()]);

      await waitFor(() =>
        expect(
          within(mounted!.container).getByRole("progressbar").getAttribute("aria-valuenow"),
        ).toBe("25"),
      );
      finish();
      await waitFor(() => expect(within(mounted!.container).queryByRole("progressbar")).toBeNull());
    });

    it("uploads every file dropped on it", async () => {
      const uploaded: string[] = [];
      mounted = binding.mountUploader({
        upload: async (file) => ({ assetId: file.name, status: "allowed" }),
        multiple: true,
        messages,
        onUploaded: ({ assetId }) => uploaded.push(assetId),
      });
      drop(mounted.container, [photo("a.png"), photo("b.png")]);

      await waitFor(() => expect(uploaded.sort()).toEqual(["a.png", "b.png"]));
    });

    it("ignores files while disabled", async () => {
      const upload = mock(async () => ({ assetId: "a1" }));
      mounted = binding.mountUploader({ upload, disabled: true, messages });
      const choose = within(mounted.container).getByRole("button", { name: messages.chooseFiles });
      expect((choose as HTMLButtonElement).disabled).toBe(true);
      drop(mounted.container, [photo()]);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(upload).not.toHaveBeenCalled();
      expect(statuses(mounted.container)).toEqual([]);
    });

    it("cancels uploads still running when it unmounts", async () => {
      let signal: AbortSignal | undefined;
      mounted = binding.mountUploader({
        upload: (_file, context) => {
          signal = context.signal;
          return new Promise(() => {});
        },
        messages,
      });
      pick(mounted.container, [photo()]);
      await waitFor(() => expect(signal).toBeDefined());
      mounted.unmount();
      mounted = undefined;

      await waitFor(() => expect(signal?.aborted).toBe(true));
    });
  });
}
