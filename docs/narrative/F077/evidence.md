# หลักฐาน ขอบเขต และสิ่งที่ยังไม่ยืนยัน

## Source ที่ตรวจ

ฐานเปรียบเทียบ `origin/dev` SHA `9efebab0c4c9f4a5024ac86d515fd16d1fb68e01` หน้าเว็บจริงไทย/อังกฤษตรวจ24ต.ค.2026 และ `/version` รายงาน9.0.2/8e2c7e1 ในรอบรีวิวก่อนสร้างชุดร่าง

| สิ่งที่อ้าง | Source | ขอบเขต |
| --- | --- | --- |
| READMEเดิม | [README](../../../README.md) | belief, intent-first, three stories, screenshots, scope |
| หน้าแรกเดิม | [PublicWelcome](../../../src/tabletop/ui/PublicWelcome.tsx), [copy](../../../src/tabletop/ui/landing-copy.ts) | heroSVG, processGIF, three use cases, EN/TH, authslot |
| motionเดิม | [showcase provenance](../../showcase/README.md), [source](../../showcase/motion/src/tabletop-story.jsx) | 20s/960×540/12fps concept physics, ไม่ใช่AI recording |
| บุคลิก | [design](../../../design.md), [CalmCanvas](../../CALM_CANVAS_DESIGN.md) | ครีม/หมึก/เขียว, การ์ดใช้ทำงาน, ลดnoise |
| เริ่มไม่มีไฟล์+เติมCSV | [Release9 PD005/006](../../testing/f066-post-deploy/RELEASE9_RESULTS_TH.md) | production QAรายเคส, ไม่ใช่ทุกpromptผ่านครั้งแรก |
| คำนวณและส่งผลmetric/chart | รายงานเดียวกัน PD013–019 | source/versionคงเดิม; model-job IDsคงเดิม แต่ providerCallsยังUNVERIFIED |
| ถาม/แก้กฎเฉพาะใบ | รายงานเดียวกัน PD027/028 | ถามกฎdiscountที่เลือก, แก้discountโดยไม่แก้gross/raw |
| กลับมาเปิดโต๊ะเดิม | รายงานเดียวกัน PD020 | บัญชีเดิม; ไม่พิสูจน์หลายบัญชีด้วยตัวมันเอง |
| สูตร/JS/Python | รายงานเดียวกัน PD002/003/007–017 | runtime/librariesที่เปิดใช้ตามprofile; ไม่ใช่arbitrarysoftware |

## Claim discipline

- ใช้คำว่า “ใช้วิธีคำนวณเดิม” ได้ หลีกเลี่ยง “ไม่เรียกAIเลย/ไม่มีค่าAIเลย” เพราะproviderledgerไม่ได้ยืนยันในรายงาน
- ไม่มีเปอร์เซ็นต์ลดเวลา ต้นทุน รายได้ ความเร็วgeneration หรือจำนวนผู้ใช้จริงที่วัดไว้ ห้ามเพิ่มเป็นmarketingKPI
- หลายบัญชี/permissions8เคสของF066ยังBLOCKED; humanreadbackและmobileบางขอบเขตยังไม่ครบ ไม่ขึ้นbadge“production proven”แบบครอบจักรวาล
- ผล37PASS/10BLOCKED/1SKIPPED_SCOPEรวมcontrolledlocal7รหัส ไม่ใช่37เคสรันใหม่ทั้งหมดบนproduction9.0.2 และrawUIgateยังมีFAILแยก
- Coffee/Cakeและตัวอย่างร้านเป็นเรื่องสมมติ ไม่มีบุคคล/ธุรกิจจริง ไม่มีข้อมูลส่วนบุคคลในสื่อ
- ตัวเลข225→405ในmotionเป็นค่าคำนวณจากinputที่กำหนด ไม่ได้อ่านจากproduction; ส่วนลด10→20%บนgross405เป็นลำดับเล่าใหม่ ไม่อ้างเป็นrecordingของเคสPD028เดิมที่gross225
- product.mdส่วนcurrentbetaยังเน้นเริ่มจากไฟล์ และoutsidebetaมีคำว่าgeneratedcodeexecutionกว้างเกินจริงเมื่อเทียบรุ่น9 ควรปรับเอกสารเจ้าของเรื่องในงานintegrationโดยแยกboundedcomputeออกจากarbitraryexecution; ชุดร่างนี้ยังไม่แก้sourceดังกล่าว
- [GENERIC_TABLE_DESIGN](../../GENERIC_TABLE_DESIGN.md) ยังเรียก prompt-only Generative Canvas ว่า unreleased candidate ซึ่งตามหลังผล production ใน F066; งาน integration ต้องปรับสถานะเอกสารนี้พร้อม product.md ก่อนเผยแพร่ copy ใหม่

## แหล่งภายนอก

- [Reference video](https://skillry.dev/ai-videos/opus-5-5/deedydas-252537): ดูเฟรม0/4/9/14/22–23sและหน้าprompt; ไม่ดาวน์โหลด/นำmedia/เพลงมาใช้ และไม่ติดตั้งpremiumskill
- [Prompt source](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/main/prompts/deedydas-252537.md): promptสั้น, metadataของremakeเป็นSVG/GSAP; ใช้เป็นreferencedirectionไม่ใช่คำสั่งให้ใช้assetหรือแอบอ้างผล
- [Event](https://luma.com/39zve8ph): เกณฑ์และexistingprojectruleที่ตรวจจากหน้าeventก่อนงาน ต้องทวนอีกครั้งก่อนส่งประกวดเพราะกติกาอาจเปลี่ยน

## งาน integration ที่ต้องตรวจอีกครั้ง

- เมื่อย้ายreadme-draftไปroot ให้เปลี่ยนrelativepathsของposter/video/ภาพเดโม/คู่มือ/license ให้ตรงตำแหน่งปลายทางแล้วตรวจลิงก์ใหม่
- หน้าreview.htmlเป็นartifactทบทวน ไม่ใช่runtimeของPublicWelcome ตัวปุ่มที่พาเว็บจริงต้องแสดงปลายทางตรง ไม่สร้างฟอร์มauthปลอม
- ตรวจภาษาEN/THของหน้าlandingให้ความสามารถและข้อจำกัดตรงกัน; UIหลังloginยังใช้ภาษาตามแอปเดิม
- แยกpublicmediaกับtestresults/บัญชีQA; ห้ามเผยแพร่credentials, roomIDsหรือภาพบัญชีจริง
