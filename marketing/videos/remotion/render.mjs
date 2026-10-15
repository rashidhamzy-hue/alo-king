// node render.mjs frames  -> ../review/<id>-fNNN.jpg (the five review frames per video, plus a safe-zone overlay sheet)
// node render.mjs video   -> ../out/<id>/silent.mp4 (then ../audio/mix.py muxes the final MP4)
import {execFileSync} from 'node:child_process';
import {mkdirSync, readdirSync, renameSync, rmSync} from 'node:fs';
import path from 'node:path';

const BROWSER = process.env.REMOTION_BROWSER ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const VIDEOS = {
  V1Customers: {id: 'v1', review: [0, 45, 270, 360, 740]},
  V2Merchants: {id: 'v2', review: [0, 200, 290, 390, 740]},
};
const mode = process.argv[2] ?? 'frames';
const only = process.argv[3];
const remotion = (args) => execFileSync('npx', ['remotion', ...args, `--browser-executable=${BROWSER}`, '--log=error'], {stdio: 'inherit'});

for (const [comp, {id, review}] of Object.entries(VIDEOS)) {
  if (only && only !== id) continue;
  if (mode === 'frames') {
    const tmp = path.resolve('out', `frames-${id}`);
    rmSync(tmp, {recursive: true, force: true});
    remotion(['render', comp, tmp, `--frames=${review.join(',')}`, '--image-format=jpeg', '--jpeg-quality=88']);
    const dst = path.resolve('..', 'review');
    mkdirSync(dst, {recursive: true});
    for (const f of readdirSync(tmp)) {
      const n = Number(f.match(/(\d+)/)[1]);
      renameSync(path.join(tmp, f), path.join(dst, `${id}-f${String(n).padStart(3, '0')}.jpg`));
    }
    // Contact sheet with the Reels safe zone drawn: red lines at 14% and 75% height, cyan at the 80 px side margins.
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-pattern_type', 'glob', '-i', path.join(dst, `${id}-f*.jpg`), '-vf',
      'drawbox=y=269:w=iw:h=3:color=red@0.8:t=fill,drawbox=y=1440:w=iw:h=3:color=red@0.8:t=fill,drawbox=x=80:w=2:h=ih:color=cyan@0.6:t=fill,drawbox=x=998:w=2:h=ih:color=cyan@0.6:t=fill,scale=432:768,tile=5x1:padding=8:color=white',
      '-frames:v', '1', '-q:v', '3', path.join(dst, `${id}-sheet-safezone.jpg`)]);
  } else {
    mkdirSync(path.resolve('..', 'out', id), {recursive: true});
    remotion(['render', comp, path.resolve('..', 'out', id, 'silent.mp4'), '--codec=h264', '--crf=16', '--muted', '--pixel-format=yuv420p']);
  }
}
