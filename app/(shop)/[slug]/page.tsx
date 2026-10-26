import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Blocks } from "@/components/cms/blocks";
import { getPublishedPage } from "@/lib/cms/pages";

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Asia/Dhaka" });

export async function generateMetadata({ params }: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) return {};
  return { title: page.seo_title ?? page.title, description: page.seo_description ?? undefined };
}

export default async function CmsPageRoute({ params }: PageProps<"/[slug]">) {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) notFound();
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-semibold text-espresso">{page.title}</h1>
      {page.kind === "legal" ? (
        <p className="mt-2 text-sm text-muted">Last updated {dateFmt.format(new Date(page.published_at))}</p>
      ) : null}
      <div className="mt-8">
        <Blocks blocks={page.blocks} />
      </div>
    </article>
  );
}
