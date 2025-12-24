import { describe, it, expect, vi, beforeEach } from "vitest";
import { makePaidWrapper } from "../../src/flows/auto.js";
import type { BasePaymentProvider } from "../../src/providers/base.js";
import type { PriceConfig, ToolExtraLike } from "../../src/types/config.js";
import type { McpServerLike } from "../../src/types/mcp.js";

describe("AUTO Flow", () => {
  let mockProvider: BasePaymentProvider;
  let mockServer: McpServerLike;
  let mockLogger: any;
  let mockStateStore: any;
  let priceInfo: PriceConfig;

  beforeEach(() => {
    mockProvider = {
      createPayment: vi.fn().mockResolvedValue({
        paymentId: "payment_123",
        paymentUrl: "https://payment.example.com/123",
      }),
      getPaymentStatus: vi.fn().mockResolvedValue("paid"),
      logger: undefined,
    } as any;

    mockServer = {} as any;

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockStateStore = {
      set: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      lock: vi.fn().mockImplementation(async (_key: string, fn: () => Promise<any>) => await fn()),
    };

    priceInfo = { amount: 10, currency: "USD" };
  });

  it("routes to elicitation when client supports it", async () => {
    const clientInfo = () => ({ name: "test", capabilities: { elicitation: true } });
    const mockTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    const wrapper = makePaidWrapper(
      mockTool,
      mockServer,
      mockProvider,
      priceInfo,
      "testTool",
      mockStateStore,
      {},
      clientInfo,
      mockLogger
    );

    const extra: ToolExtraLike = {
      sendRequest: vi.fn().mockResolvedValue({ action: "accept" }),
    } as any;

    const result = await wrapper({ foo: "bar" }, extra);

    expect(extra.sendRequest).toHaveBeenCalled();
    expect(mockProvider.createPayment).toHaveBeenCalled();
    expect(mockTool).toHaveBeenCalledWith({ foo: "bar" }, extra);
    expect(result.annotations?.payment?.status).toBe("paid");
  });

  it("routes to resubmit when elicitation capability is missing", async () => {
    const clientInfo = () => ({ name: "test", capabilities: {} });
    const mockTool = vi.fn();

    const wrapper = makePaidWrapper(
      mockTool,
      mockServer,
      mockProvider,
      priceInfo,
      "testTool",
      mockStateStore,
      {},
      clientInfo,
      mockLogger
    );

    const extra: ToolExtraLike = {
      sendRequest: vi.fn(),
    } as any;

    await expect(wrapper({ foo: "bar" }, extra)).rejects.toMatchObject({
      code: 402,
      error: "payment_required",
    });

    expect(extra.sendRequest).not.toHaveBeenCalled();
    expect(mockTool).not.toHaveBeenCalled();
  });
});

