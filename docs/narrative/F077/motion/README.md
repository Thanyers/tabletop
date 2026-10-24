# Tabletop narrative animatic

This is a code-authored Remotion concept film about tools adapting to the people
who use them. It opens with a hand writing an order, a hammer in use, and a
chair gaining useful features in stages. It then contrasts that physical
adaptation with software that makes people pick apps, learn menus, and bend
their workflow. The second half follows a small coffee stand as its seller
shapes one canvas through five typed requests.

The on-screen interface, actions, and data are illustrative; this film is not
a recording of Tabletop and is not evidence of runtime behavior. The simulated
workspace carries the persistent disclosure **Concept animation · illustrative
data**. The final end card is a white background with the existing `tabletop.`
logo only.

## Story timing

The measured English narration composition is 1280 × 720 at 30 fps for 3,133
frames (104.43 seconds). `timeline.json` is generated from
`narration-r5.json` and its word-alignment files; it is the source for named
visual and sound cues, typing, review, apply, and result timing.

| Time | Beat |
| --- | --- |
| 00:00.4–00:12.83 | A person writes with a pen; a hammer handle and chair backrest, armrests, and wheels are highlighted. The chair resolves to its complete photograph. |
| 00:12.83–00:23.67 | App selection, menus, and a bent workflow show how software can reverse the adaptation. |
| 00:23.67–00:34.57 | Tabletop reframes the relationship; describe, review, and apply lead into the same canvas. |
| 00:34.57–00:45.77 | Type a sales-table request, review the draft, then apply it. |
| 00:45.77–01:02.23 | Request quick-sale buttons, review and apply them, click Coffee, and update the same table from ฿225 to ฿250 gross. |
| 01:02.23–01:11.03 | Request and add a chart from those same sales rows. |
| 01:11.03–01:22.47 | Add a reviewed 10% discount: ฿250 gross and ฿225 net. |
| 01:22.47–01:35.57 | Select that rule, request a 20% change, review the ฿200 net proposal, and apply it; gross remains ฿250. |
| 01:35.57–01:39.87 | Hold the completed canvas while the closing narration lands. |
| 01:39.87–01:44.43 | Fade to the white logo-only end card and hold. |

The coffee click at frame 1,664 follows the quick-sale buttons settling at frame
1,648; the Coffee quantity and gross total update later at frame 1,745. Request
letters use measured word-alignment timing and grapheme-safe steps. Review and
Apply remain distinct human-visible states.

## Brand and media provenance

- The lowercase `tabletop.` wordmark and four-tile mark follow the existing
  geometry and colors in `src/tabletop/ui/tabletop.css` (`.tt-brand__mark`).
- The mark's tilt and staggered tile pulses port the timing from
  `src/loading/LoadingScreen.tsx` and `src/loading/loading-screen.css`: a
  2.4-second rotation cycle and a 1.2-second pulse cycle with a 0.15-second
  stagger, evaluated deterministically from the frame.
- Photograph sources, authors, licenses, and use are recorded in
  `public/objects/SOURCES.md`. The chair image is cropped and revealed in
  stages, then resolves to the complete photograph; it is not reshaped.
- Manrope and Noto Sans Thai are bundled from pinned `@fontsource` packages
  with their licenses. Remaining visuals are authored React, SVG, and CSS.
  No AI-generated image or video is used.
- The checked-in soundtrack is a cached English narration mix with
  code-generated sound effects. Regular rendering reads that local FLAC; it
  does not generate speech or call a product API. Speech regeneration is a
  separate explicit operation using the configured voice service.

## Render and preview

Use Node.js 22.23.2, a local Chrome or Edge installation, and FFmpeg on `PATH`
(or set `F077_FFMPEG_EXECUTABLE`). From this directory:

```powershell
npm ci --ignore-scripts
$env:REMOTION_BROWSER_EXECUTABLE = 'path to a local Chrome or Edge executable'
node src/build-timeline.mjs
npm run render
```

To render selected source preview frames without rendering the full film:

```powershell
node render.mjs --preview 155 272 660 850 1295 1648 1664 1745 1986 2708 2996
```

Preview images are written to the ignored `.remotion-bundle/previews/`
directory. The completed video is muxed with `public/audio/soundtrack.flac` as
AAC. The script then extracts the poster and eight stills from the rendered
MP4, so they match the final film by construction. Outputs are written to
`../media/`: `tabletop-narrative-draft.mp4`, `tabletop-narrative-poster.png`,
and `scene-01.png` through `scene-08.png`. The sample frames are 4.40, 9.07,
22.00, 28.33, 40.73, 58.17, 66.20, and 90.27 seconds; the poster is taken at
103.33 seconds.

To re-extract stills from the existing MP4 without rendering video again:

```powershell
node render.mjs --extract-stills-only
```
