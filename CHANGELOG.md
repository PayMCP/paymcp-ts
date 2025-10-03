# Changelog

## 0.2.1
### Fixed
- **Multi-user session isolation** in LIST_CHANGE flow: Fixed per-session server instance pattern to prevent state interference
  - Demo servers now create NEW McpServer instance per session (matching MCP SDK pattern)
  - Each session gets independent server + transport pair
  - Prevents concurrent requests from interfering with each other's state
  - Verified with multi-user isolation test scenarios (100% pass rate)
- **Session context propagation**: Added `runWithSession()` wrapper for proper AsyncLocalStorage context
  - Critical for LIST_CHANGE flow to maintain per-session tool visibility
  - Uses AsyncLocalStorage to propagate session ID to PayMCP tools
  - Required for `getCurrentSession()` to work correctly
- **LIST_CHANGE confirmation tools**: Fixed MCP SDK validation error
  - Parameterless confirmation tools now omit `inputSchema` field entirely
  - Prevents `Cannot read properties of null (reading '_def')` error
  - Confirmation tool naming uses FULL payment ID: `confirm_{toolname}_{payment_id}`

### Added
- Support for pluggable state storage in TWO_STEP flow
  - Default is in-memory
  - New `RedisStateStore` implementation allows persisting state in Redis

### Changed
- Improved session ID fallback mechanism for better multi-user isolation when server doesn't support session tracking
- Updated demo servers to follow MCP SDK pattern for per-session server instances

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