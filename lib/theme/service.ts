import "server-only";
import { cache } from "react";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_THEME, themeTokensSchema, type ThemeTokens } from "./tokens";

/** Published theme for the storefront (anonymous read of the live version only). Falls back to the built-in defaults. */
export const getPublishedTheme = cache(async (): Promise<{ tokens: ThemeTokens; published: boolean }> => {
  try {
    const { data } = await createSupabasePublicClient().rpc("get_theme");
    const parsed = themeTokensSchema.safeParse(data);
    if (parsed.success) return { tokens: parsed.data, published: true };
  } catch {
    // Fall through to defaults: the storefront must render even if the database is unreachable.
  }
  return { tokens: DEFAULT_THEME, published: false };
});

export type ThemeVersion = { id: string; version: number; note: string | null; created_at: string; tokens: ThemeTokens };

/** Draft + history for the editor (RLS: cms.edit). */
export async function getDraftTheme(key = "default") {
  const supabase = await createSupabaseServerClient();
  const [{ data: theme }, { data: versions }] = await Promise.all([
    supabase.from("themes").select("key, draft_tokens, published_version_id, updated_at").eq("key", key).maybeSingle(),
    supabase.from("theme_versions").select("id, version, note, created_at, tokens").eq("theme_key", key).order("version", { ascending: false }).limit(30),
  ]);
  if (!theme) return null;
  const draft = themeTokensSchema.safeParse(theme.draft_tokens);
  return {
    key,
    draft: draft.success ? draft.data : DEFAULT_THEME,
    liveVersionId: (theme.published_version_id as string | null) ?? null,
    updatedAt: theme.updated_at as string,
    versions: ((versions ?? []) as { id: string; version: number; note: string | null; created_at: string; tokens: unknown }[])
      .map((v) => {
        const t = themeTokensSchema.safeParse(v.tokens);
        return t.success ? ({ ...v, tokens: t.data } as ThemeVersion) : null;
      })
      .filter((v): v is ThemeVersion => v !== null),
  };
}
