import React from 'react';
import { Easing, interpolate } from 'remotion';

export function BrandMark({ frame, size = 30, staticMark = false }) {
  // Frame-based port of LoadingScreen's -5°→85°→-5° tilt and staggered pulses.
  const tiltFrame = ((frame % 72) + 72) % 72;
  const animatedTilt = interpolate(tiltFrame, [0, 36, 72], [-5, 85, -5], {
    easing: Easing.bezier(0.65, 0, 0.35, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const offsets = [0, 4.5, 13.5, 9];
  const colors = ['#243548', '#24796b', '#6f8190', '#d49a47'];
  const tileSize = (size - size * 0.28) / 2;

  return <span className="brand-mark" style={{
    width: size,
    height: size,
    gridTemplateColumns: `repeat(2, ${tileSize}px)`,
    gap: size * 0.14,
    transform: `rotate(${staticMark ? -5 : animatedTilt}deg)`,
  }} aria-hidden="true">
    {colors.map((color, index) => {
      const phase = ((frame - offsets[index]) % 36 + 36) % 36;
      const animatedScale = phase <= 14.4
        ? interpolate(phase, [0, 14.4], [1, 0.62], { easing: Easing.bezier(0.45, 0, 0.55, 1) })
        : interpolate(phase, [14.4, 36], [0.62, 1], { easing: Easing.bezier(0.45, 0, 0.55, 1) });
      const animatedOpacity = phase <= 14.4
        ? interpolate(phase, [0, 14.4], [1, 0.45], { easing: Easing.bezier(0.45, 0, 0.55, 1) })
        : interpolate(phase, [14.4, 36], [0.45, 1], { easing: Easing.bezier(0.45, 0, 0.55, 1) });
      return <i key={color} style={{
        width: tileSize,
        height: tileSize,
        borderRadius: index === 3 ? '50%' : size * 0.11,
        background: color,
        transform: `scale(${staticMark ? 1 : animatedScale})`,
        opacity: staticMark ? 1 : animatedOpacity,
      }} />;
    })}
  </span>;
}
