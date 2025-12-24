// ---------------------------------------------------------------------------
// Helper: safely invoke the original tool handler preserving args shape

import { ToolExtraLike } from "../types/config.js";
import { ToolHandler } from "../types/flows.js";

// ---------------------------------------------------------------------------
export async function callOriginal(
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