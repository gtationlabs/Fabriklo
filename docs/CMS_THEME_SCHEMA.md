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

## Theme (built, slice 8)

- `themes` holds one draft per key (`default`), `theme_versions` the immutable published snapshots; `themes.published_version_id` points at the live one. `public.get_theme()` returns the live tokens to anyone (null until the first publish → the storefront uses the defaults in `app/globals.css`).
- **Tokens are a closed set** (`lib/theme/tokens.ts`, mirrored by `private.theme_tokens_valid` in SQL): twelve named colours as 6-digit hex, a display font (`cormorant`, `playfair`, `fraunces`) and a body font (`inter`, `manrope`, `dm_sans`) from the self-hosted set in `app/layout.tsx`, and a corner radius (`none`, `sm`, `md`, `lg`). No custom CSS, no URLs, no font files from the editor. The root layout re-validates with Zod and emits only `--color-*`, `--font-*` and `--ui-radius-*` custom properties, so nothing from the database can inject CSS.
- **Permissions**: `cms.edit` saves the draft (`admin_save_theme_draft`); `theme.publish` publishes and rolls back (`admin_publish_theme`, `admin_rollback_theme`, rollback also restores the draft). Everything is audited (`theme.draft`, `theme.publish`, `theme.rollback`).
- **Editor**: Admin → Content & hero → Theme. Colour pickers with hex inputs, font and radius selects, a scoped live preview, WCAG AA contrast checks for the text pairs the store actually uses, a draft preview of the store tour (`/admin/content/preview?theme=draft`), publish with a note, version history with roll back.
- Store name, tagline and contact details are settings (`site_settings` `store.identity`, `store.contact`, public) edited in Admin → Settings; the header, footer and page titles read them. The brand is not inferred from the renders.
