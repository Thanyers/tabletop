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
