// Public landing copy in English and Thai (F069). Only the public landing, its
// sign-in box and the signed-in "welcome back" box read from here; the app
// behind sign-in stays English. Server meta in index.html stays English too.

export type LandingLanguage = 'en' | 'th';

export const landingLanguages: readonly LandingLanguage[] = ['en', 'th'];

const languageKey = 'tabletop.landingLanguage';

export function readLandingLanguage(): LandingLanguage {
  try {
    const stored = window.localStorage.getItem(languageKey);
    if (stored === 'th' || stored === 'en') return stored;
  } catch {
    // Storage can be blocked (private window, disabled site data): open in the default language.
  }
  return 'en';
}

export function saveLandingLanguage(language: LandingLanguage): void {
  try { window.localStorage.setItem(languageKey, language); } catch { /* the choice then lasts for this page only */ }
}

/** Kept English in both languages: the product thesis is a brand tagline. */
export const productThesis = 'Work defines what software becomes.';

const en = {
  header: {
    home: 'Tabletop home',
    note: 'A place for work, learning, and play',
    signIn: 'Sign in',
    yourTables: 'Your tables',
    languageGroup: 'Language',
  },
  hero: {
    eyebrow: 'TABLETOP · A TABLE FOR WHAT YOU CAME TO DO',
    title: "The best tool is the one you don't have to think about.",
    promise: "Tabletop is a shared space on a canvas. Say what you want to do, and AI helps draft tables, buttons, charts, or an experiment scene for you to use and keep adjusting. Start with words, then add files when you're ready.",
    primary: 'Start with your own work',
    secondary: 'See the prepared demo',
    alt: 'Concept illustration of a shared table with data, tools, and people in one space.',
    caption: 'Concept illustration of Tabletop · not a screenshot of the real app',
  },
  why: {
    eyebrow: 'WHY TABLETOP',
    title: 'The work lives in one file, the conversation somewhere else, and we still have to assemble tools before we can start.',
    body: 'We have always adapted our tools to what we do, but software tends to keep data, conversation, and rules in separate places. Tabletop brings them together and lets them change with the work in hand.',
    thesisLabel: 'OUR PRODUCT THESIS',
  },
  process: {
    eyebrow: 'FROM INTENT TO A SHARED TABLE',
    title: 'Start with the work. Let the table take shape around it.',
    aside: 'Start from an idea. You can add the files you already have later.',
    storyAlt: 'A lesson table grows from a force-and-motion file into a reviewed rule, hands-on controls, and a car experiment.',
    storyCaption: 'A learning idea: force and mass',
    showStill: 'Show still',
    replay: 'Replay animation',
    replayIdea: 'Replay idea',
    showStillLabel: 'Show the still illustration',
    replayLabel: 'Replay the concept animation',
    storyNote: 'A Remotion simulation that explains the idea · not a screenshot or a real usage result',
    steps: [
      { title: 'Start with what you want to do', body: 'Type your problem or idea right away. You do not need a file yet.' },
      { title: 'Draft tools you can really use', body: 'Let AI help draft tables, buttons, charts, or scenes, then check and adjust them before you use them.' },
      { title: 'Change the table together', body: 'When the problem changes, adjust the tools on the same table and keep the data that is still useful.' },
    ],
  },
  useCases: {
    eyebrow: 'THREE REASONS TO GATHER',
    title: 'Different people, different work. The tools should change with them.',
    aside: 'From checking work to experimenting and playing together.',
    items: [
      { title: 'Your Table', body: "Check invoice discrepancies and follow the related evidence without redoing the work you've already done." },
      { title: 'A Table for Learning', body: 'Adjust force and mass to see how the motion changes.' },
      { title: 'Our Tables', body: 'Take turns in a cooperative scenario and use a shield to help a teammate.' },
    ],
    physics: {
      alt: 'Screenshot from the prepared Physics demo: a car moves 4 m in 2 s with 10 N force and 5 kg mass, calculating acceleration of 2 m/s².',
      hint: 'Force-and-mass lesson demo · simulated data',
      open: 'Open the Physics demo',
    },
    encounter: {
      alt: 'Screenshot from the prepared cooperative Encounter demo, showing two characters, turns, and a shield action.',
      hint: 'Cooperative play demo · simulated players',
      open: 'Open the Encounter demo',
    },
    demoNote: 'Real screenshots from the public demo · simulated data and players',
  },
  start: {
    eyebrow: 'BRING YOUR WORK TO THE TABLE',
    title: 'More time doing what matters.',
    body: 'Start with what you want to do, then adjust the table as the work goes. Tools can grow within the rules and components Tabletop supports, and what the AI drafts may need adjusting to fit your work.',
  },
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
    demo: 'Auto demo',
    demoHint: 'opens in a new tab',
    demoLabel: 'Auto demo (opens in a new tab)',
  },
  welcome: {
    eyebrow: 'SIGNED IN',
    title: (name: string | null) => name ? `Welcome back, ${name}` : 'Welcome back',
    body: 'Return to a table you share, or start a new one.',
    start: 'Start a new table',
  },
};

export type LandingCopy = typeof en;

const th: LandingCopy = {
  header: {
    home: 'หน้าแรก Tabletop',
    note: 'พื้นที่สำหรับงาน การเรียนรู้ และการเล่น',
    signIn: 'เข้าสู่ระบบ',
    yourTables: 'โต๊ะของฉัน',
    languageGroup: 'ภาษา',
  },
  hero: {
    eyebrow: 'TABLETOP · โต๊ะสำหรับสิ่งที่คุณตั้งใจมาทำ',
    title: 'เครื่องมือที่ดีที่สุด คือเครื่องมือที่คุณไม่ต้องคิดถึงมัน',
    promise: 'Tabletop คือพื้นที่ร่วมกันบน Canvas บอกสิ่งที่อยากทำ แล้วให้ AI ช่วยร่างตาราง ปุ่ม กราฟ หรือฉากทดลองให้คุณลงมือใช้และปรับต่อ เริ่มจากข้อความก่อน แล้วเพิ่มไฟล์เมื่อพร้อม',
    primary: 'เริ่มจากเรื่องของคุณ',
    secondary: 'ดูเดโมที่เตรียมไว้',
    alt: 'ภาพประกอบแนวคิดของโต๊ะร่วมกัน ที่มีข้อมูล เครื่องมือ และผู้คนอยู่บนพื้นที่เดียวกัน',
    caption: 'ภาพประกอบแนวคิดของ Tabletop · ไม่ใช่ภาพหน้าจอแอปจริง',
  },
  why: {
    eyebrow: 'ทำไมต้อง TABLETOP',
    title: 'งานหนึ่งอยู่ในไฟล์ ข้อความอยู่อีกที่ แล้วเรายังต้องประกอบเครื่องมือก่อนเริ่ม',
    body: 'เราปรับเครื่องมือให้เข้ากับสิ่งที่ทำมาเสมอ แต่ซอฟต์แวร์มักแยกข้อมูล บทสนทนา และกติกาไว้คนละที่ Tabletop ให้สิ่งเหล่านั้นมาอยู่ร่วมกัน แล้วเปลี่ยนตามงานที่กำลังทำ',
    thesisLabel: 'หลักคิดของผลิตภัณฑ์',
  },
  process: {
    eyebrow: 'จากความตั้งใจ สู่โต๊ะที่ใช้ร่วมกัน',
    title: 'เริ่มจากงาน แล้วให้โต๊ะค่อย ๆ เข้ารูปรอบงานนั้น',
    aside: 'เริ่มจากความคิดได้เลย จะเพิ่มไฟล์ที่มีอยู่ภายหลังก็ได้',
    storyAlt: 'โต๊ะบทเรียนค่อย ๆ เติบโตจากไฟล์เรื่องแรงและการเคลื่อนที่ ไปเป็นกฎที่ตรวจแล้ว ปุ่มควบคุม และการทดลองรถ',
    storyCaption: 'แนวคิดการเรียนรู้เรื่องแรงและมวล',
    showStill: 'แสดงภาพนิ่ง',
    replay: 'เล่นภาพเคลื่อนไหวอีกครั้ง',
    replayIdea: 'ดูแนวคิดอีกครั้ง',
    showStillLabel: 'แสดงภาพประกอบแบบภาพนิ่ง',
    replayLabel: 'เล่นภาพเคลื่อนไหวของแนวคิดอีกครั้ง',
    storyNote: 'ภาพจำลองจาก Remotion เพื่ออธิบายแนวคิด · ไม่ใช่ภาพหน้าจอหรือผลการใช้งานจริง',
    steps: [
      { title: 'เริ่มจากสิ่งที่อยากทำ', body: 'พิมพ์โจทย์หรือความคิดของคุณได้เลย ยังไม่ต้องมีไฟล์' },
      { title: 'ร่างเครื่องมือที่ใช้ได้จริง', body: 'ให้ AI ช่วยร่างตาราง ปุ่ม กราฟ หรือฉาก แล้วตรวจและปรับก่อนใช้' },
      { title: 'เปลี่ยนโต๊ะไปพร้อมกัน', body: 'เมื่อโจทย์เปลี่ยน ปรับเครื่องมือบนโต๊ะเดิมและเก็บข้อมูลที่ยังใช้ต่อได้' },
    ],
  },
  useCases: {
    eyebrow: 'สามเหตุผลที่มารวมกัน',
    title: 'คนต่างกัน งานต่างกัน เครื่องมือก็ควรเปลี่ยนตาม',
    aside: 'จากการตรวจงาน ไปจนถึงการทดลองและเล่นร่วมกัน',
    items: [
      { title: 'โต๊ะของคุณ', body: 'ตรวจความต่างของใบแจ้งหนี้ แล้วตามหลักฐานที่เกี่ยวข้องได้ โดยไม่ต้องเริ่มงานที่ทำไว้ใหม่' },
      { title: 'โต๊ะสำหรับเรียนรู้', body: 'ปรับแรงและมวลเพื่อดูว่าการเคลื่อนที่เปลี่ยนอย่างไร' },
      { title: 'โต๊ะของเรา', body: 'ผลัดกันเล่นในสถานการณ์ร่วมมือ และใช้โล่ช่วยเพื่อนร่วมทีม' },
    ],
    physics: {
      alt: 'ภาพหน้าจอจากเดโม Physics ที่เตรียมไว้: รถเคลื่อนที่ 4 m ใน 2 s ด้วยแรง 10 N และมวล 5 kg คำนวณความเร่งได้ 2 m/s²',
      hint: 'เดโมบทเรียนแรงและมวล · ข้อมูลจำลอง',
      open: 'เปิดเดโม Physics',
    },
    encounter: {
      alt: 'ภาพหน้าจอจากเดโม Encounter แบบร่วมมือที่เตรียมไว้ มีตัวละครสองตัว ลำดับตา และการกระทำกางโล่',
      hint: 'เดโมเล่นร่วมกัน · ผู้เล่นจำลอง',
      open: 'เปิดเดโม Encounter',
    },
    demoNote: 'ภาพหน้าจอจริงจากเดโมสาธารณะ · ใช้ข้อมูลและผู้เล่นจำลอง',
  },
  start: {
    eyebrow: 'นำงานของคุณขึ้นโต๊ะ',
    title: 'มีเวลามากขึ้นกับสิ่งที่สำคัญ',
    body: 'เริ่มจากเรื่องที่คุณอยากทำ แล้วค่อยปรับโต๊ะไปพร้อมกับงาน เครื่องมือเติบโตได้ภายในกฎและส่วนประกอบที่รองรับ สิ่งที่ AI ร่างอาจต้องปรับให้ตรงกับงานของคุณ',
  },
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
    demo: 'เดโมอัตโนมัติ',
    demoHint: 'เปิดในแท็บใหม่',
    demoLabel: 'เดโมอัตโนมัติ (เปิดในแท็บใหม่)',
  },
  welcome: {
    eyebrow: 'เข้าสู่ระบบแล้ว',
    title: (name: string | null) => name ? `ยินดีต้อนรับกลับ ${name}` : 'ยินดีต้อนรับกลับ',
    body: 'กลับไปยังโต๊ะที่คุณใช้ร่วมกัน หรือเริ่มโต๊ะใหม่',
    start: 'เริ่มโต๊ะใหม่',
  },
};

export const landingCopy: Record<LandingLanguage, LandingCopy> = { en, th };

/** Each option is labelled in its own language so a reader of either can find it. */
export const languageOptionLabel: Record<LandingLanguage, string> = { en: 'English', th: 'ไทย' };
