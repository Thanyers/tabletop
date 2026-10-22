import { ArrowUpRight, BookOpen, FileText, UsersRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import storyGif from '../../../docs/showcase/tabletop-story.gif';
import storyPoster from '../../../docs/showcase/tabletop-story-poster.png';
import physicsImage from '../../../docs/showcase/physics.png';
import encounterImage from '../../../docs/showcase/encounter.png';
import './public-welcome.css';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

export function PublicWelcome({ children }: { children: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia(reducedMotionQuery).matches);
  const [playStory, setPlayStory] = useState(() => !(typeof window !== 'undefined' && window.matchMedia(reducedMotionQuery).matches));
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    const media = window.matchMedia(reducedMotionQuery);
    const updatePreference = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
      setPlayStory(!event.matches);
    };
    setReducedMotion(media.matches);
    setPlayStory(!media.matches);
    media.addEventListener('change', updatePreference);
    return () => media.removeEventListener('change', updatePreference);
  }, []);

  const showStory = () => {
    if (!playStory) {
      setReplay((current) => current + 1);
      setPlayStory(true);
    } else {
      setPlayStory(false);
    }
  };

  const storySource = playStory && replay > 0 ? `${storyGif}?replay=${replay}` : playStory ? storyGif : storyPoster;

  return <main className="tt-account-gate tt-public-welcome">
    <header className="tt-public-welcome__header">
      <a className="tt-brand tt-public-welcome__brand" href="/" aria-label="Tabletop home" onClick={(event) => {
        // Already home: a full reload would only replay both loading stages.
        if (window.location.pathname !== '/') return;
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}>
        <span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <span>tabletop<span>.</span></span>
      </a>
      <span className="tt-public-welcome__header-note">A place for work, learning, and play</span>
      <a className="tt-public-welcome__signin" href="#sign-in">Sign in <ArrowUpRight size={14} aria-hidden="true" /></a>
    </header>

    <div className="tt-public-welcome__content">
      <section className="tt-public-welcome__hero" aria-labelledby="tt-public-welcome-title">
        <div className="tt-public-welcome__hero-copy">
          <p className="tt-public-welcome__eyebrow">TABLETOP · WHY WE'RE HERE</p>
          <h1 id="tt-public-welcome-title">The best tool is the one you don't have to think about.</h1>
          <p className="tt-public-welcome__promise">คุณมีบางอย่างอยากทำให้สำเร็จ — งานที่ต้องสะสาง เรื่องที่อยากเข้าใจ หรือเกมที่อยากเล่นกับเพื่อน</p>
          <p className="tt-public-welcome__bridge">คุณมาที่นี่เพื่อทำสิ่งหนึ่งให้สำเร็จ ไม่ใช่มาสร้างเครื่องมือก่อนเริ่ม</p>
          {children}
        </div>

        <figure className="tt-public-welcome__story">
          <div className="tt-public-welcome__story-frame">
            <img key={playStory ? `story-${replay}` : 'poster'} src={storySource} width={960} height={540} alt="A lesson table grows from a force-and-motion file into a reviewed rule, hands-on controls, and a car experiment." />
          </div>
          <figcaption>
            <span>ภาพอธิบายแนวคิด · บทเรียนแรงและมวล</span>
            <button type="button" onClick={showStory} aria-label={playStory ? 'Show the still illustration' : 'Replay the concept animation'}>
              {playStory ? 'Show still' : reducedMotion ? 'Replay animation' : 'Replay idea'}
            </button>
          </figcaption>
          <p className="tt-public-welcome__story-note">ภาพจำลองจาก Remotion ไม่ใช่ภาพหน้าจอแอปหรือผลการใช้งานจริง</p>
        </figure>
      </section>

      <section className="tt-public-welcome__why" aria-labelledby="tt-public-welcome-why-title">
        <div className="tt-public-welcome__section-mark">
          <span className="tt-public-welcome__eyebrow">THE REASON</span>
          <span className="tt-public-welcome__rule" aria-hidden="true" />
        </div>
        <div className="tt-public-welcome__why-copy">
          <h2 id="tt-public-welcome-why-title">Tools have always changed to fit the work. Software should, too.</h2>
          <p>เราปรับเครื่องมือให้เข้ามือเสมอ แต่ซอฟต์แวร์มักเพิ่มขั้นตอนให้เรียนรู้ หรือบังคับให้หาทางอ้อมเมื่องานเปลี่ยน Tabletop เริ่มจากสิ่งที่คุณกำลังทำ แล้วให้เครื่องมือค่อย ๆ เข้ารูปตามงานนั้น</p>
        </div>
        <div className="tt-public-welcome__thesis">
          <span>OUR PRODUCT THESIS</span>
          <p>Work defines what software becomes.</p>
        </div>
      </section>

      <section className="tt-public-welcome__lenses" aria-labelledby="tt-public-welcome-lenses-title">
        <div className="tt-public-welcome__section-heading">
          <div>
            <p className="tt-public-welcome__eyebrow">THREE REASONS TO GATHER</p>
            <h2 id="tt-public-welcome-lenses-title">One table, different reasons to come together.</h2>
          </div>
          <p>These are the directions we're exploring — not a promise that any app or interface can be generated today.</p>
        </div>
        <div className="tt-public-welcome__lens-list">
          <article className="tt-public-welcome__lens">
            <FileText aria-hidden="true" size={20} />
            <h3>Your Table</h3>
            <p>Follow an invoice through its evidence. Change what you need to inspect without losing the work already done.</p>
          </article>
          <article className="tt-public-welcome__lens">
            <BookOpen aria-hidden="true" size={20} />
            <h3>A Table for Learning</h3>
            <p>Explain one idea in different ways — with words, numbers, experiments, or a picture that makes it click.</p>
          </article>
          <article className="tt-public-welcome__lens">
            <UsersRound aria-hidden="true" size={20} />
            <h3>Our Tables</h3>
            <p>Meet friends in a shared world, play together, and shape the rules as your story unfolds.</p>
          </article>
        </div>
      </section>

      <section className="tt-public-welcome__today" id="today" aria-labelledby="tt-public-welcome-today-title">
        <div className="tt-public-welcome__today-heading">
          <div>
            <p className="tt-public-welcome__eyebrow">THE CURRENT BETA</p>
            <h2 id="tt-public-welcome-today-title">ลองอะไรได้แล้ววันนี้</h2>
          </div>
          <p>ขอบเขตที่รองรับตอนนี้ — คนตรวจ กำหนดจังหวะ และลงมือเอง</p>
        </div>
        <div className="tt-public-welcome__capabilities">
          <article>
            <span className="tt-public-welcome__capability-label">01 · START</span>
            <h3>Bring supported files</h3>
            <p>เริ่มจาก CSV, JSON, TXT หรือ Markdown แล้วให้ AI ช่วยร่างข้อมูลและกติกาที่มีขอบเขตชัดเจน</p>
          </article>
          <article>
            <span className="tt-public-welcome__capability-label">02 · REVIEW</span>
            <h3>Approve before use</h3>
            <p>เจ้าของโต๊ะตรวจและอนุมัติกฎก่อนเปิดใช้ ผู้เล่นเลือกและยืนยันการกระทำเอง</p>
          </article>
          <article>
            <span className="tt-public-welcome__capability-label">03 · RETURN</span>
            <h3>Keep a shared table</h3>
            <p>เชิญสมาชิกให้เห็นงานร่วมกัน บันทึกสิ่งที่ทำแล้ว แล้วกลับมาทำต่อด้วยบัญชีเดิม</p>
          </article>
        </div>

        <div className="tt-public-welcome__demos">
          <div className="tt-public-welcome__demos-heading">
            <div>
              <p className="tt-public-welcome__eyebrow">PREPARED DEMOS</p>
              <h3>Try a table that is ready to play.</h3>
            </div>
            <p>Open the public demo and choose Invoice, Physics, or cooperative Encounter. Pause to take over and try the controls yourself. These prepared scenarios make no AI calls.</p>
          </div>
          <div className="tt-public-welcome__demo-figures">
            <figure>
              <img src={physicsImage} width={1652} height={928} loading="lazy" decoding="async" alt="Screenshot from the prepared Physics demo: a car moves 4 m in 2 s with 10 N force and 5 kg mass, calculating acceleration of 2 m/s²." />
              <figcaption><span><strong>Physics</strong><small>Change force, mass, and time.</small></span><a href="/demo" target="_blank" rel="noopener" aria-label="Open demo chooser and select Physics in a new tab">Choose Physics <ArrowUpRight size={14} /></a></figcaption>
            </figure>
            <figure>
              <img src={encounterImage} width={1652} height={928} loading="lazy" decoding="async" alt="Screenshot from the prepared cooperative Encounter demo, showing two characters, turns, and a shield action." />
              <figcaption><span><strong>Encounter</strong><small>Take a turn and help a teammate.</small></span><a href="/demo" target="_blank" rel="noopener" aria-label="Open demo chooser and select cooperative Encounter in a new tab">Choose Encounter <ArrowUpRight size={14} /></a></figcaption>
            </figure>
          </div>
          <p className="tt-public-welcome__demo-note">ภาพหน้าจอจริงจากเดโมสาธารณะ · ใช้สถานการณ์และผู้เล่นจำลอง</p>
        </div>
      </section>

      <footer className="tt-public-welcome__footer">
        <span className="tt-brand tt-public-welcome__brand"><span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span><span>tabletop<span>.</span></span></span>
        <span>For the work, learning, and play that brought you here.</span>
      </footer>
    </div>
  </main>;
}
