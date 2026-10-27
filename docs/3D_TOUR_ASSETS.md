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

## How the tour works (built)

`components/hero/store-tour.tsx`, rendered on `/` from the **published** version.

- **Server HTML** is five full-height panels (image + caption + CTA). This is also what visitors get without JavaScript, with `prefers-reduced-motion: reduce`, or when an editor sets the mode to "Static panels only".
- **With motion allowed**, `gsap.matchMedia()` adds `.is-tour`, pins the stage and scrubs one timeline over about 1.1 screen heights of scroll per scene:
  - slow camera push-in on each render (`zoom` → `zoom + 0.12 × motion strength`) with vertical drift (`parallax`), anchored on the scene's focus point (`object_position`);
  - a cross-dissolve with a slight zoom-out into the next render, as if turning into the next area;
  - captions slide out and in.
  Scrolling up plays it in reverse. Motion is about 40% softer on phones. If the OS reduced-motion setting changes, the effect reverts cleanly.
- **Controls**: "Skip store tour" moves focus to the Featured section; scene dots (24 px targets) jump to a scene; a polite `n / 5` counter. Scenes that aren't showing are `inert`, so keyboard and screen-reader users only reach the visible scene's link.
- **Test hooks**: `#store-tour[data-mode=tour|static][data-active-scene=N]`, `[data-scene=N]`.
- **Loading**: scene 1 is eager with `fetchpriority=high`; the others are lazy and low priority, with a 32 px blurred background placeholder; responsive `srcset` uses 768/1280/1728 widths.

## Editing (admin → Content & hero)

`hero_scenes` is the **draft**. Editors (`cms.edit`) can:
- change the render (one of the five), alt text, label, heading, text, button label and internal link;
- set the camera focus (x/y), start zoom and drift;
- show or hide a scene, reorder scenes, and change tour settings (mode, text shading, motion strength).

"Preview draft" renders the draft with the same component. **Publish** (`cms.publish`) stores an immutable snapshot in `hero_tour_versions` and points the tour at it. The storefront can only read that snapshot (RLS); drafts are never public. **Roll back** makes an earlier version live again and loads it as the draft. Every publish and rollback is audited.

Safety:
- Text is rendered as plain text, so no HTML or scripts.
- Links must be internal paths. `javascript:`, external hosts and `//host` are refused in Zod and again by a database CHECK.
- Images are limited to `/assets/store/`.

## Screenshots

`docs/screenshots/tour-desktop-scene-1..5.jpg`, `tour-mobile-scene-1.jpg`, `tour-mobile-scene-3.jpg`.

## Honest limits

These are fixed camera views, so there is no free movement or parallax between foreground and background layers. Proper depth layers would need the renders split into layers (or depth maps); a true walkthrough needs the 3D source file. The "ALVIC STORE" signage in the renders is still visible.
