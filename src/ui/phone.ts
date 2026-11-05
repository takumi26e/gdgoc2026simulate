// スマホの画面: 開始、向きを合わせる、画面を暗く、案内、パー・指さし、スライドで歩く
import { MathUtils } from 'three';
import { audio } from '../audio/engine';
import { $ } from '../dom';
import { linkFlush, linkSend } from '../link';
import { nav, startNav, stopNav } from '../sim/nav';
import { enableSensors, recenter, sensor } from '../sim/orientation';
import { ISLANDS } from '../shop';
import { display } from '../state';
import { bindGesture, bindSound } from './buttons';
import { toggleAudio } from './panel';

const SLIDE_DEAD = 12, SLIDE_FULL = 80;   // 動き始めるスライド量と、最高速になるスライド量(px)

export function setupPhone() {
  document.body.classList.add('phone');
  const notice = (text: string) => { $('pnotice').textContent = text; $('pnotice').hidden = false; };
  const startBtn = $<HTMLButtonElement>('pStart');
  startBtn.onclick = async () => {
    startBtn.disabled = true; startBtn.textContent = '音を読み込んでいます';
    // 許可の要求はユーザー操作の直後にしか出せないので、ほかの待ち処理より先に呼ぶ
    const sensors = enableSensors();
    await toggleAudio();
    const result = await sensors;
    (navigator as Navigator & { wakeLock?: { request(t: string): Promise<unknown> } }).wakeLock?.request('screen').catch(() => {});
    $('poverlay').hidden = true;
    if (!audio.started) notice('音を読み込めませんでした。ネットにつながっているか確かめてください');
    setTimeout(() => {
      if (sensor.events) return;
      notice(result === 'denied' ? '端末の角度の利用が許可されませんでした。ブラウザの設定でモーションセンサーを許可してください' : '端末の角度を取得できません。HTTPS 接続とセンサーの有無を確かめてください');
    }, 2000);
  };
  bindGesture($('pOpen'), 'open'); bindGesture($('pPoint'), 'point');
  bindSound($('pTrail'), 'trailAt'); bindSound($('pListen'), 'listenAt');
  $('pRecenter').onclick = recenter;
  $('pBlackout').onclick = () => {
    display.blackout = !display.blackout;
    $('curtain').hidden = !display.blackout;
    $('pBlackout').textContent = display.blackout ? '画面を表示' : '画面を暗く';
    $('pBlackout').setAttribute('aria-pressed', String(display.blackout));
  };
  for (const isl of ISLANDS) {
    const b = document.createElement('button'); b.className = 'ghost'; b.textContent = isl.name;
    b.onclick = () => { if (nav.on) stopNav(); startNav(isl); $('pguide').hidden = true; };
    $('pguideList').append(b);
  }
  $('pGuideOpen').onclick = () => { $('pguide').hidden = false; };
  $('pGuideClose').onclick = () => { $('pguide').hidden = true; };
  $('pGuideStop').onclick = () => { stopNav('案内を終わります'); $('pguide').hidden = true; };

  // 触れた点から上へスライドすると前、下へスライドすると後ろ。大きくスライドするほど速い（画面を暗くしても使える）
  let slideId: number | null = null, slideY = 0;
  const stop = () => { slideId = null; linkSend({ phoneMove: 0 }); linkFlush(); };
  addEventListener('pointerdown', (e) => {
    if (slideId !== null || (e.target as Element).closest('button, #pguide, #poverlay')) return;
    slideId = e.pointerId; slideY = e.clientY;
  });
  addEventListener('pointermove', (e) => {
    if (e.pointerId !== slideId) return;
    const dy = slideY - e.clientY, k = MathUtils.clamp((Math.abs(dy) - SLIDE_DEAD) / (SLIDE_FULL - SLIDE_DEAD), 0, 1);
    linkSend({ phoneMove: Math.round(Math.sign(dy) * k * 100) / 100 });
  });
  for (const type of ['pointerup', 'pointercancel'] as const) addEventListener(type, (e) => { if (e.pointerId === slideId) stop(); });
  addEventListener('blur', () => { if (slideId !== null) stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && slideId !== null) stop(); });
}
