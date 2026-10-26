"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Last-resort error boundary (replaces the root layout when it throws). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1rem", textAlign: "center" }}>
        <main>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ marginTop: "0.75rem", color: "#555" }}>We have been notified. Please try again in a moment.</p>
          {error.digest ? <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#888" }}>Reference: {error.digest}</p> : null}
          <button type="button" onClick={reset} style={{ marginTop: "1.5rem", padding: "0.6rem 1.2rem", border: "1px solid #333", borderRadius: 6, background: "transparent", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
