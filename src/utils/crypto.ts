import crypto from "crypto";

/**
 * base64url encoding (RFC 7515)
 */
function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function randomNonceHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

function ed25519KeyFromBase64Secret(secretB64: string) {
  const seed = Buffer.from(secretB64.trim(), "base64");

  // CDP API Key Secret is a base64-encoded Ed25519 seed.
  // Wrap it into a minimal PKCS8 structure (RFC 8410) so Node can sign with it.
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const pkcs8 = Buffer.concat([pkcs8Prefix, seed]);
  return crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
}

/**
 * Generate CDP Bearer JWT for x402 Facilitator
 */
export function generateCdpBearerJwt(opts: {
  apiKeyId: string;
  apiKeySecret: string;
  ttlSeconds?: number; // <= 120
  requestHost?: string;
  requestPath?: string;
  requestMethod?: string;
}): string {
  const ttl = Math.min(opts.ttlSeconds ?? 120, 120);
  const now = Math.floor(Date.now() / 1000);

  const requestHost = (opts.requestHost ?? "api.cdp.coinbase.com").replace(/^https:\/\//, "");
  if (!opts.requestPath) {
    throw new Error(
      "requestPath is required (e.g. /platform/v2/x402/verify or /platform/v2/x402/settle)"
    );
  }
  const requestPath = opts.requestPath;
  const requestMethod = (opts.requestMethod ?? "POST").toUpperCase();

  // CDP SDK uses uris entries like: "POST api.cdp.coinbase.com/platform/v2/x402/verify"
  const uriEntry = `${requestMethod} ${requestHost}${requestPath}`;

  const header = {
    alg: "EdDSA",
    kid: opts.apiKeyId,
    typ: "JWT",
    nonce: randomNonceHex(),
  };

  const payload = {
    sub: opts.apiKeyId,
    iss: "cdp",
    uris: [uriEntry],
    iat: now,
    nbf: now,
    exp: now + ttl,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  const key = ed25519KeyFromBase64Secret(opts.apiKeySecret);
  const sig = crypto.sign(null, Buffer.from(signingInput), key);

  return `${signingInput}.${b64url(sig)}`;
}