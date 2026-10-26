# Store tour assets

## What we have (honest scope)

Five **2D perspective renders** of the client's store (1728×1080 PNG originals). They are not a navigable 3D model, so the hero is a **2.5D cinematic scroll sequence**: crossfades, gentle zoom and parallax between fixed camera views. Moving freely around or behind objects is not possible from these inputs. A real walkthrough would need the source scene (SketchUp/3ds Max/Blender) exported to glTF, or a photogrammetry capture.

## Frame mapping (verified visually)

| File | View | Notes |
| --- | --- | --- |
| `store-01.webp` | Wide entrance view: wooden ceiling, track lights, racks both sides, counters "1" and "2" at the back | Establishing shot, LCP image |
| `store-02.webp` | Left wall: black-frame shelving with folded tees/tops, low display table, fitting rooms behind | "Tops and tees" |
| `store-03.webp` | Right side: chrome rail of trousers, wooden wall unit with shirts, checked shirts rail | "Trousers and shirts" |
| `store-04.webp` | Main checkout: three numbered counters (1, 2, 3), lettered wall art | "Checkout / delivery" |
| `store-05.webp` | Fitting rooms (For Women / For Men) next to jacket rack and service counter | "Fitting rooms / try-on" |

The order matches the spec's suggested mapping, so no re-ordering was needed.

## Brand caution

The renders contain signage for another brand name and slogans painted on the walls. The website brand is **not** taken from that signage; it stays editable in `site_settings` (`store.identity`). If the final brand differs, either re-render the scene with the right signage or crop/mask the signage areas (the `object_position` and `zoom` fields per scene allow crops without editing images).

## Generated files (`public/assets/store/`)

| Variant | Width | Quality | Use |
| --- | --- | --- | --- |
| `store-0N.webp` | 1728 | 82 | Desktop / large screens |
| `store-0N-1280.webp` | 1280 | 80 | Laptops, department tiles |
| `store-0N-768.webp` | 768 | 78 | Phones |
| `store-0N-blur.webp` | 32 | 50 | Tiny placeholder |

Metadata is stripped. Total ≈ 1.1 MB for all 20 files; the first-frame mobile image is ≈ 42 KB. Only scene 1 is fetched eagerly (`fetchpriority="high"`); others will be lazy-loaded by the tour.

Regenerate with ImageMagick:

```bash
for n in 01 02 03 04 05; do
  convert store-$n.png -strip -quality 82 -define webp:method=6 store-$n.webp
  convert store-$n.png -strip -resize 1280x -quality 80 store-$n-1280.webp
  convert store-$n.png -strip -resize 768x -quality 78 store-$n-768.webp
  convert store-$n.png -strip -resize 32x -quality 50 store-$n-blur.webp
done
```

Originals are not committed (≈ 11 MB); keep them with the client's design files.

## CMS schema (already in the database)

`hero_tours` (renderer, status, overlay opacity, motion strength) and `hero_scenes` (position, image path from `/assets/store/` only, alt text ≥ 10 chars, eyebrow, heading, body, CTA label, internal-only CTA href, object-position `NN% NN%`, zoom 1–1.4, parallax 0–0.15, transition 200–3000 ms, publish flag). The same bounds are enforced by Zod in `lib/cms/hero.ts`.

## Next milestone

GSAP ScrollTrigger pinned sequence (scrub, reversible), reduced-motion/static fallback (the current static hero), mobile shorter tour, deterministic test hooks (`data-scene` + progress attribute), screenshot tests at desktop/mobile, admin scene editor with preview and rollback.
