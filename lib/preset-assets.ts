// T19a: static manifest of shipped ("preset") library assets, backing the
// Presets tab of the assets popover (Task 19b, later). Files live under
// public/assets/preset/ — committed in-repo and versioned, per the Task 19
// brief's decision (simpler than uploading once to blob and pinning URLs).
// No delete affordance for presets (see brief); GET isn't needed either,
// since this list is static and imported directly by the client.
//
// Provenance of each entry (real vs. placeholder), so a future pass can
// swap in genuine Komos brand assets without guessing:
//
//   - komos-cover:     REAL. Komos brand cover (white logo + wordmark on the
//                       brand's green gradient, 1200x630) from the komos
//                       repo's slides/common/assets/og-cover.png. Replaced
//                       the transparent-background wordmark variants
//                       (user 2026-07-21, twice: recolored-white SVG, then
//                       black/white PNGs) — a self-backgrounded logo reads
//                       correctly in both themes and every tile size.
//   - sf-skyline:      REAL. "San Francisco skyline from Marin Headlands.jpg",
//                       CC0-licensed photo from Wikimedia Commons
//                       (https://commons.wikimedia.org/wiki/File:San_Francisco_skyline_from_Marin_Headlands.jpg),
//                       downscaled to the 1280px-wide thumbnail rendition
//                       (288KB, 1280x657 JPEG) to stay well under the 8MB
//                       upload cap and keep the repo lean.
//   - puppy / fjord / strawberries / coffee-beans: REAL. Unsplash-licensed
//                       photos fetched via Lorem Picsum (picsum.photos ids
//                       237 / 1015 / 1080 / 425, 1280x853) — user 2026-07-21
//                       "a few more preset pictures": a portrait subject, a
//                       landscape, a food/product shot, and a texture, so
//                       every demo verb (edit/redact/crop/adjust) has a
//                       natural target. Replaced the neutral-gradient
//                       placeholder.
//
// DROP-IN POINT for real Komos brand assets: add the image file under
// public/assets/preset/<slug>.<ext> and append a matching entry below. No
// other code needs to change — the assets popover (Task 19b) reads this
// array directly.
export const PRESET_ASSETS: { slug: string; url: string; name: string }[] = [
  { slug: 'komos-cover', url: '/assets/preset/komos-cover.png', name: 'Komos Logo' },
  { slug: 'sf-skyline', url: '/assets/preset/sf-skyline.jpg', name: 'San Francisco Skyline' },
  { slug: 'puppy', url: '/assets/preset/puppy.jpg', name: 'Black Lab Puppy' },
  { slug: 'fjord', url: '/assets/preset/fjord.jpg', name: 'Fjord Landscape' },
  { slug: 'strawberries', url: '/assets/preset/strawberries.jpg', name: 'Strawberries' },
  { slug: 'coffee-beans', url: '/assets/preset/coffee-beans.jpg', name: 'Coffee Beans' },
]
