/**
 * One grid, one colour system, one type scale for both Reels (1080×1920).
 * Colours are the repo's design tokens (src/design/design.css). Customers live at night, businesses work by day.
 */
export const W = 1080;
export const H = 1920;
export const FPS = 30;

// Instagram/Facebook Reels UI covers the top ~14% and the bottom ~25%: nothing that carries meaning goes there.
export const SAFE = {
  top: Math.round(H * 0.14), // 269
  bottom: Math.round(H * 0.75), // 1440
  side: 80,
};

// Vertical zones inside the safe area.
export const ZONE = {
  // Big kinetic word, set behind the phone.
  wordY: 560,
  // The phone's screen centre in the frame (the 3D camera is set so the phone sits here at rest).
  stageY: 760,
  // Caption band: centred at captionY, at most two lines, always above SAFE.bottom.
  captionY: 1338,
  captionMaxW: W - 2 * SAFE.side,
};

export const C = {
  ink: '#17131A',
  ink0: '#110D13',
  ink2: '#1F1923',
  ink3: '#2A2230',
  deep: '#0E0B10',
  gold: '#F4B63C',
  goldHi: '#FFD27A',
  goldText: '#855400', // gold as text on cream (6:1)
  cream: '#FFF9F0',
  cream2: '#F7EBD8',
  cream3: '#EBDDC6',
  paper: '#FFFDF8',
  sand: '#EFE2CC',
  textNight: '#F8F1E7',
  muteNight: '#C4BAC9',
  muteCream: '#5B505F',
  okNight: '#7BD389',
  okCream: '#1F7A3A',
  wa: '#25D366',
};

export type Tone = 'night' | 'day';

export const TONE: Record<Tone, {bg: string; bg2: string; fg: string; mute: string; line: string; accent: string}> = {
  night: {bg: C.ink, bg2: C.ink0, fg: C.textNight, mute: C.muteNight, line: 'rgba(244,182,60,0.16)', accent: C.gold},
  day: {bg: C.cream, bg2: C.paper, fg: C.ink, mute: C.muteCream, line: 'rgba(23,19,26,0.09)', accent: C.goldText},
};

// Type scale (px at 1080 wide). Display is set tight like the site: 800, −0.045em, 0.98 line height.
export const T = {
  mega: 300, // kinetic background word
  display: 132,
  headline: 96,
  caption: 64, // ≥ 56 per the brief
  body: 44,
  latin: '"Plus Jakarta Sans", system-ui, sans-serif',
  arabic: '"IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif',
};

// Spring presets: every entrance uses one of these.
export const SPRING = {
  snappy: {damping: 15, stiffness: 180, mass: 0.7},
  soft: {damping: 20, stiffness: 110, mass: 0.9},
  bouncy: {damping: 11, stiffness: 160, mass: 0.6},
};
