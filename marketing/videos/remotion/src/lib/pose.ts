import {spring} from 'remotion';
import type {Pose} from '../components/Phone3D';
import type {Timeline} from './timeline';
import {SPRING} from '../brand/tokens';

const keys: (keyof Pose)[] = ['x', 'y', 'z', 'rx', 'ry', 'rz', 's'];
const mix = (a: Pose, b: Pose, t: number) => Object.fromEntries(keys.map((k) => [k, a[k] + (b[k] - a[k]) * t])) as Pose;

/** The phone eases (spring) from the previous scene's pose to the current one at every cut, with a slow idle sway. */
export const phonePose = (tl: Timeline, frame: number, poses: Record<string, Pose>, fallback: Pose): Pose => {
  const i = Math.max(0, tl.scenes.findIndex((s) => frame >= s.from && frame < s.to));
  const idx = frame >= tl.durationInFrames ? tl.scenes.length - 1 : i;
  const cur = poses[tl.scenes[idx].id] ?? fallback;
  const prev = idx > 0 ? poses[tl.scenes[idx - 1].id] ?? fallback : cur;
  const t = spring({frame: frame - tl.scenes[idx].from, fps: tl.fps, config: SPRING.soft});
  const p = mix(prev, cur, t);
  return {...p, rx: p.rx + 0.018 * Math.sin(frame * 0.05), ry: p.ry + 0.035 * Math.sin(frame * 0.033 + 1), y: p.y + 0.02 * Math.sin(frame * 0.04)};
};
