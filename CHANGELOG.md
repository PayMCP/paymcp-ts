# Changelog

# 0.9.1
### Fixed
- The in-memory state store's per-payment lock was not exclusive: it discarded a key's lock as soon as its holder released it, so a caller arriving while others were still queued built a second lock for the same key and ran alongside them. `RESUBMIT` and `TWO_STEP` could therefore run the paid tool twice on one payment. The Redis store was unaffected.
- A client that goes away after a paid tool has run no longer costs it a second execution. Every flow returned "Connection aborted. Call the tool again to retrieve the result." while storing nothing, so the retry ran the tool again on one payment and the first result was discarded. The result is now kept and served on the retry. Note this covers a client that *cancels* its request: the SDK aborts a handler's signal only on an explicit `notifications/cancelled`, not on a dropped connection.
- `ELICITATION` checked the connection only after the branch that synthesizes a missing `content` field, so a tool whose result is not MCP-shaped skipped the check entirely.
- The `X402` flow consumed its state strictly after settlement but before running the tool. Its provider settles inside `getPaymentStatus`, so a store that could not delete failed the call with the caller already charged, and the retry settled a second time.

### Changed
- In `RESUBMIT` and `TWO_STEP` a delivered result stays retrievable under the same `payment_id` until the state store expires it — one hour by default. The tool is not run again, but anyone holding that id can fetch the result a second time. Handing a result back can fail the same way the first attempt did, and the caller has already paid, so it is kept rather than dropped on delivery. The session-keyed flows (`ELICITATION`, `PROGRESS`) drop theirs once delivered, because their key is reused by every later call to the same tool.
- In `ELICITATION`, a tool whose result is not MCP-shaped now consumes the payment. It previously returned before the state was deleted, leaving the payment reusable.
- The confirm tools of `TWO_STEP` and `DYNAMIC_TOOLS` now pass their own request's `extra` to the paid tool. `TWO_STEP` passed the params object, which carries no `sendRequest`, progress token or session, so a paid tool that reported progress or elicited under that flow would have thrown; `DYNAMIC_TOOLS` passed the extra of the initiating request, whose closures target a request the client has already closed. A paid tool under either flow now also receives a live abort signal for the first time.
- `TWO_STEP` and `DYNAMIC_TOOLS` consume the payment only once the paid tool has returned, as `RESUBMIT` always has. A tool that fails — including one that throws because the request was cancelled — leaves the payment where it was instead of leaving the caller charged with an unusable payment id. A failed execution therefore does not consume the payment and can be retried.

# 0.9.0
### Breaking Changes
- x402 v2 challenges now carry the resource description under `resource`, the field name the v2 `PaymentRequired` schema defines. It was previously emitted as `resourceInfo`, which is not an x402 field, so v2 clients never found it. Anyone reading the old key must switch. The `resourceInfo` constructor option keeps its name.

### Fixed
- `resource` is required by the v2 schema but was omitted unless `resourceInfo` was configured. Every v2 challenge PayMCP sends now carries it, defaulting to `mcp://tool/<toolName>` — the form used by the x402 MCP transport spec. A configured URL still wins.
- `ResourceInfo.description` and `.mimeType` are now optional, matching the spec, and the configuration type no longer requires `url` — PayMCP fills it in.

x402 v1 challenges are unchanged, including their non-standard top-level `resourceInfo`, which is left alone deliberately: in v1 the fields the facilitator verifies live inside `accepts`.

# 0.8.3
### Changed
- Default x402 facilitator is now https://facilitator.paymcp.info

# 0.8.2
### Changed
- Price/subscription setup moved to the tool `_meta`
- Removed auto‑adding pricing hints to the tool descriptions.

# 0.8.1
### Added
- Mode.AUTO now supports configuring both a traditional provider and an X402 provider, automatically selecting X402 when the client has an X402 wallet.

# 0.8.0
### Added
- Introduced `Mode.X402`.

### Changed
- In `AUTO` mode, the server now detects client support for `X402` and automatically selects `Mode.X402` when available.

# 0.7.0
### Breaking Changes
- Default `mode` is now `AUTO`.
  - Clients relying on implicit defaults may observe different execution paths.

### Added
- Introduced `AUTO` mode that automatically selects between ELICITATION and RESUBMIT based on client capabilities.

# 0.6.1
### Added
- Session recovery for ELICITATION and PROGRESS flows after client timeouts/disconnects (reuse pending payment and continue).
- `AbortWatcher` to capture aborts and preserve payment info when the connection drops before sending the result.


# 0.5.3
### Added
Stripe provider now sets an Idempotency-Key when creating customers to prevent duplicate customer records for the same user.

# 0.5.1
### Added
- Added subscription support in addition to the existing pay-per-request model.

# 0.4.4
### Changed
- In RESUBMIT mode, the tool now uses the latest arguments rather than the initial ones.

# 0.4.3
### Added
- Added protection against reusing `payment_id` in RESUBMIT mode (single-use enforcement).

## 0.4.2
### Changed
- `mode` is now the recommended parameter instead of `paymentFlow`, as it better reflects the intended behavior.
  - `paymentFlow` remains supported for backward compatibility, but `mode` takes precedence in new implementations.
  - Future updates may deprecate `paymentFlow`.

## 0.4.1
### Added
- payment flow `RESUBMIT`.
- Introduced `mode` parameter (will replace `paymentFlow` in future versions).

## 0.3.3
### Changed
- Kept original tool UI in ChatGPT Apps by removing `_meta` from the initial tool and applying it only to confirmation tools in TWO_STEP payment flow. 

## 0.3.1 
### Added
- Experimental payment flow `DYNAMIC_TOOLS`.

## 0.2.1
### Added
- Support for pluggable state storage in TWO_STEP flow.
  - Default is in-memory.
  - New `RedisStateStore` implementation allows persisting state in Redis.

## 0.2.0
### Added
- Extensible provider system. Providers can now be supplied in multiple ways:
  - As config mapping `{ name: { apiKey: "..." } }` (existing behavior).
  - As ready-made instances:  
    ```ts
    { 
      stripe: new StripeProvider({ apiKey: "..." }), 
      custom: new MyProvider({ apiKey: "..." }) 
    }
    ```
  - As a list of instances:  
    ```ts
    [
      new WalleotProvider({ apiKey: "..." }), 
      new MyProvider({ apiKey: "..." })
    ]
    ```
