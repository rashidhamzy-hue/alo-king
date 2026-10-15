import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {Backdrop} from '../components/Backdrop';
import {C} from '../brand/tokens';
import {Captions16, ChapterRail, sc, tl} from './kit';
import {PhoneLayer} from './phone';
import {ColdOpen, Customer, OneChat, SendHome, WhyNotApp} from './scenesA';
import {Brain, Drivers, Merchants} from './scenesB';
import {Business, Close, DatabaseCh, Status} from './scenesC';

/** The investor and partner explainer: 16:9, eleven chapters, one voice timeline (src/data/inv.json). */
export const Investor: React.FC = () => {
  const frame = useCurrentFrame();
  // The merchants chapter is set by day, like the business side of the website.
  const dayIn = sc('listed').from;
  const dayOut = sc('modes').from;
  const day = interpolate(frame, [dayIn - 12, dayIn + 6, dayOut - 6, dayOut + 12], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{background: C.ink, overflow: 'hidden'}}>
      <Backdrop tone="night" />
      {day > 0 ? (
        <div style={{position: 'absolute', inset: 0, opacity: day}}>
          <Backdrop tone="day" />
        </div>
      ) : null}
      <ColdOpen />
      <WhyNotApp />
      <OneChat />
      <Customer />
      <SendHome />
      <Brain />
      <Merchants />
      <Drivers />
      <DatabaseCh />
      <Business />
      <Status />
      <Close />
      <PhoneLayer />
      <ChapterRail />
      <Captions16 />
    </AbsoluteFill>
  );
};

export const investorFrames = tl.durationInFrames;
