import { Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LandingLanguage } from './landing-copy';
import learningEn from '../../../docs/showcase/hero-evolution-en.gif';
import learningTh from '../../../docs/showcase/hero-evolution-th.gif';
import learningPosterEn from '../../../docs/showcase/hero-evolution-en-poster.png';
import learningPosterTh from '../../../docs/showcase/hero-evolution-th-poster.png';
import salesEn from '../../../docs/showcase/hero-sales-en.gif';
import salesTh from '../../../docs/showcase/hero-sales-th.gif';
import salesPosterEn from '../../../docs/showcase/hero-sales-en-poster.png';
import salesPosterTh from '../../../docs/showcase/hero-sales-th-poster.png';
import playEn from '../../../docs/showcase/hero-play-en.gif';
import playTh from '../../../docs/showcase/hero-play-th.gif';
import playPosterEn from '../../../docs/showcase/hero-play-en-poster.png';
import playPosterTh from '../../../docs/showcase/hero-play-th-poster.png';

// Each authored GIF is 216 frames at 12 fps. Switch only after its full story.
const caseDurationMs = 18_000;
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const cases = [
  {
    id: 'sales',
    en: { label: 'Café sales', gif: salesEn, poster: salesPosterEn, alt: 'Typed requests create a café sales table, add a quick-sale button that updates the same table, then add a sales chart.' },
    th: { label: 'ขายกาแฟ', gif: salesTh, poster: salesPosterTh, alt: 'พิมพ์สร้างตารางขายกาแฟ เพิ่มปุ่มขายเร็วที่ใช้เพิ่มยอดในตารางเดิม แล้วเพิ่มกราฟยอดขาย' },
  },
  {
    id: 'learning',
    en: { label: 'Physics lab', gif: learningEn, poster: learningPosterEn, alt: 'Typed requests build a force-and-motion experiment, then add controls and a distance chart to the same canvas.' },
    th: { label: 'ทดลองฟิสิกส์', gif: learningTh, poster: learningPosterTh, alt: 'พิมพ์คำขอเพื่อสร้างการทดลองแรงและการเคลื่อนที่ แล้วพิมพ์เพิ่มตัวควบคุมกับกราฟระยะทางบนบอร์ดเดิม' },
  },
  {
    id: 'play',
    en: { label: 'Adventure', gif: playEn, poster: playPosterEn, alt: 'Typed requests create an adventure party table, add a dice-roll button, then add a health tracker that changes during the fight.' },
    th: { label: 'ผจญภัย', gif: playTh, poster: playPosterTh, alt: 'พิมพ์สร้างตารางทีมผจญภัย เพิ่มปุ่มทอยเต๋า แล้วเพิ่มตัวติดตามพลังชีวิตที่เปลี่ยนระหว่างต่อสู้' },
  },
];

export function HeroCaseRotation({ language }: { language: LandingLanguage }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [loadedSource, setLoadedSource] = useState('');
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia(reducedMotionQuery).matches);
  const activeCase = cases[activeIndex];
  const content = activeCase[language];
  const source = paused || reducedMotion ? content.poster : content.gif;

  useEffect(() => {
    const media = window.matchMedia(reducedMotionQuery);
    const update = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion || loadedSource !== source) return;
    const timer = window.setTimeout(() => {
      setLoadedSource('');
      setActiveIndex((index) => (index + 1) % cases.length);
    }, caseDurationMs);
    return () => window.clearTimeout(timer);
  }, [activeIndex, paused, reducedMotion, loadedSource, source]);

  return <figure className="tt-public-welcome__hero-story" data-hero-case={activeCase.id} data-hero-loaded={loadedSource === source ? 'true' : undefined}>
    <img key={source} src={source} width={960} height={540} loading="eager" decoding="async" alt={content.alt} onLoad={() => setLoadedSource(source)} />
    {!reducedMotion && <button className="tt-public-welcome__motion-toggle" type="button" onClick={() => setPaused((value) => !value)} aria-label={paused ? (language === 'en' ? 'Resume animation' : 'เล่นภาพเคลื่อนไหวต่อ') : (language === 'en' ? 'Pause animation' : 'หยุดภาพเคลื่อนไหวชั่วคราว')}>
      {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
    </button>}
    <div className="tt-public-welcome__hero-cases" role="group" aria-label={language === 'en' ? 'Example cases' : 'เลือกตัวอย่าง'}>
      {cases.map((item, index) => <button key={item.id} type="button" aria-pressed={index === activeIndex} onClick={() => {
        if (index === activeIndex) return;
        setLoadedSource('');
        setActiveIndex(index);
      }}><span aria-hidden="true" />{item[language].label}</button>)}
    </div>
  </figure>;
}
