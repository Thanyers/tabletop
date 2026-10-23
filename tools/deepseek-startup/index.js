import { createUserMessage } from './native-sdk.mjs';
import { attachDeepSeekStartup } from './agent-startup.mjs';

export const name = 'tabletop-task-startup';
export const inject = ['agents', 'workingDirectory'];
export function apply(ctx) {
  attachDeepSeekStartup(ctx, createUserMessage);
}
