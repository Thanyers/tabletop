import type { StoryStep } from './types';

// One clock for the narrative and its sample carousel, including playback speed.
export const SAMPLE_DWELL_MS = 3600;
export const STORY_DURATIONS: Record<StoryStep, number> = {
  sources: 3800,
  minimal: 6200,
  notice: 2800,
  teach: 3400,
  verify: SAMPLE_DWELL_MS * 4 + 600,
  approve: 2800,
  simulate: 4600,
  handoff: 4200,
};
