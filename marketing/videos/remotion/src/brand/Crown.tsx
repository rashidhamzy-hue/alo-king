import React from 'react';

/** The hand-drawn crown, copied from src/design/Crown.tsx. `draw` (0..1) reveals the strokes for the end card. */
export const Crown: React.FC<{size: number; color: string; draw?: number; style?: React.CSSProperties}> = ({size, color, draw = 1, style}) => {
  const len = 260;
  const dash = {strokeDasharray: len, strokeDashoffset: len * (1 - draw)};
  return (
    <svg width={size} height={(size * 48) / 64} viewBox="0 0 64 48" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path
        d="M7.2 37.4C6 29.6 5.1 19.8 4.6 13.1c5.3 4 9.7 8.2 15 12 3.5-6.9 7.4-13.4 12.3-19.2 5.1 5.9 8.9 12.5 12.6 19.3 5.4-3.8 9.5-8 14.8-12.1-.5 6.8-1.5 16.4-2.6 24.2-12.4 3.6-38.4 3.5-49.5.1Z"
        fill={color}
        fillOpacity={0.16 * draw}
        style={dash}
      />
      <path d="M10.4 42.2c13.4 2.6 30.6 2.7 43.3-.2" style={dash} />
      <path d="M16 31.5c5.2 1.5 26.7 1.6 32.2.1" strokeWidth={1.8} opacity={0.7} style={dash} />
      {[[4.4, 9.6, 2.6], [32, 3.9, 2.8], [59.7, 9.4, 2.6]].map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r * Math.min(1, Math.max(0, draw * 3 - 2 + i * 0.0))} fill={color} stroke="none" />
      ))}
    </svg>
  );
};
