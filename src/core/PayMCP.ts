import { PayMCPOptions, PayToolConfig } from "../types/config.js";
import { McpServerLike } from "../types/mcp.js";
import { PaymentFlow } from "../types/payment.js";
import { buildProviders, ProviderInstances } from "../providers/index.js";
import type { ProviderConfig, BasePaymentProvider } from "../providers/index.js";
import { appendPriceToDescription } from "../utils/messages.js";
import { makeFlow } from "../flows/index.js";
import { getCurrentSession } from "./sessionContext.js";

type ProvidersInput = ProviderConfig | BasePaymentProvider[];

export class PayMCP {
    private server: McpServerLike;
    private providers: ProviderInstances;
    private flow: PaymentFlow;
    private wrapperFactory: ReturnType<typeof makeFlow>;
    private originalRegisterTool: McpServerLike["registerTool"];
    private installed = false;

    constructor(server: McpServerLike, opts: PayMCPOptions) {
        this.server = server;
        this.providers = buildProviders(opts.providers as ProvidersInput);
        this.flow = opts.paymentFlow ?? PaymentFlow.TWO_STEP;
        this.wrapperFactory = makeFlow(this.flow);
        this.originalRegisterTool = server.registerTool.bind(server);
        this.patch();
        // Hook into server.connect() for LIST_CHANGE flow to patch tools/list after requestHandlers is created
        if (this.flow === PaymentFlow.LIST_CHANGE) {
            this.patchServerConnect();
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
            const price = config?.price;
            let wrapped = handler;

            if (price) {
                // pick the first provider (or a specific one by name? TBD)
                const provider = Object.values(self.providers)[0];
                if (!provider) {
                    throw new Error(`[PayMCP] No payment provider configured (tool: ${name}).`);
                }

                // append price to the description
                config = {
                    ...config,
                    description: appendPriceToDescription(config.description, price),
                };

                // wrap the handler in a payment flow
                const paymentWrapper = self.wrapperFactory(handler, self.server, provider, price, name);
                // Explicit await wrapper ensures tool handler completes before SDK sends response
                wrapped = async function(...args: any[]): Promise<any> {
                    return await paymentWrapper(...args);
                };
            }

            return self.originalRegisterTool(name, config, wrapped);
        }

        // Monkey-patch
        (this.server as any).registerTool = patchedRegisterTool;
        this.installed = true;
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

    // Hook into server.connect() to patch tools/list handler after requestHandlers is created
    private patchServerConnect() {
        const serverAny = this.server as any;
        const originalConnect = serverAny.connect?.bind(serverAny);

        if (!originalConnect) {
            console.warn('[PayMCP] Server does not have connect() method, LIST_CHANGE filtering may not work');
            return;
        }

        const self = this;
        serverAny.connect = async function(...args: any[]) {
            const result = await originalConnect(...args);
            self.patchToolListing();  // Patch after SDK creates requestHandlers
            return result;
        };
    }

    /**
     * Patch tools/list handler for LIST_CHANGE flow to filter per-session hidden tools.
     *
     * WHY THIS PATCHING IS NECESSARY:
     * The MCP SDK's tools/list handler returns ALL registered tools without session awareness.
     * For LIST_CHANGE flow, we need to dynamically hide/show tools based on payment state
     * for each individual user session.
     *
     * HOW IT WORKS:
     * 1. Intercept the SDK's tools/list handler (_requestHandlers Map)
     * 2. Call original handler to get full tool list
     * 3. Filter tools based on HIDDEN_TOOLS Map (session-specific state from list_change.ts)
     * 4. Hide confirmation tools belonging to OTHER sessions (multi-user isolation)
     * 5. Return filtered list to client
     *
     * SESSION CONTEXT:
     * getCurrentSession() reads from AsyncLocalStorage set by runWithSession() in demo server.
     * This provides the session ID needed to look up which tools should be hidden for THIS user.
     *
     * ALTERNATIVE APPROACHES CONSIDERED:
     * - JavaScript Proxy on _registeredTools: Rejected - doesn't work for Map access patterns
     * - Patching server.tools directly: Rejected - SDK uses internal _registeredTools in v1.16.0+
     * - Handler interception (current): Chosen - works with SDK architecture, minimal invasiveness
     */
    private patchToolListing() {
        import("../flows/list_change.js").then((listChangeModule) => {
            const HIDDEN_TOOLS = (listChangeModule as any).HIDDEN_TOOLS;
            const CONFIRMATION_TOOLS = (listChangeModule as any).CONFIRMATION_TOOLS;

            const serverAny = this.server as any;
            const protocolServer = serverAny.server ?? serverAny;
            const handlers: Map<string, any> | undefined = protocolServer._requestHandlers;

            if (!handlers?.has('tools/list')) {
                console.warn('[PayMCP] _requestHandlers missing tools/list; LIST_CHANGE filtering will not run');
                return;
            }

            const originalListHandler = handlers.get('tools/list');

            // Replace tools/list handler with filtering wrapper
            handlers.set('tools/list', async (request: any, extra: any) => {
                const result = await originalListHandler(request, extra);
                const sessionId = getCurrentSession();

                if (!sessionId || !HIDDEN_TOOLS) {
                    return result;  // No session context
                }

                const sessionHidden = HIDDEN_TOOLS.get(sessionId);
                if (!sessionHidden && !CONFIRMATION_TOOLS) {
                    return result;  // No filtering needed
                }

                // Filter tools based on per-session hidden tools and confirmation tools
                const filteredTools = result.tools.filter((tool: any) => {
                    const toolName = tool.name;

                    if (sessionHidden && sessionHidden.has(toolName)) {
                        return false;  // Hide if in this session's hidden tools
                    }

                    if (CONFIRMATION_TOOLS && CONFIRMATION_TOOLS.has(toolName)) {
                        const toolSessionId = CONFIRMATION_TOOLS.get(toolName);
                        if (toolSessionId !== sessionId) {
                            return false;  // Hide confirmation tools from other sessions
                        }
                    }

                    return true;
                });

                return { ...result, tools: filteredTools };
            });
        }).catch((err) => {
            console.error('[PayMCP] Failed to patch tool listing for LIST_CHANGE:', err);
        });
    }
}

export function installPayMCP(server: McpServerLike, opts: PayMCPOptions): PayMCP {
    return new PayMCP(server, opts);
}