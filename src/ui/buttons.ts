// 押しているあいだ効くボタン（パー・指さし）と、音の道のボタン
import { startTrail } from '../audio/select';
import { link, linkFlush, linkSend, type Gesture } from '../link';
import { ROLE } from '../state';


/** 音の道を、音を出す端末で鳴らす（スマホがつながっていれば、PC のボタンもスマホで鳴らす） */
export function requestTrail() {
  if (ROLE === 'pc' && link.peers.includes('phone')) linkSend({ trailAt: Date.now() });
  else startTrail();
}
/** 長押しの状態。音を出す端末が、長押しのあいだ繰り返す */
export function trailHold(on: boolean) {
  if (link.state.trailHold === on) return;
  linkSend({ trailHold: on }); linkFlush();
}

export function bindPress(btn: HTMLElement, down: () => void, up: () => void) {
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); btn.classList.add('active'); down(); });
  const release = (e: PointerEvent) => { if (btn.hasPointerCapture?.(e.pointerId)) btn.releasePointerCapture(e.pointerId); btn.classList.remove('active'); up(); };
  btn.addEventListener('pointerup', release); btn.addEventListener('pointercancel', release);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** 音の道: 押すとすぐ鳴らし、長押しのあいだは繰り返す */
export function bindTrail(btn: HTMLElement) {
  let pressed = false;
  bindPress(btn, () => { pressed = true; requestTrail(); trailHold(true); }, () => trailHold(false));
  // 指で押した後の click は無視する。読み上げ機能のダブルタップやキーボードは click だけが届くので、1 回鳴らす
  btn.addEventListener('click', () => { if (!pressed) requestTrail(); pressed = false; });
}

/** スマホのパー・指さし。押しているあいだだけ */
export function bindGesture(btn: HTMLElement, gesture: Exclude<Gesture, 'none'>) {
  bindPress(btn, () => linkSend({ phoneGesture: gesture }), () => { if (link.state.phoneGesture === gesture) linkSend({ phoneGesture: 'none' }); });
}
