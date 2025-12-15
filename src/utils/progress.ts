import { ToolExtraLike } from "../types/config.js";
import { Logger } from "../types/logger.js";


export async function safeReportProgress(
    extra: ToolExtraLike,
    log: Logger,
    message: string,
    progressPct: number,
    totalPct = 100
): Promise<void> {


    // --- Token-based fallback -------------------------------------------------
    // FastMCP Python (and some other clients) expose a progress token in the
    // extra metadata but *not* a callable report_progress. In that case we must
    // emit a protocol-compliant notification ourselves:
    //   method: 'notifications/progress'
    //   params: { progressToken, progress, total, message }
    // If we instead send a made-up method (like 'progress/update') the client
    // will raise Pydantic validation errors (you saw those).
    const sendNote = (extra as any)?.sendNotification;
    const token =
        (extra as any)?._meta?.progressToken ?? (extra as any)?.progressToken;
    if (typeof sendNote === "function" && token !== undefined) {
        try {
            await sendNote({
                method: "notifications/progress",
                params: {
                    progressToken: token,
                    progress: progressPct,
                    total: totalPct,
                    message,
                },
            });
            return;
        } catch (err) {
            log?.warn?.(
                `[PayMCP:Progress] progress-token notify failed: ${(err as Error).message}`
            );
            // fall through to simple log below
        }
    }

    // No usable progress channel; just log so we don't spam invalid notifications.

    log?.debug?.(
        `[PayMCP:Progress] progress ${progressPct}/${totalPct}: ${message}`
    );
}
