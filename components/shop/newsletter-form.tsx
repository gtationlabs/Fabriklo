"use client";

import { useId, useState } from "react";

export function NewsletterForm() {
  const id = useId();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setState(null);
    try {
      const fd = new FormData(e.currentTarget);
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "footer", website: String(fd.get("website") ?? "") }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
      if (res.ok) {
        setState({ ok: true, text: body.message ?? "Check your inbox to confirm." });
        setEmail("");
      } else setState({ ok: false, text: body.error?.message ?? "Please check the email address." });
    } catch {
      setState({ ok: false, text: "Network problem. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3" aria-label="Newsletter">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-widest text-cream/60">Newsletter</label>
      <p className="mt-1 text-xs text-cream/70">New arrivals and offers. Double opt-in, unsubscribe any time.</p>
      <div className="mt-2 flex gap-2">
        <input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" maxLength={254} className="w-full rounded border border-cream/20 bg-cream/10 px-3 py-2 text-sm text-cream placeholder:text-cream/40" />
        <button type="submit" disabled={busy} className="rounded bg-cream px-3 py-2 text-sm font-medium text-espresso disabled:opacity-60">Join</button>
      </div>
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label>Leave this empty<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {state ? <p role={state.ok ? "status" : "alert"} className={`mt-2 text-xs ${state.ok ? "text-cream" : "text-red-300"}`}>{state.text}</p> : null}
    </form>
  );
}
