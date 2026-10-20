import type React from 'react';

/**
 * Tiny looping SVG animations for the how-to steps. All motion is CSS (howto.css) and is
 * switched off under prefers-reduced-motion, leaving a still that still reads correctly.
 * viewBox is 160×100 for every animation so they line up in the step list.
 */

function Phone({ x, y, w = 34, h = 62 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} className="a-phone" />
      <rect x={x + 3} y={y + 6} width={w - 6} height={h - 14} rx={2} className="a-screen" />
      <rect x={x + w / 2 - 5} y={y + h - 5} width={10} height={2} rx={1} className="a-slot" />
    </g>
  );
}

function Ripples({
  cx,
  cy,
  className = '',
  half = false,
}: {
  cx: number;
  cy: number;
  className?: string;
  /** Upper half only, for sound leaving something that sits on a surface. */
  half?: boolean;
}) {
  return (
    <g className={`a-ripples ${className}`}>
      {[0, 1, 2].map((i) =>
        half ? (
          <path
            key={i}
            d={`M${cx - 10} ${cy} a10 10 0 0 1 20 0`}
            className={`a-ripple half d${i}`}
          />
        ) : (
          <circle key={i} cx={cx} cy={cy} r={10} className={`a-ripple d${i}`} />
        ),
      )}
    </g>
  );
}

/** Sensor check: phone face-up on a table, sweep going out and coming back in. */
export function PhoneOnTableAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <rect x="10" y="80" width="140" height="6" rx="2" className="a-table" />
      {/* Side view of a phone lying face-up: a thin slab with the speaker at its right end. */}
      <rect x="44" y="71" width="72" height="9" rx="3" className="a-phone" />
      <rect x="50" y="71.5" width="56" height="2.5" rx="1" className="a-screen" />
      <Ripples cx={112} cy={71} half />
      <Ripples cx={48} cy={71} half className="echo" />
      <text x="14" y="20" className="a-label">
        quiet room · phone flat
      </text>
    </svg>
  );
}

/** Mic check: a voice wave flowing into the phone, level bars bouncing. */
export function MicListenAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <Phone x={96} y={18} />
      <path d="M8 50 q8 -14 16 0 t16 0 t16 0 t16 0 t16 0" className="a-wave" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x={102 + i * 5}
          y={40}
          width={3}
          height={24}
          rx={1}
          className={`a-level d${i}`}
        />
      ))}
    </svg>
  );
}

/** Motion check: phone tilting back and forth with axis arrows. */
export function PhoneTiltAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <g className="a-tilt">
        <Phone x={63} y={10} />
      </g>
      <path d="M40 78 a44 44 0 0 1 80 0" className="a-arc" />
      <path d="M116 72 l5 7 l-8 1" className="a-arc" />
      <path d="M44 72 l-5 7 l8 1" className="a-arc" />
    </svg>
  );
}

function Bucket({ level = 0, className = '' }: { level?: number; className?: string }) {
  // Frustum side view: top 44–116, bottom 54–106, rim y=30, base y=88.
  const yTop = 30;
  const yBot = 88;
  const wy = yBot - level * (yBot - yTop);
  const xl = (y: number) => 54 - ((yBot - y) / (yBot - yTop)) * 10;
  const xr = (y: number) => 106 + ((yBot - y) / (yBot - yTop)) * 10;
  return (
    <g className={className}>
      {level > 0 && (
        <path
          d={`M${xl(wy)} ${wy} L${xr(wy)} ${wy} L106 ${yBot} L54 ${yBot} Z`}
          className="a-water"
        />
      )}
      <path d="M44 30 L116 30 L106 88 L54 88 Z" className="a-bucket" />
      <path d="M44 30 q36 -26 72 0" className="a-handle" />
    </g>
  );
}

/** Tap: a pen swings and taps the bucket's side; ripples go out to the phone. */
export function TapBucketAnim({ level = 0.4 }: { level?: number }) {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <Bucket level={level} />
      <g className="a-pen">
        <rect x="118" y="2" width="5" height="40" rx="2" className="a-pen-body" />
        <path d="M118 42 l2.5 6 l2.5 -6 z" className="a-pen-tip" />
      </g>
      <Ripples cx={114} cy={46} className="on-hit" />
      <g transform="translate(132 72) scale(0.5)">
        <Phone x={0} y={0} />
      </g>
    </svg>
  );
}

/** Calibration: water poured from a jug, the level rising to a known amount. */
export function FillBucketAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <g className="a-fill">
        <Bucket level={0.55} />
      </g>
      <g className="a-jug">
        <path d="M120 6 h22 v26 a6 6 0 0 1 -6 6 h-10 a6 6 0 0 1 -6 -6 z" className="a-jug-body" />
        <path d="M120 10 l-8 4 l8 2" className="a-jug-body" />
      </g>
      <path d="M112 16 q-4 20 -18 30" className="a-pour" />
      <text x="128" y="52" className="a-label" textAnchor="middle">
        2.0 L
      </text>
    </svg>
  );
}

/** Calibration: the empty bucket. */
export function EmptyBucketAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <Bucket level={0} />
      <text x="80" y="66" className="a-label a-blink" textAnchor="middle">
        0 L
      </text>
    </svg>
  );
}

/** A ping (short arc) travelling `travel` units along y (or x), then its echo coming back. */
function Ping({
  d,
  travel,
  horizontal = false,
}: {
  d: string;
  travel: number;
  horizontal?: boolean;
}) {
  const style = { '--travel': `${travel}px` } as React.CSSProperties;
  return (
    <g className={horizontal ? 'h' : ''}>
      <path d={d} className="a-ping" style={style} />
      {/* CSS transforms replace the transform attribute, so offset with a wrapper. */}
      <g transform={horizontal ? `translate(${travel} 0)` : `translate(0 ${travel})`}>
        <path d={d} className="a-ping back" style={style} />
      </g>
    </g>
  );
}

/** Echo: phone upright over the bucket, bottom edge down; a chirp goes down and comes back. */
export function PhoneOverBucketAnim({ level = 0.45 }: { level?: number }) {
  const water = 88 - level * 58;
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <Bucket level={level} />
      <Phone x={70} y={-10} w={20} h={36} />
      <Ping d="M70 31 q10 5 20 0" travel={water - 33} />
      <path d="M96 28 v-4" className="a-arc" />
      <text x="100" y="24" className="a-label">
        ≈ rim
      </text>
    </svg>
  );
}

/** Echo reference: the phone held up in open air, the chirp spreading out with nothing to return it. */
export function FreeAirAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <Phone x={70} y={6} w={20} h={36} />
      <Ripples cx={80} cy={46} />
      <text x="80" y="94" className="a-label" textAnchor="middle">
        nothing below for 1 m
      </text>
    </svg>
  );
}

/** Sonar ruler: phone's bottom edge pointed at a wall; ping out and back. */
export function PhoneAtWallAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <rect x="140" y="8" width="10" height="84" className="a-table" />
      <g transform="rotate(-90 40 50)">
        <Phone x={30} y={20} w={20} h={36} />
      </g>
      <Ping d="M62 40 q5 10 0 20" travel={72} horizontal />
      <path d="M62 80 H138" className="a-arc" />
      <text x="100" y="94" className="a-label" textAnchor="middle">
        distance
      </text>
    </svg>
  );
}

/** Room acoustics: two hands clap once; sound spreads out and bounces off the walls. */
export function ClapAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <rect x="6" y="10" width="4" height="80" className="a-table" />
      <rect x="150" y="10" width="4" height="80" className="a-table" />
      <g className="a-clap-l">
        <rect x="58" y="34" width="18" height="30" rx="8" className="a-hand" />
      </g>
      <g className="a-clap-r">
        <rect x="84" y="34" width="18" height="30" rx="8" className="a-hand" />
      </g>
      <Ripples cx={80} cy={49} className="on-hit wide" />
    </svg>
  );
}

/** Camera, top view: a bank card lying on the rim, the phone straight above, a flash. */
export function CardOnRimAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <ellipse cx="62" cy="64" rx="46" ry="20" className="a-bucket" />
      <ellipse cx="62" cy="64" rx="40" ry="16" className="a-handle" />
      <rect x="86" y="54" width="26" height="16" rx="2" className="a-card" />
      <g transform="translate(122 6) rotate(20)">
        <Phone x={0} y={0} w={20} h={36} />
      </g>
      <circle cx="132" cy="44" r="6" className="a-flash" />
      <text x="62" y="96" className="a-label" textAnchor="middle">
        card flat on the rim
      </text>
    </svg>
  );
}

/** Camera, side view: the card taped upright on the wall, the phone level, 1–2 m away. */
export function CardOnSideAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <Bucket level={0.45} />
      <rect x="76" y="44" width="10" height="17" rx="1.5" className="a-card" />
      <Phone x={136} y={44} w={14} h={24} />
      <circle cx="136" cy="56" r="5" className="a-flash" />
      <path d="M128 56 H112" className="a-arc" />
      <text x="80" y="98" className="a-label" textAnchor="middle">
        level, 1–2 m back, zoom in
      </text>
    </svg>
  );
}

/** Knock ID: a knuckle knocks on an object; the phone listens nearby. */
export function KnockAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <rect x="20" y="40" width="70" height="46" rx="3" className="a-box" />
      <g className="a-knock">
        <rect x="96" y="42" width="22" height="18" rx="7" className="a-hand" />
        <rect x="114" y="46" width="16" height="9" rx="4" className="a-hand" />
      </g>
      <Ripples cx={92} cy={51} className="on-hit" />
      <g transform="translate(132 66) scale(0.5)">
        <Phone x={0} y={0} />
      </g>
    </svg>
  );
}

/** Fruit firmness: a finger flicks a melon; weigh it too. */
export function FruitTapAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <ellipse cx="78" cy="58" rx="40" ry="30" className="a-melon" />
      <path
        d="M48 44 q30 -14 60 0 M42 58 q36 -10 72 0 M48 72 q30 8 60 0"
        className="a-melon-stripe"
      />
      <g className="a-pen">
        <rect x="118" y="2" width="5" height="40" rx="2" className="a-pen-body" />
        <path d="M118 42 l2.5 6 l2.5 -6 z" className="a-pen-tip" />
      </g>
      <Ripples cx={116} cy={50} className="on-hit" />
      <text x="20" y="96" className="a-label">
        + weigh it (kg)
      </text>
    </svg>
  );
}

/** Metal finder: the phone (flat, seen from above) slides over a board with a hidden screw. */
export function MetalSweepAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <rect x="8" y="58" width="144" height="30" rx="3" className="a-box" />
      <circle cx="80" cy="73" r="3.5" className="a-screw" />
      <path d="M77.5 73 h5 M80 70.5 v5" className="a-screw-x" />
      <g className="a-slide">
        <rect x="64" y="14" width="32" height="36" rx="5" className="a-phone" />
        <rect x="67" y="18" width="26" height="28" rx="2" className="a-screen" />
      </g>
      <Ripples cx={80} cy={73} className="on-near" />
    </svg>
  );
}

/** Sound alerts: a smoke alarm on the ceiling beeps in threes; the phone lights up. */
export function SmokeAlarmAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <rect x="10" y="6" width="140" height="4" className="a-table" />
      <rect x="58" y="10" width="44" height="10" rx="5" className="a-box" />
      <circle cx="80" cy="20" r="3" className="a-led" />
      <Ripples cx={80} cy={22} className="t3" />
      <g transform="translate(66 52) scale(0.75)">
        <Phone x={0} y={0} />
      </g>
      <text x="80" y="76" className="a-label a-bell" textAnchor="middle">
        🔔
      </text>
    </svg>
  );
}

/** Teaching a sound: a doorbell plays its chime next to the phone. */
export function DoorbellAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <rect x="24" y="22" width="34" height="56" rx="6" className="a-box" />
      <circle cx="41" cy="50" r="9" className="a-led" />
      <text x="72" y="40" className="a-label a-note">
        ♪
      </text>
      <text x="88" y="54" className="a-label a-note d1">
        ♫
      </text>
      <g transform="translate(116 30) scale(0.75)">
        <Phone x={0} y={0} />
      </g>
    </svg>
  );
}

/** Presence: a person lying still, chest rising and falling; the phone pings from the side. */
export function PresenceAnim() {
  return (
    <svg viewBox="0 0 160 100" className="anim">
      <rect x="40" y="62" width="112" height="14" rx="4" className="a-box" />
      <circle cx="140" cy="54" r="7" className="a-hand" />
      <path d="M58 62 q22 -12 44 0" className="a-chest" />
      <rect x="6" y="66" width="22" height="10" rx="2" className="a-table" />
      <g transform="translate(10 44) scale(0.42)">
        <Phone x={0} y={0} />
      </g>
      <Ping d="M28 50 q4 6 0 12" travel={22} horizontal />
    </svg>
  );
}
