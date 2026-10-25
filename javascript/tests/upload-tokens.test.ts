import { describe, expect, it } from "bun:test";
import { sha256Hex } from "../src/contract/CryptoUtils.js";
import { decodeUploadToken, verifyUploadTokenSignature } from "../src/contract/UploadToken.js";
import { type CalmLensError, CalmLensServerClient } from "../src/server";
import { MockCalmLensServerClient } from "../src/testing";

const PRESET_ID = "8f0f6a8e-2c1e-4c7a-9d55-0b6f4c1a2e10";
const API_KEY = "clsk_use_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHabcdef";

const errorCode = async (run: () => unknown) => {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as CalmLensError).code;
  }
};

describe("uploadTokens.sign", () => {
  it("refuses upload preset options", () => {
    expect(
      () =>
        new CalmLensServerClient({
          uploadPresetId: PRESET_ID,
          token: "clut_token",
        } as never),
    ).toThrow(expect.objectContaining({ code: "sdk/invalid-config" }));
  });

  it("signs a token the backend can verify against the key's stored hash", async () => {
    const client = new CalmLensServerClient({ apiKey: API_KEY, projectId: "project-1" });
    const before = Date.now();
    const { token, expiresAt } = await client.uploadTokens.sign({
      uploadPresetId: PRESET_ID,
      externalId: "post-42",
      expiresInSeconds: 120,
    });

    const decoded = decodeUploadToken(token);
    expect(decoded?.claims).toMatchObject({
      u: PRESET_ID,
      x: "post-42",
      e: expiresAt,
      k: "clsk_use_abcd",
    });
    expect(expiresAt - before).toBeGreaterThanOrEqual(120_000);
    expect(expiresAt - before).toBeLessThan(121_000);
    const keyHash = await sha256Hex(API_KEY);
    expect(await verifyUploadTokenSignature(decoded!.body, decoded!.signature, keyHash)).toBe(true);
    expect(
      await verifyUploadTokenSignature(decoded!.body, decoded!.signature, await sha256Hex("other")),
    ).toBe(false);
  });

  it("gives every token its own nonce so each uploads once", async () => {
    const client = new CalmLensServerClient({ apiKey: API_KEY, projectId: "project-1" });
    const first = await client.uploadTokens.sign({ uploadPresetId: PRESET_ID });
    const second = await client.uploadTokens.sign({ uploadPresetId: PRESET_ID });
    expect(decodeUploadToken(first.token)?.claims.n).not.toBe(
      decodeUploadToken(second.token)?.claims.n,
    );
  });

  it("rejects lifetimes over an hour", async () => {
    const client = new CalmLensServerClient({ apiKey: API_KEY, projectId: "project-1" });
    expect(
      await errorCode(() =>
        client.uploadTokens.sign({ uploadPresetId: PRESET_ID, expiresInSeconds: 3601 }),
      ),
    ).toBe("sdk/invalid-argument");
  });

  it("signs the same verifiable tokens in the mock client, at the mock's time and without a request", async () => {
    const mock = new MockCalmLensServerClient({
      apiKey: API_KEY,
      projectId: "project-1",
      mockOptions: { now: () => 1_700_000_000_000, createId: () => "nonce-1" },
    });
    const { token, expiresAt } = await mock.uploadTokens.sign({
      uploadPresetId: PRESET_ID,
      expiresInSeconds: 60,
    });
    const decoded = decodeUploadToken(token)!;
    expect(
      await verifyUploadTokenSignature(decoded.body, decoded.signature, await sha256Hex(API_KEY)),
    ).toBe(true);
    expect({ expiresAt, nonce: decoded.claims.n }).toEqual({
      expiresAt: 1_700_000_060_000,
      nonce: "nonce-1",
    });
    expect(mock.calls).toEqual([]);
  });
});
