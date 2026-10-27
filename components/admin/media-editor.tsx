"use client";

import { useActionState } from "react";
import { deleteProductMedia, moveProductMedia, updateProductMedia, uploadProductMedia, type MediaState } from "@/app/admin/(console)/products/media-actions";
import { mediaUrl } from "@/lib/media/url";
import { FormMessage, inputCls } from "./form-bits";

export type MediaItem = { id: string; storage_path: string; alt: string; width: number | null; height: number | null; variant_id: string | null };
export type ColourOption = { variant_id: string; color: string };

const idle: MediaState = { ok: false, message: null };

/**
 * Photos for one product: upload (several at once), alt text, colour link,
 * ordering and removal. The first photo is the one shown on product cards.
 */
export function MediaEditor({ productId, media, colours, canWrite }: { productId: string; media: MediaItem[]; colours: ColourOption[]; canWrite: boolean }) {
  return (
    <div className="space-y-6">
      {media.length === 0 ? (
        <p className="text-sm text-muted">No photos yet. The storefront shows a labelled placeholder until the first photo is added.</p>
      ) : (
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="media-list">
          {media.map((m, i) => (
            <li key={m.id} className="rounded border border-line bg-white p-3" data-testid="media-item" data-media-id={m.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail, no optimisation needed */}
              <img src={mediaUrl(m.storage_path)} alt={m.alt} width={m.width ?? undefined} height={m.height ?? undefined} className="aspect-[4/5] w-full rounded object-cover" />
              <p className="mt-2 text-xs text-muted">
                {i === 0 ? <strong className="text-espresso">Primary photo</strong> : `Photo ${i + 1}`}
                {m.width && m.height ? ` · ${m.width}×${m.height}` : ""}
              </p>
              {canWrite ? <MediaItemForms productId={productId} m={m} colours={colours} index={i} count={media.length} /> : <p className="mt-1 text-sm">{m.alt}</p>}
            </li>
          ))}
        </ol>
      )}
      {canWrite ? <UploadForm productId={productId} colours={colours} /> : null}
    </div>
  );
}

function UploadForm({ productId, colours }: { productId: string; colours: ColourOption[] }) {
  const [state, action, pending] = useActionState<MediaState, FormData>(uploadProductMedia.bind(null, productId), idle);
  return (
    <form key={state.ok ? state.message : "upload"} action={action} aria-label="Add photos" className="grid gap-3 rounded border border-line bg-white p-4 md:grid-cols-3" encType="multipart/form-data">
      <label className="block text-sm md:col-span-3">
        <span className="font-medium text-espresso">Photos (JPEG, PNG or WebP, up to 8 at a time)</span>
        <input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple required className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-espresso file:px-3 file:py-1.5 file:text-cream" />
      </label>
      <label className="block text-sm md:col-span-2">
        <span className="font-medium text-espresso">Describe the photos (alt text)</span>
        <input name="alt" minLength={3} maxLength={180} required placeholder="Front view of the linen shirt in sand" className={`mt-1 ${inputCls}`} />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-espresso">Colour shown</span>
        <select name="variant_id" defaultValue="" className={`mt-1 ${inputCls}`}>
          <option value="">All colours</option>
          {colours.map((c) => (
            <option key={c.variant_id} value={c.variant_id}>{c.color}</option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3 md:col-span-3">
        <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">
          {pending ? "Uploading…" : "Add photos"}
        </button>
        <FormMessage state={state} />
      </div>
      <p className="text-xs text-muted md:col-span-3">Photos are checked, resized to 2000 px and re-encoded without metadata before they are published. Only upload photos you have the rights to.</p>
    </form>
  );
}

function MediaItemForms({ productId, m, colours, index, count }: { productId: string; m: MediaItem; colours: ColourOption[]; index: number; count: number }) {
  const [editState, editAction, editPending] = useActionState<MediaState, FormData>(updateProductMedia.bind(null, m.id, productId), idle);
  const [moveState, moveAction, movePending] = useActionState<MediaState, FormData>(moveProductMedia.bind(null, productId), idle);
  const [delState, delAction, delPending] = useActionState<MediaState, FormData>(() => deleteProductMedia(m.id, productId), idle);
  return (
    <div className="mt-2 space-y-2 text-sm">
      <form action={editAction} aria-label={`Edit photo ${index + 1}`} className="space-y-2">
        <label className="block">
          <span className="sr-only">Alt text</span>
          <input name="alt" defaultValue={m.alt} minLength={3} maxLength={200} required className={inputCls} aria-label={`Alt text for photo ${index + 1}`} />
        </label>
        <div className="flex gap-2">
          <select name="variant_id" defaultValue={m.variant_id ?? ""} className={inputCls} aria-label={`Colour shown in photo ${index + 1}`}>
            <option value="">All colours</option>
            {colours.map((c) => (
              <option key={c.variant_id} value={c.variant_id}>{c.color}</option>
            ))}
          </select>
          <button type="submit" disabled={editPending} className="shrink-0 rounded border border-espresso px-3 py-1.5 text-xs disabled:opacity-60">Save</button>
        </div>
        <FormMessage state={editState} />
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <form action={moveAction}>
          <input type="hidden" name="media_id" value={m.id} />
          <input type="hidden" name="direction" value="up" />
          <button type="submit" disabled={movePending || index === 0} className="rounded border border-line px-2 py-1 text-xs disabled:opacity-40" aria-label={`Move photo ${index + 1} earlier`}>↑</button>
        </form>
        <form action={moveAction}>
          <input type="hidden" name="media_id" value={m.id} />
          <input type="hidden" name="direction" value="down" />
          <button type="submit" disabled={movePending || index === count - 1} className="rounded border border-line px-2 py-1 text-xs disabled:opacity-40" aria-label={`Move photo ${index + 1} later`}>↓</button>
        </form>
        <form
          action={delAction}
          onSubmit={(e) => {
            if (!window.confirm("Remove this photo? This cannot be undone.")) e.preventDefault();
          }}
        >
          <button type="submit" disabled={delPending} className="rounded border border-danger px-2 py-1 text-xs text-danger disabled:opacity-40" aria-label={`Remove photo ${index + 1}`}>Remove</button>
        </form>
        <FormMessage state={moveState.message ? moveState : delState} />
      </div>
    </div>
  );
}
