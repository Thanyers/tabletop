import type { SpaceToolInstallation } from '../shared/collaboration-space';

/**
 * F080 / D-036: what the room says about the tool it runs.
 *
 * Until the package source is served to the client this is deliberately a card, not a running tool:
 * it states which version the room runs and who installed it, so a person can tell an empty room from
 * a room whose tool failed to load. The suite that mounts the real host comes with the package route.
 */
export interface ToolInstallationCardProps {
  tool: SpaceToolInstallation;
}

export function ToolInstallationCard(props: ToolInstallationCardProps): React.ReactElement {
  const { tool } = props;
  return (
    <section className="tt-room__tool" data-testid="room-tool">
      <h3 className="tt-room__tool-title" data-testid="room-tool-title">{tool.title}</h3>
      <p className="tt-room__tool-line" data-testid="room-tool-version">
        {`v${tool.version} · ${tool.route === 'ai' ? 'AI' : 'human'} · ${tool.contentHash.slice(0, 8)}…`}
      </p>
      <p className="tt-room__tool-line" data-testid="room-tool-owner">
        {`installed by ${tool.installedBy}`}
      </p>
    </section>
  );
}
