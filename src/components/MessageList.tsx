"use client";
import { useEffect, useRef } from "react";

/**
 * Scrollable message area. Jumps to the newest message when a conversation opens or a message arrives, but does not
 * yank the view if the reader has scrolled up to read history.
 */
export function MessageList({ conversationId, lastId, children }: { conversationId: string; lastId: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (shown.current !== conversationId || nearBottom) el.scrollTop = el.scrollHeight;   // new conversation, or already at the bottom
    shown.current = conversationId;
  }, [conversationId, lastId]);
  return <div className="msgs" ref={box} tabIndex={0} aria-label="Messages" role="log">{children}</div>;
}
