import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { HeroEvolution } from './hero-evolution.jsx';

const HeroRoot = () => <Composition
  id="HeroEvolution"
  component={HeroEvolution}
  width={960}
  height={540}
  fps={12}
  durationInFrames={216}
  defaultProps={{ locale: 'en' }}
/>;

registerRoot(HeroRoot);
