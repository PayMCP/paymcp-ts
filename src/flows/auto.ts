// AUTO flow: chooses between ELICITATION and RESUBMIT at runtime based on client capabilities.

import type { PaidWrapperFactory, ToolHandler } from "../types/flows.js";
import type { ToolExtraLike } from "../types/config.js";
import { Logger } from "../types/logger.js";
import { makePaidWrapper as makeElicitationWrapper } from "./elicitation.js";
import { makePaidWrapper as makeResubmitWrapper } from "./resubmit.js";
import { makePaidWrapper as makeX402Wrapper } from "./x402.js";

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

  const getElicitationWrapper = () => makeElicitationWrapper(
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

  const getResubmitWrapper = () => makeResubmitWrapper(
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

  const getX402Wrapper = () => makeX402Wrapper(
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
    // Normalize (args, extra) vs (extra) call shapes (SDK calls tool cb this way).
    const hasArgs = arguments.length === 2;
    const extra: ToolExtraLike = hasArgs
      ? (maybeExtra as ToolExtraLike)
      : (paramsOrExtra as ToolExtraLike);
    const clientInfo = await getClientInfo(extra.sessionId as string) ?? { name: "Unknown client", capabilities: {} };
    const hasX402 = Boolean((clientInfo as any)?.capabilities?.x402) && Object.keys(providers).includes("x402");
    const hasElicitation = Boolean((clientInfo as any)?.capabilities?.elicitation);
    logger?.debug?.(
      `[PayMCP:AUTO] tool=${toolName} client=${clientInfo?.name ?? "unknown"} elicitation=${hasElicitation}`
    );


    const selected = hasX402
      ? getX402Wrapper()
      : (hasElicitation
        ? getElicitationWrapper()
        : getResubmitWrapper());
    if (arguments.length === 2) {
      return await (selected as ToolHandler)(paramsOrExtra, maybeExtra as ToolExtraLike);
    }
    return await (selected as ToolHandler)(paramsOrExtra as ToolExtraLike);
  }

  return wrapper as unknown as ToolHandler;
};
