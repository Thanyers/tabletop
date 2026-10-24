import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { NarrativeAnimatic } from './animatic.jsx';
import './styles.css';

const Root = () => (
  <Composition
    id="TabletopNarrative"
    component={NarrativeAnimatic}
    width={1280}
    height={720}
    fps={30}
    durationInFrames={1800}
  />
);

registerRoot(Root);
