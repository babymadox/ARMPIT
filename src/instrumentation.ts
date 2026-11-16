import type { Instrumentation } from "next";

/** Records every server-side error (page render, server action, route handler) with the digest shown on the error page. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logEvent } = await import("./lib/log");
  const e = err as Error & { digest?: string };
  await logEvent({
    level: "error", source: `${context.routeType}:${context.routePath}`, message: e.message || "Unknown error", digest: e.digest,
    details: { method: request.method, path: request.path.split("?")[0], render: context.renderSource, stack: e.stack?.split("\n").slice(1, 6) },
  });
};
