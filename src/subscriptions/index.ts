import { SubscriptionConfig, ToolExtraLike } from "../types/config.js";
import { SubscriptionWrapperFactory, ToolHandler } from "../types/flows.js";
import { Logger } from "../types/logger.js";
import { z } from "zod";

async function ensureSubscriptionAllowed(
    provider: unknown,
    subscriptionInfo: SubscriptionConfig,
    userId: string,
    toolName: string,
    log: Logger,
): Promise<void> {
    // subscriptionInfo.plan can be:
    //  - a string with a required plan id
    //  - an array of required plan ids (user must have at least one of them)
    if (!subscriptionInfo) {
        return;
    }

    const raw = subscriptionInfo.plan;

    let requiredPlans: string[] = [];
    if (Array.isArray(raw)) {
        requiredPlans = raw.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
        );
    } else if (typeof raw === "string" && raw.length > 0) {
        requiredPlans = [raw];
    }

    if (requiredPlans.length === 0) {
        return;
    }

    let subsResult: any;
    try {
        // This may throw if the provider does not support subscriptions.
        subsResult = await (provider as any).getSubscriptions(userId);
    } catch (err: any) {
        const msg = String(err?.message ?? err);

        // If the provider explicitly reports that it does not support subscriptions,
        // convert this into a clear "provider does not support subscriptions" error.
        if (msg.includes("Subscriptions are not supported for this payment provider")) {
            log?.warn?.(
                `[PayMCP:Subscriptions] provider does not support subscriptions (tool=${toolName}): ${msg}`,
            );
            throw new Error(
                "Subscriptions are required for this tool, but the current payment provider does not support subscription checks.",
            );
        }

        // Otherwise, this is some other error (e.g. Stripe HTTP error, bug, etc.).
        // Log it and rethrow as-is so callers see the real cause.
        log?.error?.(
            `[PayMCP:Subscriptions] error while checking subscriptions (tool=${toolName}): ${msg}`,
        );
        throw err;
    }

    const currentSubs: any[] =
        subsResult?.current_subscriptions ??
        subsResult?.currentSubscriptions ??
        [];

    // Normalize current subscriptions to a simple shape with planId + status where possible.
    const normalized = currentSubs
        .map((sub) => {
            const planId = sub.planId ?? sub.priceId ?? sub.plan_id;
            const status = (sub.status ?? "").toString().toLowerCase();
            return { planId, status };
        })
        .filter((s) => typeof s.planId === "string" && s.planId.length > 0);

    const hasRequired = normalized.some((s) => {
        const active =
            s.status === "active" ||
            s.status === "trialing" ||
            s.status === "past_due";
        return active && requiredPlans.includes(s.planId);
    });

    if (!hasRequired) {
        const available =
            subsResult?.available_subscriptions ??
            subsResult?.availableSubscriptions ??
            [];

        log?.info?.(
            `[PayMCP:Subscriptions] subscription required for tool=${toolName}, userId=${userId}, requiredPlans=${requiredPlans.join(
                ",",
            )}`,
        );

        // Throw an error that also contains information about available subscriptions
        // so the client can show something meaningful to the user.
        const errorPayload = {
            error: "subscription_required",
            message:
                "A subscription is required to use this tool. Please purchase one of the required plans.",
            tool: toolName,
            available_subscriptions: available,
        };

        throw new Error(JSON.stringify(errorPayload));
    }
}

export const makeSubscriptionWrapper: SubscriptionWrapperFactory = (
    func,
    server,
    provider,
    subscriptionInfo,
    toolName,
    stateStore,
    _config,
    logger,
) => {
    const log: Logger = logger ?? (provider as any).logger ?? console;

    async function wrapper(paramsOrExtra: any, maybeExtra?: ToolExtraLike) {
        const hasArgs = arguments.length === 2;
        const toolArgs = hasArgs ? paramsOrExtra : undefined;
        const extra: ToolExtraLike = hasArgs
            ? (maybeExtra as ToolExtraLike)
            : (paramsOrExtra as ToolExtraLike);
        log?.debug?.(
            `[PayMCP:Resubmit] wrapper invoked for tool=${toolName} argsLen=${arguments.length}`
        );

        const userId = extra.authInfo?.userId;
        if (!userId) {
            log?.error?.(`User ID is required in authInfo for subscription tools (tool: ${toolName})`);
            throw new Error(`Not authorized`);
        }
        await ensureSubscriptionAllowed(provider, subscriptionInfo, userId, toolName, log);

        const toolResult = await callOriginal(func, toolArgs, extra);
        return toolResult;
    }

    return wrapper as unknown as ToolHandler;
}

// ---------------------------------------------------------------------------
// Helper: safely invoke the original tool handler preserving args shape
// ---------------------------------------------------------------------------
async function callOriginal(
    func: ToolHandler,
    args: any | undefined,
    extra: ToolExtraLike
) {
    if (args !== undefined) {
        return await func(args, extra);
    } else {
        return await func(extra);
    }
}

export function registerSubscriptionTools(
    server: unknown,
    provider: {
        getSubscriptions: (userId: string) => Promise<any>;
        startSubscription: (planId: string, userId: string, email?: string) => Promise<any>;
        cancelSubscription: (subscriptionId: string, userId: string) => Promise<any>;
    },
    logger?: Logger,
) {
    const srvAny = server as any;
    const log: Logger = logger ?? (provider as any).logger ?? console;

    srvAny.registerTool(
        "list_subscriptions",
        {
            title: "List current and available subscriptions",
            description:
                "Returns the current subscriptions for the authenticated user and the available subscription plans.",
        },
        async (extra: ToolExtraLike) => {
            const userId = extra.authInfo?.userId;
            if (!userId) {
                log?.error?.(
                    "[PayMCP:Subscriptions] User ID is required in authInfo for list_subscriptions tool",
                );
                throw new Error("Not authorized");
            }

            const payload = await provider.getSubscriptions(userId);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(payload, null, 2),
                    },
                ],
            };
        },
    );

    srvAny.registerTool(
        "start_subscription",
        {
            title: "Start a subscription",
            description:
                "Starts a subscription for the authenticated user for the given plan.",
            inputSchema: z
                .object({
                    planId: z
                        .string()
                        .min(1)
                        .describe("Plan identifier to start a subscription for."),
                })
                .describe(
                    "Provide the planId (pricing identifier) to start a subscription for.",
                ),
        },
        async (input: { planId: string }, extra: ToolExtraLike) => {
            const userId = extra.authInfo?.userId;
            const planId = input.planId
            if (!userId) {
                log?.error?.(
                    "[PayMCP:Subscriptions] User ID is required in authInfo for start_subscription tool",
                );
                throw new Error("Not authorized");
            }

            if (!planId) {
                log?.error?.(
                    "[PayMCP:Subscriptions] planId is required for start_subscription tool",
                );
                throw new Error("planId is required to start a subscription");
            }

            const email: string | undefined = (extra.authInfo as any)?.email;

            const sub = await provider.startSubscription(planId, userId, email);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(sub),
                    },
                ],
            }
        },
    );

    srvAny.registerTool(
        "cancel_subscription",
        {
            title: "Cancel a subscription",
            description:
                "Cancels a subscription for the authenticated user by subscription id.",
            inputSchema: z
                .object({
                    subscriptionId: z
                        .string()
                        .min(1)
                        .describe("Identifier of the subscription to cancel."),
                })
                .describe(
                    "Provide the subscriptionId to cancel.",
                ),
        },
        async (input: {subscriptionId: string}, extra: ToolExtraLike) => {
            const userId = extra.authInfo?.userId;
            const subscriptionId = input.subscriptionId;
            if (!userId) {
                log?.error?.(
                    "[PayMCP:Subscriptions] User ID is required in authInfo for cancel_subscription tool",
                );
                throw new Error("Not authorized");
            }

            if (!subscriptionId) {
                log?.error?.(
                    "[PayMCP:Subscriptions] subscriptionId is required for cancel_subscription tool",
                );
                throw new Error("subscriptionId is required to cancel a subscription");
            }

            const result = await provider.cancelSubscription(subscriptionId, userId);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            result,
                            null,
                            2,
                        ),
                    },
                ],
            }
        },
    );
}