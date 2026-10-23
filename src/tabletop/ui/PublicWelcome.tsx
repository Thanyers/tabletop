import { ArrowUpRight, BookOpen, FileText, UsersRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import storyGif from '../../../docs/showcase/tabletop-story.gif';
import storyPoster from '../../../docs/showcase/tabletop-story-poster.png';
import physicsImage from '../../../docs/showcase/physics.png';
import encounterImage from '../../../docs/showcase/encounter.png';
import heroIllustration from './landing-table.svg';
import './public-welcome.css';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

export function PublicWelcome({ children, headerAction }: { children: ReactNode; headerAction?: ReactNode }) {
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
      {headerAction ?? <a className="tt-public-welcome__signin" href="#sign-in">Sign in <ArrowUpRight size={14} aria-hidden="true" /></a>}
    </header>

    <div className="tt-public-welcome__content">
      <section className="tt-public-welcome__hero" aria-labelledby="tt-public-welcome-title">
        <div className="tt-public-welcome__hero-copy">
          <p className="tt-public-welcome__eyebrow">TABLETOP · A TABLE FOR WHAT YOU CAME TO DO</p>
          <h1 id="tt-public-welcome-title">The best tool is the one you don't have to think about.</h1>
          <p className="tt-public-welcome__promise">Tabletop คือพื้นที่ร่วมกันบน Canvas บอกสิ่งที่อยากทำ แล้วให้ AI ช่วยร่างตาราง ปุ่ม กราฟ หรือฉากทดลองให้คุณลงมือใช้และปรับต่อ เริ่มจากข้อความก่อน แล้วเพิ่มไฟล์เมื่อพร้อม</p>
          <div className="tt-public-welcome__hero-actions">
            <a className="tt-public-welcome__primary-link" href="#sign-in">เริ่มจากเรื่องของคุณ <ArrowUpRight size={16} aria-hidden="true" /></a>
            <a className="tt-public-welcome__secondary-link" href="/demo" target="_blank" rel="noopener">ดูเดโมที่เตรียมไว้ <ArrowUpRight size={15} aria-hidden="true" /></a>
          </div>
        </div>

        <figure className="tt-public-welcome__hero-art">
          <img src={heroIllustration} width={800} height={650} alt="ภาพประกอบแนวคิดของโต๊ะร่วมกัน ที่มีข้อมูล เครื่องมือ และผู้คนอยู่บนพื้นที่เดียวกัน" />
          <figcaption>ภาพประกอบแนวคิดของ Tabletop · ไม่ใช่ภาพหน้าจอแอปจริง</figcaption>
        </figure>
      </section>

      <section className="tt-public-welcome__why" aria-labelledby="tt-public-welcome-why-title">
        <div className="tt-public-welcome__why-heading">
          <p className="tt-public-welcome__eyebrow">WHY TABLETOP</p>
          <h2 id="tt-public-welcome-why-title">งานหนึ่งอยู่ในไฟล์ ข้อความอยู่อีกที่ แล้วเรายังต้องประกอบเครื่องมือก่อนเริ่ม</h2>
        </div>
        <div className="tt-public-welcome__why-copy">
          <p>เราปรับเครื่องมือให้เข้ากับสิ่งที่ทำมาเสมอ แต่ซอฟต์แวร์มักแยกข้อมูล บทสนทนา และกติกาไว้คนละที่ Tabletop ให้สิ่งเหล่านั้นมาอยู่ร่วมกัน แล้วเปลี่ยนตามงานที่กำลังทำ</p>
          <div className="tt-public-welcome__thesis">
            <span>OUR PRODUCT THESIS</span>
            <p>Work defines what software becomes.</p>
          </div>
        </div>
      </section>

      <section className="tt-public-welcome__process" aria-labelledby="tt-public-welcome-process-title">
        <div className="tt-public-welcome__section-heading">
          <div>
            <p className="tt-public-welcome__eyebrow">FROM INTENT TO A SHARED TABLE</p>
            <h2 id="tt-public-welcome-process-title">Start with the work. Let the table take shape around it.</h2>
          </div>
          <p>เริ่มจากความคิดได้เลย จะเพิ่มไฟล์ที่มีอยู่ภายหลังก็ได้</p>
        </div>

        <div className="tt-public-welcome__process-layout">
          <figure className="tt-public-welcome__story">
            <div className="tt-public-welcome__story-frame">
              <img key={playStory ? `story-${replay}` : 'poster'} src={storySource} width={960} height={540} loading="lazy" decoding="async" alt="A lesson table grows from a force-and-motion file into a reviewed rule, hands-on controls, and a car experiment." />
            </div>
            <figcaption>
              <span>แนวคิดการเรียนรู้เรื่องแรงและมวล</span>
              <button type="button" onClick={showStory} aria-label={playStory ? 'Show the still illustration' : 'Replay the concept animation'}>
                {playStory ? 'Show still' : reducedMotion ? 'Replay animation' : 'Replay idea'}
              </button>
            </figcaption>
            <p className="tt-public-welcome__story-note">ภาพจำลองจาก Remotion เพื่ออธิบายแนวคิด · ไม่ใช่ภาพหน้าจอหรือผลการใช้งานจริง</p>
          </figure>

          <ol className="tt-public-welcome__steps">
            <li>
              <span className="tt-public-welcome__step-number">01</span>
              <div><h3>เริ่มจากสิ่งที่อยากทำ</h3><p>พิมพ์โจทย์หรือความคิดของคุณได้เลย ยังไม่ต้องมีไฟล์</p></div>
            </li>
            <li>
              <span className="tt-public-welcome__step-number">02</span>
              <div><h3>ร่างเครื่องมือที่ใช้ได้จริง</h3><p>ให้ AI ช่วยร่างตาราง ปุ่ม กราฟ หรือฉาก แล้วตรวจและปรับก่อนใช้</p></div>
            </li>
            <li>
              <span className="tt-public-welcome__step-number">03</span>
              <div><h3>เปลี่ยนโต๊ะไปพร้อมกัน</h3><p>เมื่อโจทย์เปลี่ยน ปรับเครื่องมือบนโต๊ะเดิมและเก็บข้อมูลที่ยังใช้ต่อได้</p></div>
            </li>
          </ol>
        </div>
      </section>

      <section className="tt-public-welcome__use-cases" id="today" aria-labelledby="tt-public-welcome-use-cases-title">
        <div className="tt-public-welcome__section-heading">
          <div>
            <p className="tt-public-welcome__eyebrow">THREE REASONS TO GATHER</p>
            <h2 id="tt-public-welcome-use-cases-title">คนต่างกัน งานต่างกัน เครื่องมือก็ควรเปลี่ยนตาม</h2>
          </div>
          <p>จากการตรวจงาน ไปจนถึงการทดลองและเล่นร่วมกัน</p>
        </div>

        <div className="tt-public-welcome__use-case-list">
          <article className="tt-public-welcome__use-case">
            <FileText aria-hidden="true" size={20} />
            <div><h3>Your Table</h3><p>ตรวจความต่างของใบแจ้งหนี้ แล้วตามหลักฐานที่เกี่ยวข้องได้ โดยไม่ต้องเริ่มงานที่ทำไว้ใหม่</p></div>
          </article>
          <article className="tt-public-welcome__use-case">
            <BookOpen aria-hidden="true" size={20} />
            <div><h3>A Table for Learning</h3><p>ปรับแรงและมวลเพื่อดูว่าการเคลื่อนที่เปลี่ยนอย่างไร</p></div>
          </article>
          <article className="tt-public-welcome__use-case">
            <UsersRound aria-hidden="true" size={20} />
            <div><h3>Our Tables</h3><p>ผลัดกันเล่นในสถานการณ์ร่วมมือ และใช้โล่ช่วยเพื่อนร่วมทีม</p></div>
          </article>
        </div>

        <div className="tt-public-welcome__demo-figures">
          <figure>
            <img src={physicsImage} width={1652} height={928} loading="lazy" decoding="async" alt="Screenshot from the prepared Physics demo: a car moves 4 m in 2 s with 10 N force and 5 kg mass, calculating acceleration of 2 m/s²." />
            <figcaption><span><strong>Physics</strong><small>เดโมบทเรียนแรงและมวล · ข้อมูลจำลอง</small></span><a href="/demo" target="_blank" rel="noopener">เปิดเดโม Physics <ArrowUpRight size={14} aria-hidden="true" /></a></figcaption>
          </figure>
          <figure>
            <img src={encounterImage} width={1652} height={928} loading="lazy" decoding="async" alt="Screenshot from the prepared cooperative Encounter demo, showing two characters, turns, and a shield action." />
            <figcaption><span><strong>Encounter</strong><small>เดโมเล่นร่วมกัน · ผู้เล่นจำลอง</small></span><a href="/demo" target="_blank" rel="noopener">เปิดเดโม Encounter <ArrowUpRight size={14} aria-hidden="true" /></a></figcaption>
          </figure>
        </div>
        <p className="tt-public-welcome__demo-note">ภาพหน้าจอจริงจากเดโมสาธารณะ · ใช้ข้อมูลและผู้เล่นจำลอง</p>
      </section>

      <section className="tt-public-welcome__start" aria-labelledby="tt-public-welcome-start-title">
        <div className="tt-public-welcome__start-copy">
          <p className="tt-public-welcome__eyebrow">BRING YOUR WORK TO THE TABLE</p>
          <h2 id="tt-public-welcome-start-title">More time doing what matters.</h2>
          <p>เริ่มจากเรื่องที่คุณอยากทำ แล้วค่อยปรับโต๊ะไปพร้อมกับงาน เครื่องมือเติบโตได้ภายในกฎและส่วนประกอบที่รองรับ สิ่งที่ AI ร่างอาจต้องปรับให้ตรงกับงานของคุณ</p>
        </div>
        <div className="tt-public-welcome__start-slot">{children}</div>
      </section>

      <footer className="tt-public-welcome__footer">
        <span className="tt-brand tt-public-welcome__brand"><span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span><span>tabletop<span>.</span></span></span>
        <span>For the work, learning, and play that brought you here.</span>
      </footer>
    </div>
  </main>;
}
