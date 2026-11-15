"use client";

/** Shown instead of the bare "Application error" page when a screen fails to load. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="empty" role="alert">
      <b>This page could not load</b>
      <p>If you just updated the app or the database, a pending database migration is the most common cause. Try again, and if it keeps happening, send this reference to whoever runs the app: <code>{error.digest ?? "no reference"}</code></p>
      <button className="pri" onClick={reset}>Try again</button>
    </div>
  );
}
