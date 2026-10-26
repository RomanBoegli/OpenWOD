# OpenWOD — Code × Training

Vector reconstruction of the selected code-bracket/barbell concept, with the slogan **Not born. Made.** The lettering and symbol are custom path geometry; every SVG is self-contained and scales without installed fonts or raster images.

| File | Intended use |
| --- | --- |
| `openwod-logo-dark.svg` | Full logo and slogan on dark surfaces; off-white lettering and lime symbol/slogan. |
| `openwod-logo-light.svg` | Full logo and slogan on light surfaces; charcoal lettering and deeper green symbol/slogan. |
| `openwod-icon-dark.svg` | Standalone symbol on a dark surface, in a square viewBox. |
| `openwod-icon-light.svg` | Standalone symbol on a light surface, in a square viewBox. |
| `preview.svg` | Dark/light comparison with presentation backgrounds. |
| `preview.png` | Raster preview rendered from `preview.svg`; the deliverable logos remain vectors. |

The four logo/icon SVGs have **transparent backgrounds**. Theme names refer to the surface on which the asset will be placed. Background colours appear only in the comparison preview. All logos include SVG titles/descriptions; use a meaningful `alt` attribute when embedding them as HTML images.

## Palette

| Theme | Wordmark | Symbol and slogan | Suggested surface |
| --- | --- | --- | --- |
| Dark | `#F4F4EC` | `#B9F27B` | `#101714` |
| Light | `#101714` | `#6B962D` | `#F7F6F0` or white |

The light-theme green is intentionally deeper so the symbol and slogan remain clear on pale surfaces. The full lockup has a 1200×320 viewBox; the standalone icon has a 400×400 viewBox. Both include clear space. For small app avatars, use the standalone symbol rather than shrinking the slogan.

## Regenerate or customise

```sh
node assets/brand/generate.mjs
```

The generator uses only Node's standard library and reproduces all five SVGs. Edit the palette, outline geometry, or layout in `generate.mjs`; there are no third-party font files or runtime dependencies. The raster preview is an optional rendering of the comparison SVG, not part of the vector generation step.

These assets are provided for the OpenWOD branding work. They have not yet replaced the current app header or favicon.
