import { describe, expect, test } from "bun:test";
import {
  createLocalSigningSecret,
  describeEventTypes,
  type EventSource,
  formatForwardLine,
  forwardEvent,
  listen,
  unavailableWarning,
} from "../../src/cli/listen";
import { EXAMPLE_IDS, isId, newId } from "../../src/contract/Ids.js";
import { CalmLensError, verifyWebhookSignature } from "../../src/server";

const makeEvent = (id: string, type: "asset.uploaded" | "asset.allowed" | "asset.blocked") => ({
  id,
  projectId: EXAMPLE_IDS.proj,
  type,
  severity: "low" as const,
  title: "Asset allowed",
  description: null,
  assetId: null,
  assetSequence: null,
  asset: null,
  facts: [],
  createdAt: 1760000000000,
});

describe("calmlens listen", () => {
  test("forwards the event body signed like a real webhook delivery", async () => {
    const secret = createLocalSigningSecret();
    const event = makeEvent(EXAMPLE_IDS.evt, "asset.allowed");
    let received: { url: string; init: RequestInit } | undefined;
    const result = await forwardEvent(event, {
      forwardTo: "http://localhost:3000/api/webhooks/calmlens",
      secret,
      fetchImpl: async (url, init) => {
        received = { url: String(url), init: init as RequestInit };
        return new Response("ok", { status: 200 });
      },
    });

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(secret).toMatch(/^whsec_local_[0-9a-f]{48}$/);
    const headers = new Headers(received?.init.headers);
    const body = String(received?.init.body);
    expect(received?.url).toBe("http://localhost:3000/api/webhooks/calmlens");
    // A delivery carries the event exactly as the feed lists it.
    expect(JSON.parse(body)).toEqual(event);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-calmlens-delivery-attempt")).toBeNull();
    expect(isId(headers.get("x-calmlens-delivery"), "dlv")).toBe(true);
    const timestamp = headers.get("x-calmlens-timestamp");
    expect(timestamp).toMatch(/^\d+$/);
    expect(Math.abs(Number(timestamp) - Date.now() / 1000)).toBeLessThan(60);
    expect(headers.get("x-calmlens-signature")).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(
      await verifyWebhookSignature({
        payload: body,
        signature: headers.get("x-calmlens-signature"),
        timestamp,
        secret,
      }),
    ).toBe(true);
  });

  test("reports handler errors and unreachable servers", async () => {
    const event = makeEvent(EXAMPLE_IDS.evt, "asset.blocked");
    const rejected = await forwardEvent(event, {
      forwardTo: "http://localhost:3000/hook",
      secret: "s",
      fetchImpl: async () => new Response("nope", { status: 401 }),
    });
    expect(rejected).toMatchObject({ ok: false, status: 401 });
    expect(formatForwardLine(event, rejected)).toContain("401 (handler returned an error)");

    const unreachable = await forwardEvent(event, {
      forwardTo: "http://localhost:3000/hook",
      secret: "s",
      fetchImpl: async () => {
        throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
      },
    });
    expect(unreachable).toMatchObject({ ok: false, error: "ECONNREFUSED" });
    expect(formatForwardLine(event, unreachable)).toContain("is your server running?");
  });

  test("starts from now, follows the cursor and filters event types", async () => {
    const calls: Array<{ cursor?: string; pageSize?: number }> = [];
    const controller = new AbortController();
    const [uploadedId, allowedId] = [newId("evt"), newId("evt")];
    const pages = [
      { items: [], nextCursor: "c0", hasMore: false, excludedTypes: [] },
      {
        items: [makeEvent(uploadedId, "asset.uploaded"), makeEvent(allowedId, "asset.allowed")],
        nextCursor: "c1",
        hasMore: false,
        excludedTypes: [],
      },
    ];
    const client: EventSource = {
      events: {
        list: async (options) => {
          calls.push(options);
          const page = pages.shift();
          if (!page) {
            controller.abort();
            return {
              items: [],
              nextCursor: options.cursor ?? "",
              hasMore: false,
              excludedTypes: [],
            };
          }
          return page;
        },
      },
    };
    const forwarded: string[] = [];

    await listen({
      client,
      forwardTo: "http://localhost:3000/hook",
      secret: "s",
      eventTypes: ["asset.allowed"],
      intervalMs: 1,
      signal: controller.signal,
      log: () => {},
      fetchImpl: async (_url, init) => {
        forwarded.push(JSON.parse(String(init?.body)).id);
        return new Response(null, { status: 204 });
      },
    });

    expect(calls[0]).toEqual({});
    expect(calls[1]).toEqual({ cursor: "c0", pageSize: 100 });
    expect(calls[2]).toEqual({ cursor: "c1", pageSize: 100 });
    expect(forwarded).toEqual([allowedId]);
  });

  test("forwards each asset's events in assetSequence order, wherever the feed lists them", async () => {
    const controller = new AbortController();
    const [first, other] = [newId("asset"), newId("asset")];
    const about = (assetId: string | null, assetSequence: number | null) => ({
      ...makeEvent(newId("evt"), "asset.allowed"),
      assetId,
      assetSequence,
    });
    // An event stored a moment late is listed after a newer one about the same asset.
    const later = about(first, 2);
    const unrelated = about(other, 1);
    const projectWide = about(null, null);
    const earlier = about(first, 1);
    const pages = [
      { items: [], nextCursor: "c0", hasMore: false, excludedTypes: [] },
      {
        items: [later, unrelated, projectWide, earlier],
        nextCursor: "c1",
        hasMore: false,
        excludedTypes: [],
      },
    ];
    const forwarded: string[] = [];
    await listen({
      client: {
        events: {
          list: async (options) => {
            const page = pages.shift();
            if (page) return page;
            controller.abort();
            return {
              items: [],
              nextCursor: options.cursor ?? "",
              hasMore: false,
              excludedTypes: [],
            };
          },
        },
      },
      forwardTo: "http://localhost:3000/hook",
      secret: "s",
      intervalMs: 1,
      signal: controller.signal,
      log: () => {},
      fetchImpl: async (_url, init) => {
        forwarded.push(JSON.parse(String(init?.body)).id);
        return new Response(null, { status: 204 });
      },
    });

    expect(forwarded).toEqual([earlier.id, unrelated.id, projectWide.id, later.id]);
  });

  test("reports the event types the key can't receive instead of silently skipping them", async () => {
    const excludedTypes = ["asset.review-requested", "api-key.created"] as const;
    const readyWith = async (eventTypes?: string[]) => {
      const controller = new AbortController();
      let ready: { unavailableTypes: string[] } | undefined;
      await listen({
        client: {
          events: {
            list: async () => {
              controller.abort();
              return {
                items: [],
                nextCursor: "c0",
                hasMore: false,
                excludedTypes: [...excludedTypes],
              };
            },
          },
        },
        forwardTo: "http://localhost:3000/hook",
        secret: "s",
        eventTypes,
        signal: controller.signal,
        log: () => {},
        onReady: (value) => {
          ready = value;
        },
      });
      return ready?.unavailableTypes;
    };

    // Everything requested: every excluded type is reported.
    expect(await readyWith()).toEqual(["asset.review-requested", "api-key.created"]);
    // A filter: only the requested types the key can't receive.
    expect(await readyWith(["asset.uploaded", "asset.review-requested"])).toEqual([
      "asset.review-requested",
    ]);
    expect(await readyWith(["asset.uploaded"])).toEqual([]);

    // The printed event types leave out those the key can't receive.
    const filtered = describeEventTypes(
      ["asset.uploaded", "asset.review-requested"],
      ["asset.review-requested"],
    );
    expect(filtered).toContain("asset.uploaded");
    expect(filtered).not.toContain("asset.review-requested");
    expect(describeEventTypes(undefined, ["asset.review-requested"])).not.toBe(
      describeEventTypes(undefined, []),
    );
    expect(unavailableWarning(["asset.review-requested"])).toContain("asset.review-requested");
  });

  test("stops on authentication errors instead of retrying", async () => {
    const client: EventSource = {
      events: {
        list: async () => {
          throw new CalmLensError({ id: "api-key/invalid" });
        },
      },
    };
    await expect(
      listen({ client, forwardTo: "http://localhost/hook", secret: "s", log: () => {} }),
    ).rejects.toMatchObject({ code: "api-key/invalid" });
  });
});
