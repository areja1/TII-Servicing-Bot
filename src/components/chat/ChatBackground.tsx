/**
 * Decorative chat background: small airplane icons, each with a dashed trail
 * behind it (its "flight path"), over a faint TII logo watermark and a soft
 * brand gradient. A radial mask fades the planes/trails out over the centered
 * logo so the dashes never sit on top of the watermark. Kept very low-contrast
 * so message text stays the priority.
 */

const AIRPLANE_PATH =
  "M22 16v-2l-8-5V3.5C14 2.67 13.33 2 12.5 2S11 2.67 11 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L14 19v-5.5l8 2.5z";

/** Positions/orientations of the planes (viewBox is 800x600). */
const PLANES = [
  { x: 70, y: 470, r: -35, s: 1.6 },
  { x: 560, y: 195, r: 25, s: 1.3 },
  { x: 130, y: 535, r: 10, s: 1.1 },
  { x: 715, y: 315, r: -20, s: 1.5 },
  { x: 60, y: 295, r: 40, s: 1.2 },
  { x: 640, y: 120, r: -10, s: 1.4 },
];

function Airplanes() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 800 600"
    >
      <defs>
        {/* Hidden (black) in the center where the logo sits, visible (white)
            toward the edges, with a soft fade between. */}
        <radialGradient id="logoFade" cx="50%" cy="50%" r="38%">
          <stop offset="48%" stopColor="black" />
          <stop offset="100%" stopColor="white" />
        </radialGradient>
        <mask id="logoHole">
          <rect width="800" height="600" fill="url(#logoFade)" />
        </mask>
      </defs>

      <g mask="url(#logoHole)">
        {PLANES.map((p, i) => (
          <g
            key={i}
            transform={`translate(${p.x} ${p.y}) rotate(${p.r}) scale(${p.s}) translate(-12 -12)`}
          >
            {/* Dashed trail behind the plane (the tail points down in the
                icon's local frame, so the trail extends downward). */}
            <line
              x1="12"
              y1="25"
              x2="12"
              y2="90"
              stroke="#0b2545"
              strokeOpacity="0.13"
              strokeWidth="2"
              strokeDasharray="3 7"
              strokeLinecap="round"
            />
            <path d={AIRPLANE_PATH} fill="#13a3b5" fillOpacity="0.24" />
          </g>
        ))}
      </g>
    </svg>
  );
}

export function ChatBackground() {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-tii-blue/10 to-white">
      <Airplanes />
      <div
        className="absolute inset-0 bg-center bg-no-repeat opacity-[0.06]"
        style={{
          backgroundImage: "url(/brand/tii-logo-primary.png)",
          backgroundSize: "320px",
        }}
      />
    </div>
  );
}
