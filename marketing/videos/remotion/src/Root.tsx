import React from 'react';
import {Composition} from 'remotion';
import './brand/fonts';
import {V1Customers, v1Timeline} from './videos/V1Customers';
import {V2Merchants, v2Timeline} from './videos/V2Merchants';
import {FPS, H, W} from './brand/tokens';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="V1Customers" component={V1Customers} width={W} height={H} fps={FPS} durationInFrames={v1Timeline.durationInFrames} />
    <Composition id="V2Merchants" component={V2Merchants} width={W} height={H} fps={FPS} durationInFrames={v2Timeline.durationInFrames} />
  </>
);
