"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** IMAP has no push, so while the Inbox is open and visible we ask the server to check mail every 90 seconds. */
export function MailSync() {
  const router = useRouter();
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try { const r = await fetch("/api/mail/sync", { method: "POST" }); const j = await r.json().catch(() => null); if (j?.imported > 0) router.refresh(); } catch { /* offline: try again next time */ }
      }
      timer = setTimeout(run, 90_000);
    };
    run();
    return () => { stop = true; clearTimeout(timer); };
  }, [router]);
  return null;
}
