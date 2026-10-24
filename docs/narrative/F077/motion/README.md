# F077 narrative animatic

This standalone Remotion package renders the 36-second, silent Tabletop concept animatic. It uses authored React, SVG, and CSS shapes with deterministic frame timing. The persistent on-screen label, “Concept animation · illustrative data,” identifies the scenes as an explanatory draft rather than a recording of the product.

The data examples are illustrative. Rendering calls no product API, image/video-generation service, or voice service. No remote or reference media is used; Manrope and Noto Sans Thai are bundled from pinned `@fontsource` packages under their respective licenses.

## Render

Use Node.js 22.23.2. From this directory:

    npm ci --ignore-scripts
    $env:REMOTION_BROWSER_EXECUTABLE = 'path to your Chrome or Edge executable'
    npm run render

The browser path is machine-specific. Omit the environment variable when Remotion can find a browser on its own.

The renderer uses local port 41739 by default. If that port is occupied, set F077_REMOTION_PORT to another available port before rendering.

After rendering, the script extracts the poster and eight scene stills from the MP4 with Remotion's bundled FFmpeg, so the review images match the playable render exactly. To regenerate only the stills from an existing video, run `node render.mjs --extract-stills-only`.

The script writes tabletop-narrative-draft.mp4, tabletop-narrative-poster.png, and scene-01.png through scene-08.png into ../media/.
