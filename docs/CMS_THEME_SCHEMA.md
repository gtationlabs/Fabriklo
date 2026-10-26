# CMS and theme schema

Implemented tables: `cms_pages` (slug, status draft/published/archived, published version pointer, SEO), `cms_page_versions` (immutable JSON block arrays), `hero_tours`, `hero_scenes` (see `3D_TOUR_ASSETS.md`), `site_settings` (non-secret JSON, `is_public` flag).

## Pages (built)

- `cms_pages.draft_blocks` is the editors' draft; `cms_page_versions.blocks` are immutable published snapshots; `cms_pages.published_version_id` points at the live one. `public.get_page(slug)` returns only the live version of a published page. Routes: `/[slug]` renders it; reserved paths (`admin`, `api`, `account`, `cart`, `checkout`, `shop`, …) cannot be used as slugs (database CHECK).
- **Block registry** (`lib/cms/blocks.ts`, mirrored by `private.cms_blocks_valid` in SQL): `heading` (h2/h3), `paragraph`, `list` (bullet/number), `faq`, `callout` (info/warning), `cta` (internal link only), `image` (`/assets/...` only). Text is plain; the renderer understands `**bold**` and `[label](/internal/path)` and nothing else. React escapes everything, so no HTML, scripts, iframes or `javascript:` links can reach the page; the database also rejects unknown block types, keys such as `html`/`script`, and `<script`/`javascript:` substrings.
- **Permissions**: `cms.edit` saves drafts and creates pages; `cms.publish` publishes, rolls back and takes pages offline (`admin_publish_page`, `admin_rollback_page`, `admin_unpublish_page`). A trigger blocks status/version changes by anyone without `cms.publish`, even through direct table updates. Everything is audited.
- **Editor**: Admin → Content & hero → Pages. Block list with add/move/remove, inline preview, SEO fields, version history with roll back.
- **Starter pages** seeded as templates (Shipping, Returns, Size guide, About, Contact, Privacy, Terms). They carry a visible "template" callout and must be reviewed by the owner; the legal pages are not legal advice.

## Hero tour

See `3D_TOUR_ASSETS.md` (draft scenes, published versions, publish/rollback).

## Theme (not built)

Theme versions (colour/type tokens) will follow the same draft → preview → publish → rollback model and map to the CSS variables in `app/globals.css`.
