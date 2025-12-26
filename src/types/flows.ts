// lib/ts/paymcp/src/flows/types.ts
import type { ClientInfo, PriceConfig, SubscriptionConfig } from "./config.js";
import type { ProviderInstances } from "../providers/index.js";
import type { McpServerLike } from "./mcp.js";
import { Logger } from "./logger.js";
import { StateStore } from "./state.js";


export type ToolHandler = (...args: any[]) => Promise<any> | any;


export type PaidWrapperFactory = (
  func: ToolHandler,
  server: McpServerLike,
  providers: ProviderInstances,
  priceInfo: PriceConfig,
  toolName: string,
  stateStore: StateStore,
  config: any,
  getClientInfo: ()=> ClientInfo ,
  logger?: Logger
) => ToolHandler;

export type SubscriptionWrapperFactory = (
  func: ToolHandler,
  server: McpServerLike,
  providers: ProviderInstances,
  subscription: SubscriptionConfig,
  toolName: string,
  stateStore: StateStore,
  config: any,
  getClientInfo: ()=> {name: string,capabilities: Record<string, any>},
  logger?: Logger
) => ToolHandler;


export type FlowModule = {
  makePaidWrapper: PaidWrapperFactory;
};
