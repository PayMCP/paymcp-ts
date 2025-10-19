import { PayMCPOptions, PayToolConfig } from "../types/config.js";
import { McpServerLike } from "../types/mcp.js";
import { PaymentFlow } from "../types/payment.js";
import { buildProviders, ProviderInstances } from "../providers/index.js";
import type { ProviderConfig, BasePaymentProvider } from "../providers/index.js";
import { appendPriceToDescription } from "../utils/messages.js";
import { makeFlow } from "../flows/index.js";
import { StateStore } from "../types/state.js";
import { InMemoryStateStore } from "../state/inMemory.js";

type ProvidersInput = ProviderConfig | BasePaymentProvider[];

export class PayMCP {
    private server: McpServerLike;
    private providers: ProviderInstances;
    private flow: PaymentFlow;
    private stateStore: StateStore;
    private flowModule: ReturnType<typeof makeFlow>;
    private originalRegisterTool: McpServerLike["registerTool"];
    private installed = false;

    constructor(server: McpServerLike, opts: PayMCPOptions) {
        this.server = server;
        this.providers = buildProviders(opts.providers as ProvidersInput);
        this.flow = opts.paymentFlow ?? PaymentFlow.TWO_STEP;
        this.stateStore = opts.stateStore ?? new InMemoryStateStore();
        this.flowModule = makeFlow(this.flow);
        this.originalRegisterTool = server.registerTool.bind(server);

        this.patch();

        /**
         * Delegate flow-specific initialization to the flow module.
         *
         * Each payment flow may have unique setup requirements:
         * - LIST_CHANGE: Patches server.connect() and tools/list handler for per-session filtering
         * - TWO_STEP, ELICITATION, PROGRESS: No special setup needed (setup is optional)
         *
         * This delegation pattern keeps PayMCP core simple and flow-agnostic.
         * Flow modules handle their own complexity via the optional setup(server) method.
         */
        this.flowModule.setup?.(server);

        if (opts.retrofitExisting) {
            this.retrofitExistingTools();
        }
    }

    /** Return server (useful for chaining) */
    getServer() {
        return this.server;
    }

    /** Remove patch (for tests / teardown) */
    uninstall() {
        if (!this.installed) return;
        (this.server as any).registerTool = this.originalRegisterTool;
        this.installed = false;
    }

    /** Patch registerTool to wrap paid tools */
    private patch() {
        if (this.installed) return;
        const self = this;

        function patchedRegisterTool(
            name: string,
            config: PayToolConfig,
            handler: (...args: any[]) => Promise<any> | any
        ) {
            const price = config?.price;
            let wrapped = handler;

            if (price) {
                const provider = Object.values(self.providers)[0];
                if (!provider) {
                    throw new Error(`[PayMCP] No payment provider configured (tool: ${name}).`);
                }

                config = {
                    ...config,
                    description: appendPriceToDescription(config.description, price),
                };

                /**
                 * ARCHITECTURAL NOTE: Why flowModule.makePaidWrapper instead of direct wrapperFactory?
                 *
                 * Previously (before refactoring):
                 * - We stored: `wrapperFactory: PaidWrapperFactory`
                 * - Flow-specific logic was embedded in PayMCP (e.g., patchServerConnect, patchToolListing)
                 * - Result: ~240 lines, violation of Single Responsibility Principle
                 *
                 * Now (after refactoring):
                 * - We store: `flowModule: FlowModule` (which contains { makePaidWrapper, setup? })
                 * - Each flow module handles its own initialization via optional setup(server) method
                 * - PayMCP core delegates: `flowModule.setup?.(server)` in constructor
                 * - Result: ~107 lines, clear separation of concerns
                 *
                 * Benefits:
                 * 1. DRY: Flow-specific logic lives with the flow, not in core
                 * 2. Extensibility: New flows add their logic in their own module
                 * 3. Maintainability: Changes to flow behavior don't touch core
                 * 4. Testability: Flow setup can be tested independently
                 *
                 * Example: LIST_CHANGE flow needs to patch tools/list handler for per-session
                 * filtering. This logic now lives in list_change.ts::setup() instead of
                 * cluttering PayMCP with conditional flow-specific code.
                 */
                const paymentWrapper = self.flowModule.makePaidWrapper(
                    handler, self.server, provider, price, name, self.stateStore
                );

                wrapped = async function(...args: any[]): Promise<any> {
                    return await paymentWrapper(...args);
                };
            }

            return self.originalRegisterTool(name, config, wrapped);
        }

        (this.server as any).registerTool = patchedRegisterTool;
        this.installed = true;
    }

    /** Retrofit existing tools with payment wrapping */
    private retrofitExistingTools() {
        const toolMap: Map<string, any> | undefined = (this.server as any)?.tools;
        if (!toolMap) return;

        for (const [name, entry] of toolMap.entries()) {
            const cfg: PayToolConfig = entry.config;
            const h = entry.handler;
            if (!cfg?.price) continue;
            (this.server as any).registerTool(name, cfg, h);
        }
    }
}

export function installPayMCP(server: McpServerLike, opts: PayMCPOptions): PayMCP {
    return new PayMCP(server, opts);
}
