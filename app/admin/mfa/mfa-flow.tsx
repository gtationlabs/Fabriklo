"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Enrollment = { factorId: string; qr: string; secret: string };

export function MfaFlow({ hasVerifiedFactor }: { hasVerifiedFactor: boolean }) {
  const supabase = getSupabaseBrowserClient();
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) {
        setError("Could not load your authenticator settings. Refresh and try again.");
        return;
      }
      const verified = data.totp.find((f: { id: string; status: string }) => f.status === "verified");
      if (verified) {
        if (!cancelled) setFactorId(verified.id);
        return;
      }
      // Clean up abandoned enrolments, then start a fresh one.
      for (const f of data.all.filter((x: { id: string; status: string }) => x.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Fabriklo admin ${new Date().toISOString().slice(0, 16)}`,
      });
      if (cancelled) return;
      if (enrollError || !enrolled) {
        setError("Could not start authenticator setup.");
        return;
      }
      setEnrollment({ factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
      setFactorId(enrolled.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, hasVerifiedFactor]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || !/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (verifyError) {
      setError("That code did not work. Check your device clock and try the newest code.");
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {enrollment ? (
        <div className="space-y-3 text-sm">
          <p>Scan this QR code with an authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG data URI from Supabase Auth */}
          <img src={enrollment.qr} alt="QR code for setting up your authenticator app" className="mx-auto h-44 w-44 bg-white p-2" />
          <details>
            <summary className="cursor-pointer text-muted">Can&apos;t scan? Enter the key manually</summary>
            <code data-testid="totp-secret" className="mt-2 block break-all rounded bg-cream p-2 text-xs">{enrollment.secret}</code>
          </details>
        </div>
      ) : factorId ? (
        <p className="text-sm">Enter the 6-digit code from your authenticator app.</p>
      ) : (
        <p className="text-sm text-muted">Loading…</p>
      )}
      <form onSubmit={verify} className="space-y-3">
        <label htmlFor="code" className="block text-sm font-medium text-espresso">Authentication code</label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="w-full rounded border border-line bg-white px-3 py-2 text-center text-lg tracking-[0.4em]"
        />
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <button type="submit" disabled={busy || !factorId} className="w-full rounded bg-espresso px-4 py-2.5 font-medium text-cream disabled:opacity-60">
          {busy ? "Verifying…" : "Verify"}
        </button>
      </form>
    </div>
  );
}
