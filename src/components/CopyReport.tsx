"use client";
import { useState } from "react";

/** Copies the diagnostics report as Markdown so it can be pasted into a chat. */
export function CopyReport({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="pri" type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2500); } catch { window.prompt("Copy the report:", text); } }}>
      {done ? "Copied ✓" : "Copy report"}
    </button>
  );
}
