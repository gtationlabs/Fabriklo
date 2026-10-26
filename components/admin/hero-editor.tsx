"use client";

import { useActionState } from "react";
import {
  publishHero,
  rollbackHero,
  saveScene,
  saveSettings,
  type HeroActionState,
} from "@/app/admin/(console)/content/actions";
import { FormMessage, inputCls } from "@/components/admin/form-bits";
import type { DraftScene, HeroVersion } from "@/lib/cms/hero-admin";
import type { HeroSettings } from "@/lib/cms/hero";
import { HERO_IMAGES, heroSrcSet } from "@/lib/cms/hero-media";

const idle: HeroActionState = { ok: false, message: null };
const btn = "rounded bg-espresso px-3 py-2 text-sm text-cream hover:bg-charcoal disabled:opacity-60";
const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });

export function SceneEditor({ scene, index }: { scene: DraftScene; index: number }) {
  const [state, action, pending] = useActionState(saveScene, idle);
  const [fx, fy] = scene.object_position.split(" ").map((p) => parseInt(p, 10));
  const v = state.values ?? {
    image_path: scene.image_path,
    image_alt: scene.image_alt,
    eyebrow: scene.eyebrow,
    heading: scene.heading,
    body: scene.body,
    cta_label: scene.cta_label ?? "",
    cta_href: scene.cta_href ?? "",
    focus_x: String(fx),
    focus_y: String(fy),
    zoom: String(scene.zoom),
    parallax: String(scene.parallax),
    is_published: scene.is_published ? "on" : "",
  };
  const id = (k: string) => `s${index}-${k}`;
  return (
    <form action={action} key={JSON.stringify(scene) + String(state.ok)} aria-label={`Scene ${index + 1}`} className="grid gap-4 md:grid-cols-[220px_1fr]">
      <input type="hidden" name="id" value={scene.id} />
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={scene.image_path.replace(/\.webp$/, "-768.webp")}
          srcSet={heroSrcSet(scene.image_path)}
          sizes="220px"
          alt=""
          className="aspect-video w-full rounded object-cover"
          style={{ objectPosition: scene.object_position }}
        />
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_published" defaultChecked={v.is_published === "on"} /> Show this scene
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={id("image")} className="text-xs font-medium">
          Store render
          <select id={id("image")} name="image_path" defaultValue={v.image_path} className={inputCls}>
            {HERO_IMAGES.map((img) => (
              <option key={img.path} value={img.path}>{img.label}</option>
            ))}
          </select>
        </label>
        <label htmlFor={id("eyebrow")} className="text-xs font-medium">
          Small label
          <input id={id("eyebrow")} name="eyebrow" defaultValue={v.eyebrow} maxLength={60} className={inputCls} />
        </label>
        <label htmlFor={id("heading")} className="text-xs font-medium sm:col-span-2">
          Heading
          <input id={id("heading")} name="heading" defaultValue={v.heading} maxLength={90} required className={inputCls} />
        </label>
        <label htmlFor={id("body")} className="text-xs font-medium sm:col-span-2">
          Text
          <textarea id={id("body")} name="body" defaultValue={v.body} maxLength={280} rows={2} className={inputCls} />
        </label>
        <label htmlFor={id("cta_label")} className="text-xs font-medium">
          Button label
          <input id={id("cta_label")} name="cta_label" defaultValue={v.cta_label} maxLength={40} className={inputCls} />
        </label>
        <label htmlFor={id("cta_href")} className="text-xs font-medium">
          Button link (internal, e.g. /shop)
          <input id={id("cta_href")} name="cta_href" defaultValue={v.cta_href} maxLength={200} className={inputCls} />
        </label>
        <label htmlFor={id("alt")} className="text-xs font-medium sm:col-span-2">
          Image description (for screen readers)
          <input id={id("alt")} name="image_alt" defaultValue={v.image_alt} maxLength={300} required className={inputCls} />
        </label>
        <fieldset className="grid grid-cols-2 gap-3 sm:col-span-2 lg:grid-cols-4">
          <legend className="mb-1 text-xs font-medium">Camera</legend>
          <label className="text-xs">Focus left–right ({v.focus_x}%)
            <input type="range" name="focus_x" min={0} max={100} defaultValue={v.focus_x} className="w-full accent-bronze" />
          </label>
          <label className="text-xs">Focus top–bottom ({v.focus_y}%)
            <input type="range" name="focus_y" min={0} max={100} defaultValue={v.focus_y} className="w-full accent-bronze" />
          </label>
          <label className="text-xs">Start zoom
            <input type="number" name="zoom" min={1} max={1.4} step={0.01} defaultValue={v.zoom} className={inputCls} />
          </label>
          <label className="text-xs">Drift
            <input type="number" name="parallax" min={0} max={0.15} step={0.01} defaultValue={v.parallax} className={inputCls} />
          </label>
        </fieldset>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={pending} className={btn}>{pending ? "Saving…" : "Save draft"}</button>
          <FormMessage state={state} />
        </div>
      </div>
    </form>
  );
}

export function SettingsEditor({ settings }: { settings: HeroSettings }) {
  const [state, action, pending] = useActionState(saveSettings, idle);
  const v = state.values ?? {
    renderer: settings.renderer === "static" ? "static" : "scroll-2.5d",
    overlay: String(settings.overlay_opacity),
    motion: String(settings.motion_strength),
  };
  return (
    <form action={action} key={JSON.stringify(settings) + String(state.ok)} aria-label="Tour settings" className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs font-medium">
        Mode
        <select name="renderer" defaultValue={v.renderer} className={inputCls}>
          <option value="scroll-2.5d">Scroll walkthrough</option>
          <option value="static">Static panels only</option>
        </select>
      </label>
      <label className="text-xs font-medium">
        Text shading (0–0.9)
        <input type="number" name="overlay" min={0} max={0.9} step={0.05} defaultValue={v.overlay} className={inputCls} />
      </label>
      <label className="text-xs font-medium">
        Motion strength (0–1.5)
        <input type="number" name="motion" min={0} max={1.5} step={0.1} defaultValue={v.motion} className={inputCls} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button type="submit" disabled={pending} className={btn}>Save settings</button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function PublishForm() {
  const [state, action, pending] = useActionState(publishHero, idle);
  return (
    <form action={action} key={String(state.ok)} aria-label="Publish tour" className="flex flex-wrap items-end gap-2">
      <label className="min-w-56 flex-1 text-xs font-medium">
        What changed? (optional)
        <input name="note" defaultValue={state.values?.note ?? ""} maxLength={200} className={inputCls} />
      </label>
      <button type="submit" disabled={pending} className="rounded bg-bronze-strong px-4 py-2 text-sm font-medium text-cream hover:bg-espresso disabled:opacity-60">
        {pending ? "Publishing…" : "Publish draft"}
      </button>
      <div className="w-full"><FormMessage state={state} /></div>
    </form>
  );
}

export function VersionList({ versions, liveId, canPublish }: { versions: HeroVersion[]; liveId: string | null; canPublish: boolean }) {
  const [state, action, pending] = useActionState(rollbackHero, idle);
  return (
    <div className="space-y-2">
      <FormMessage state={state} />
      <ul className="divide-y divide-line rounded border border-line bg-white text-sm" data-testid="hero-versions">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
            <span>
              <span className="font-medium">Version {v.version}</span>
              {v.id === liveId ? <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">Live</span> : null}
              <span className="ml-2 text-muted">{dateFmt.format(new Date(v.created_at))} · {v.scene_count} scenes{v.note ? ` · ${v.note}` : ""}</span>
            </span>
            {canPublish && v.id !== liveId ? (
              <form action={action}>
                <input type="hidden" name="versionId" value={v.id} />
                <button type="submit" disabled={pending} className="rounded border border-line px-3 py-1 text-xs">
                  Roll back to version {v.version}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
