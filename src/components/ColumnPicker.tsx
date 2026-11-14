"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type C = { key: string; label: string; group: string; hint?: string };
/** Remembers the chosen columns per tracker in a cookie (read server-side), so the choice follows the user. */
export function ColumnPicker({ cookie, cols, selected, defaults }: { cookie: string; cols: C[]; selected: string[]; defaults: string[] }) {
  const router = useRouter();
  const [sel, setSel] = useState(new Set(selected));
  const save = (next: Set<string>) => {
    setSel(next);
    document.cookie = `${cookie}=${[...next].join(",")}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  const toggle = (k: string) => { const n = new Set(sel); n.has(k) ? n.delete(k) : n.add(k); if (n.size) save(n); };
  const groups = [...new Set(cols.map((c) => c.group))];
  return (
    <details className="picker">
      <summary className="btn">Columns ({sel.size})</summary>
      <div className="picker-pop card" role="group" aria-label="Choose columns">
        {groups.map((g) => (
          <fieldset key={g}><legend>{g}</legend>
            {cols.filter((c) => c.group === g).map((c) => (
              <label key={c.key} title={c.hint}><input type="checkbox" checked={sel.has(c.key)} onChange={() => toggle(c.key)} /> {c.label}</label>))}
          </fieldset>))}
        <div className="between"><button type="button" onClick={() => save(new Set(cols.map((c) => c.key)))}>Select all</button><button type="button" onClick={() => save(new Set(defaults))}>Reset</button></div>
      </div>
    </details>
  );
}
