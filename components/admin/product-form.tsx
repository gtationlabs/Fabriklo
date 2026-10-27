"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/admin/(console)/products/actions";
import { Field, FormMessage, inputCls } from "./form-bits";

type Product = {
  title: string;
  slug: string;
  subtitle: string;
  description: string;
  materials: string;
  care: string;
  category_id: string | null;
  audience: string;
  status: string;
  featured: boolean;
  tags: string[];
  seo_title: string | null;
  seo_description: string | null;
};

export function ProductForm({
  action,
  categories,
  product,
  mode,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  categories: { id: string; name: string }[];
  product?: Product;
  mode: "create" | "edit";
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: null, errors: {} });
  const e = state.errors;
  // After a failed submit, show what the user typed (React resets forms after actions).
  const val = (name: string, fallback: string | null | undefined) => (state.ok ? fallback : (state.values?.[name] ?? fallback)) ?? "";
  const inv = (n: string) => ({ "aria-invalid": e[n] ? true : undefined, "aria-describedby": e[n] ? `${n}-error` : undefined });

  return (
    <form key={JSON.stringify(state.values ?? {}) + String(state.ok)} action={formAction} className="space-y-5" noValidate>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Title" name="title" errors={e}>
          <input id="title" name="title" defaultValue={val("title", product?.title)} required maxLength={140} className={inputCls} {...inv("title")} />
        </Field>
        <Field label="URL slug" name="slug" errors={e} hint="Leave blank to generate from the title.">
          <input id="slug" name="slug" defaultValue={val("slug", product?.slug)} maxLength={120} className={inputCls} {...inv("slug")} />
        </Field>
      </div>
      <Field label="Subtitle" name="subtitle" errors={e}>
        <input id="subtitle" name="subtitle" defaultValue={val("subtitle", product?.subtitle)} maxLength={200} className={inputCls} />
      </Field>
      <Field label="Description" name="description" errors={e} hint="Plain text. Line breaks are kept; HTML is not rendered.">
        <textarea id="description" name="description" defaultValue={val("description", product?.description)} rows={5} maxLength={8000} className={inputCls} />
      </Field>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Materials" name="materials" errors={e}>
          <textarea id="materials" name="materials" defaultValue={val("materials", product?.materials)} rows={2} maxLength={1000} className={inputCls} />
        </Field>
        <Field label="Care" name="care" errors={e}>
          <textarea id="care" name="care" defaultValue={val("care", product?.care)} rows={2} maxLength={1000} className={inputCls} />
        </Field>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        <Field label="Category" name="category_id" errors={e}>
          <select id="category_id" name="category_id" defaultValue={val("category_id", product?.category_id)} className={inputCls}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Audience" name="audience" errors={e}>
          <select id="audience" name="audience" defaultValue={val("audience", product?.audience ?? "unisex")} className={inputCls}>
            <option value="men">Men</option>
            <option value="women">Women</option>
            <option value="unisex">Unisex</option>
          </select>
        </Field>
        {mode === "edit" ? (
          <Field label="Status" name="status" errors={e} hint="Active products are visible in the shop.">
            <select id="status" name="status" defaultValue={val("status", product?.status ?? "draft")} className={inputCls}>
              <option value="draft">Draft</option>
              <option value="active">Active (published)</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
        ) : null}
      </div>
      <Field label="Tags" name="tags" errors={e} hint="Comma separated.">
        <input id="tags" name="tags" defaultValue={val("tags", product?.tags.join(", "))} className={inputCls} />
      </Field>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="SEO title" name="seo_title" errors={e}>
          <input id="seo_title" name="seo_title" defaultValue={val("seo_title", product?.seo_title)} maxLength={70} className={inputCls} />
        </Field>
        <Field label="SEO description" name="seo_description" errors={e}>
          <input id="seo_description" name="seo_description" defaultValue={val("seo_description", product?.seo_description)} maxLength={170} className={inputCls} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="featured" defaultChecked={product?.featured} className="accent-bronze" /> Featured on homepage
      </label>
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className="rounded bg-espresso px-5 py-2.5 text-sm font-medium text-cream disabled:opacity-60">
          {pending ? "Saving…" : mode === "create" ? "Create draft" : "Save product"}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
