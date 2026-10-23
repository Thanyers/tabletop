import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { RoutedConnection } from '../state/edge-routing';
import './canvas-edges.css';

export interface CanvasEdgeData extends Record<string, unknown> {
  route?: RoutedConnection;
  active?: boolean;
  dimmed?: boolean;
  moving?: boolean;
  /** Line colour; a caller that colours edges by role passes it here. */
  color?: string;
  /** Colour of the mask under the line, so it reads cleanly over paper and dots. */
  haloColor?: string;
  strokeWidth?: number;
}

type CanvasFlowEdge = Edge<CanvasEdgeData, 'canvasConnection'>;

/** A quiet, rounded edge that uses the obstacle-aware route from edge-routing. */
export function CanvasEdge({
  id,
  data,
  style,
  markerEnd,
}: EdgeProps<CanvasFlowEdge>) {
  const route = data?.route;
  if (!route || route.hidden || !route.path) return null;

  const active = data?.active === true;
  const dimmed = data?.dimmed === true;
  const moving = data?.moving === true;
  const color = data?.color ?? (active ? '#7860bd' : dimmed ? '#cbc5d2' : '#a69db4');
  const haloColor = data?.haloColor ?? '#fff';
  const strokeWidth = data?.strokeWidth ?? (active ? 2.2 : 1.7);
  const edgeStyle: CSSProperties = {
    ...style,
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    opacity: dimmed ? 0.48 : moving ? 0.72 : 0.92,
  };
  const label = typeof route.label === 'string' ? route.label : '';
  const markerId = `canvas-edge-arrow-${safeId(id)}-${hashId(id)}`;
  const effectiveMarker = markerEnd ?? `url(#${markerId})`;

  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M 1 1 L 8 5 L 1 9 z" fill={color} />
        </marker>
      </defs>
      <BaseEdge
        id={`${id}-halo`}
        path={route.path}
        className="canvas-edge__halo"
        interactionWidth={0}
        style={{ stroke: haloColor, strokeWidth: strokeWidth + 4, strokeLinecap: 'round', strokeLinejoin: 'round', opacity: 0.94 }}
      />
      <BaseEdge
        id={id}
        path={route.path}
        markerEnd={effectiveMarker}
        interactionWidth={16}
        className={`canvas-edge__path${active ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}${moving ? ' is-moving' : ''}`}
        style={edgeStyle}
      />
      {route.points[0] && (
        <circle
          className="canvas-edge__source-dot"
          cx={route.points[0].x}
          cy={route.points[0].y}
          r="3.2"
          fill={color}
          stroke="#fff"
          strokeWidth="1.5"
          pointerEvents="none"
        />
      )}
      {label && route.labelX !== null && route.labelY !== null && route.labelBounds && (
        <EdgeLabelRenderer>
          <div
            className={`canvas-edge-label${active ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}${moving ? ' is-moving' : ''}`}
            data-edge-id={id}
            style={{
              transform: `translate(-50%, -50%) translate(${route.labelX}px, ${route.labelY}px)`,
              width: `${route.labelBounds.width}px`,
              minHeight: `${route.labelBounds.height}px`,
            }}
            aria-hidden="true"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default CanvasEdge;

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'edge';
}

function hashId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
