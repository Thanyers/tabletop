import { createContext, useContext } from 'react';

// Public landing copy in both languages (F052). The signed-in app stays English;
// only the landing, sign-in and welcome-back panels read from here.

export type LandingLanguage = 'th' | 'en';

const languageKey = 'tabletop.landingLanguage';

export function readLandingLanguage(): LandingLanguage {
  try {
    const stored = window.localStorage.getItem(languageKey);
    if (stored === 'th' || stored === 'en') return stored;
  } catch {
    // Storage can be blocked; the page then opens in the default language.
  }
  return 'en';
}

export function saveLandingLanguage(language: LandingLanguage): void {
  try { window.localStorage.setItem(languageKey, language); } catch { /* the choice lasts for this page only */ }
}

const th = {
  header: { note: 'พื้นที่สำหรับงาน การเรียนรู้ และการเล่น', signIn: 'เข้าสู่ระบบ', yourTables: 'โต๊ะของฉัน', switchTo: 'English', switchLabel: 'Switch the page to English' },
  hero: {
    eyebrow: 'TABLETOP · ทำไมเราถึงอยู่ที่นี่',
    title: 'เครื่องมือที่ดีที่สุด คือเครื่องมือที่คุณไม่ต้องคิดถึงมัน',
    promise: 'คุณมีบางอย่างอยากทำให้สำเร็จ — งานที่ต้องสะสาง เรื่องที่อยากเข้าใจ หรือเกมที่อยากเล่นกับเพื่อน',
    bridge: 'คุณมาที่นี่เพื่อทำสิ่งหนึ่งให้สำเร็จ ไม่ใช่มาสร้างเครื่องมือก่อนเริ่ม',
  },
  story: {
    alt: 'โต๊ะบทเรียนค่อย ๆ เติบโตจากไฟล์เรื่องแรงและการเคลื่อนที่ ไปเป็นกฎที่ตรวจแล้ว ปุ่มควบคุม และการทดลองรถ',
    caption: 'ภาพอธิบายแนวคิด · บทเรียนแรงและมวล',
    showStill: 'แสดงภาพนิ่ง', replay: 'เล่นอีกครั้ง', replayIdea: 'ดูแนวคิดอีกครั้ง',
    showStillLabel: 'แสดงภาพนิ่ง', replayLabel: 'เล่นภาพเคลื่อนไหวอีกครั้ง',
    note: 'ภาพจำลองจาก Remotion ไม่ใช่ภาพหน้าจอแอปหรือผลการใช้งานจริง',
  },
  why: {
    eyebrow: 'เหตุผล',
    title: 'เครื่องมือเปลี่ยนให้เข้ากับงานมาตลอด ซอฟต์แวร์ก็ควรเป็นแบบนั้น',
    body: 'เราปรับเครื่องมือให้เข้ามือเสมอ แต่ซอฟต์แวร์มักเพิ่มขั้นตอนให้เรียนรู้ หรือบังคับให้หาทางอ้อมเมื่องานเปลี่ยน Tabletop เริ่มจากสิ่งที่คุณกำลังทำ แล้วให้เครื่องมือค่อย ๆ เข้ารูปตามงานนั้น',
    thesisLabel: 'หลักคิดของผลิตภัณฑ์',
    thesis: 'งานเป็นตัวกำหนดว่าซอฟต์แวร์จะเป็นอะไร',
  },
  today: {
    eyebrow: 'เบต้าปัจจุบัน',
    title: 'ลองอะไรได้แล้ววันนี้',
    summary: 'ขอบเขตที่รองรับตอนนี้ — AI ร่าง ระบบตรวจ คนเป็นคนลงมือ',
    capabilities: [
      { label: '01 · เริ่ม', title: 'เริ่มจากบอกว่าต้องการอะไร', body: 'พิมพ์ในแชทว่าอยากทำอะไร แนบไฟล์ CSV, JSON, TXT หรือ Markdown ได้ถ้ามี แล้ว AI จะร่างข้อมูลและกติกาบนโต๊ะให้' },
      { label: '02 · ตรวจ', title: 'ตรวจครบแล้วจึงขึ้นโต๊ะ', body: 'กฎที่ AI ร่างผ่านการตรวจของระบบครบแล้วจึงขึ้นโต๊ะ เอากฎออกทีละข้อได้ ส่วนการกระทำที่ AI เสนอ คนถามต้องกดยืนยันเอง' },
      { label: '03 · ร่วมกัน', title: 'ทำด้วยกันแบบสด', body: 'เชิญคนเข้าโต๊ะ เห็นเมาส์และแชท AI ของกันและกันแบบสด กำหนดสิทธิ์รายคนได้ แปะโน้ตไว้บนโต๊ะ แล้วกลับมาทำต่อด้วยบัญชีเดิม' },
    ],
  },
  demos: {
    eyebrow: 'เดโมที่เตรียมไว้',
    title: 'ลองโต๊ะที่พร้อมเล่น',
    body: 'เปิดเดโมสาธารณะแล้วเลือก Invoice, Physics หรือ Encounter แบบร่วมมือ กดหยุดเพื่อลองควบคุมเอง เดโมเหล่านี้เตรียมไว้ล่วงหน้าและไม่เรียก AI',
    physics: { name: 'Physics', hint: 'ปรับแรง มวล และเวลา', open: 'เลือก Physics', openLabel: 'เปิดหน้าเลือกเดโมแล้วเลือก Physics ในแท็บใหม่', alt: 'ภาพหน้าจอจากเดโม Physics: รถเคลื่อนที่ 4 m ใน 2 s ด้วยแรง 10 N และมวล 5 kg ได้ความเร่ง 2 m/s²' },
    encounter: { name: 'Encounter', hint: 'เล่นตาของคุณและช่วยเพื่อนร่วมทีม', open: 'เลือก Encounter', openLabel: 'เปิดหน้าเลือกเดโมแล้วเลือก Encounter แบบร่วมมือในแท็บใหม่', alt: 'ภาพหน้าจอจากเดโม Encounter แบบร่วมมือ มีตัวละครสองตัว ลำดับตา และการกระทำกางโล่' },
    note: 'ภาพหน้าจอจริงจากเดโมสาธารณะ · ใช้สถานการณ์และผู้เล่นจำลอง',
  },
  lenses: {
    eyebrow: 'สามเหตุผลที่มารวมกัน',
    title: 'โต๊ะเดียว หลายเหตุผลที่ทำให้มารวมกัน',
    disclaimer: 'นี่คือทิศทางที่เรากำลังสำรวจ ไม่ใช่สัญญาว่าตอนนี้สร้างแอปหรือหน้าจอแบบไหนก็ได้',
    items: [
      { title: 'โต๊ะของคุณ', body: 'ไล่ดูใบแจ้งหนี้พร้อมหลักฐาน เปลี่ยนสิ่งที่ต้องตรวจได้โดยงานที่ทำไปแล้วไม่หาย' },
      { title: 'โต๊ะสำหรับเรียนรู้', body: 'อธิบายเรื่องเดียวได้หลายแบบ ทั้งคำพูด ตัวเลข การทดลอง หรือภาพที่ทำให้เข้าใจทันที' },
      { title: 'โต๊ะของเรา', body: 'พบเพื่อนในโลกเดียวกัน เล่นด้วยกัน และปรับกติกาไปตามเรื่องราวที่ดำเนินไป' },
    ],
  },
  closing: { eyebrow: 'พร้อมเมื่อคุณพร้อม', title: 'มีงานอะไรอยู่ในมือ เอาขึ้นโต๊ะได้เลย' },
  footer: 'สำหรับงาน การเรียนรู้ และการเล่น ที่พาคุณมาที่นี่',
  auth: {
    eyebrow: 'โต๊ะของคุณเริ่มที่นี่',
    title: 'นำงานของคุณขึ้นโต๊ะ',
    body: 'เข้าสู่ระบบด้วย Google เพื่อเริ่มโต๊ะใหม่ หรือกลับไปยังโต๊ะที่คุณใช้ร่วมกันอยู่',
    inviteSaved: 'บันทึกคำเชิญไว้ในแท็บนี้แล้ว และจะใช้หลังเข้าสู่ระบบ',
    dismiss: 'ปิดข้อความ',
    google: 'ดำเนินการต่อด้วย Google',
    checking: 'กำลังตรวจสอบการเข้าสู่ระบบ…',
    checkAgain: 'เข้าสู่ระบบแล้ว? ตรวจอีกครั้ง',
    inviteHelpTitle: 'คำเชิญเข้าโต๊ะทำงานอย่างไร',
    inviteHelp: 'ลิงก์คำเชิญใช้ได้ครั้งเดียวและมีวันหมดอายุ ใครเปิดลิงก์ขณะที่ยังใช้ได้จะได้ที่นั่งที่กำหนดไว้ ลิงก์ไม่ได้ผูกกับอีเมลใดล่วงหน้า และระบบตรวจสิทธิ์เข้าโต๊ะหลังเข้าสู่ระบบ',
    demo: 'เดโมอัตโนมัติ', demoHint: 'เปิดในแท็บใหม่', demoLabel: 'เดโมอัตโนมัติ (เปิดในแท็บใหม่)',
  },
  profile: { menu: 'เมนูบัญชี', yourTables: 'โต๊ะของฉัน', admin: 'ข้อมูลโต๊ะทั้งหมด (ผู้ดูแลระบบ)', language: 'Language: English', signOut: 'ออกจากระบบ', signingOut: 'กำลังออกจากระบบ…' },
  welcome: {
    eyebrow: 'เข้าสู่ระบบแล้ว',
    title: (name: string | null) => name ? `ยินดีต้อนรับกลับ ${name}` : 'ยินดีต้อนรับกลับ',
    body: 'กลับไปยังโต๊ะที่คุณใช้ร่วมกัน หรือเริ่มโต๊ะใหม่',
    start: 'เริ่มโต๊ะใหม่',
  },
};

export type LandingCopy = typeof th;

const en: LandingCopy = {
  header: { note: 'A place for work, learning, and play', signIn: 'Sign in', yourTables: 'Your tables', switchTo: 'ไทย', switchLabel: 'เปลี่ยนหน้านี้เป็นภาษาไทย' },
  hero: {
    eyebrow: "TABLETOP · WHY WE'RE HERE",
    title: "The best tool is the one you don't have to think about.",
    promise: 'You have something you want to get done — work to sort out, an idea you want to understand, or a game to play with friends.',
    bridge: 'You came here to do something. Not to build the tools to do it.',
  },
  story: {
    alt: 'A lesson table grows from a force-and-motion file into a reviewed rule, hands-on controls, and a car experiment.',
    caption: 'Concept illustration · a force-and-mass lesson',
    showStill: 'Show still', replay: 'Replay animation', replayIdea: 'Replay idea',
    showStillLabel: 'Show the still illustration', replayLabel: 'Replay the concept animation',
    note: 'A Remotion illustration, not an app screenshot or a real usage result.',
  },
  why: {
    eyebrow: 'THE REASON',
    title: 'Tools have always changed to fit the work. Software should, too.',
    body: "We have always shaped tools to fit the hand, but software tends to add steps to learn or force workarounds when the work changes. Tabletop starts from what you're doing and lets the tools take shape around it.",
    thesisLabel: 'OUR PRODUCT THESIS',
    thesis: 'Work defines what software becomes.',
  },
  today: {
    eyebrow: 'THE CURRENT BETA',
    title: 'What you can try today',
    summary: "What's supported now — the AI drafts, the system checks, people act.",
    capabilities: [
      { label: '01 · START', title: 'Start by saying what you need', body: 'Type what you want to do in the chat, attach a CSV, JSON, TXT, or Markdown file if you have one, and the AI drafts the data and rules on your table.' },
      { label: '02 · CHECK', title: 'Checked, then on the table', body: "Rules the AI drafts reach the table only after the system's checks pass, and you can remove them one at a time. Actions the AI proposes still wait for the person who asked to confirm." },
      { label: '03 · TOGETHER', title: 'Work on it together, live', body: "Invite people to the table, see each other's cursors and AI chats live, set permissions per person, pin notes to the table, and pick up where you left off with the same account." },
    ],
  },
  demos: {
    eyebrow: 'PREPARED DEMOS',
    title: 'Try a table that is ready to play.',
    body: 'Open the public demo and choose Invoice, Physics, or cooperative Encounter. Pause to take over and try the controls yourself. These prepared scenarios make no AI calls.',
    physics: { name: 'Physics', hint: 'Change force, mass, and time.', open: 'Choose Physics', openLabel: 'Open demo chooser and select Physics in a new tab', alt: 'Screenshot from the prepared Physics demo: a car moves 4 m in 2 s with 10 N force and 5 kg mass, calculating acceleration of 2 m/s².' },
    encounter: { name: 'Encounter', hint: 'Take a turn and help a teammate.', open: 'Choose Encounter', openLabel: 'Open demo chooser and select cooperative Encounter in a new tab', alt: 'Screenshot from the prepared cooperative Encounter demo, showing two characters, turns, and a shield action.' },
    note: 'Real screenshots from the public demo · simulated scenarios and players',
  },
  lenses: {
    eyebrow: 'THREE REASONS TO GATHER',
    title: 'One table, different reasons to come together.',
    disclaimer: "These are the directions we're exploring — not a promise that any app or interface can be generated today.",
    items: [
      { title: 'Your Table', body: 'Follow an invoice through its evidence. Change what you need to inspect without losing the work already done.' },
      { title: 'A Table for Learning', body: 'Explain one idea in different ways — with words, numbers, experiments, or a picture that makes it click.' },
      { title: 'Our Tables', body: 'Meet friends in a shared world, play together, and shape the rules as your story unfolds.' },
    ],
  },
  closing: { eyebrow: 'READY WHEN YOU ARE', title: "Whatever you're working on, bring it to the table." },
  footer: 'For the work, learning, and play that brought you here.',
  auth: {
    eyebrow: 'YOUR TABLE STARTS HERE',
    title: 'Bring your work to the table',
    body: 'Sign in with Google to start a table or return to one you already share.',
    inviteSaved: 'Your invitation is saved in this tab and will be used after sign-in.',
    dismiss: 'Dismiss message',
    google: 'Continue with Google',
    checking: 'Checking sign-in…',
    checkAgain: 'Already signed in? Check again',
    inviteHelpTitle: 'How table invitations work',
    inviteHelp: 'Invitation links are single-use and expire. They grant a designated seat to whoever opens the link while it is valid; it is not tied to a preselected email. Table access is checked after sign-in.',
    demo: 'Auto demo', demoHint: 'opens in a new tab', demoLabel: 'Auto demo (opens in a new tab)',
  },
  profile: { menu: 'Account menu', yourTables: 'Your tables', admin: 'All table metadata (admin)', language: 'ภาษา: ไทย', signOut: 'Sign out', signingOut: 'Signing out…' },
  welcome: {
    eyebrow: 'SIGNED IN',
    title: (name: string | null) => name ? `Welcome back, ${name}` : 'Welcome back',
    body: 'Return to a table you share, or start a new one.',
    start: 'Start a new table',
  },
};

export const landingCopy: Record<LandingLanguage, LandingCopy> = { th, en };

export const LandingLanguageContext = createContext<LandingLanguage>('en');
/** Switches the landing language; provided by `PublicWelcome` so menus inside it can offer the same toggle. */
export const LandingLanguageSwitchContext = createContext<() => void>(() => undefined);

export function useLandingCopy(): LandingCopy {
  return landingCopy[useContext(LandingLanguageContext)];
}
