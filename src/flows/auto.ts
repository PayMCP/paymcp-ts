// AUTO flow: chooses between ELICITATION and RESUBMIT at runtime based on client capabilities.

import type { PaidWrapperFactory, ToolHandler } from "../types/flows.js";
import type { ToolExtraLike } from "../types/config.js";
import { Logger } from "../types/logger.js";
import { makePaidWrapper as makeElicitationWrapper } from "./elicitation.js";
import { makePaidWrapper as makeResubmitWrapper } from "./resubmit.js";

export const makePaidWrapper: PaidWrapperFactory = (
  func,
  server,
  providers,
  priceInfo,
  toolName,
  stateStore,
  config,
  getClientInfo,
  logger
) => {
  const provider = Object.values(providers)[0];
  if (!provider) {
    throw new Error(`[PayMCP] No payment provider configured (tool: ${toolName}).`);
  }
  const log: Logger = logger ?? (provider as any).logger ?? console;

  const elicitationWrapper = makeElicitationWrapper(
    func,
    server,
    providers,
    priceInfo,
    toolName,
    stateStore,
    config,
    getClientInfo,
    logger
  );

  const resubmitWrapper = makeResubmitWrapper(
    func,
    server,
    providers,
    priceInfo,
    toolName,
    stateStore,
    config,
    getClientInfo,
    logger
  );

  async function wrapper(paramsOrExtra: any, maybeExtra?: ToolExtraLike) {
    const clientInfo = getClientInfo?.() ?? { name: "Unknown client", capabilities: {} };
    const hasElicitation = Boolean((clientInfo as any)?.capabilities?.elicitation);
    log.debug?.(
      `[PayMCP:AUTO] tool=${toolName} client=${clientInfo?.name ?? "unknown"} elicitation=${hasElicitation}`
    );

    const selected = hasElicitation ? elicitationWrapper : resubmitWrapper;
    if (arguments.length === 2) {
      return await (selected as ToolHandler)(paramsOrExtra, maybeExtra as ToolExtraLike);
    }
    return await (selected as ToolHandler)(paramsOrExtra as ToolExtraLike);
  }

  return wrapper as unknown as ToolHandler;
};
