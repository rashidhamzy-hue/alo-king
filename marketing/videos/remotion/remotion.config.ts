import {Config} from '@remotion/cli/config';

// Three.js needs WebGL; with no GPU in the render box, ANGLE on SwiftShader ("swangle") is the reliable software path.
Config.setChromiumOpenGlRenderer('swangle');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setConcurrency(4);
