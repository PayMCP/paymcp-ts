import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildX402middleware } from "../../src/utils/x402.js";
import { Mode } from "../../src/types/payment.js";

describe("buildX402middleware", () => {
  const toolName = "testTool";
  const paidtools = {
    [toolName]: { amount: 1, currency: "USD", description: "Test fee" },
  };

  let mockProvider: any;
  let mockStateStore: any;
  let mockLogger: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    mockProvider = {
      createPayment: vi.fn().mockResolvedValue({
        paymentId: "pay_123",
        paymentData: { x402Version: 2 },
      }),
    };
    mockStateStore = {
      set: vi.fn(),
    };
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    res = {
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  it("returns 402 and stores payment data for x402 v2", async () => {
    const providers = { x402: mockProvider };
    const getClientInfo = vi.fn().mockResolvedValue({
      sessionId: "s1",
      capabilities: { x402: true },
    });
    const req = {
      body: { method: "tools/call", params: { name: toolName } },
      headers: { "mcp-session-id": "s1" },
    };

    const middleware = buildX402middleware(
      providers as any,
      mockStateStore,
      paidtools,
      Mode.AUTO,
      getClientInfo,
      mockLogger
    );

    await middleware(req, res, next);

    expect(mockProvider.createPayment).toHaveBeenCalledWith(1, "USD", "Test fee");
    expect(mockStateStore.set).toHaveBeenCalledWith("pay_123", { paymentData: { x402Version: 2 } });
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.setHeader).toHaveBeenCalledWith("PAYMENT-REQUIRED", expect.any(String));
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
    expect(res.json).toHaveBeenCalledWith({ x402Version: 2 });
    expect(next).not.toHaveBeenCalled();
  });

  it("stores v1 payment data by session id and tool name", async () => {
    mockProvider.createPayment.mockResolvedValueOnce({
      paymentId: "pay_123",
      paymentData: { x402Version: 1 },
    });

    const providers = { x402: mockProvider };
    const getClientInfo = vi.fn().mockResolvedValue({
      sessionId: "s1",
      capabilities: { x402: true },
    });
    const req = {
      body: { method: "tools/call", params: { name: toolName } },
      headers: { "mcp-session-id": "s1" },
    };

    const middleware = buildX402middleware(
      providers as any,
      mockStateStore,
      paidtools,
      Mode.X402,
      getClientInfo,
      mockLogger
    );

    await middleware(req, res, next);

    expect(mockStateStore.set).toHaveBeenCalledWith("s1-testTool", { paymentData: { x402Version: 1 } });
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith({ x402Version: 1 });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when v1 response lacks session id", async () => {
    mockProvider.createPayment.mockResolvedValueOnce({
      paymentId: "pay_123",
      paymentData: { x402Version: 1 },
    });

    const providers = { x402: mockProvider };
    const getClientInfo = vi.fn().mockResolvedValue({
      capabilities: { x402: true },
    });
    const req = {
      body: { method: "tools/call", params: { name: toolName } },
      headers: { "mcp-session-id": "s1" },
    };

    const middleware = buildX402middleware(
      providers as any,
      mockStateStore,
      paidtools,
      Mode.X402,
      getClientInfo,
      mockLogger
    );

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith("Error: No session id provided by MCP client");
    expect(mockStateStore.set).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("skips payment when payment signature is provided", async () => {
    const providers = { x402: mockProvider };
    const getClientInfo = vi.fn().mockResolvedValue({
      sessionId: "s1",
      capabilities: { x402: true },
    });
    const req = {
      body: { method: "tools/call", params: { name: toolName } },
      headers: {
        "mcp-session-id": "s1",
        "payment-signature": "sig",
      },
    };

    const middleware = buildX402middleware(
      providers as any,
      mockStateStore,
      paidtools,
      Mode.X402,
      getClientInfo,
      mockLogger
    );

    await middleware(req, res, next);

    expect(mockProvider.createPayment).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
