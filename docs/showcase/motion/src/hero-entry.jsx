import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { HeroEvolution } from './hero-evolution.jsx';
import { HeroVariant } from './hero-variants.jsx';

const HeroScene = ({ locale, caseName }) => caseName === 'learning'
  ? <HeroEvolution locale={locale} />
  : <HeroVariant locale={locale} caseName={caseName} />;

const HeroRoot = () => <Composition
  id="HeroEvolution"
  component={HeroScene}
  width={960}
  height={540}
  fps={12}
  durationInFrames={216}
  defaultProps={{ locale: 'en', caseName: 'learning' }}
/>;

registerRoot(HeroRoot);
