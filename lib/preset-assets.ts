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
//   - komos-logo:      REAL. Recolored-white Komos wordmark/logo, committed
//                       ahead of this task (see public/assets/preset/komos-logo.svg).
//   - sf-skyline:      REAL. "San Francisco skyline from Marin Headlands.jpg",
//                       CC0-licensed photo from Wikimedia Commons
//                       (https://commons.wikimedia.org/wiki/File:San_Francisco_skyline_from_Marin_Headlands.jpg),
//                       downscaled to the 1280px-wide thumbnail rendition
//                       (288KB, 1280x657 JPEG) to stay well under the 8MB
//                       upload cap and keep the repo lean.
//   - neutral-gradient: PLACEHOLDER. A warm-gray diagonal gradient PNG
//                       generated locally (no stock source) as a stand-in
//                       "neutral texture" preset —960x540, ~21KB. Swap for
//                       a real branded texture/pattern when available.
//
// DROP-IN POINT for real Komos brand assets: add the image file under
// public/assets/preset/<slug>.<ext> and append a matching entry below. No
// other code needs to change — the assets popover (Task 19b) reads this
// array directly.
export const PRESET_ASSETS: { slug: string; url: string; name: string }[] = [
  { slug: 'komos-logo', url: '/assets/preset/komos-logo.svg', name: 'Komos Logo' },
  { slug: 'sf-skyline', url: '/assets/preset/sf-skyline.jpg', name: 'San Francisco Skyline' },
  { slug: 'neutral-gradient', url: '/assets/preset/neutral-gradient.png', name: 'Neutral Gradient (placeholder)' },
]
