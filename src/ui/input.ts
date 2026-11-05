// PC のキーとマウス
import { MathUtils } from 'three';
import { setMode } from '../audio/engine';
import { hand } from '../sim/hand';
import { input } from '../state';
import { renderer } from '../world';
import { requestSound, soundHold } from './buttons';
import { grab, modeByKey, switchCam, toggleNav } from './panel';

export function setupInput() {
  const keys = input.keys;
  addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if ((tag === 'INPUT' || tag === 'SELECT') && e.code.startsWith('Arrow')) return;
    if ((tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT') && (e.code === 'Space' || e.code === 'Enter')) return;
    if (!e.repeat) {
      if (e.code === 'KeyV') switchCam();
      if (e.code === 'KeyG') toggleNav();
      if (e.code === 'KeyC') grab();
      if (e.code === 'KeyT') { requestSound('trailAt'); soundHold('trailAt', true); }
      if (e.code === 'KeyL') { requestSound('listenAt'); soundHold('listenAt', true); }
      const m = modeByKey(e.code); if (m) setMode(m);
    }
    keys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'KeyT') soundHold('trailAt', false);
    if (e.code === 'KeyL') soundHold('listenAt', false);
  });
  addEventListener('blur', () => { keys.clear(); input.mouseDown = false; soundHold('trailAt', false); soundHold('listenAt', false); });

  // マウス: 手の向き。左ボタンで指さし、ホイールで手の高さ（上からの視点）
  const cv = renderer.domElement;
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => { if (e.button === 0) input.mouseDown = true; });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    hand.mouse = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  });
  cv.addEventListener('pointerup', (e) => { if (e.button === 0) input.mouseDown = false; });
  cv.addEventListener('pointerleave', () => { hand.mouse = null; input.mouseDown = false; });
  cv.addEventListener('wheel', (e) => { hand.height = MathUtils.clamp(hand.height - Math.sign(e.deltaY) * 0.1, 0.2, 2.0); e.preventDefault(); }, { passive: false });
}
