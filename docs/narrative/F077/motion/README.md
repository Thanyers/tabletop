# F077 narrative animatic

Standalone Remotion source for a 60-second, silent, code-authored concept film. It is an explanatory animation with illustrative data, not a recording of Tabletop or proof of runtime behavior. The Thai provenance label `ภาพอธิบาย • ข้อมูลตัวอย่าง` stays visible throughout.

The opening keeps the chair, pen, hammer, nail, cushion, and book as separate drawn objects. At 00:09 the story moves to a no-file request, then to one continuous sales canvas. Cards stay in place as the table, saved discount rule, gross metric, bar chart, updated rows, review/apply steps, and net result appear. The example arithmetic is consistent: 3 × ฿25 + 3 × ฿50 = ฿225; after changing the coffee price to ฿35 and cake quantity to 6, 3 × ฿35 + 6 × ฿50 = ฿405. Applying a 20% discount to ฿405 yields ฿324; the gross amount remains ฿405.

## Story beats

- 00:00–00:09 — a chair, pen, and hammer arrive separately; the pen makes a mark and the hammer adds a nail, then a cushion and book join the chair.
- 00:09–00:14 — the request “ช่วยทำโต๊ะสรุปยอดขายวันนี้” appears without a file.
- 00:14–00:22 — the coffee-and-cake sales table takes shape on the canvas.
- 00:22–00:29 — review the saved row-sum/discount rule, then apply it.
- 00:29–00:36 — the gross metric and per-item chart branch from that same table.
- 00:36–00:42 — sample inputs change and the gross total updates from ฿225 to ฿405.
- 00:42–00:50 — a 20% discount is proposed, reviewed, and applied; the before/after net amounts remain visible.
- 00:50–00:58 — show ฿324 net beside ฿405 gross, then reveal the full board.
- 00:58–01:00 — the lowercase Tabletop lockup and URL fade in, then hold.

Within the single canvas section, the camera moves from the sales table to the selected rule, widens to the metric/chart, then focuses on the rule/net comparison before widening back to the whole board. Cards keep their board coordinates as the camera moves.

## Source and motion provenance

- The lowercase `tabletop.` wordmark and four-tile mark use the geometry and colors in `src/tabletop/ui/tabletop.css` (`.tt-brand__mark`).
- The recurring mark tilt and staggered tile pulses port the timing from `src/loading/LoadingScreen.tsx` and `src/loading/loading-screen.css`: a 2.4-second rotation loop and 1.2-second tile-pulse loop with 0.15-second stagger. The timing is evaluated from Remotion's current frame, without browser timers.
- Fonts are bundled from the pinned `@fontsource/manrope` and `@fontsource/noto-sans-thai` packages with their licenses. No remote/reference media or generated video, image, voice, or audio is used.

All remaining graphics are authored React, SVG, and CSS. No product API, AI provider, or external service is called. The render is silent by design.

## Render

Use Node.js 22.23.2. From this directory:

```powershell
npm ci --ignore-scripts
$env:REMOTION_BROWSER_EXECUTABLE = 'path to a local Chrome or Edge executable'
npm run render
```

The browser path is machine-specific. Omit the environment variable when Remotion can find a local browser on its own. The renderer uses port 41739 by default; set `F077_REMOTION_PORT` if that port is occupied.

The composition is 1280 × 720 at 30 fps for 1800 frames (60 seconds). The script writes `../media/tabletop-narrative-draft.mp4`, `tabletop-narrative-poster.png`, and eight sample stills. The stills are extracted from the finished MP4 with Remotion's bundled FFmpeg, so they represent the playable render exactly. Their sample times are 00:08, 00:12, 00:21, 00:27.5, 00:34, 00:39, 00:49.2, and 00:56.5; the poster uses 00:59. To re-extract stills from a video already rendered, run `node render.mjs --extract-stills-only`.
