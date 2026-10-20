import { describe, expect, it } from "bun:test";
import { type CalmLensError, CalmLensServerClient } from "../src/server";

const page = { items: [], total: 0, hasMore: false, nextCursor: null, pageSize: 10 };

const createClient = (projectId = "project-1") => {
  const requests: { method: string; url: URL }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push({ method: request.method, url: new URL(request.url) });
    return Response.json(
      request.url.includes("/assets/page")
        ? page
        : { id: "a", processing: { status: "uploading" }, moderation: { status: "pending" } },
    );
  };
  const client = new CalmLensServerClient({
    apiKey: "key",
    projectId,
    fetch: fetchImpl,
    uploadFetch: fetchImpl,
  });
  return { client, requests };
};

const errorCode = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: CalmLensError) => error.code,
  );

describe("request paths", () => {
  it("lists assets without options", async () => {
    const { client, requests } = createClient();
    await client.assets.list();
    expect(requests.map(({ method, url }) => `${method} ${url.pathname}${url.search}`)).toEqual([
      "GET /v1/projects/project-1/assets/page",
    ]);
  });

  it("rejects listChildren without an asset ID before sending a request", async () => {
    const { client, requests } = createClient();
    expect(await errorCode(client.assets.listChildren())).toBe("sdk/invalid-argument");
    expect(requests).toEqual([]);
  });

  it("keeps a project ID with reserved characters in one path segment", async () => {
    const { client, requests } = createClient("p/../x?y#z");
    await client.assets.list({ pageSize: 5 });
    await client.assets.create({ name: "a.txt", content: { plainText: "a", type: "text/plain" } });
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/v1/projects/p%2F..%2Fx%3Fy%23z/assets/page",
      "/v1/projects/p%2F..%2Fx%3Fy%23z/assets",
    ]);
  });

  it('rejects "." and ".." project IDs', () => {
    for (const projectId of [".", ".."]) {
      expect(() => createClient(projectId)).toThrow(
        expect.objectContaining({ code: "sdk/invalid-config" }),
      );
    }
  });

  it("keeps an asset ID in one path segment for multipart parts", async () => {
    const { client, requests } = createClient();
    await client.assets.uploadPart({
      assetId: "a/../b?c",
      part: { plainText: "final", partNumber: 2, isFinal: true },
    });
    expect(requests.map(({ url }) => url.pathname)).toEqual(["/v1/assets/a%2F..%2Fb%3Fc/part"]);
  });
});
