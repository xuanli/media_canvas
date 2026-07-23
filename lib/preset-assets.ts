// T19a: static manifest of shipped ("preset") library assets, backing the
// Presets tab of the assets drawer. Files live under public/assets/preset/ —
// committed in-repo and versioned, per the Task 19 brief's decision (simpler
// than uploading once to blob and pinning URLs). No delete affordance for
// presets; no GET needed — this list is static and imported by the client.
//
// Curation (2026-07-22, demo-story pass — several rounds of user feedback):
// assets chosen to power the example-canvas narrative — composite Xuan into
// the Komos office, hang the logo on the wall, then edit/crop/resize.
//
// Provenance:
//   - komos-light / komos-dark: REAL brand. Composed cards — the komos
//     frontend's wordmark PNGs (logo-with-text{,-dark}.png) scaled large on
//     solid white / near-black (#0f171a), 1200x480. Cards read crisply in
//     drawer tiles AND as wall-signage references for edits. (Earlier
//     rounds: recolored-white SVG → transparent B/W PNGs → og green cover —
//     all rejected as reading badly at tile size.)
//   - xuan:         Xuan's own photo (400x400), for compositing into scenes.
//   - komos-office: GENERATED with fal-ai/nano-banana-pro (2026-07-22, v3
//     after two user rejections): SF Mission District warehouse loft from
//     the AUDIENCE's side of the desk — empty presenter chair on the far
//     side facing the camera (Xuan composites in facing the viewer), blank
//     rolling WHITEBOARD (logo/sketch surface), blank brick area. No
//     license concerns — made by this product's own default model.
//   - sf-bus-stop:  GENERATED with fal-ai/nano-banana-pro (2026-07-22): SF
//     Muni bus shelter with a prominent generic ad panel ("Abstract
//     Solutions" fictional poster) + Victorians — the ad-swap demo target
//     (replace the shelter ad with a Komos ad).
//   - sf-skyline:   CC0, Wikimedia Commons ("San Francisco skyline from
//     Marin Headlands.jpg"), 1280x657 thumbnail rendition.
//   - puppy:        Unsplash-licensed via Lorem Picsum (id 237, 1280x853) —
//     charming subject target for edit/redact demos. (fjord/strawberries/
//     coffee-beans trimmed 2026-07-22: off-story filler.)
//
// DROP-IN POINT: add a file under public/assets/preset/<slug>.<ext> and
// append an entry below — nothing else needs to change.
export const PRESET_ASSETS: { slug: string; url: string; name: string }[] = [
  { slug: 'komos-light', url: '/assets/preset/komos-light.png', name: 'Komos Logo (light)' },
  { slug: 'komos-dark', url: '/assets/preset/komos-dark.png', name: 'Komos Logo (dark)' },
  { slug: 'xuan', url: '/assets/preset/xuan.jpg', name: 'Xuan' },
  { slug: 'komos-office', url: '/assets/preset/komos-office.jpg', name: 'Komos Office' },
  { slug: 'sf-bus-stop', url: '/assets/preset/sf-bus-stop.jpg', name: 'SF Bus Stop' },
  { slug: 'sf-skyline', url: '/assets/preset/sf-skyline.jpg', name: 'San Francisco Skyline' },
  { slug: 'puppy', url: '/assets/preset/puppy.jpg', name: 'Black Lab Puppy' },
]
