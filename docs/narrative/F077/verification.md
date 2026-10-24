# F077 — Revision5 verification in progress

24October2026 · Node22.23.2 · Python3.12 · English-first homepage and revised concept film

- User accepted the website design and requested English as its base. Fresh browser load shows English title/lang/body, controls and dynamic sample text; Thai switch still works. English first request→review→apply produces225.
- User rejected R4 story opening and voice, then Emma/Andrew auditions. ElevenLabs Liam direction accepted with female requested; Laura chosen, all10segments generated and decoded. Measured windows total104.433s/3133frames before final visual review.
- Actual homepage source integration is authorized in this revision. It is not a production release/deploy request.
- Picture/word match, final render/mix, homepage build/browser and independent review: IN PROGRESS. Earlier revision results below are historical and do not pass these new checks.

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
