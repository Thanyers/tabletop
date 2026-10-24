# Tabletop film — Tools that keep adapting to you

Revision 4 · English-first · 84.7 seconds / 2,541 frames / 30 fps · code-authored visuals, synthetic narration and procedural sound effects

## Direction

The user removed the one-minute limit and requested English first. Pace follows the measured narration, action and result; do not speed up speech to meet an arbitrary duration. Revision 3 relied too much on reading, and its chair/pen/hammer drawings did not communicate a useful opening.

Open on a real action: a pen writes coffee and cake orders on a paper slip; the seller adds and corrects a manual total. Slide the paper out and the empty digital canvas in as separate objects. The film then follows the same seller through five typed requests. Each new need leads to a request, a proposed change, review/application, and use. The table and accepted tools stay on the same canvas.

The original Tabletop logo and loader timing remain. No AI-generated video or images. The persistent disclosure reads “Concept animation · illustrative data.” The exact sequence is an authored example, not a product recording or a runtime guarantee.

## Voice-led edit

| Time | Story | Visible result |
| --- | --- | --- |
| 0–9.9s | Pen, paper, and growing orders | Write entries, add/correct a manual total, then move to the canvas; no object morphing |
| 9.9–21.83s | Ask for a coffee-and-cake sales table | Type request, send, review and apply; initial total225 |
| 21.83–40.17s | Entering every sale is too slow | Ask for quick-sale buttons; apply; click Coffee at the spoken cue; quantity3→4, total225→250 |
| 40.17–51.63s | See what is selling | Request and approve a chart using the same rows: Coffee100 / Cake150 |
| 51.63–62.3s | Try an afternoon offer | Add/approve10%; gross250, net225 |
| 62.3–75.8s | Change the offer without starting again | Select the existing rule, type20%; proposed200 while active10% remains225; apply then show200; retain all tools |
| 75.8–84.7s | Start small, use it, shape it | Hold completed canvas, then original logo and final line |

Exact action frames are owned by [sound cues](motion/sound-cues.json) and the motion source. Exact narration starts, durations and text are in [narration.json](motion/narration.json). Allow the completed request to settle before Send. Do not let narration and sound effects imply an applied change while the board still shows a draft.

## Recorded English narration

**intro** (0.4s)

Imagine a cafe starting with pen and paper. Then orders pile up. What if its tools could grow with the work?

**table** (9.9s)

Start with a request: Make me a sales table for coffee and cake. Tabletop drafts it. Review it, apply it, and start using it.

**quick-request** (21.83s)

Now the shop gets busy. Entering every sale is too slow. Add buttons so I can record a sale with one click.

**quick-use** (31.93s)

The buttons join the same canvas. Click Coffee: the count goes up, and the total updates.

**chart** (40.17s)

Want to see what's selling? Ask for a chart. Once approved, it reads the same sales data. There's nothing to enter again.

**discount10** (51.63s)

Trying an afternoon offer? Add and approve a ten-percent discount. The rule calculates the net total from today's sales.

**discount20** (62.3s)

Change your mind? Select that rule and ask for twenty percent. Review the new result, then apply it. Your table, buttons, and chart stay in place.

**close** (75.8s)

Tabletop. Start small, use it, and shape it as you go. Tools that keep adapting to you.

## Sound direction and provenance

- Narration: Microsoft Edge TTS voice `en-US-AriaNeural`, normal rate, via [edge-tts](https://github.com/rany2/edge-tts). The authored public script is sent only by an explicit generation command. No personal voice imitation or credential is used. Previously tested Thai narration is not included in this export.
- Effect sounds are synthesized locally in [mix-audio.py](motion/mix-audio.py): short quiet keys during visible typing, soft send swishes, discrete review/apply clicks, and a gentle tonal arrival when a tool becomes usable. The Coffee click is distinct. Pen/contact sounds support the opening. No downloaded sound library or generated music.
- Narration stays centered; subtle effect positioning follows the action. No continuous music bed. Normalize the final mix to approximately-16LUFS with true-peak target-1.5dBTP; inspect actual output before reporting measured levels.
- Cached audio is used for ordinary rendering; no TTS call occurs during render. Optional English captions come from word-boundary timing and remain selectable, not forced over the interface.

## Production prompt

```text
Revise the existing Tabletop film with authored React/SVG/CSS scenes. Use the supplied English narration and action cues. Let the story breathe for84.7seconds at30fps; do not force60seconds. Show a pen writing real order entries and the manual tally burden, then slide into the digital canvas without morphing objects. Keep Tabletop's original logo and loader animation.

Show five explicit typed requests on the same canvas: sales table, quick-sale buttons, chart,10% discount, change selected rule to20%. Explain why the seller needs each change. Align Coffee click and Apply moments to the narration. Keep table values and old tools visible. The quick button must actually update quantity and total in the illustrative animation. Before applying20%, active10%/net225 remains; preview200 is separate. After Apply, net200 and gross250 stay clear.

Use the final cached soundtrack, quiet action SFX and optional English captions. Maintain legible English UI, clear draft/applied states, deliberate pauses and persistent concept/sample disclosure. Deliver H.264/AAC MP4, poster, eight final-MP4 stills, captions, source and verification. No productAPI, production mutation, AI image/video generation, or private data. Keep rootREADME and deployed homepage unchanged.
```

## Verification boundaries

Verify timing against the actual decoded audio, all video/audio frames, voice-window overlap, final loudness/peak, typing/SFX intervals, request/result pairs and Coffee/20% changes. Inspect the intro, transition and completed board. Technical checks and team review do not establish first-time viewer comprehension or prove real product behavior. A human listening pass remains distinct from waveform/metadata checks.

A separate product proof clip would need real prompts, real actions and readback/reload evidence. Do not present this illustration as that proof.
