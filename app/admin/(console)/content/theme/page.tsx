import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ThemeEditor, ThemePublishForm, ThemeVersionList } from "@/components/admin/theme-editor";
import { requireStaff } from "@/lib/auth/staff";
import { getDraftTheme } from "@/lib/theme/service";

export const metadata: Metadata = { title: "Theme" };

export default async function ThemePage() {
  const staff = await requireStaff("cms.edit");
  const canPublish = staff.permissions.includes("theme.publish");
  const theme = await getDraftTheme();
  if (!theme) notFound();
  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted"><Link href="/admin/content" className="hover:underline">Content &amp; hero</Link> / Theme</p>
          <h1 className="font-display text-3xl font-semibold text-espresso">Storefront theme</h1>
          <p className="max-w-2xl text-sm text-muted">
            Colours, fonts and corner radius for the whole store. Save a draft, check it in the preview, then publish. Every published
            version is kept and can be restored. Only these fixed options can be changed: no custom CSS.
          </p>
        </div>
        <Link href="/admin/content/preview?theme=draft" target="_blank" className="rounded border border-line bg-white px-4 py-2 text-sm">
          Preview draft on the store tour ↗
        </Link>
      </header>

      {canPublish ? (
        <section aria-labelledby="publish-h" className="rounded-lg border border-bronze/40 bg-cream p-5">
          <h2 id="publish-h" className="mb-3 font-semibold text-espresso">Publish</h2>
          <ThemePublishForm />
        </section>
      ) : (
        <p className="rounded border border-line bg-cream p-4 text-sm">You can edit the draft. Someone with theme publish permission makes it live.</p>
      )}

      {/* Remount on publish/rollback so the editor shows the restored draft; plain saves keep the form state and its message. */}
      <ThemeEditor draft={theme.draft} key={theme.liveVersionId ?? "none"} />

      <section aria-labelledby="versions-h" className="space-y-3">
        <h2 id="versions-h" className="font-semibold text-espresso">Published versions</h2>
        <ThemeVersionList versions={theme.versions} liveId={theme.liveVersionId} canPublish={canPublish} />
      </section>
    </div>
  );
}
