"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { blocksSchema, pageSchema } from "@/lib/cms/blocks";
import { friendlyDbError } from "@/lib/db-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Page editor actions: drafts need cms.edit; publish/rollback/unpublish need cms.publish (also enforced in SQL). */
export type PageActionState = { ok: boolean; message: string | null; values?: Record<string, string> };

function echo(fd: FormData) {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v.slice(0, 60000);
  return out;
}

function parseBlocks(raw: string) {
  try {
    return blocksSchema.safeParse(JSON.parse(raw || "[]"));
  } catch {
    return { success: false as const, error: null };
  }
}

export async function createPage(_prev: PageActionState, fd: FormData): Promise<PageActionState> {
  const values = echo(fd);
  const parsed = pageSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields.", values };
  const auth = await checkStaff("cms.edit");
  if (!auth.ok) return { ok: false, message: auth.message, values };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("cms_pages")
    .insert({ ...parsed.data, seo_title: parsed.data.seo_title || null, seo_description: parsed.data.seo_description || null, status: "draft" })
    .select("id")
    .single();
  if (error) {
    const msg = error.code === "23514" && /reserved/.test(error.message) ? "That address is reserved by the store." : friendlyDbError(error);
    return { ok: false, message: msg, values };
  }
  redirect(`/admin/content/pages/${data.id}`);
}

export async function savePageDraft(_prev: PageActionState, fd: FormData): Promise<PageActionState> {
  const values = echo(fd);
  const id = z.uuid().safeParse(fd.get("id"));
  const meta = pageSchema.safeParse(values);
  if (!id.success || !meta.success) return { ok: false, message: meta.success ? "Unknown page." : (meta.error.issues[0]?.message ?? "Check the fields."), values };
  const blocks = parseBlocks(values.blocks ?? "[]");
  if (!blocks.success) {
    const issue = blocks.error?.issues[0];
    return { ok: false, message: issue ? `Block ${Number(issue.path[0]) + 1}: ${issue.message}` : "Some blocks are invalid.", values };
  }
  const auth = await checkStaff("cms.edit");
  if (!auth.ok) return { ok: false, message: auth.message, values };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("cms_pages")
    .update({
      ...meta.data,
      seo_title: meta.data.seo_title || null,
      seo_description: meta.data.seo_description || null,
      draft_blocks: blocks.data,
      updated_by: auth.staff.userId,
    })
    .eq("id", id.data);
  if (error) return { ok: false, message: friendlyDbError(error), values };
  revalidatePath(`/admin/content/pages/${id.data}`);
  return { ok: true, message: "Draft saved. Publish to make it live." };
}

export async function publishPage(_prev: PageActionState, fd: FormData): Promise<PageActionState> {
  const id = z.uuid().safeParse(fd.get("id"));
  const note = String(fd.get("note") ?? "").trim().slice(0, 200);
  if (!id.success) return { ok: false, message: "Unknown page." };
  const auth = await checkStaff("cms.publish");
  if (!auth.ok) return { ok: false, message: auth.message, values: { note } };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_publish_page", { p_page_id: id.data, p_note: note || null });
  if (error) {
    return { ok: false, message: error.hint === "empty_page" ? "Add some content before publishing." : friendlyDbError(error), values: { note } };
  }
  revalidatePath(`/admin/content/pages/${id.data}`);
  revalidatePath("/[slug]", "page");
  return { ok: true, message: `Published version ${(data as { version: number }).version}. It is live.` };
}

export async function rollbackPage(_prev: PageActionState, fd: FormData): Promise<PageActionState> {
  const id = z.uuid().safeParse(fd.get("versionId"));
  const pageId = z.uuid().safeParse(fd.get("id"));
  if (!id.success || !pageId.success) return { ok: false, message: "Unknown version." };
  const auth = await checkStaff("cms.publish");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_rollback_page", { p_version_id: id.data });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath(`/admin/content/pages/${pageId.data}`);
  revalidatePath("/[slug]", "page");
  return { ok: true, message: `Version ${(data as { version: number }).version} is live again and loaded as the draft.` };
}

export async function unpublishPage(_prev: PageActionState, fd: FormData): Promise<PageActionState> {
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, message: "Unknown page." };
  const auth = await checkStaff("cms.publish");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_unpublish_page", { p_page_id: id.data });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath(`/admin/content/pages/${id.data}`);
  revalidatePath("/[slug]", "page");
  return { ok: true, message: "Page taken offline. Its versions are kept." };
}
