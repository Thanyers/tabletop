import { collectStartup } from '../../scripts/agent-startup.mjs';

// Native OpenCode project plugin. Policy stays in AGENTS.md, not in this adapter.
export const TabletopStartup = async ({ directory }) => {
  const sessions = new Map();
  async function refresh(sessionID) {
    const pending = collectStartup({ cwd: directory });
    sessions.set(sessionID, pending);
    return pending;
  }
  return {
    'chat.message': async ({ sessionID }) => { await refresh(sessionID); },
    'experimental.chat.system.transform': async ({ sessionID }, output) => {
      if (!sessionID) return;
      const result = await (sessions.get(sessionID) || refresh(sessionID));
      if (result.context) output.system.push(result.context);
    },
    'experimental.session.compacting': async ({ sessionID }, output) => {
      const result = await refresh(sessionID);
      if (result.context) output.context.push(result.context);
    },
    event: async ({ event }) => {
      if (event.type === 'session.deleted') sessions.delete(event.properties.info.id);
    },
  };
};
