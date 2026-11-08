import { describe, expect, test } from "bun:test";
import { CalmLensAppClient } from "../src/app";
import { CalmLensServerClient } from "../src/server";

const asset = {
  id: "asset-1",
  name: "a.txt",
  upload: { status: "completed" },
  classification: { status: "done", moderation: { status: "allowed" } },
};

const recordingFetch = () => {
  const requests: Request[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return Response.json(asset);
  }) as typeof fetch;
  return { fetchImpl, requests };
};

/** The error `call` throws or rejects with. */
const failure = async (call: () => unknown) => {
  try {
    await call();
  } catch (error) {
    return error as { code?: string; message: string; details?: Record<string, unknown> };
  }
  throw new Error("Expected the call to fail");
};

describe("unknown option keys", () => {
  test("the server client refuses them with sdk/invalid-argument before sending", async () => {
    const { fetchImpl, requests } = recordingFetch();
    const client = new CalmLensServerClient({ apiKey: "key", projectId: "p", fetch: fetchImpl });
    const calls: Record<string, [string, () => unknown]> = {
      "text.classify": [
        "extrenalId",
        () => client.text.classify({ text: "hi", extrenalId: "x" } as never),
      ],
      "assets.create": [
        "visiblity",
        () =>
          client.assets.create({
            name: "a.txt",
            content: { plainText: "a", type: "text/plain" },
            visiblity: "private",
          } as never),
      ],
      "assets.retrieve": [
        "assetID",
        () => client.assets.retrieve({ assetId: "a", assetID: "b" } as never),
      ],
      "assets.iterate": ["filters", () => client.assets.iterate({ filters: "name==a" } as never)],
      "assets.waitForDecision": [
        "timeout",
        () => client.assets.waitForDecision({ assetId: "a", timeout: 5 } as never),
      ],
      "events.pages": ["page_size", () => client.events.pages({ page_size: 5 } as never)],
      "cdn.getAssetUrl": [
        "lenz",
        () => client.cdn.getAssetUrl({ assetId: "a", lenz: "x" } as never),
      ],
      "uploadTokens.sign": [
        "external",
        () => client.uploadTokens.sign({ uploadPresetId: "preset_1", external: "x" } as never),
      ],
      "policies.update": [
        "setting",
        () => client.policies.update({ policyId: "p", revision: 1, setting: {} } as never),
      ],
      ensureLens: [
        "identifer",
        () =>
          client.ensureLenses({
            lenses: [{ identifier: "thumb", name: "Thumb", type: "image", identifer: "x" }],
          } as never),
      ],
    };
    for (const [operation, [key, call]] of Object.entries(calls)) {
      const error = await failure(call);
      expect(error.code, operation).toBe("sdk/invalid-argument");
      expect(error.details, operation).toEqual({ operation, options: [key] });
    }
    expect(requests).toHaveLength(0);
  });

  test("the server client still sends the keys a method takes, and an idempotency key", async () => {
    const { fetchImpl, requests } = recordingFetch();
    const client = new CalmLensServerClient({ apiKey: "key", projectId: "p", fetch: fetchImpl });
    await client.text.classify({ text: "hi", externalId: "post-1", idempotencyKey: "key-1" });
    expect(requests[0]!.headers.get("idempotency-key")).toBe("key-1");
    expect(((await requests[0]!.json()) as { externalId: string }).externalId).toBe("post-1");
  });

  test("the app client refuses keys its upload preset requests don't take", async () => {
    const { fetchImpl, requests } = recordingFetch();
    const client = new CalmLensAppClient({ uploadPresetId: "preset_1", fetch: fetchImpl });
    const content = { plainText: "a", type: "text/plain" };
    // The preset chooses the folder, so an upload can't.
    const error = await failure(() =>
      client.assets.create({ name: "a.txt", content, folderId: "f" } as never),
    );
    expect(error.code).toBe("sdk/invalid-argument");
    expect(error.details).toEqual({ operation: "assets.create", options: ["folderId"] });
    const retrieve = await failure(() =>
      client.assets.retrieve({ assetId: "a", id: "b" } as never),
    );
    expect(retrieve.details).toEqual({ operation: "assets.retrieve", options: ["id"] });
    expect(requests).toHaveLength(0);
    await client.assets.create({ name: "a.txt", content, idempotencyKey: "key-1" });
    expect(requests[0]!.headers.get("idempotency-key")).toBe("key-1");
  });
});
