import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateCdpBearerJwt } from "../../src/utils/crypto.js";

function decodeBase64Url(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

describe("generateCdpBearerJwt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a valid JWT with expected header and payload fields", () => {
    const apiKeySecret = Buffer.alloc(32, 1).toString("base64");

    const token = generateCdpBearerJwt({
      apiKeyId: "key_123",
      apiKeySecret,
      ttlSeconds: 999,
      requestHost: "https://example.com",
      requestPath: "/platform/v2/x402/verify",
      requestMethod: "post",
    });

    const [headerB64, payloadB64, signatureB64] = token.split(".");

    expect(headerB64).toBeTruthy();
    expect(payloadB64).toBeTruthy();
    expect(signatureB64).toBeTruthy();

    const header = JSON.parse(decodeBase64Url(headerB64));
    const payload = JSON.parse(decodeBase64Url(payloadB64));

    expect(header).toEqual(
      expect.objectContaining({
        alg: "EdDSA",
        kid: "key_123",
        typ: "JWT",
      })
    );
    expect(typeof header.nonce).toBe("string");
    expect(header.nonce.length).toBeGreaterThan(0);

    expect(payload.sub).toBe("key_123");
    expect(payload.iss).toBe("cdp");
    expect(payload.uris).toEqual(["POST example.com/platform/v2/x402/verify"]);
    expect(payload.iat).toBe(1704067200);
    expect(payload.nbf).toBe(1704067200);
    expect(payload.exp).toBe(1704067200 + 120);
  });

  it("throws when requestPath is missing", () => {
    const apiKeySecret = Buffer.alloc(32, 1).toString("base64");

    expect(() =>
      generateCdpBearerJwt({
        apiKeyId: "key_123",
        apiKeySecret,
      })
    ).toThrow("requestPath is required");
  });
});
