const TICKS = Array.from({ length: 60 }, (_, idx) => {
  const angle = (idx * 6 * Math.PI) / 180;
  const isCardinal = idx % 15 === 0;
  const isHour = idx % 5 === 0;
  const outerR = 236;
  const innerR = isCardinal ? 216 : isHour ? 222 : 228;
  return {
    idx,
    isCardinal,
    isHour,
    x1: (280 + innerR * Math.sin(angle)).toFixed(2),
    y1: (280 - innerR * Math.cos(angle)).toFixed(2),
    x2: (280 + outerR * Math.sin(angle)).toFixed(2),
    y2: (280 - outerR * Math.cos(angle)).toFixed(2),
  };
});

export function GradientRing3D({ layer }) {
  // Render a single calm architectural horological chapter ring behind the watch
  if (layer === 'front') return null;

  return (
    <div className="ring-3d-layer ring-3d-back" aria-hidden="true">
      <svg
        className="ring-3d-svg"
        viewBox="0 0 560 560"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle
          cx="280"
          cy="280"
          r="252"
          stroke="rgba(255, 240, 220, 0.08)"
          strokeWidth="1"
        />
        <circle
          cx="280"
          cy="280"
          r="212"
          stroke="rgba(255, 240, 220, 0.06)"
          strokeWidth="1"
        />
        <circle
          cx="280"
          cy="280"
          r="156"
          stroke="rgba(255, 240, 220, 0.05)"
          strokeWidth="1"
          strokeDasharray="2 6"
        />
        {TICKS.map((tick) => (
          <line
            key={tick.idx}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={
              tick.isCardinal
                ? 'rgba(255, 240, 220, 0.28)'
                : tick.isHour
                ? 'rgba(255, 240, 220, 0.16)'
                : 'rgba(255, 240, 220, 0.07)'
            }
            strokeWidth={tick.isCardinal ? '1.5' : '1'}
          />
        ))}
      </svg>
    </div>
  );
}
