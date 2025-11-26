import { Logger } from "../types/logger.js";

type JwtPayload = {
  sub?: string;   // user id
  email?: string;
  exp?: number;
  [key: string]: any;
};

/**
 * Decode JWT payload without verifying signature or claims.
 *
 * SECURITY WARNING:
 * - This function MUST NOT be used to authenticate users or authorize requests.
 * - The token MUST already be fully validated by the MCP host
 *   (signature, expiration, issuer, audience, etc.) before calling this function.
 * - The returned payload SHOULD be treated as trusted only because the caller
 *   guarantees prior verification, not because of this function itself.
 */
export function decodeJwtPayloadUnverified(token: string, log: Logger): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) {
      throw new Error("Invalid JWT format");
    }

    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );

    const payload: JwtPayload = JSON.parse(json);

    // Optional defense-in-depth: reject obviously expired tokens.
    // This does NOT replace proper JWT verification at the boundary (signature, iss, aud, etc.).
    if (typeof payload.exp === "number") {
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        log.error("Expired JWT", { exp: payload.exp, now });
        return null;
      }
    }

    return payload;
  } catch (e) {
    log.error("Invalid JWT", e);
    return null;
  }
}