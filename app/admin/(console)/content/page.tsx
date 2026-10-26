import Link from "next/link";
import { notFound } from "next/navigation";
import { PublishForm, SceneEditor, SettingsEditor, VersionList } from "@/components/admin/hero-editor";
import { requireStaff } from "@/lib/auth/staff";
import { getDraftHero } from "@/lib/cms/hero-admin";
import { moveScene } from "./actions";

export default async function ContentPage() {
  const staff = await requireStaff("cms.edit");
  const canPublish = staff.permissions.includes("cms.publish");
  const hero = await getDraftHero("home");
  if (!hero) notFound();

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-espresso">Home store tour</h1>
          <p className="max-w-2xl text-sm text-muted">
            Edit the draft below, check it in the preview, then publish. The live home page only changes when you publish,
            and every published version can be restored.
          </p>
        </div>
        <Link href="/admin/content/preview" target="_blank" className="rounded border border-line bg-white px-4 py-2 text-sm">
          Preview draft ↗
        </Link>
      </header>

      {canPublish ? (
        <section aria-labelledby="publish-h" className="rounded-lg border border-bronze/40 bg-cream p-5">
          <h2 id="publish-h" className="mb-3 font-semibold text-espresso">Publish</h2>
          <PublishForm />
        </section>
      ) : (
        <p className="rounded border border-line bg-cream p-4 text-sm">You can edit drafts. Someone with publish permission makes them live.</p>
      )}

      <section aria-labelledby="settings-h" className="space-y-3">
        <h2 id="settings-h" className="font-semibold text-espresso">Tour settings</h2>
        <SettingsEditor settings={hero.settings} />
      </section>

      <section aria-labelledby="scenes-h" className="space-y-4">
        <h2 id="scenes-h" className="font-semibold text-espresso">Scenes (in walkthrough order)</h2>
        <ol className="space-y-6">
          {hero.scenes.map((s, i) => (
            <li key={s.id} className="rounded-lg border border-line bg-white p-5" data-testid="scene-editor">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-medium text-espresso">Scene {i + 1}{s.is_published ? "" : " (hidden)"}</h3>
                <div className="flex gap-2">
                  {(
                    [
                      [-1, "Move up", i === 0],
                      [1, "Move down", i === hero.scenes.length - 1],
                    ] as const
                  ).map(([dir, label, disabled]) => (
                    <form key={dir} action={moveScene}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="direction" value={dir} />
                      <button type="submit" disabled={disabled} className="rounded border border-line px-2 py-1 text-xs disabled:opacity-40">
                        {label}<span className="sr-only"> scene {i + 1}</span>
                      </button>
                    </form>
                  ))}
                </div>
              </div>
              <SceneEditor scene={s} index={i} />
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="versions-h" className="space-y-3">
        <h2 id="versions-h" className="font-semibold text-espresso">Published versions</h2>
        <VersionList versions={hero.versions} liveId={hero.liveVersionId} canPublish={canPublish} />
      </section>
    </div>
  );
}
