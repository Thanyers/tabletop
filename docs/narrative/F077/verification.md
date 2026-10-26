# F077 — Revision 11 verification

26 October 2026 · [PR #348](https://github.com/Thanyers/tabletop/pull/348)

- Published on the default branch through [release #351](https://github.com/Thanyers/tabletop/pull/351), main `0ce11c8`. [Exact-head full CI](https://github.com/Thanyers/tabletop/actions/runs/40294440122) passed all three browser suites and fast checks on `13a781d`; main validation reused its identical Git tree. [Deploy](https://github.com/Thanyers/tabletop/actions/runs/40295626873) completed Worker/Container settings, smoke and GitHub Release publication. Production readback at 15:59 Asia/Bangkok: 9.1.5 / 0ce11c8, built_at 2026-10-26T08:56:08Z; health/readiness 200. Staging snapshot remains 0.0.0-dev / ec3a65d at that read, not a claim about the later closeout.
- Actual GitHub main rendering shows the café/physics/adventure headings in order and all three GIFs loaded. Main README blob `68b48a5ee8ce1f915c40e91d36188cff913ae407` equals the approved local file. Application, homepage, film, media, backend, dependencies and deployment source have no diff from production 9.1.4; only documentation and release metadata changed. Release Notes HTML generated locally (33 releases, latest 9.1.5); publishing to the existing private Claude artifact remains unavailable to this agent.

- Scope: English root README plus owning task records. The document follows café sales → force-and-motion learning → shared adventure, using the exact EN GIFs/posters already published in the homepage hero. Each case describes a need, an added tool and continued use of the same table.
- Retained exactly: definition and physical-tool story; current-capability bullet text; start/beta guidance; AGPL section. Removed the older invoice example and separate learning/Encounter illustration assortment from README. App, homepage, film, media source and generated asset bytes unchanged.
- Node22.23.2 documentation checks: all 13 local references resolve; three GIFs in the intended order with three matching reduced-motion posters. GitHub Markdown API rendered all three picture/GIF/reduced-motion sources. Public scan has zero findings and diff check passes. No new runtime tests authored for this documentation-only change; hosted exact-head full validation passed as recorded above.
- The documentation release excluded unrelated dev runtime work, following the same narrow publication boundary as round 10. Default-branch publication and GitHub rendered readback completed as recorded above.

## Revision 10 verification (historical)

26 October 2026 · [PR #306](https://github.com/Thanyers/tabletop/pull/306)

- Published as **9.1.4 / d09d2f2** via [release #309](https://github.com/Thanyers/tabletop/pull/309). [Exact-head full CI](https://github.com/Thanyers/tabletop/actions/runs/40255695998) passed all three browser suites and fast checks on `5e8d70f`; main reused the identical validated tree. [Deploy](https://github.com/Thanyers/tabletop/actions/runs/40256468104) succeeded through migrations, Worker/Container settings, smoke, and GitHub Release publication. Production readback at 08:57 Asia/Bangkok: version 9.1.4 / d09d2f2, built_at 2026-10-26T01:55:13Z; health/readiness/capabilities 200.
- Production browser readback confirms sales opens, the case selector order is café/physics/adventure, all three select the expected GIF, and sections remain top/why/board/examples/film. Served EN sales/learning/play GIF SHA-256 hashes equal their source files. Reduced-motion component readback preserves headings/table content and all three selectors while selecting a poster without Pause. No live AI call or production account/data mutation was used. Incident #291 was closed after successful replacement deployment; previous failed 9.1.3 attempts remain failures, and their underlying cause is unknown. Staging snapshot remains 0.0.0-dev / 8478c39 as of this readback, not a claim that the later dev closeout has deployed.

- Scope: existing hero GIF area only. Café sales → original physics learning → adventure play; sales opens because the work/control/result is familiar, followed by visibly different learning and play cases. Other page sections/copy, README, film and accepted learning GIF/poster bytes match the starting dev baseline.
- New EN/TH sales and play GIFs: each 960×540, 216 frames at 12 fps, 18 seconds, infinite loop. Four matching static posters. Each typed request precedes its card; prior cards remain. Sales uses quick entry (225→250), play ties Mira's roll to her initiative row (16→17), then shows health 18→11. Frames and posters inspected in both languages; the independent review's disconnected initiative finding was corrected and rechecked.
- Rotation starts after the selected image loads and gives each case 18 seconds. Manual selection resets that case's timer. Pause/Resume uses the existing poster behavior. Paused and reduced-motion modes do not rotate, and reduced motion retains manual case selection. No live AI or persisted table data is used by these authored examples.
- Node22.23.2: scoped ESLint, syntax checks, public scan and diff checks pass. Local build/typecheck and Worker dry-run pass. Local Workers browser suite: 35 PASS groups, no uncaught browser errors; hero assertions cover full sales→learning→play→sales rotation, no early transition, pause, reduced-motion freeze, keyboard selection and EN/TH source selection. That suite preceded the final media-only Mira label/initiative correction; final assets were subsequently rebuilt and visually/metadata checked. No rotation/runtime source changed after the suite.
- Final-asset offline component UI gate: **13 PASS / 3 FAIL / 4 SKIP**. Retained generic failures: bundled/shared CSS literal lint; positional reduced-motion parity after Pause is removed shifts later element indexes; clicking the already-selected English button is treated as a dead interaction. Missing theme/token/dialog inputs cause four skips. Raw results are retained; none are relabelled PASS. Responsive/contrast/keyboard/target checks that ran are included in that measured result.
- The production baseline is used for the scope-only release rather than bundling unrelated architecture commits now present on dev: the user's explicit “นอกนั้นห้ามแก้” constrains the publication. This is a bounded exception to the normal release-from-dev starting point, not permission to alter backend, configuration or credentials. Exact-head hosted CI and publication readback completed as recorded above.
- First release CI exposed a fixture timing race: `image.complete` became true before React's load/passive-effect timer was installed, so advancing a frozen clock immediately did not rotate at the expected boundary. The browser test now drives three frames (50 ms) after decoded-image readiness and checks the 18-second boundary with that explicit tolerance. The hero/runtime/media source is unchanged by this test repair; the corrected exact release head passed full CI as recorded above.

## Revision 9 verification (historical)

25 October 2026 · [PR #288](https://github.com/Thanyers/tabletop/pull/288) · [Release #289](https://github.com/Thanyers/tabletop/pull/289)

- Scope: homepage and English root README order/copy only. The accepted film, captions, GIFs and physical images have no source-byte changes compared with production 9.1.2 (`abe4aaf`).
- Reader order: product definition → physical-tool adaptation → software friction/solution → evolving café example → broader uses → optional film → start. README's learning animation now sits with Learning.
- Cleanup: repeated hero/section eyebrows, THE IDEA callout, vague footer/README slogans, repeated physical labels, LOCAL ILLUSTRATION and text-interpreted implementation notes removed. One prepared-request/sample-data/no-live-AI disclosure remains near the café example. English/Thai copy is aligned.
- Node22.23.2: local build/typecheck, Worker dry-run, scoped lint, public scan, 13 resolving README references and exact AGPL-section preservation passed. Local Workers suite: 35 PASS groups, no browser errors, using the built UI before final disclosure/Thai wording polish. [Full release CI](https://github.com/Thanyers/tabletop/actions/runs/40131202479) passed all three browser suites on final source. Main validation reused the identical validated tree.
- CUA readback: DOM/header anchors follow the intended order; no overflow at 280/320/414/1280. Important headings/table content remains identical and visible under reduced motion, with the poster selected. Existing browser checks cover real language switching and the five-step café state/calculation flow.
- Raw offline UI gate: 13 measured PASS / 3 FAIL / 4 SKIP. Findings retained: shared bundled CSS literals; generic reduced-motion parity indexes elements by position while removing Pause shifts later indices; generic interaction clicks already-selected English. Four skipped checks lack theme/token/dialog inputs. Raw failures are not relabelled PASS; focused content/language checks are separate evidence.
- Production readback at 04:08 Asia/Bangkok: `/version` reports `9.1.3 / 4748689`, built_at `2026-10-24T21:02:51Z`; health/readiness 200. Actual homepage order and final prepared-example copy verified. Root README blob on GitHub main equals local main (`36d0eae6d3d19e6c1c7371ddddd7a721800c84a5`). Staging remains `0.0.0-dev / ac51767`, not the latest dev HEAD.
- Deployment is **PARTIAL**: [first attempt](https://github.com/Thanyers/tabletop/actions/runs/40132004027) and [same-SHA retry](https://github.com/Thanyers/tabletop/actions/runs/40132413721) both failed applying Durable Object-managed Container settings after Worker publication. D1 migration steps succeeded; workflow smoke and GitHub Release publication were **SKIPPED**. Full deployment and compute completion remain **UNVERIFIED**; [incident #291](https://github.com/Thanyers/tabletop/issues/291) stays open. No backend, Wrangler/configuration or credential changes were attempted. Public readback is not a substitute for completed pipeline smoke or actual compute execution.
- No production account/data write or live AI request was used for validation. Release Notes HTML was generated locally; updating the existing private Claude artifact is unavailable to this agent.

## Revision 8 evidence (historical)

# F077 — Revision 8 verification

24 October 2026 · [PR #285](https://github.com/Thanyers/tabletop/pull/285) · [Release #286](https://github.com/Thanyers/tabletop/pull/286)

- Scope: only hero media/note/framing and the hammer/chair images changed visibly. README, its original animation, accepted R6 film, sales walkthrough and other page copy are unchanged.
- Node 22.23.2: build/typecheck, Worker dry-run, scoped lint and public-file scan passed. Full local Workers browser suite: 35 PASS groups, zero browser errors, 37 mocked provider requests; no live provider call.
- Both EN/TH GIFs: 960×540, 216 frames, 18,000ms, loop=0 (infinite). Typed requests precede each new card; existing cards persist. Posters and typing/card timeline frames inspected. Autoplay, Pause/Resume and reduced-motion poster are covered by the browser contract.
- Local CUA: no overflow at 280/320/414/1280, autoplay GIF loaded, all four before/after panels loaded. Main inspected the rendered hero and physical images. Independent source review confirmed scope containment; its autoplay-control finding was resolved with the discreet Pause/Resume control.
- The physical images are generated photorealistic illustrations. [Exact prompts and provenance](../../../public/narrative/adaptations/README.md) are saved with the assets. The film has not gained generated imagery.
- [Full release CI](https://github.com/Thanyers/tabletop/actions/runs/40092252022) passed all three browser suites. [Production deploy](https://github.com/Thanyers/tabletop/actions/runs/40092917650) passed; `/version` reports `9.1.2 / abe4aaf`, health/readiness returned 200, and production visual readback verified the scoped changes. No production account/data mutation or live AI invocation was performed.
- The full generic offline UI gate was not rerun for this bounded correction; the earlier revision's documented checker findings remain historical, not silently relabelled PASS.

## Revision 7 evidence (historical)

# F077 — Revision 7 verification

24 October 2026 · English README and homepage visual correction · [PR #280](https://github.com/Thanyers/tabletop/pull/280)

The root README now uses the English story. The homepage removes README navigation, restores the original learning animation to the hero, and replaces generic tool photos with before/after additions to the same hammer and chair. The accepted 93.2-second R6 film remains unchanged.

| Check | Result | Evidence and limit |
| --- | --- | --- |
| README source review | PASS | Independent reader review found no capability/provenance blocker; 14 local references resolve. Reusable-compute contract status now links to its existing production results rather than retaining stale candidate wording. |
| Build and source checks | PASS | Node 22.23.2: `npm run build`, final Vite rebuild, `npm run build:cloudflare` dry-run, scoped ESLint, Node syntax checks and public-file scan (970 files / 0 findings). |
| Complete Workers browser suite | PASS | Existing Workers browser harness passed the homepage, English/Thai persistence, sign-in error and version groups. New checks exercise send/review/apply, 225→250 gross, chart values 100/150, 10% net 225, pending 20% retaining 225, applied 20% net 200 and reset. The complete local suite finished with 35 PASS groups, exit 0 and no browser errors; its 37 provider requests were intercepted by the test mock, not sent to a live AI provider. |
| Visual readback | PASS within scope | Main inspected the English hero, same-object hammer comparison and corrected chair side profile; signed-in homepage has no horizontal overflow at 280/320/414/1280px, image loaded, zero README links. Existing browser harness also captured anonymous EN/TH desktop/mobile views. |
| Offline component UI gate | 14/16 measured checks pass; 4 SKIPPED | Real PublicWelcome component bundled offline. Raw full run: 12 PASS / 4 FAIL / 4 SKIP; film-height/status-border repairs passed both targeted rechecks. Remaining FAIL: hardcoded-value lint includes shared/bundled CSS; generic interaction gate expects the already-selected English button to change state. Existing browser test verifies switching both languages instead. Token/theme/dialog gates skipped without corresponding inputs. These are not an all-green or audience-comprehension claim. |
| English animation | PASS | Same authored composition, 960×540 / 240 frames / 20s. Poster and timeline frames inspected; original Thai assets unchanged. English GIF SHA-256 `A0A3A681ABDAE0747714918C3D9D62C495D6E992C3464EF53E3229C8FBC212A8`; no AI media generation. |
| Independent review | PASS within source scope | README and UI reviews found no functional/auth blocker. Requested demo regression coverage was added and passed in the changed browser journey. |
| Publication | PASS | [Release #282](https://github.com/Thanyers/tabletop/pull/282) merged as `3f8a06e`. [Full release CI](https://github.com/Thanyers/tabletop/actions/runs/40089761432) passed all three browser suites; [production deploy](https://github.com/Thanyers/tabletop/actions/runs/40090356750) succeeded. Readback: `9.1.1 / 3f8a06e`, health/readiness 200. Published English hero and lazy-loaded examples loaded, README links 0, no overflow at 1280 and 375px. No signed-in production write or live-provider test was performed. |

## Revision 6 evidence (historical)

# F077 — Revision 6 verification

24 October 2026 · Node 22.23.2 · Python 3.12 · FFmpeg 8.1.2

The user accepted the R5 story, imagery and voice, requested a tighter intro and selected explanatory sections, and authorized publication when complete. R6 keeps that approved content and uses section-specific, pitch-preserving retiming from the frozen R5 render. The homepage and review page now use R6. README remains a proposed draft.

- [Final film](media/tabletop-narrative-r6.mp4): 93.233333 seconds, 2,797 frames, 1280×720/30 fps, H.264/AAC stereo 48 kHz, 4,233,279 bytes.
- SHA-256: `5B1A53F7D79A4115A21AB3B335C794C8FFFDC9688870E68D0090239CDC6BF5A0`.
- Tools 1.20×, friction 1.18×, reversal 1.15×, board sections 1.10–1.11×, close 1.00×. Actual frame-rounded rates and boundaries are in the [retime manifest](media/tabletop-narrative-r6-retime.json).
- Existing Laura voice and original picture/sound sequence; no new TTS/provider call. Original R5 source is retained and hash-guarded. The retime script rerun produced the identical R6 video hash.

| Check | Result | Evidence and limit |
| --- | --- | --- |
| Media and captions | PASS | Full FFmpeg decode; 58 caption cues retained and mapped through the same piecewise timings, no invalid duration/overlap; public MP4/poster/VTT hashes match source outputs. |
| Audio | PASS measured | Independent readback: -15.8 LUFS integrated / -1.5 dBFS true peak. FFmpeg atempo preserves pitch; final caption ends at 91.807s, leaving about 1.43s of logo-only hold. |
| Source and picture review | PASS within scope | Main inspected all eight R6 contact-sheet frames; reviewer checked baseline guard, contiguous mapping, source/output separation, intro/reversal/applied-20% stills and white logo poster. No open blocker. |
| App verification on dev 0f97b79 | PASS | `npm test -- --reporter=dot`: 955 passed / 5 skipped; `npm run lint`: 0 errors / 111 existing warnings; `npm run build`, `npm run test:cloudflare` (204 passed), `npm run build:cloudflare` dry-run passed. |
| Release readiness | PASS for preflight | No migration, Wrangler/binding or new deployment-secret changes from current production. Normal release includes the already merged F078 work on dev, as required by the repository release workflow. |
| Homepage playback | PASS | Local and production browsers played R6 to 93.233333s with `ended=true`, no media error and English captions showing. Production EN/TH copy was observed and the English homepage left open. |
| Workers browser contract | PASS after repair | Original release run failed twice on the obsolete English H1; [PR #275](https://github.com/Thanyers/tabletop/pull/275) updates only the test contract. Existing local harness: 34 checks passed, errors empty. Auth, language, mobile, navigation and reduced-motion gates remain. |
| Hosted release validation | PASS | [Full release CI](https://github.com/Thanyers/tabletop/actions/runs/40085660035) passed all three browser suites and fast checks on `542d029`. [Main validation](https://github.com/Thanyers/tabletop/actions/runs/40086273497) reused that full result because the release and main `48d9b98` trees are identical; skipped jobs are not new passes. |
| Production deploy | PASS | [Release 9.1.0 pipeline](https://github.com/Thanyers/tabletop/actions/runs/40086302663) succeeded; `/version` reports 9.1.0 / 48d9b98, health/ready 200; served MP4 hash and captions match the checked-in R6. See [DEPLOYMENTS](../../DEPLOYMENTS.md). |
| Human listening/comprehension | NOT RUN | User accepted the R5 voice/story direction. Technical audio and image checks do not establish first-time audience comprehension. |

## Revision 5 evidence (historical)

# F077 — Revision 5 verification

24 October 2026 · Node 22.23.2 · Python 3.12 · FFmpeg 8.1.2

## Candidate and scope

The accepted website design is now in the actual shared homepage, English by default with a Thai switch. The film restores physical tools → software friction → Tabletop → the evolving café canvas. Laura is the female voice direction accepted by the user. The final lockup is white with the original logo only. README remains a draft; no production release/deploy was requested or performed.

- MP4: [concept film](media/tabletop-narrative-draft.mp4), 1280×720, 30 fps, 3,133 frames, 104.433333 seconds, H.264/AAC stereo 48 kHz, 4,455,384 bytes.
- SHA-256: `901380ADBFB2096F96C8B73098990D7A523F7F9ECA58364AFFB780FD8205672C`.
- Homepage media copies live under `public/narrative/`. The authored film and sample board are explanatory illustrations, not a recording or proof of successful AI execution.
- Photographs and adaptations: [credits/license](motion/public/objects/SOURCES.md). Laura was generated while the project had an active paid Starter plan, verified before synthesis. Credentials remain ignored and absent from tracked files.

## Checks

| Check | Result | Evidence and limit |
| --- | --- | --- |
| Fresh dependencies | PASS | `npm ci --no-fund`: 327 packages audited, 0 vulnerabilities. An initial test attempt with stale installed dependencies was stopped and is not counted. |
| Unit/SQL | PASS | `npm test -- --reporter=dot`: 927 passed, 5 skipped; 123 files passed, 2 skipped. Skips remain skips. |
| Lint | PASS | `npm run lint`: 0 errors, 111 existing warnings; scoped homepage lint also passed after review fixes. |
| App build/types | PASS | `npm run build`: public demo 9 scenarios/55 steps, three typecheck configurations and Vite build. Final `npx vite build` packages the media. Existing chunk-size/dependency annotation warnings remain. |
| Worker tests/bundle | PASS | `npm run test:cloudflare`: 204/204; `npm run build:cloudflare` dry run passes. An earlier run before building assets failed 3 asset tests; rerun after build passed all 204. |
| Voice/cache/alignment | PASS | All 10 local MP3s decode and fit measured windows. 58 VTT cues have no overlap; delivery directions are excluded. Ordinary mix/render uses cache without provider calls. |
| Mix and encoded audio | PASS | `python docs/narrative/F077/motion/mix-audio.py`; 10/10 windows, no premix clipping. Final MP4 measured -15.78 LUFS integrated / -1.51 dBTP. |
| Cue causality | PASS | All 5 chains preserve typing → complete text hold ≥8 frames → Send → draft → Review → Apply → result. Buttons settle 12 frames before Coffee click; rows update 10 frames after click. |
| Render/decode | PASS | `node render.mjs`, then full FFmpeg decode. Duration matches soundtrack within one frame. Source syntax checks passed. |
| Picture/script review | PASS for inspected frames | Main inspected physical-tool stages, corrected grip highlight, hammer callout clipping, chair mask gaps, reversal steps, completed typed requests, quick-sale update, 20% pending/10% active, and white logo ending. Worker inspected all extracted stills. |
| Actual homepage flow | PASS | Browser exercised all 5 chapters with mouse and again with keyboard: 225 → Coffee +1/gross250 → chart → 10% net225 → pending20% retains225 → Apply net200. Buttons remain disabled before Apply. |
| English/Thai and motion | PASS | Fresh English content, Thai/English keyboard switch, immediate full request under reduced motion, original animation retained with reduced-motion poster. |
| Responsive populated states | PASS | 280/320/414/1280 CSS-pixel views: document width equals viewport for initial and populated boards. Fixed intrinsic table overflow and narrow-screen heading/label stacking found during review. |
| Landmarks | PASS | One focusable main; global header/footer outside main; home scroll respects reduced motion. |
| Homepage film and photos | PASS | Browser playback reached 104.433333 seconds with `ended=true`, no media error, and the English text track showing. All three physical-tool photographs loaded. Emulation overrides were restored after checks. |
| Public files and documents | PASS | Final public scan: 950 files, 0 findings; 50 local Markdown targets resolved, 10 changelog fragments checked, and `git diff --check` passed. |
| Final dev sync | PASS | Merged `bad48d768841` without conflicts, preserving independent F078 entries. Rebuilt the app and reran the 10 navigation tests and 204 Worker tests after the merge. |
| Independent review | PASS, no open source blocker | Audio/credential/rights review and homepage state/auth/route/language review; landmark and reduced-motion findings fixed and rechecked. Final media targets supplied after render. |
| Hosted CI | PENDING | Read the latest PR commit checks; historical CI does not certify this candidate. |
| Human full-film listening/comprehension | NOT RUN | The user approved the voice direction. Automated audio checks and picture review do not establish naturalness or first-time audience understanding. |
| Production release/deploy | NOT RUN | Work stays on the F077 branch/draft PR. |

The initial app preview lacked its local API; starting the repository's loopback local API resolved it. Mobile screenshots required the browser's mobile viewport override and full-page capture path to avoid a display-scaling capture artifact; actual DOM widths were checked separately. This is not a full accessibility audit or a new hosted product acceptance run.

## Revision4 evidence (historical)

# F077 — ผลตรวจรอบ4: English narration + action sound

24 ตุลาคม2026 · Node22.23.2 · Python3.12 · English-first · ความยาวตามเรื่อง ไม่บังคับ60s

## Candidate รอบ4

- เสียงบรรยาย8ช่วง en-US-AriaNeural จากบทที่เขียนเอง ผ่านedge-tts7.3.1; ไม่มีkeyหรือเสียงบุคคลอ้างอิง
- เสียงtyping/send/review/apply/tool-arrivalและpaper/contactสร้างด้วยโค้ดตามเฟรม; ไม่มีเพลงหรือเสียงดาวน์โหลด
- Introเป็นปากกาจดออร์เดอร์และแก้ผลบวก ก่อนเลื่อนเข้าสู่canvas แทนรูปเก้าอี้/ปากกา/ค้อนที่ผู้ใช้ไม่เข้าใจ
- ความยาวกำหนดจากเสียงจริงและช่วงพัก:84.7s/2541frames; อังกฤษทั้งเสียงและข้อความในคลิป; webTH/ENคงอยู่

| Check | Result | Evidence / limit |
| --- | --- | --- |
| Narration-only independent review | PASS after revision | เพิ่มเหตุว่ากรอกแต่ละรายการช้า; chart/discountมีapprovalในบท; introใช้Imagineและconceptdisclosureคงตลอด; ไม่อ้างruntimeproof |
| Intro visual review | PASS, main | ตรวจintroก่อนrenderและMP4-derivedscene01หลังrender:ใบออร์เดอร์/ยอดแก้275→225; workerตรวจ8stillsและmainตรวจintro/quick-sale/20%applied |
| Voice generation | PASS8/8 | MP3ทุกช่วงdecodeได้และมีWordBoundarymetadata; คงrateปกติ ไม่เร่งเพื่อให้ครบ60s |
| Mix / timing / captions | PASS | FLAC84.7s/stereo48kHz;8voicewindowsไม่ทับ;5causalcuechainsผ่าน;Coffeeclickหลังปุ่มพร้อม;22captionintervalsไม่ทับ/ไม่เกินคลิป;premixpeak.78และSFXpeak.049; normalizedoutput-15.93LUFS/-1.50dBTP;ไม่ใช้ผลนี้อ้างhumanlistening |
| Final film / sound / frames | PASS | H.2641280×720/30fps/2541frames, AACstereo48kHz,84.700s; FFmpegdecodeครบ; finalAACreadback-15.95LUFS/-1.50dBTP;8MP4-derivedstillsตรวจแล้ว |
| Browser player / captions | PASS playback; caption toggle NOT RUN | Browserอ่านduration84.7และended=trueที่84.7; replayเวลาเดินถึง12.29sและpause12.30s;ไม่มีmediaerror;EnglishtextTrackมีอยู่และ22VTTcuesผ่านstaticcheck แต่ไม่ได้เปิดCCในplayer |
| Independent audio review | PASS | reviewerตรวจhashของcache8/8,wordtiming/VTTตรง,readback-15.95LUFS/-1.50dBTP;Coffee35.167sตรงคำCoffee35.158sต่าง8ms;ไม่ฟังเสียงด้วยคน |
| Independent source review | PASS within source scope | reviewerตรวจheadercutsตามvoice,request→draft→review→apply→result,pointerไม่ซ้อน,ruleเลือกก่อนพิมพ์,ตัวเลขจากgrossเดียว,README84.7s/Englishและdisclosure;ไม่ได้ตรวจMP4สุดท้าย |
| Syntax / internal links | PASS | node --check review.jsและrender.mjs;Pythoncompile2scripts;70localtargetsมีอยู่ |
| Public / changelog / whitespace | PASS | node scripts/check-public-files.mjs:876files/0findings; npx tsx server/changelog.ts check:4fragmentsOK; git diff --checkผ่าน |
| Human listening / comprehension | NOT RUN | เครื่องมือนี้อ่านaudioinputไม่ได้; metadata/waveformไม่ยืนยันความเป็นธรรมชาติของเสียงหรือfirst-timecomprehension |
| Production / exact prompts | NOT RUN | conceptanimationและข้อมูลสมมติ ไม่ใช่runtimeproof |

หน้าเว็บเปลี่ยนเฉพาะคำอธิบาย/เวลา/trackcaptionของวิดีโอ; การทดลองบอร์ดเดิมไม่มีlogicchange FullUIgateและbrowser5บทของรอบ3เป็นhistoricalผลเดิม ไม่อ้างว่ารันใหม่รอบ4

Final MP4:3,515,240bytes · SHA256 `409fc4a8c1e111783aeb8370518c154f06d2589d3af4eb3ad7a3da21323821b7`

Sync before delivery: merged `origin/dev` at `694d556`; preserved F077 and independent F078 entries. Post-merge public scan888files/0findings, changelog6fragmentsOK, whitespace clean. Media and narrative source unchanged by this merge; earlier876files/4fragments are the pre-merge candidate checks.

## ประวัติรอบ3 (ก่อนเพิ่มเสียง)

24 ตุลาคม 2026 · Node.js 22.23.2 · ขอบเขต: สื่อร่างและตัวอย่างในหน้า ไม่ใช่ production runtime

### เหตุที่ต้องแก้รอบนี้

ผู้ใช้ดูรอบ2แล้วระบุว่าไม่เห็นเครื่องมือปรับเข้ากับคนและไม่เห็นการพิมพ์คำขอต่อเนื่อง **เกณฑ์เรื่องเล่ารอบ2ไม่ผ่าน** แม้ผล UI gate 16/16 และตัวเลขจะผ่าน จึงไม่ใช้ผลตรวจเทคนิคอ้างว่าคนดูเข้าใจ

รอบ3เปลี่ยนเป็นความต้องการของคนขาย → พิมพ์ → ส่ง → ร่าง → ตรวจ/ใช้ → ลงมือใช้ แล้วขอปรับต่อบนโต๊ะเดิม

### ผลที่ตรวจใหม่

| การตรวจ | ผล | สิ่งที่ตรวจจริง |
| --- | --- | --- |
| เรื่อง/README | PASS ในขอบเขต independent prose review | ทุกการเพิ่มมีเหตุจากคน; ปุ่มขายถูกกดจริงในเรื่อง; chart/ruleต่อจากข้อมูลเดิม; ระบุภาพสมมติ |
| คำนวณตัวอย่าง | PASS 8/8 | gross225; coffee100; cake150; gross250;10%net225;20%net200; extraCakegross300;20%net240 |
| Browser 5 บท | PASS หลังแก้ | พิมพ์/ส่ง/ตรวจ/ใช้ครบ; คำขอส่งแล้วแสดงบนโต๊ะ; previewมีป้ายร่าง; ปุ่มขายยังdisabledก่อนApply; กดกาแฟ3→4ได้gross250; chart100/150 |
| Browser กฎและใช้ต่อ | PASS | Review20%ยังใช้10%net225/gross250; Applyแล้วใช้20%; กดเค้กเพิ่มต่อได้gross300/net240/chart100/200; ย้อนบท3ไม่ล้างกฎหรือข้อมูล |
| Browser ภาษา/หยุด/รีเซ็ต | PASS | หยุดพิมพ์แสดงคำขอครบเพื่อส่ง; สลับENระหว่างพิมพ์แปลpresetและรักษายอด/กฎ; resetหยุดtimerและคืนโต๊ะเริ่มต้น |
| Browser runtime error | RED → GREEN | พบdraft-summaryว่างแต่renderหาspanไทย/อังกฤษ ทำให้Send/Reviewthrow; เติมspanแล้วรันครบ5บทใหม่ ไม่พบconsoleerrorใหม่ในช่วงตรวจ |
| Independent source review | CLOSED 3/3 P2 | เปลี่ยนeditablepromptที่ผลไม่อ่านเป็นreadonlypreset; ไม่มีcustomtextถูกทับเมื่อเปลี่ยนภาษา; ปิดnull-queryในdraftsummary; motion sourceลำดับคำขอ/ผลและตัวเลขสอดคล้อง |
| Motion legibility review | แก้ตามภาพ preview | Mainพบคำขอเล็กเกินไปในภาพ1280×720 จึงขยายช่วงพิมพ์เป็นภาพหลักและแก้pointerซ้อนก่อนrenderสุดท้าย |
| Full UI gate รอบ3 | PASS 16/16 measured; SKIP 4 | รัน--fullหลังแก้sourceครบ:13render+3staticผ่าน; theme resolution, DTCG, token contrast, dialog focus trapข้ามเพราะไม่มีargument/selector; ผลจริงในignored test-results/f077/ui-gate-full.log |
| MP4 รอบ3 / decoded frames | PASS | H.264 60s/1280×720/30fps; full decode 1,800 frames; workerตรวจ8stills+poster; mainตรวจภาพคำขอปุ่มขาย/ผลคลิก/คำขอ10%/ข้อเสนอ20%/ใช้20%จากMP4; browserเวลา3.85→15.22sและerror=null; pause/seekรอบ3ไม่ยืนยัน |
| ลิงก์ภายใน | PASS 67/67 | Python pathlibตรวจMarkdown/HTML targets; excludeexternalURLs/node_modules/.remotion-bundle |
| Public files / changelog / whitespace | PASS | public scan0findings; changelog1fragment; git diff --checkผ่านก่อนcommit |
| JavaScript syntax | PASS | node --check review.js และmotion/render.mjs; JSXผ่านbundlepreview |
| ESLint draft coverage | SKIPPED BY CONFIG | rootESLintไม่ได้ครอบไฟล์draftทั้งหมด; hookไม่ใช่หลักฐานlintครบ |
| Human comprehension รอบ3 | NOT RUN | ยังไม่มีผลให้คนใหม่ดูแล้วเล่าเรื่องกลับ และยังไม่ได้รับuseracceptance |
| Actual product proof | NOT RUN | exact5requests/quick-sale/storyนี้ยังไม่ได้บันทึกจากproductจริง |
| เสียง | NOT PRODUCED | MP4เงียบ; เตรียมบทTH/ENไว้ ไม่เรียกAPIเสียง |

ตัวอย่างบนเว็บเป็นreadonlypresetที่เลือกบทแล้วเล่นเรื่องต่อ กดปุ่มขายได้จริงเฉพาะstateในหน้า ไม่ได้ตีความข้อความอิสระหรือเรียกAI ภาพวิดีโอสร้างจากโค้ดและข้อมูลสมมติทั้งหมด

### ขอบเขตเก่าและ CI

รอบ1เป็น36s; รอบ2เป็น60s hash `9198e8852be7998441f81873c11adb1a26bdc9e55ac2f7f345ca969a2bf1fc34` ผลเหล่านั้นไม่ใช่ผลตรวจartifactรอบ3

[CIรอบ2ของ31ac96f](https://github.com/Thanyers/tabletop/actions/runs/40068985937) failedที่ `Check dependency advisories` (4 moderate/3 high) ทำให้local-validationFAIL; งานนี้ไม่แก้rootdependenciesและคง [draft PR259](https://github.com/Thanyers/tabletop/pull/259) ผลcurrentheadต้องอ่านใหม่หลังpush ไม่มีmergeหรือdeploy

MP4 รอบ3: 1,395,144 bytes; SHA-256 `a3b7809a90f752a8a03822e5bd971ee16cba9f4496f35d1c4f136b6446ba77b0`. รวมMP4/poster/8stills 2,871,261 bytes.
