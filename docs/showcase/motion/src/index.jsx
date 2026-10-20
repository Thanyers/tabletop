import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { TabletopStory } from './tabletop-story.jsx';

const Root = () => (
  <Composition
    id="TabletopStory"
    component={TabletopStory}
    width={960}
    height={540}
    fps={12}
    durationInFrames={144}
  />
);

registerRoot(Root);
