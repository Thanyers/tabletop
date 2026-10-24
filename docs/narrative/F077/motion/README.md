# F077 narrative animatic

Standalone Remotion source for a 60-second, silent, code-authored concept film. It follows a fictional coffee seller as successive requests adapt one canvas to a changing workday. This is an illustrative animation, not a recording of Tabletop or proof of runtime behavior. The Thai disclosure `ภาพอธิบาย · ข้อมูลตัวอย่าง` stays visible throughout.

The opening uses separate chair, pen, and hammer drawings: a cushion and book join the chair, the pen draws a mark, and the hammer adds a nail. The working sequence keeps the seller's conversation and the same sales table visible while each new request is typed, sent, reviewed, and applied. The accepted quick-sale buttons are used once before the seller asks for the next change.

## Story beats

- 00:00–00:05 — separate objects arrive and are adapted; a coffee seller and a changing workday set the human context.
- 00:05–00:14 — type `ช่วยทำโต๊ะจดขายกาแฟกับเค้ก`, send it, review the proposed table, and apply it.
- 00:14–00:28 — after the rush makes entry too slow, request `เพิ่มปุ่มขาย กดครั้งเดียวเพิ่มจำนวน`; review and apply two +1 buttons, then click Coffee once.
- 00:28–00:38 — request `เพิ่มกราฟยอดขายแยกตามสินค้า`; apply a chart from the same rows.
- 00:38–00:46 — request and apply a 10% discount rule.
- 00:46–00:55 — select that rule, request `เปลี่ยนกฎนี้เป็น 20%`, review the preview, and apply the change.
- 00:55–00:58 — hold the completed canvas; 00:58–01:00 — hold the Tabletop mark, wordmark, and URL.

Each message types by Thai grapheme, then holds before Send. Drafting, Review, and Apply are distinct frame-driven states. A feature appears only after its request is applied. The table stays in place while the new controls, chart, and discount are added.

## Example data

- Start: 3 × ฿25 Coffee + 3 × ฿50 Cake = ฿225 gross.
- One Coffee +1 click: 4 × ฿25 + 3 × ฿50 = ฿250 gross; chart shows Coffee ฿100 and Cake ฿150.
- Applied 10% discount: ฿225 net on ฿250 gross.
- Proposed 20% discount: the current 10% remains applied until Apply; the preview is ฿200 net.
- After Apply: ฿200 net, with ฿250 gross unchanged.

## Source and motion provenance

- The lowercase `tabletop.` wordmark and four-tile mark follow the existing logo geometry and colors in `src/tabletop/ui/tabletop.css` (`.tt-brand__mark`).
- The mark's tilt and staggered tile pulses port the timing from `src/loading/LoadingScreen.tsx` and `src/loading/loading-screen.css`: a 2.4-second rotation loop and 1.2-second tile-pulse loop with a 0.15-second stagger. The movement is evaluated from Remotion's current frame, without browser timers.
- Fonts are bundled from the pinned `@fontsource/manrope` and `@fontsource/noto-sans-thai` packages with their licenses. No remote/reference media or generated video, image, voice, or audio is used.
- All remaining scenes and interface graphics are authored React, SVG, and CSS. No product API, AI provider, or external service is called. The render is silent by design.

## Render

Use Node.js 22.23.2. From this directory:

```powershell
npm ci --ignore-scripts
$env:REMOTION_BROWSER_EXECUTABLE = 'path to a local Chrome or Edge executable'
npm run render
```

The browser path is machine-specific. Omit the environment variable when Remotion can find a local browser on its own. The renderer uses port 41739 by default; set `F077_REMOTION_PORT` if that port is occupied.

The composition is 1280 × 720 at 30 fps for 1800 frames (60 seconds). The script writes `../media/tabletop-narrative-draft.mp4`, `tabletop-narrative-poster.png`, and eight sample stills. Still times are 00:07.6, 00:11, 00:18, 00:23.8, 00:31.7, 00:35.3, 00:49.9, and 00:51.7. The poster uses 00:59. Still images are extracted from the finished MP4, so they match the playable render. To re-extract them from a rendered video, run `node render.mjs --extract-stills-only`.
