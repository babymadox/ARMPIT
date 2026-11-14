"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Re-renders the inbox when a message or conversation changes. Realtime respects row level security. */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const db = supabaseBrowser();
    let t: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(t); t = setTimeout(() => router.refresh(), 600); };   // coalesce bursts
    const ch = db.channel("inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, bump)
      .subscribe();
    return () => { clearTimeout(t); db.removeChannel(ch); };
  }, [router]);
  return null;
}
