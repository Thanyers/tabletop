export type DemoTour = 'story' | 'details';
export type DemoScene = {
 title:string;text:string;caption:string;action:'connect'|'minimal'|'compare'|'overview'|'why'|'threshold'|'schedule'|'types'|'list'|'browse'|'teach'|'test'|'approve'|'experiment'|'knowledge'|'handoff'|'continue';hold:number;
};

// The main story follows one discrepancy. The detailed tour retains every control.
export const storyScenes:readonly DemoScene[] = [
 {title:'เริ่มจากงานตรงหน้า',text:'เทียบค่าเสื่อมกับบัญชีเดือนนี้ให้หน่อย',caption:'อ่านทะเบียนตัวอย่างกับ Excel',action:'minimal',hold:1600},
 {title:'ตารางเดิม ข้อมูลเพิ่ม',text:'เพิ่มยอดบัญชีกับส่วนต่างไว้ข้างกัน',caption:'เพิ่มคอลัมน์ในตารางเดิม',action:'compare',hold:1800},
 {title:'ทำไมรายการนี้ไม่ตรง?',text:'FA-001 ในทะเบียนเป็น 500 ทำไมคำนวณได้ 0?',caption:'ดูสาเหตุจากข้อมูลและกฎ',action:'why',hold:2600},
 {title:'สอนกฎที่บริษัทใช้',text:'Laptop ตั้งแต่ 15,000 บาท ใช้ 36 เดือน เริ่มเดือนพร้อมใช้',caption:'ร่าง UI ต่อเนื่องจากคำขอเดียว',action:'teach',hold:2000},
 {title:'ตรวจผลก่อนใช้จริง',text:'ลองกับข้อมูลเดิม แล้วทดสอบก่อนนะ',caption:'กฎที่ใช้อยู่ยังไม่เปลี่ยน',action:'test',hold:1800},
 {title:'คำสอนเปลี่ยนผลลัพธ์',text:'ผ่านแล้ว ใช้กฎนี้ได้เลย',caption:'อนุมัติแล้วคำนวณใหม่',action:'approve',hold:2600},
 {title:'ลองได้ โดยกฎจริงยังอยู่',text:'ถ้าใช้ 48 เดือน จะได้เท่าไร? ลองดูก่อน',caption:'เทียบผลจริงกับสมมติฐาน',action:'experiment',hold:2800},
 {title:'จำได้ว่ากฎนี้มาจากไหน',text:'แสดงที่มาของกฎที่เราเพิ่งสอนหน่อย',caption:'ตามหลักฐานที่บันทึกไว้',action:'knowledge',hold:2200},
 {title:'ส่งต่อสิ่งที่ยังต้องทำ',text:'FA-009 ยังขาดวันพร้อมใช้ ให้เพื่อนตรวจต่อ',caption:'ปัญหายังค้างจนกว่าจะมีหลักฐาน',action:'handoff',hold:2200},
 {title:'เปิดต่อ พร้อมเหตุผลเดิม',text:'เก็บงานนี้ แล้วเปิดให้คนรับช่วงต่อดู',caption:'เปิดตัวอย่างที่บันทึกจริง',action:'continue',hold:2200},
];

export const detailScenes:readonly DemoScene[] = [
 {title:'ข้อมูลอยู่ที่ไหน?',text:'ทะเบียนอยู่ในฐานข้อมูล ยอดบัญชีอยู่ใน Excel ขอเลือกข้อมูลก่อน',caption:'ตรวจตาราง ชีต และฟิลด์จับคู่',action:'connect',hold:8000},
 {title:'เริ่มจากตารางเล็ก ๆ',text:'ขอชื่อสินทรัพย์กับค่าเสื่อมก่อน',caption:'เริ่มจากสองคอลัมน์ที่ใช้ได้จริง',action:'minimal',hold:7000},
 {title:'ขยายตารางเดิม',text:'เพิ่มยอดบัญชีกับส่วนต่างไว้ข้างกัน',caption:'ข้อมูลเดิม เพิ่มมุมเปรียบเทียบ',action:'compare',hold:7000},
 {title:'เพิ่มเครื่องมือเมื่อจำเป็น',text:'ขอค้นหา กรองประเภท และดูรายการที่ยังไม่ตรง',caption:'เพิ่มภาพรวมจากผลที่คำนวณจริง',action:'overview',hold:8000},
 {title:'ทำไม FA-001 เป็น 0?',text:'ทะเบียนเป็น 500 ช่วยตรวจสาเหตุหน่อย',caption:'ดูข้อมูลและกฎที่ใช้กับรายการนี้',action:'why',hold:10000},
 {title:'เพิ่มเกณฑ์ราคา',text:'Laptop ตั้งแต่ 15,000 บาทเป็นสินทรัพย์',caption:'เพิ่มช่องตั้งค่าฉบับร่าง',action:'threshold',hold:7000},
 {title:'เพิ่มอายุและเดือนเริ่ม',text:'ใช้ 36 เดือน เริ่มเดือนพร้อมใช้',caption:'เติมช่องตามความต้องการ',action:'schedule',hold:8000},
 {title:'แยกประเภทสินทรัพย์',text:'ประเภทอื่นตั้งแยกได้ไหม? รอบนี้แก้เฉพาะ Laptop',caption:'เก็บกฎประเภทอื่นไว้',action:'types',hold:8000},
 {title:'ดูผลก่อนใช้',text:'ขอดูรายการภายใต้กฎฉบับร่าง',caption:'ผลทดลองจากข้อมูลเดิม',action:'list',hold:7000},
 {title:'เพิ่มการค้นหาและกรอง',text:'ค้นหา กรองประเภท และดูแถวที่เปลี่ยนได้ด้วย',caption:'เพิ่มเครื่องมือใน Preview เดิม',action:'browse',hold:7000},
 {title:'ทดสอบก่อนอนุมัติ',text:'ตรวจผลกระทบและรายการเดิมก่อนนะ',caption:'กฎจริงยังไม่เปลี่ยน',action:'test',hold:10000},
 {title:'ใช้กฎที่ตรวจแล้ว',text:'ผ่านแล้ว ใช้กฎ Laptop ฉบับนี้ได้',caption:'คำนวณใหม่ในงานเดิม',action:'approve',hold:10000},
 {title:'ลอง 48 เดือน',text:'ลอง 48 เดือนก่อน กฎจริงยังใช้ 36 เดือน',caption:'แยกผลทดลองจากผลจริง',action:'experiment',hold:10000},
 {title:'ตามที่มาของกฎ',text:'กฎนี้มาจากคำสอนและการตรวจอะไร?',caption:'ดูหลักฐานของการเปลี่ยนแปลง',action:'knowledge',hold:10000},
 {title:'ส่งต่องานค้าง',text:'FA-009 ยังขาดวันพร้อมใช้ ส่งให้เพื่อนตรวจต่อ',caption:'ส่งต่อพร้อมบริบทและหลักฐาน',action:'handoff',hold:8000},
 {title:'กลับมาทำต่อได้',text:'บันทึก แล้วเปิดให้คนรับงานต่อดู',caption:'กฎ ผลลัพธ์ และงานค้างยังอยู่',action:'continue',hold:9000},
];
