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

## R6 shortened cut

The current delivery is a measured, piecewise retime of the frozen R5 render,
not a newly generated narration or a re-rendered animation. It keeps the same
visual sequence, Laura voice, effects, and causal request → review → apply →
result order while tightening the opening and explanatory passages. Each
scene's picture and mixed audio are retimed together; FFmpeg `atempo` preserves
the voice pitch. The closing passage and logo hold remain at their original
speed. The R5 beat table above describes the source; R6 uses these segment
rates: tools 1.20×, friction 1.18×, reversal 1.15×, table/quick-request/chart/
discounts 1.11×, quick-use 1.10×, close 1.00×. R6 is 93.23 seconds (2,797
frames at 30 fps).

The R5 source is deliberately left unchanged. `retime-r6.mjs` reads only that
frozen R5 MP4 and the matching English VTT, checks the expected source hash,
then writes the R6 MP4, mapped captions, poster, eight MP4-derived stills, and
a JSON timing map. Re-running the script always starts from R5, so it cannot
compound the speed change. It does not call Remotion, speech services, or the
network. FFmpeg and FFprobe must be available on `PATH`; set
`F077_FFMPEG_EXECUTABLE` or `F077_FFPROBE_EXECUTABLE` to override either binary.

From this directory, after the checked-in R5 source files are present:

```powershell
node retime-r6.mjs
```

The script also refreshes `public/narrative/tabletop-story.mp4`,
`tabletop-story-poster.png`, and `tabletop-story-en.vtt`; a review copy is
written to ignored `test-results/f077/tabletop-story-r6.mp4`. The media folder
also receives `tabletop-narrative-r6-poster.png`, eight `scene-XX-r6.png`
stills extracted from the R6 MP4, and `tabletop-narrative-r6-retime.json` with
the exact frame map.

The “Keep shaping” step begins with the spoken “Then” and remains through the
end of that phrase; the canvas begins at frame 1,023. The quick-sale buttons
finish entering at frame 1,660, the Coffee click lands at frame 1,672, and the
Coffee quantity and gross total update at frame 1,682. Request letters use
measured word-alignment timing and grapheme-safe steps, with an eight-frame
hold before Send. Review and Apply remain distinct human-visible states.

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
node render.mjs --preview 132 192 216 245 272 675 985 1023 1187 1222 1295 1660 1672 1682 1918 1944 1986 2249 2275 2376 2632 2658 2708 2996
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

R5 Laura narration was generated while the project account had an active paid Starter plan (verified before synthesis). No account identifiers or credentials are included. The cached narration accompanies the authored concept film; ordinary rendering makes no provider requests.
