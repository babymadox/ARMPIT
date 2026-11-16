"use client";
import { useState } from "react";

/** A read-only value with a Copy button (used for invite links). */
export function CopyText({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input readOnly value={value} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 0 }} />
      <button type="button" className="pri" onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 2000); } catch { window.prompt("Copy the link:", value); } }}>{done ? "Copied ✓" : "Copy"}</button>
    </div>
  );
}
