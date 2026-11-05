// 画面の左上の状態と、パネルの「いま鳴っているもの」
import { Vector3 } from 'three';
import { audio, voices } from '../audio/engine';
import { LEVEL } from '../config';
import { clockDir } from '../core/geometry';
import { $, hud } from '../dom';
import { headYaw } from '../link';
import { hand, handTarget } from '../sim/hand';
import { nav } from '../sim/nav';
import { trailOn } from '../sim/trail';
import { player, topCam, world } from '../world';

const playingEl = $('playing');

export function updateHud() {
  const items = voices
    .filter((v) => v.item && (!v.item.trail || v.item.key === 'trail0'))   // 音の道は 1 行にまとめる
    .map((v) => ({ ...v.item!, ...clockDir(player.position, headYaw(), v.pos) }))
    .sort((a, b) => a.d - b.d);
  playingEl.innerHTML = items.length
    ? items.map((w) => `<li><span class="lv">${w.beep ? '道' : LEVEL[w.level]}</span><span class="nm">${w.name}</span><span class="d">${w.h}時・${w.d.toFixed(1)}m</span></li>`).join('')
    : `<li class="empty">${audio.started ? '鳴っている物はありません' : 'まだ鳴っていません'}</li>`;
  const state = nav.on ? `案内中：${nav.isl!.name}` : hand.point ? '指さし' : hand.open ? 'パー' : trailOn() ? '音の道' : 'ふだん';
  const pe = hand.point || hand.open ? handTarget() : null;
  const wp = nav.on ? nav.wps[nav.i] : null;
  const detail = wp ? `次の曲がり角まで ${new Vector3(player.position.x, 0, player.position.z).distanceTo(wp).toFixed(1)}m`
    : pe ? `${LEVEL[pe.level]}「${pe.name}」${hand.point ? 'を指しています' : 'に手を向けています'}`
    : audio.started ? (world.cam === topCam ? `手の高さ ${hand.height.toFixed(1)}m` : '') : '「音を出す」を押すと始まります';
  hud.innerHTML = `<b>${state}</b><br><span>${detail}</span>`;
}
