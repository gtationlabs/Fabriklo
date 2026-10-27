"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

type Variant = { id: string; size: string; color: string; available: number };
type Job = {
  id: string;
  status: string;
  input_url: string | null;
  output_url: string | null;
  error_code: string | null;
  message: string | null;
  expires_at: string;
};

export type TryonOffer = { label: string; isMock: boolean; disclosure: string };

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Product-page try-on. Everything that matters happens on the server (checks,
 * queue, provider call); this component uploads, asks for consent, polls the
 * job and shows the result with a before/after view.
 */
export function TryonPanel({
  productTitle,
  variants,
  signedIn,
  signInHref,
  offer,
  consentVersion,
  retentionHours,
}: {
  productTitle: string;
  variants: Variant[];
  signedIn: boolean;
  signInHref: string;
  offer: TryonOffer;
  consentVersion: string;
  retentionHours: number;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "queued" | "processing" | "completed" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [view, setView] = useState<"after" | "before">("after");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  function choose(f: File | null) {
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f ? URL.createObjectURL(f) : null;
    });
    setFile(f);
  }

  function pick(f: File | null) {
    setError(null);
    if (!f) return choose(null);
    if (!ACCEPT.split(",").includes(f.type)) return setError("Please choose a JPEG, PNG or WebP photo.");
    if (f.size > MAX_BYTES) return setError("That photo is over 10 MB. Please use a smaller one.");
    choose(f);
  }

  async function poll(jobId: string) {
    const res = await fetch(`/api/tryon/jobs/${jobId}`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as Job | null;
    if (!res.ok || !body) {
      setPhase("failed");
      setError("We lost track of this try-on. Please try again.");
      return;
    }
    setJob(body);
    if (body.status === "completed") return setPhase("completed");
    if (body.status === "failed" || body.status === "expired" || body.status === "cancelled") {
      setPhase("failed");
      setError(body.message ?? "The try-on didn't work this time. Please try again.");
      return;
    }
    setPhase(body.status === "processing" ? "processing" : "queued");
    pollRef.current = setTimeout(() => void poll(jobId), 2000);
  }

  async function start() {
    if (!file || !consent || !variantId) return;
    setError(null);
    setPhase("uploading");
    try {
      const fd = new FormData();
      fd.set("photo", file);
      const up = await fetch("/api/tryon/uploads", { method: "POST", body: fd });
      const upBody = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upBody?.error?.message ?? "Upload failed.");
      const res = await fetch("/api/tryon/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId, inputPath: upBody.path, consent: true, consentVersion }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not start the try-on.");
      setPhase("queued");
      void poll(body.jobId as string);
    } catch (e) {
      setPhase("failed");
      setError((e as Error).message);
    }
  }

  async function remove() {
    if (!job) return;
    await fetch(`/api/tryon/jobs/${job.id}`, { method: "DELETE" });
    setJob(null);
    setPhase("idle");
    choose(null);
    setConsent(false);
  }

  function reset() {
    if (pollRef.current) clearTimeout(pollRef.current);
    setJob(null);
    setPhase("idle");
    setError(null);
  }

  const busy = phase === "uploading" || phase === "queued" || phase === "processing";

  return (
    <section aria-labelledby={`${id}-h`} className="rounded border border-line bg-cream p-4" data-testid="tryon-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-h`} className="font-semibold text-espresso">See it on you</h2>
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="rounded border border-espresso px-4 py-2 text-sm font-medium text-espresso hover:bg-espresso hover:text-cream">
            Try it on with your photo
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted">A visualisation only, not a fit or size guarantee. Prints and logos may differ.</p>
      {offer.isMock ? (
        <p className="mt-2 rounded border border-danger/40 bg-danger/5 p-2 text-xs font-semibold text-danger" role="note">
          Demo mock: no AI provider is configured, so the result is your photo with the garment shown beside it. Not a real try-on.
        </p>
      ) : null}

      {open && !signedIn ? (
        <p className="mt-4 text-sm">
          <Link href={signInHref} className="underline">Sign in or create an account</Link> to try this on. Your photo is kept private to your account and deleted after {retentionHours} hours.
        </p>
      ) : null}

      {open && signedIn && phase !== "completed" ? (
        <div className="mt-4 space-y-4 text-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-variant`} className="font-medium">Colour</label>
              <select id={`${id}-variant`} value={variantId} onChange={(e) => setVariantId(e.target.value)} disabled={busy} className="mt-1 w-full rounded border border-line bg-white px-3 py-2">
                {[...new Map(variants.map((v) => [v.color, v])).values()].map((v) => (
                  <option key={v.id} value={v.id}>{v.color}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-photo`} className="font-medium">Your photo</label>
              <input
                id={`${id}-photo`}
                type="file"
                accept={ACCEPT}
                disabled={busy}
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-espresso file:px-3 file:py-2 file:text-cream"
              />
            </div>
          </div>
          <ul className="list-disc pl-5 text-xs text-muted">
            <li>Stand facing the camera with your whole torso visible, arms relaxed.</li>
            <li>Plain background and even light work best. JPEG, PNG or WebP, up to 10 MB.</li>
            <li>Only upload a photo of yourself. Don&apos;t upload photos of other people.</li>
          </ul>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={preview} alt="Preview of your uploaded photo" className="max-h-72 rounded border border-line object-contain" />
          ) : null}
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} className="mt-1 accent-bronze" data-testid="tryon-consent" />
            <span className="text-xs">
              I agree that this photo is processed to show {productTitle} on me. {offer.disclosure} We keep the photo and the result privately in my account for {retentionHours} hours, then delete them; I can delete them earlier at any time. No face or body measurements are stored.
            </span>
          </label>
          {error ? <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-2 text-danger">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={start} disabled={!file || !consent || busy} className="rounded bg-espresso px-5 py-2.5 font-medium text-cream disabled:opacity-50">
              {phase === "uploading" ? "Uploading…" : phase === "queued" ? "Queued…" : phase === "processing" ? "Generating…" : phase === "failed" ? "Try again" : "Generate try-on"}
            </button>
            <span className="text-xs text-muted" aria-live="polite" data-testid="tryon-status">
              {phase === "queued" ? "Waiting for a free slot." : phase === "processing" ? "Usually takes under 20 seconds." : ""}
            </span>
          </div>
        </div>
      ) : null}

      {phase === "completed" && job?.output_url ? (
        <div className="mt-4 space-y-3" data-testid="tryon-result">
          <div className="flex gap-2" role="group" aria-label="Before and after">
            <button type="button" onClick={() => setView("after")} aria-pressed={view === "after"} className={`rounded px-3 py-1 text-sm ${view === "after" ? "bg-espresso text-cream" : "border border-line bg-white"}`}>After</button>
            <button type="button" onClick={() => setView("before")} aria-pressed={view === "before"} className={`rounded px-3 py-1 text-sm ${view === "before" ? "bg-espresso text-cream" : "border border-line bg-white"}`}>Before</button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
          <img src={view === "after" ? job.output_url : (job.input_url ?? job.output_url)} alt={view === "after" ? `Try-on result for ${productTitle}` : "Your original photo"} className="max-h-[32rem] rounded border border-line object-contain" />
          <p className="text-xs text-muted">Private to your account; deleted automatically after {retentionHours} hours. Choose your size above to add it to your cart.</p>
          <div className="flex flex-wrap gap-3 text-sm">
            <a href={job.output_url} download className="rounded border border-espresso px-4 py-2 font-medium text-espresso">Download</a>
            <button type="button" onClick={reset} className="rounded border border-line bg-white px-4 py-2">Try another photo</button>
            <button type="button" onClick={remove} className="rounded border border-danger px-4 py-2 text-danger" data-testid="tryon-delete">Delete my photos</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
