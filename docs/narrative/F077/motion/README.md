# F077 narrative animatic

A standalone, code-authored Remotion concept film about a small coffee-and-cake seller adapting one canvas to a changing workday. It is an illustrative animation, not a recording of Tabletop or evidence of runtime behavior. The persistent on-screen disclosure is **Concept animation · illustrative data**.

The opening follows an order slip: a pen writes the coffee and cake rows, the seller adds the line totals, and a mistaken total is corrected. Extra slips pile up before the paper scene slides away and the same work continues on a digital canvas. Each later change begins with an English request typed into the composer, followed by separate drafting, review, and apply states. The table stays in place as quick-sale buttons, a chart, and a discount rule are added. A click updates the Coffee quantity from 3 to 4; the gross total changes from ฿225 to ฿250. The 10% rule gives ฿225 net. A reviewed 20% proposal changes net to ฿200 while gross stays ฿250.

## Story timing

The composition is 1280 × 720 at 30 fps for 2541 frames (84.7 seconds).

- 00:00–00:09.9 — handwritten orders and the corrected ฿225 total; slide to the blank canvas.
- 00:09.9–00:21.833 — type a sales-table request, review the proposal, apply it, and reveal the table.
- 00:21.833–00:31.933 — a busy shop motivates a one-click request; review and apply the buttons.
- 00:31.933–00:40.167 — click Coffee once; the quantity and gross total update.
- 00:40.167–00:51.633 — request a chart by item, review it, and add it from the same rows.
- 00:51.633–01:02.3 — request and apply a 10% discount; hold on ฿250 gross and ฿225 net.
- 01:02.3–01:15.8 — select the saved rule, request 20%, review the proposed ฿200 net, then apply it.
- 01:15.8–01:20.5 — hold on the completed canvas; 01:20.5–01:24.7 — Tabletop end card.

All motion is frame-driven and deterministic. `sound-cues.json` holds the frame ranges for typing, actions, and the opening pencil strokes. The soundtrack is a cached mix of synthetic English narration and synchronized, code-generated sound effects in `public/audio/soundtrack.flac`. Ordinary rendering uses that local FLAC and does not generate speech or make network or product API calls. Regenerating narration is a separate, explicit task; `generate-narration.py --generate` may access its configured speech service.

## Source and asset provenance

- The lowercase `tabletop.` wordmark and four-tile mark follow the existing logo geometry and colors in `src/tabletop/ui/tabletop.css` (`.tt-brand__mark`).
- The mark's rotation and staggered tile pulses port the timing from `src/loading/LoadingScreen.tsx` and `src/loading/loading-screen.css`: a 2.4-second rotation cycle and a 1.2-second pulse cycle with a 0.15-second stagger. The animation is evaluated from the current frame, without browser timers.
- Manrope and Noto Sans Thai are bundled from pinned `@fontsource` packages with their licenses. The film uses authored React, SVG, and CSS graphics; it contains no remote or reference media and no AI-generated images or video.
- The fictional shop, requests, data, and all interface states are illustrative. No product service, AI provider, or external API is called by the film renderer.

## Render

Use Node.js 22.23.2, a local Chrome or Edge installation, and FFmpeg on `PATH` (or set `F077_FFMPEG_EXECUTABLE`). From this directory:

```powershell
npm ci --ignore-scripts
$env:REMOTION_BROWSER_EXECUTABLE = 'path to a local Chrome or Edge executable'
npm run render
```

The script renders the silent Remotion video, muxes the local `public/audio/soundtrack.flac` track as AAC, then extracts the poster and sample stills from the finished MP4. Output files are written to `../media/`: `tabletop-narrative-draft.mp4`, `tabletop-narrative-poster.png`, and `scene-01.png` through `scene-08.png`. The still samples land at 00:05.17, 00:13, 00:19.5, 00:28.83, 00:36.2, 00:46, 00:57.67, and 01:08.67. The poster uses 01:23.33.

To re-extract the stills from an existing rendered video, run `node render.mjs --extract-stills-only`. This does not render frames or modify the video.

## Rebuild audio

The checked-in audio is sufficient for rendering. To intentionally regenerate it, use Python3.12 with `edge-tts==7.3.1` and `numpy==2.5.1` installed in an isolated environment, plus a full FFmpeg executable on PATH:

```powershell
python generate-narration.py --generate
python mix-audio.py
```

The first command sends only the authored text in `narration.json` to Microsoft Edge's speech service. It uses `en-US-AriaNeural` at normal rate and caches each MP3, word-boundary metadata, and a fingerprint of text/voice/rate. Matching cached segments are reused. No key or personal voice sample is used. The second command is entirely local: it checks that voice clips fit their slots, synthesizes quiet action sounds from `sound-cues.json`, normalizes the mix, writes the cached FLAC and optional English VTT captions, and records a measurement report under ignored `.remotion-bundle/audio-review/`.

If script length or action timing changes, update narration slots, composition duration and frame cues together before mixing. `mix-audio.py` rejects overlapping or out-of-window narration; it never speeds up or truncates speech to force it into the film. Report measurements separately from a human listening pass.
