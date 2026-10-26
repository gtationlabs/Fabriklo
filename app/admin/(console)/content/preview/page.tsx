import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreTour } from "@/components/hero/store-tour";
import { requireStaff } from "@/lib/auth/staff";
import { getDraftHero } from "@/lib/cms/hero-admin";
import { getDraftTheme } from "@/lib/theme/service";
import { themeStyle } from "@/lib/theme/tokens";

export const metadata: Metadata = { title: "Tour preview (draft)", robots: { index: false, follow: false } };

export default async function HeroPreviewPage({ searchParams }: PageProps<"/admin/content/preview">) {
  await requireStaff("cms.edit");
  const { theme: themeParam } = await searchParams;
  const [hero, theme] = await Promise.all([getDraftHero("home"), themeParam === "draft" ? getDraftTheme() : Promise.resolve(null)]);
  if (!hero) notFound();
  const scenes = hero.scenes.filter((s) => s.is_published);
  return (
    <div className="-m-4 bg-paper sm:-m-8" style={theme ? themeStyle(theme.draft) : undefined} data-testid="hero-preview" data-theme={theme ? "draft" : "live"}>
      <p role="status" className="sticky top-0 z-[60] bg-bronze-strong px-4 py-2 text-center text-sm text-cream">
        Draft preview: not live. Publish from the editor to update the home page.{theme ? " Showing the DRAFT theme colours and fonts." : ""}
      </p>
      {scenes.length ? (
        <StoreTour scenes={scenes} settings={hero.settings} skipTo="#preview-end" />
      ) : (
        <p className="p-10 text-center">No visible scenes in the draft.</p>
      )}
      <div id="preview-end" tabIndex={-1} className="h-[60vh] p-10 text-center text-muted">End of tour preview.</div>
    </div>
  );
}
