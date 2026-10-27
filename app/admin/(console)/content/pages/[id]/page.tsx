import Link from "next/link";
import { notFound } from "next/navigation";
import { PageEditor, PagePublishPanel } from "@/components/admin/page-editor";
import { requireStaff } from "@/lib/auth/staff";
import { blocksSchema } from "@/lib/cms/blocks";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function EditPage({ params }: PageProps<"/admin/content/pages/[id]">) {
  const staff = await requireStaff("cms.edit");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data: page }, { data: versions }] = await Promise.all([
    supabase.from("cms_pages").select("id, slug, title, page_kind, seo_title, seo_description, status, draft_blocks, published_version_id").eq("id", id).maybeSingle(),
    supabase.from("cms_page_versions").select("id, version, note, created_at").eq("page_id", id).order("version", { ascending: false }).limit(20),
  ]);
  if (!page) notFound();
  const blocks = blocksSchema.safeParse(page.draft_blocks);
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/admin/content" className="underline">Content & hero</Link> › Pages</p>
      <h1 className="font-display text-3xl font-semibold text-espresso">{page.title}</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <PageEditor page={page} blocks={blocks.success ? blocks.data : []} canPublish={staff.permissions.includes("cms.publish")} />
        <PagePublishPanel page={page} versions={versions ?? []} liveId={page.published_version_id} canPublish={staff.permissions.includes("cms.publish")} />
      </div>
    </div>
  );
}
