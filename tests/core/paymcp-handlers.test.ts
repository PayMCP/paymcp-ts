import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PayMCP } from "../../src/core/PayMCP.js";
import { Mode } from "../../src/types/payment.js";
import type { PayMCPOptions } from "../../src/types/config.js";

describe("PayMCP handlers", () => {
  let handlers: Map<string, any>;
  let mockServer: any;
  let stateStore: any;

  beforeEach(() => {
    handlers = new Map();
    handlers.set("initialize", vi.fn().mockResolvedValue({}));

    mockServer = {
      registerTool: vi.fn(),
      server: {
        _requestHandlers: handlers,
      },
    };

    stateStore = {
      set: vi.fn(),
      get: vi.fn().mockResolvedValue({
        args: { capabilities: { x402: true } },
      }),
      delete: vi.fn(),
      lock: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("patches initialize to store client capabilities", async () => {
    const opts: PayMCPOptions = {
      providers: { mock: { apiKey: "x" } } as any,
      mode: Mode.AUTO,
      stateStore,
    };

    new PayMCP(mockServer, opts);

    const initHandler = handlers.get("initialize");
    await initHandler(
      { params: { clientInfo: { name: "clientA" }, capabilities: { x402: true } } },
      { sessionId: "s1" }
    );

    expect(stateStore.set).toHaveBeenCalledWith(
      "session-s1",
      expect.objectContaining({ name: "clientA", sessionId: "s1" }),
      expect.objectContaining({ ttlSeconds: 60 * 60 * 24 })
    );
  });

  it("patches tools/list to hide payment_id when x402 capability is present", async () => {
    const opts: PayMCPOptions = {
      providers: { mock: { apiKey: "x" } } as any,
      mode: Mode.AUTO,
      stateStore,
    };

    new PayMCP(mockServer, opts);

    const originalList = vi.fn().mockResolvedValue({
      tools: [
        { inputSchema: { properties: { payment_id: { type: "string" } } } },
        { inputSchema: { properties: { other: { type: "string" } } } },
      ],
    });

    handlers.set("tools/list", originalList);

    const listHandler = handlers.get("tools/list");
    const result = await listHandler({}, { sessionId: "s1" });

    expect(result.tools[0].inputSchema.properties.payment_id).toBeUndefined();
    expect(result.tools[1].inputSchema.properties.other).toBeDefined();
  });
});
