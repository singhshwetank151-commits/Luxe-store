import { useId } from 'react';

function RingDefs({ prefix }) {
  return (
    <defs>
      {/* Main vibrant pink -> coral-red -> golden-amber gradient */}
      <linearGradient id={`${prefix}-body`} x1="85%" y1="5%" x2="15%" y2="95%">
        <stop offset="0%" stopColor="#ff148a" />
        <stop offset="28%" stopColor="#e8195b" />
        <stop offset="58%" stopColor="#ee4326" />
        <stop offset="84%" stopColor="#e48a28" />
        <stop offset="100%" stopColor="#d49535" />
      </linearGradient>

      {/* Glossy tubular specular highlight */}
      <linearGradient id={`${prefix}-shine`} x1="80%" y1="0%" x2="20%" y2="100%">
        <stop offset="0%" stopColor="#ff9bd2" stopOpacity="0.65" />
        <stop offset="45%" stopColor="#ff9a76" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#ffe196" stopOpacity="0.45" />
      </linearGradient>

      {/* Soft blur for 3D cylindrical shading */}
      <filter id={`${prefix}-tube-blur`} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="3.5" />
      </filter>

      {/* Feathered mask for seamless front-layer transition with zero hard seam */}
      <linearGradient id={`${prefix}-fade-grad`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#000000" />
        <stop offset="47%" stopColor="#000000" />
        <stop offset="53%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#ffffff" />
      </linearGradient>
      <mask id={`${prefix}-front-mask`}>
        <rect x="-40" y="-20" width="760" height="460" fill={`url(#${prefix}-fade-grad)`} />
      </mask>
    </defs>
  );
}

function TorusGeometry({ prefix, isFront }) {
  return (
    <>
      {/* Outer dark bevel shadow only on the unbroken back layer */}
      {!isFront && (
        <ellipse
          cx="340"
          cy="214"
          rx="285"
          ry="118"
          fill="none"
          stroke="rgba(42, 2, 6, 0.55)"
          strokeWidth="34"
          filter={`url(#${prefix}-tube-blur)`}
        />
      )}

      {/* Main 3D torus body */}
      <ellipse
        cx="340"
        cy="210"
        rx="285"
        ry="118"
        fill="none"
        stroke={`url(#${prefix}-body)`}
        strokeWidth="32"
      />

      {/* Specular tubular highlight ridge */}
      <ellipse
        cx="340"
        cy="206"
        rx="285"
        ry="115"
        fill="none"
        stroke={`url(#${prefix}-shine)`}
        strokeWidth="10"
        filter={`url(#${prefix}-tube-blur)`}
      />
    </>
  );
}

export function GradientRing3D({ layer }) {
  const uid = useId().replace(/:/g, '');
  const isFront = layer === 'front';

  return (
    <div
      className={`ring-3d-layer ${isFront ? 'ring-3d-front' : 'ring-3d-back'}`}
      aria-hidden="true"
    >
      <svg
        className="ring-3d-svg"
        viewBox="0 0 680 420"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <RingDefs prefix={uid} />
        <g
          transform="rotate(-17 340 210)"
          mask={isFront ? `url(#${uid}-front-mask)` : undefined}
        >
          <TorusGeometry prefix={uid} isFront={isFront} />
        </g>
      </svg>
    </div>
  );
}
