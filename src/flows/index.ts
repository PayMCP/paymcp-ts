// lib/ts/paymcp/src/flows/index.ts
import type { FlowModule, PaidWrapperFactory } from "../types/flows.js";
import * as elicitationMod from "./elicitation.js";
import * as twoStepMod from "./two_step.js";
import * as resubmitMod from "./resubmit.js";
import * as progressMod from "./progress.js";
import * as dynamicToolsMod from "./dynamic_tools.js";


/** Registry of known flows. */
const FLOW_MAP: Record<string, FlowModule> = {
  elicitation: elicitationMod,
  two_step: twoStepMod,
  progress: progressMod,
  dynamic_tools: dynamicToolsMod,
  list_change: dynamicToolsMod,
  resubmit: resubmitMod
};

/** Select a flow by name (case-insensitive) or throw an error. */
export function makeFlow(name: string): PaidWrapperFactory {
  const key = name.toLowerCase();
  const mod = FLOW_MAP[key];
  if (!mod) {
    throw new Error(`[PayMCP] Unknown payment flow: ${name}`);
  }
  return mod.makePaidWrapper;
}
