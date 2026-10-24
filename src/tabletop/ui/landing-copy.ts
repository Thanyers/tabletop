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
    why: 'Why Tabletop',
    board: 'Try an example',
    film: 'Story',
    examples: 'Examples',
    photoCredits: 'Photo credits',
  },
  hero: {
    eyebrow: 'TABLETOP · TOOLS THAT ADAPT TO YOU',
    title: 'Tools that keep adapting to you.',
    promise: 'Describe your work. AI helps you shape tables, buttons, and charts on one canvas. Use them, then ask for changes as your needs grow.',
    primary: 'Start your table',
    secondary: 'Watch the narrated story',
    scope: 'Review each draft before applying it.',
    alt: 'Concept illustration of a shared table with data, tools, and people in one space.',
    caption: 'Concept illustration of Tabletop · not a screenshot of the real app',
  },
  why: {
    eyebrow: 'WHY TABLETOP',
    title: 'A tool becomes yours through use.',
    body: 'Use it, notice what does not fit, and change it. The tool stays. Its fit becomes personal.',
    bridgeTitle: 'The same should be true of software.',
    problem: 'When your work changes, you often switch apps, rebuild a spreadsheet, or copy the same data again.',
    solution: 'Tabletop keeps the conversation, data, and controls together. Ask for what is missing, use it, and build on the same table.',
    thesisLabel: 'THE IDEA',
    stories: {
      hammer: {
        name: 'Hammer',
        title: 'When the handle slips, shape a grip to the hand.',
        body: 'Add a padded wrap where the fingers close. The handle stays; the new grip follows the hand around it.',
        need: 'Bare handle · slips in use',
        addition: 'Wrap shaped around the fingers',
        result: 'Grip follows the fingers',
        beforeAlt: 'Illustration of a hand holding a bare hammer handle before a grip wrap is added.',
        afterAlt: 'Illustration of a hammer handle with a thick contoured grip wrap around the fingers.',
      },
      chair: {
        name: 'Workbench chair',
        title: 'Raise the seat. Give the feet support.',
        body: 'Add a firm cushion to bring the seat closer to work height, then a wooden offcut as a footrest for the raised position. The chair stays; its fit changes.',
        need: 'Seat low for the workbench',
        addition: 'Cushion + offcut footrest',
        result: 'Seat and feet supported',
        beforeAlt: 'Illustration of the same chair with a seat below workbench height before a cushion and footrest are added.',
        afterAlt: 'Illustration of a chair raised with a cushion and a seated person resting both feet on a wooden offcut footrest.',
      },
    },
  },
  film: {
    eyebrow: 'TABLETOP · ENGLISH NARRATION',
    title: 'See Tabletop on the canvas.',
    aside: 'A narrated concept film · play when ready',
    alt: 'A concept film showing Tabletop tools and work on a canvas, with English narration.',
    caption: 'The café story, with English narration and illustrative examples.',
    unavailable: 'Your browser cannot play this video.',
  },
  process: {
    eyebrow: 'LEARNING ON THE CANVAS',
    title: 'An idea can grow into something you can try.',
    aside: 'A force-and-motion learning scene · illustrative demo',
    storyAlt: 'Typed requests build a force-and-motion experiment, then add controls and a distance chart to the same canvas.',
    storyCaption: 'A learning idea: force and motion',
    showStill: 'Show still',
    replay: 'Replay animation',
    replayIdea: 'Replay idea',
    showStillLabel: 'Show the still illustration',
    replayLabel: 'Replay the concept animation',
    steps: [
      { title: 'Start with a question', body: 'Choose the variables you want to explore.' },
      { title: 'Try a change', body: 'Adjust force or mass and watch the motion respond.' },
      { title: 'Build on the same table', body: 'Keep the experiment in view while you change it.' },
    ],
  },
  useCases: {
    eyebrow: 'ONE CANVAS · MANY KINDS OF WORK',
    title: 'For work, learning, and play.',
    aside: 'Explore a prepared example, then start your own table.',
    items: [
      { title: 'Work', body: "Check invoice discrepancies and follow the related evidence without redoing the work you've already done." },
      { title: 'Learning', body: 'Adjust force and mass to see how the motion changes.' },
      { title: 'Play', body: 'Take turns in a cooperative scenario and use a shield to help a teammate.' },
    ],
    physics: {
      alt: 'Screenshot from the prepared Physics demo: a car moves 4 m in 2 s with 10 N force and 5 kg mass, calculating acceleration of 2 m/s².',
      hint: 'Experiment with force and mass',
      open: 'Open the Physics demo',
    },
    encounter: {
      alt: 'Screenshot from the prepared cooperative Encounter demo, showing two characters, turns, and a shield action.',
      hint: 'Take turns and help a teammate',
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
    why: 'ทำไมต้อง Tabletop',
    board: 'ลองตัวอย่าง',
    film: 'เรื่องราว',
    examples: 'ตัวอย่าง',
    photoCredits: 'เครดิตภาพ',
  },
  hero: {
    eyebrow: 'TABLETOP · เครื่องมือค่อย ๆ ปรับให้เข้ากับคุณ',
    title: 'เครื่องมือค่อย ๆ ปรับให้เข้ากับคุณ',
    promise: 'บอกงานที่คุณทำ แล้วให้ AI ช่วยปรับตาราง ปุ่ม และกราฟบน Canvas เดียวกัน ลองใช้แล้วค่อยขอเปลี่ยนแปลงเมื่อต้องการต่อยอด',
    primary: 'เริ่มโต๊ะของคุณ',
    secondary: 'ดูเรื่องราวพร้อมเสียง',
    scope: 'ตรวจร่างก่อนใช้ทุกครั้ง',
    alt: 'ภาพประกอบแนวคิดของโต๊ะร่วมกัน ที่มีข้อมูล เครื่องมือ และผู้คนอยู่บนพื้นที่เดียวกัน',
    caption: 'ภาพประกอบแนวคิดของ Tabletop · ไม่ใช่ภาพหน้าจอแอปจริง',
  },
  why: {
    eyebrow: 'ทำไมต้อง TABLETOP',
    title: 'เครื่องมือค่อย ๆ เป็นของคุณผ่านการใช้งาน',
    body: 'เริ่มใช้ สังเกตตรงที่ไม่พอดี แล้วค่อยปรับ เครื่องมือชิ้นเดิม แต่เข้ากับคนใช้มากขึ้น',
    bridgeTitle: 'ซอฟต์แวร์ก็ควรปรับแบบนั้นได้',
    problem: 'พองานเปลี่ยน เรามักต้องย้ายแอป สร้างตารางใหม่ หรือคัดลอกข้อมูลเดิมไปมา',
    solution: 'Tabletop รวมบทสนทนา ข้อมูล และเครื่องมือไว้ด้วยกัน บอกสิ่งที่ยังขาด ลองใช้ แล้วต่อยอดบนโต๊ะเดิม',
    thesisLabel: 'แนวคิด',
    stories: {
      hammer: {
        name: 'ค้อน',
        title: 'เมื่อด้ามลื่นมือ ก็พันกริปให้พอดีมือ',
        body: 'เพิ่มวัสดุพันตรงที่นิ้วจับ ด้ามเดิมยังอยู่ แต่กริปใหม่รับกับมือได้พอดีขึ้น',
        need: 'ด้ามเปล่า · จับแล้วลื่น',
        addition: 'พันกริปให้พอดีมือ',
        result: 'กริปรับกับนิ้วมือ',
        beforeAlt: 'ภาพประกอบมือจับด้ามค้อนเปล่าก่อนเพิ่มวัสดุพันกริป',
        afterAlt: 'ภาพประกอบด้ามค้อนที่เพิ่มกริปหนาเข้ารูปบริเวณนิ้วมือ',
      },
      chair: {
        name: 'เก้าอี้โต๊ะงาน',
        title: 'ยกที่นั่ง แล้วรองรับเท้า',
        body: 'เพิ่มเบาะแน่นเพื่อยกที่นั่งให้ใกล้ระดับโต๊ะ แล้วใช้เศษไม้ทำที่พักเท้า เก้าอี้ตัวเดิม แต่ปรับให้พอดีกับคนและงาน',
        need: 'ที่นั่งต่ำกว่าโต๊ะงาน',
        addition: 'เบาะ + ที่พักเท้าจากเศษไม้',
        result: 'รองรับทั้งที่นั่งและเท้า',
        beforeAlt: 'ภาพประกอบเก้าอี้ตัวเดิมที่มีที่นั่งต่ำกว่าโต๊ะงาน ก่อนเพิ่มเบาะและที่พักเท้า',
        afterAlt: 'ภาพประกอบคนนั่งบนเก้าอี้ที่เสริมเบาะและวางเท้าบนที่พักไม้จากเศษไม้',
      },
    },
  },
  film: {
    eyebrow: 'TABLETOP · เสียงบรรยายอังกฤษ',
    title: 'ดู Tabletop บน Canvas',
    aside: 'เรื่องราวพร้อมเสียงบรรยาย · กดเล่นเมื่อพร้อม',
    alt: 'ภาพยนตร์แนวคิดที่แสดงเครื่องมือและงานบน Canvas ของ Tabletop พร้อมเสียงบรรยายภาษาอังกฤษ',
    caption: 'เรื่องราวจากร้านกาแฟ พร้อมเสียงบรรยายภาษาอังกฤษและตัวอย่างประกอบ',
    unavailable: 'เบราว์เซอร์นี้เล่นวิดีโอไม่ได้',
  },
  process: {
    eyebrow: 'เรียนรู้บน Canvas',
    title: 'ไอเดียเติบโตเป็นสิ่งที่ลองเล่นได้',
    aside: 'ฉากเรียนรู้เรื่องแรงและการเคลื่อนที่ · เดโมภาพประกอบ',
    storyAlt: 'พิมพ์คำขอเพื่อสร้างการทดลองแรงและการเคลื่อนที่ แล้วพิมพ์เพิ่มตัวควบคุมกับกราฟระยะทางบนบอร์ดเดิม',
    storyCaption: 'แนวคิดการเรียนรู้เรื่องแรงและการเคลื่อนที่',
    showStill: 'แสดงภาพนิ่ง',
    replay: 'เล่นภาพเคลื่อนไหวอีกครั้ง',
    replayIdea: 'ดูแนวคิดอีกครั้ง',
    showStillLabel: 'แสดงภาพประกอบแบบภาพนิ่ง',
    replayLabel: 'เล่นภาพเคลื่อนไหวของแนวคิดอีกครั้ง',
    steps: [
      { title: 'เริ่มจากคำถาม', body: 'เลือกตัวแปรที่อยากทดลอง' },
      { title: 'ลองปรับดู', body: 'เปลี่ยนแรงหรือมวล แล้วสังเกตการเคลื่อนที่' },
      { title: 'ต่อยอดบนโต๊ะเดิม', body: 'มองเห็นการทดลองไปพร้อมกับการปรับ' },
    ],
  },
  useCases: {
    eyebrow: 'หนึ่ง Canvas · งานหลายแบบ',
    title: 'ใช้กับงาน การเรียนรู้ และการเล่น',
    aside: 'ลองดูตัวอย่างที่เตรียมไว้ แล้วเริ่มโต๊ะของคุณเอง',
    items: [
      { title: 'งาน', body: 'ตรวจความต่างของใบแจ้งหนี้ แล้วตามหลักฐานที่เกี่ยวข้องได้ โดยไม่ต้องเริ่มงานที่ทำไว้ใหม่' },
      { title: 'การเรียนรู้', body: 'ปรับแรงและมวลเพื่อดูว่าการเคลื่อนที่เปลี่ยนอย่างไร' },
      { title: 'การเล่น', body: 'ผลัดกันเล่นในสถานการณ์ร่วมมือ และใช้โล่ช่วยเพื่อนร่วมทีม' },
    ],
    physics: {
      alt: 'ภาพหน้าจอจากเดโม Physics ที่เตรียมไว้: รถเคลื่อนที่ 4 m ใน 2 s ด้วยแรง 10 N และมวล 5 kg คำนวณความเร่งได้ 2 m/s²',
      hint: 'ทดลองปรับแรงและมวล',
      open: 'เปิดเดโม Physics',
    },
    encounter: {
      alt: 'ภาพหน้าจอจากเดโม Encounter แบบร่วมมือที่เตรียมไว้ มีตัวละครสองตัว ลำดับตา และการกระทำกางโล่',
      hint: 'ผลัดกันเล่นและช่วยเพื่อนร่วมทีม',
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
