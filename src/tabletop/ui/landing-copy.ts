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
    note: 'Tools that adapt as work changes',
    signIn: 'Sign in',
    yourTables: 'Your tables',
    languageGroup: 'Language',
    navigation: 'Page sections',
    board: 'Example board',
    film: 'Story',
    examples: 'Examples',
    readme: 'README',
    photoCredits: 'Photo credits',
  },
  hero: {
    eyebrow: 'TABLETOP · TOOLS THAT ADAPT TO YOU',
    title: 'Tools that keep adapting to you.',
    promise: 'Describe what you want to do, then ask to adjust the tools as you use them. Start with a message; bring files when you are ready.',
    primary: 'Start your table',
    secondary: 'Watch the narrated story',
    scope: 'Review each draft before applying it.',
    alt: 'Concept illustration of a shared table with data, tools, and people in one space.',
    caption: 'Concept illustration of Tabletop · not a screenshot of the real app',
  },
  why: {
    eyebrow: 'WHY TABLETOP',
    title: 'Physical tools adapt to people. Software often asks people to adapt to it.',
    body: 'A comfortable pen grip, a balanced hammer handle, a chair back with arms and wheels: each makes the tool fit the person using it. Tabletop is built on the same idea—tools can change as your work changes.',
    thesisLabel: 'THE IDEA',
    tools: {
      chair: { title: 'Support', body: 'A back, arms, and wheels for the person using it.', alt: 'An office chair with a back, arms, and wheels against a light background.' },
      pen: { title: 'Comfortable grip', body: 'A grip shaped for the hand.', alt: 'A hand holding a pen comfortably while writing on paper.' },
      hammer: { title: 'Balanced handle', body: 'Control for the person using it.', alt: 'A hand holding the handle of a hammer.' },
    },
  },
  film: {
    eyebrow: 'TABLETOP · ENGLISH NARRATION',
    title: 'See Tabletop on the canvas.',
    aside: 'A narrated concept film · play when ready',
    alt: 'A concept film showing Tabletop tools and work on a canvas, with English narration.',
    caption: 'Concept film · illustrative data · English narration and sound',
    unavailable: 'Your browser cannot play this video.',
  },
  process: {
    eyebrow: 'LEARNING ON THE CANVAS',
    title: 'An idea can grow into something you can try.',
    aside: 'A force-and-motion learning scene · illustrative demo',
    storyAlt: 'A lesson table grows from a force-and-motion file into a reviewed rule, hands-on controls, and a car experiment.',
    storyCaption: 'A learning idea: force and motion',
    showStill: 'Show still',
    replay: 'Replay animation',
    replayIdea: 'Replay idea',
    showStillLabel: 'Show the still illustration',
    replayLabel: 'Replay the concept animation',
    storyNote: 'An original Tabletop concept animation · not a screenshot or a real usage result',
    steps: [
      { title: 'Start with a question', body: 'Choose the variables you want to explore.' },
      { title: 'Try a change', body: 'Adjust force or mass and watch the motion respond.' },
      { title: 'Build on the same table', body: 'Keep the experiment in view while you change it.' },
    ],
  },
  useCases: {
    eyebrow: 'ONE CANVAS · MANY KINDS OF WORK',
    title: 'The same space can hold different work.',
    aside: 'Explore a prepared example, then start your own table.',
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
    title: 'Start with your work. Adjust the table as it changes.',
    body: 'Describe what you want to do, then keep shaping the tools around the work in front of you.',
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
  profile: { menu: 'Account menu', yourTables: 'Your tables', admin: 'All table metadata (admin)', signOut: 'Sign out', signingOut: 'Signing out…' },
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
    note: 'เครื่องมือปรับต่อได้เมื่องานเปลี่ยน',
    signIn: 'เข้าสู่ระบบ',
    yourTables: 'โต๊ะของฉัน',
    languageGroup: 'ภาษา',
    navigation: 'ส่วนต่าง ๆ ของหน้า',
    board: 'กระดานตัวอย่าง',
    film: 'เรื่องราว',
    examples: 'ตัวอย่าง',
    readme: 'README',
    photoCredits: 'เครดิตภาพ',
  },
  hero: {
    eyebrow: 'TABLETOP · เครื่องมือค่อย ๆ ปรับให้เข้ากับคุณ',
    title: 'เครื่องมือค่อย ๆ ปรับให้เข้ากับคุณ',
    promise: 'บอกสิ่งที่อยากทำ แล้วค่อยขอปรับเครื่องมือเมื่อเริ่มใช้ เริ่มจากข้อความก่อน แล้วเพิ่มไฟล์เมื่อพร้อม',
    primary: 'เริ่มโต๊ะของคุณ',
    secondary: 'ดูเรื่องราวพร้อมเสียง',
    scope: 'ตรวจร่างก่อนใช้ทุกครั้ง',
    alt: 'ภาพประกอบแนวคิดของโต๊ะร่วมกัน ที่มีข้อมูล เครื่องมือ และผู้คนอยู่บนพื้นที่เดียวกัน',
    caption: 'ภาพประกอบแนวคิดของ Tabletop · ไม่ใช่ภาพหน้าจอแอปจริง',
  },
  why: {
    eyebrow: 'ทำไมต้อง TABLETOP',
    title: 'เครื่องมือทั่วไปปรับให้เข้ากับคนใช้ แต่ซอฟต์แวร์มักให้เราปรับตัวเข้าหามัน',
    body: 'ด้ามปากกาที่จับสบาย ด้ามค้อนที่ถนัดมือ และพนักพิง ที่วางแขน กับล้อของเก้าอี้ ช่วยให้เครื่องมือเหมาะกับคนใช้ Tabletop ยึดแนวคิดเดียวกัน: เครื่องมือปรับได้เมื่องานเปลี่ยน',
    thesisLabel: 'แนวคิด',
    tools: {
      chair: { title: 'รองรับท่านั่ง', body: 'พนักพิง ที่วางแขน และล้อที่เข้ากับคนใช้', alt: 'เก้าอี้สำนักงานมีพนักพิง ที่วางแขน และล้อ บนพื้นหลังสีอ่อน' },
      pen: { title: 'จับสบายมือ', body: 'ด้ามจับที่ออกแบบให้เข้ากับมือ', alt: 'มือจับปากกาอย่างถนัดขณะเขียนบนกระดาษ' },
      hammer: { title: 'ด้ามค้อนพอดีมือ', body: 'ช่วยให้คนใช้ควบคุมได้ถนัด', alt: 'มือจับด้ามค้อน' },
    },
  },
  film: {
    eyebrow: 'TABLETOP · เสียงบรรยายอังกฤษ',
    title: 'ดู Tabletop บน Canvas',
    aside: 'เรื่องราวพร้อมเสียงบรรยาย · กดเล่นเมื่อพร้อม',
    alt: 'ภาพยนตร์แนวคิดที่แสดงเครื่องมือและงานบน Canvas ของ Tabletop พร้อมเสียงบรรยายภาษาอังกฤษ',
    caption: 'ภาพยนตร์แนวคิด · ข้อมูลตัวอย่าง · เสียงบรรยายและเสียงประกอบภาษาอังกฤษ',
    unavailable: 'เบราว์เซอร์นี้เล่นวิดีโอไม่ได้',
  },
  process: {
    eyebrow: 'เรียนรู้บน Canvas',
    title: 'ไอเดียเติบโตเป็นสิ่งที่ลองเล่นได้',
    aside: 'ฉากเรียนรู้เรื่องแรงและการเคลื่อนที่ · เดโมภาพประกอบ',
    storyAlt: 'โต๊ะบทเรียนค่อย ๆ เติบโตจากไฟล์เรื่องแรงและการเคลื่อนที่ ไปเป็นกฎที่ตรวจแล้ว ปุ่มควบคุม และการทดลองรถ',
    storyCaption: 'แนวคิดการเรียนรู้เรื่องแรงและการเคลื่อนที่',
    showStill: 'แสดงภาพนิ่ง',
    replay: 'เล่นภาพเคลื่อนไหวอีกครั้ง',
    replayIdea: 'ดูแนวคิดอีกครั้ง',
    showStillLabel: 'แสดงภาพประกอบแบบภาพนิ่ง',
    replayLabel: 'เล่นภาพเคลื่อนไหวของแนวคิดอีกครั้ง',
    storyNote: 'ภาพเคลื่อนไหวแนวคิดต้นฉบับของ Tabletop · ไม่ใช่ภาพหน้าจอหรือผลการใช้งานจริง',
    steps: [
      { title: 'เริ่มจากคำถาม', body: 'เลือกตัวแปรที่อยากทดลอง' },
      { title: 'ลองปรับดู', body: 'เปลี่ยนแรงหรือมวล แล้วสังเกตการเคลื่อนที่' },
      { title: 'ต่อยอดบนโต๊ะเดิม', body: 'มองเห็นการทดลองไปพร้อมกับการปรับ' },
    ],
  },
  useCases: {
    eyebrow: 'หนึ่ง Canvas · งานหลายแบบ',
    title: 'พื้นที่เดียวรองรับงานได้หลายแบบ',
    aside: 'ลองดูตัวอย่างที่เตรียมไว้ แล้วเริ่มโต๊ะของคุณเอง',
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
    title: 'เริ่มจากเรื่องของคุณ แล้วปรับโต๊ะเมื่อมันเปลี่ยน',
    body: 'บอกสิ่งที่อยากทำ แล้วค่อยปรับเครื่องมือให้เข้ากับงานตรงหน้า',
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
  profile: { menu: 'เมนูบัญชี', yourTables: 'โต๊ะของฉัน', admin: 'ข้อมูลโต๊ะทั้งหมด (ผู้ดูแลระบบ)', signOut: 'ออกจากระบบ', signingOut: 'กำลังออกจากระบบ…' },
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
