import { PayMCPOptions, PayToolConfig } from "../types/config.js";
import { McpServerLike } from "../types/mcp.js";
import { Mode } from "../types/payment.js";
import { buildProviders, ProviderInstances } from "../providers/index.js";
import type { ProviderConfig, BasePaymentProvider } from "../providers/index.js";
import { appendPriceToDescription } from "../utils/messages.js";
import { makeFlow } from "../flows/index.js";
import { StateStore } from "../types/state.js";
import { InMemoryStateStore } from "../state/inMemory.js";
import { setup as setupDynamicTools } from "../flows/dynamic_tools.js";
import { z } from "zod";
import { makeSubscriptionWrapper, registerSubscriptionTools } from "../subscriptions/index.js";
import { buildX402middleware } from "../utils/x402.js";

type ProvidersInput = ProviderConfig | BasePaymentProvider[];

export class PayMCP {
    private server: McpServerLike;
    private providers: ProviderInstances;
    private flow: Mode;
    private stateStore: StateStore;
    private wrapperFactory: ReturnType<typeof makeFlow>;
    private originalRegisterTool: McpServerLike["registerTool"];
    private installed = false;
    private subscriptionToolsRegistered = false;
    private clientInfo = {name:"Unknown client", capabilities: {}}
    private logger;
    private paidtools: Record<string, {amount:number,currency:string,description?:string}>={}

    constructor(server: McpServerLike, opts: PayMCPOptions) {
        this.logger = opts.logger ?? console;
        this.server = server;
        this.providers = buildProviders(opts.providers as ProvidersInput);
        this.flow = opts.mode ?? opts.paymentFlow ?? Mode.AUTO;
        if (opts.mode && opts.paymentFlow && opts.mode !== opts.paymentFlow) {
            this.logger.warn?.("[PayMCP] Both `mode` and `paymentFlow` were provided; `mode` takes precedence. `paymentFlow` will be deprecated soon.");
        }
        this.stateStore = opts.stateStore ?? new InMemoryStateStore();
        
        if (Object.keys(this.providers)[0]==='x402') {
            this.logger.log("[PayMCP] `Mode` parameter will be ignored for x402 provider");
            this.wrapperFactory = makeFlow("x402");
        } else {
             this.wrapperFactory = makeFlow(this.flow);
        }
        
        this.originalRegisterTool = server.registerTool.bind(server);
        this.patch();
        this.patchInitialize();

        // DYNAMIC_TOOLS flow requires patching server.connect() and tools/list handler
        // CRITICAL: Must be synchronous to patch server.connect() BEFORE it's called
        if (this.flow === Mode.DYNAMIC_TOOLS) {
            setupDynamicTools(server);
        }

        if (opts.retrofitExisting) {
            // Try to re-register existing tools (if SDK allows)
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

    /** Main monkey-patch */
    private patch() {
        if (this.installed) return;
        const self = this;

        function patchedRegisterTool(
            name: string,
            config: PayToolConfig,
            handler: (...args: any[]) => Promise<any> | any
        ) {
            const price = config?.price || config._meta?.price;
            const subscription = config?.subscription || config._meta?.subscription;
            let wrapped = handler;

            if (subscription) {
                if (!self.subscriptionToolsRegistered) {
                    registerSubscriptionTools(self.server, self.providers);
                    self.subscriptionToolsRegistered = true;
                }

                const subscriptionWrapper = makeSubscriptionWrapper(
                    handler,
                    self.server,
                    self.providers,
                    subscription,
                    name,
                    self.stateStore,
                    config,
                    self.getClientInfo,
                    self.logger
                );

                wrapped = async function (...args: any[]): Promise<any> {
                    return await subscriptionWrapper(...args);
                };

            } else if (price) {
                // append price to the description
                config = {
                    ...config,
                    description: appendPriceToDescription(config.description, price),
                };

                // wrap the handler in a payment flow
                const paymentWrapper = self.wrapperFactory(
                    handler, self.server, self.providers, price, name, self.stateStore, config, self.getClientInfo, self.logger
                );

                if (config._meta && [Mode.TWO_STEP, Mode.DYNAMIC_TOOLS].includes(self.flow)) { //removing _meta from original tool - it's added to confirm tool
                    delete config._meta
                }

                if (
                    config.inputSchema &&
                    [Mode.RESUBMIT, Mode.AUTO].includes(self.flow) &&
                    typeof config.inputSchema === 'object'
                ) {
                    const schema = config.inputSchema as Record<string, any>;
                    // Add optional payment_id field with description
                    schema.payment_id = z.string().optional().describe(
                        "Optional payment identifier returned by a previous call when payment is required"
                    );
                }
                self.paidtools[name]={amount:price.amount,currency:price.currency,description:config.description};
                wrapped = async function (...args: any[]): Promise<any> {
                    return await paymentWrapper(...args);
                };
            }

            return self.originalRegisterTool(name, config, wrapped);
        }

        // Monkey-patch
        (this.server as any).registerTool = patchedRegisterTool;
        this.installed = true;
    }

    /** Intercept initialize to capture client capabilities per session. */
    private patchInitialize() {
        const srv: any = (this.server as any).server ?? this.server;
        const handlers = srv?._requestHandlers;
        if (!handlers?.has?.('initialize')) return;

        const original = handlers.get('initialize');
        if ((original as any)?._paymcp_caps_patched) return;

        const patched = async (request: any, extra: any) => {
            const clientInfo = request?.params?.clientInfo ?? {"name":"Unknown client"};
            Object.assign(this.clientInfo, { name: clientInfo.name, sessionId: extra?.sessionId, capabilities: request?.params?.capabilities ?? {} });
            this.logger.debug(`[PayMCP] Client: ${JSON.stringify(this.clientInfo)}`);
            return await original(request, extra);
        };

        (patched as any)._paymcp_caps_patched = true;
        handlers.set('initialize', patched);
    }

    /**
     * Best-effort: go through already registered tools and re-wrap.
     * SDK may not have a public API; cautiously checking private fields.
     */
    private retrofitExistingTools() {
        const toolMap: Map<string, any> | undefined = (this.server as any)?.tools;
        if (!toolMap) return;

        for (const [name, entry] of toolMap.entries()) {
            const cfg: PayToolConfig = entry.config;
            const h = entry.handler;
            if (!cfg?.price) continue;

            // re-register using the patch (it will wrap automatically)
            (this.server as any).registerTool(name, cfg, h);
        }
    }

    getClientInfo=()=>{
        return this.clientInfo;
    }

    getX402Middleware=()=>{
        return buildX402middleware(this.providers, this.stateStore, this.paidtools, this.logger);
    }
}

export function installPayMCP(server: McpServerLike, opts: PayMCPOptions): PayMCP {
    return new PayMCP(server, opts);
}
