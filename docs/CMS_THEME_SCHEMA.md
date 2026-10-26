# CMS and theme schema

Implemented tables: `cms_pages` (slug, status draft/published/archived, published version pointer, SEO), `cms_page_versions` (immutable JSON block arrays), `hero_tours`, `hero_scenes` (see `3D_TOUR_ASSETS.md`), `site_settings` (non-secret JSON, `is_public` flag).

Rules: publishing a page or tour requires `cms.publish`; editing requires `cms.edit`. Versions are immutable, so rollback = point `published_version_id` at an older version. Block content will be an allow-listed registry validated by Zod (rich_text, cta, banner, product_grid, featured_collection, faq, media, newsletter…). Rich text is sanitised server-side; links are internal or allow-listed; no custom JS/CSS fields. Theme versions (colour/type tokens) follow the same draft → preview → publish → rollback model and map to the CSS variables in `app/globals.css`.
