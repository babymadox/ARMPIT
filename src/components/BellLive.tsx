"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Refreshes the page chrome (unread badge) when a notification for this member arrives. Realtime respects row level security. */
export function BellLive({ memberId }: { memberId: string }) {
  const router = useRouter();
  useEffect(() => {
    const db = supabaseBrowser();
    let t: ReturnType<typeof setTimeout> | undefined;
    const ch = db.channel(`bell-${memberId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `member_id=eq.${memberId}` }, () => { clearTimeout(t); t = setTimeout(() => router.refresh(), 500); })
      .subscribe();
    return () => { clearTimeout(t); db.removeChannel(ch); };
  }, [memberId, router]);
  return null;
}
