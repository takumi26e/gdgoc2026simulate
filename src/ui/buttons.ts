// 押しているあいだ効くボタン（パー・指さし）と、音を鳴らすボタン（周りを聞く・音の道）
import { startListen, startTrail } from '../audio/select';
import { link, linkFlush, linkSend, type Gesture } from '../link';
import { ROLE } from '../state';

export type SoundKind = 'trailAt' | 'listenAt';

/** 音を出す端末で鳴らす（スマホがつながっていれば、PC のボタンもスマホで鳴らす） */
export function requestSound(kind: SoundKind) {
  if (ROLE === 'pc' && link.peers.includes('phone')) linkSend({ [kind]: Date.now() });
  else if (kind === 'trailAt') startTrail();
  else startListen();
}
/** 長押しの状態。音を出す端末が、長押しのあいだ繰り返す */
export function soundHold(kind: SoundKind, on: boolean) {
  const key = kind === 'trailAt' ? 'trailHold' : 'listenHold';
  if (link.state[key] === on) return;
  linkSend({ [key]: on }); linkFlush();
}

function bindPress(btn: HTMLElement, down: () => void, up: () => void) {
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); btn.classList.add('active'); down(); });
  const release = (e: PointerEvent) => { if (btn.hasPointerCapture?.(e.pointerId)) btn.releasePointerCapture(e.pointerId); btn.classList.remove('active'); up(); };
  btn.addEventListener('pointerup', release); btn.addEventListener('pointercancel', release);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** 押すとすぐ鳴らし、長押しのあいだは繰り返す */
export function bindSound(btn: HTMLElement, kind: SoundKind) {
  let pressed = false;
  bindPress(btn, () => { pressed = true; requestSound(kind); soundHold(kind, true); }, () => soundHold(kind, false));
  // 指で押した後の click は無視する。読み上げ機能のダブルタップやキーボードは click だけが届くので、1 回鳴らす
  btn.addEventListener('click', () => { if (!pressed) requestSound(kind); pressed = false; });
}

/** スマホのパー・指さし。押しているあいだだけ */
export function bindGesture(btn: HTMLElement, gesture: Exclude<Gesture, 'none'>) {
  bindPress(btn, () => linkSend({ phoneGesture: gesture }), () => { if (link.state.phoneGesture === gesture) linkSend({ phoneGesture: 'none' }); });
}
