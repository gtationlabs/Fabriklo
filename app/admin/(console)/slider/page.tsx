import type { Metadata } from "next";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, EmptyState, PageHeader, SelectField, TextField, Toggle, fieldCls, labelCls } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { siteMediaUrl } from "@/lib/media/url";
import { nowMs } from "@/lib/time";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteSlide, saveSlide } from "./actions";

export const metadata: Metadata = { title: "Slider" };

type Slide = {
  id: string; title: string; subtitle: string; eyebrow: string; image_path: string | null; image_alt: string; link_url: string | null;
  cta_label: string; theme: "dark" | "light"; position: number; is_active: boolean; starts_at: string | null; ends_at: string | null;
};

/** ISO → value for <input type="datetime-local"> in Dhaka time. */
const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 6 * 3600_000).toISOString().slice(0, 16) : "");

function SlideFields({ s }: { s: Slide | null }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      <TextField label="Eyebrow" name="eyebrow" defaultValue={s?.eyebrow} maxLength={40} placeholder="New season" />
      <TextField label="Title" name="title" defaultValue={s?.title} required maxLength={80} className="lg:col-span-3" />
      <TextField label="Subtitle" name="subtitle" defaultValue={s?.subtitle} maxLength={160} className="md:col-span-2 lg:col-span-4" />
      <TextField label="Button label" name="cta_label" defaultValue={s?.cta_label} maxLength={30} placeholder="Shop now" />
      <TextField label="Button link" name="link_url" defaultValue={s?.link_url} maxLength={300} placeholder="/shop?sort=new" />
      <SelectField label="Text colour" name="theme" defaultValue={s?.theme ?? "dark"} options={[{ value: "dark", label: "Light text on dark image" }, { value: "light", label: "Dark text on light image" }]} />
      <TextField label="Position" name="position" type="number" min={0} max={999} defaultValue={s?.position ?? 0} />
      <label className="block space-y-1 md:col-span-2">
        <span className={labelCls}>{s ? "Replace image" : "Image"}</span>
        <input type="file" name="image" accept="image/jpeg,image/png,image/webp" className={fieldCls} />
        <span className="block text-xs text-muted">Wide photo, at least 1600 × 700 looks best. Up to 10 MB; stored as WebP without camera data.</span>
      </label>
      <TextField label="Image description (alt text)" name="image_alt" defaultValue={s?.image_alt} maxLength={160} className="md:col-span-2" />
      <TextField label="Show from (Dhaka time)" name="starts_at" type="datetime-local" defaultValue={local(s?.starts_at ?? null)} />
      <TextField label="Show until (Dhaka time)" name="ends_at" type="datetime-local" defaultValue={local(s?.ends_at ?? null)} />
      <div className="md:col-span-2"><Toggle label="Show on the home page" name="is_active" defaultChecked={s?.is_active ?? false} hint="Needs publish permission." /></div>
    </div>
  );
}

export default async function SliderPage() {
  await requireStaff("cms.edit");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("home_slides").select("*").order("position").order("created_at");
  const slides = (data ?? []) as Slide[];
  const now = nowMs();
  const live = (s: Slide) => s.is_active && (!s.starts_at || Date.parse(s.starts_at) <= now) && (!s.ends_at || Date.parse(s.ends_at) > now);
  return (
    <div>
      <PageHeader title="Slider" description="Promotional banners shown as a slider on the home page, right below the store tour. Nothing shows until at least one slide is switched on, and scheduled slides appear and disappear on their own." />
      <Card title="Add a slide" className="mb-6">
        <ActionForm action={saveSlide.bind(null, null)} label="New slide" submitLabel="Add slide">
          <SlideFields s={null} />
        </ActionForm>
      </Card>
      {slides.length === 0 ? <EmptyState>No slides yet.</EmptyState> : null}
      <ul className="space-y-4" data-testid="slides-list">
        {slides.map((s) => (
          <li key={s.id} className="overflow-hidden rounded-xl border border-line bg-white">
            <details>
              <summary className="flex cursor-pointer list-none items-center gap-4 p-3">
                {s.image_path ? (
                  // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail
                  <img src={siteMediaUrl(s.image_path)} alt="" className="h-16 w-28 shrink-0 rounded-lg object-cover" />
                ) : <span className="h-16 w-28 shrink-0 rounded-lg bg-sand" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-espresso">{s.title}</span>
                  <span className="block truncate text-xs text-muted">{s.subtitle || "No subtitle"}{s.link_url ? ` · ${s.cta_label} → ${s.link_url}` : ""}</span>
                </span>
                <Badge tone={live(s) ? "good" : s.is_active ? "warn" : "neutral"}>{live(s) ? "Live" : s.is_active ? "Scheduled" : "Hidden"}</Badge>
                <span className="text-xs text-muted">#{s.position}</span>
              </summary>
              <div className="space-y-3 border-t border-line p-5">
                <ActionForm action={saveSlide.bind(null, s.id)} label={`Slide: ${s.title}`} submitLabel="Save slide">
                  <SlideFields s={s} />
                </ActionForm>
                <ActionForm action={deleteSlide.bind(null, s.id)} label={`Delete slide ${s.title}`} submitLabel="Delete slide" danger compact confirm="Delete this slide and its image?" />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
