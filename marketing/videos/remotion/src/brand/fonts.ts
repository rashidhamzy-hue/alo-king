import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';

// Self-hosted from @fontsource (OFL-1.1). Google Fonts is not reachable from the render box, and local files keep renders deterministic.
export const fontsReady = Promise.all([
  ...(['500', '600', '700', '800'] as const).map((weight) =>
    loadFont({family: 'Plus Jakarta Sans', url: staticFile(`fonts/plus-jakarta-sans-latin-${weight}-normal.woff2`), weight}),
  ),
  loadFont({family: 'IBM Plex Sans Arabic', url: staticFile('fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2'), weight: '700'}),
]);
