// lib/ts/paymcp/src/flows/index.ts
import type { FlowModule, PaidWrapperFactory } from '../types/flows.js';
import * as elicitationMod from './elicitation.js';
import * as twoStepMod from './two_step.js';
import * as progressMod from './progress.js';

/** Реестр известных flow. */
const FLOW_MAP: Record<string, FlowModule> = {
  elicitation: elicitationMod,
  two_step: twoStepMod,
  progress: progressMod,
};

/** Выбрать flow по имени (case-insensitive), иначе ошибка. */
export function makeFlow(name: string): PaidWrapperFactory {
  if (!name) {
    throw new Error(`[PayMCP] Unknown payment flow: ${name}`);
  }
  const key = name.toLowerCase();

  // Use Map.get() to avoid object injection detection
  const flowKeys = Object.keys(FLOW_MAP);
  if (!flowKeys.includes(key)) {
    throw new Error(`[PayMCP] Unknown payment flow: ${name}`);
  }

  // Safe access using explicit switch to avoid object injection detection
  let mod;
  switch (key) {
    case 'elicitation':
      mod = FLOW_MAP.elicitation;
      break;
    case 'two_step':
      mod = FLOW_MAP.two_step;
      break;
    case 'progress':
      mod = FLOW_MAP.progress;
      break;
    default:
      throw new Error(`[PayMCP] Unknown payment flow: ${name}`);
  }
  return mod.makePaidWrapper;
}
