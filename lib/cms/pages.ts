import "server-only";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { blocksSchema, type CmsPage } from "./blocks";

export async function getPublishedPage(slug: string): Promise<CmsPage | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  const { data, error } = await createSupabasePublicClient().rpc("get_page", { p_slug: slug });
  if (error || !data) return null;
  const page = data as CmsPage;
  const blocks = blocksSchema.safeParse(page.blocks);
  return { ...page, blocks: blocks.success ? blocks.data : [] };
}
