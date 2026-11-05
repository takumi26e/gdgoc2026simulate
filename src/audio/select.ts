// そのとき鳴らす物を選ぶ: 案内、手を向けた先、「周りを聞く」、音の道
import * as THREE from 'three';
import { CAM_Y, HEAR_KEEP, HEAR_MAX, HOLD_SEC, TRAIL_VOICES } from '../config';
import { closestOn } from '../core/geometry';
import type { El, RectEl } from '../core/store';
import { announce } from '../dom';
import { headYaw, link, linkSend, phoneLinked } from '../link';
import { handTarget, hand } from '../sim/hand';
import { nav } from '../sim/nav';
import { itemInView } from '../sim/recognition';
import { trail, trailOn } from '../sim/trail';
import { ISLANDS } from '../shop';
import { settings } from '../state';
import { player } from '../world';
import { BUF, audio, gestureTick, voices } from './engine';

export interface Want {
  key: unknown; name: string; level: number; pos: THREE.Vector3;
  beep?: boolean; trail?: boolean; rate?: number; once?: boolean;
}

/** 「周りを聞く」: 短く押すと押した時の様子で 1 回、長押しのあいだは繰り返す */
export const listen = { pending: false, items: null as Want[] | null, end: 0, heldAt: 0 };
export function startListen() {
  if (!audio.started) return;
  listen.pending = true;
  announce.textContent = '周りを聞きます';
}
/** 音の道を 1 回鳴らす（長押しのあいだは繰り返す） */
export function startTrail() {
  if (!audio.started) return;
  trail.plan = null; trail.endAt = 0; trail.next = 0;
  linkSend({ trailOn: true });
  announce.textContent = '音の道を鳴らします';
}

export function wanted(): Want[] {
  const out = names();
  if (!trailOn()) return out;
  // 音の道は、HEAR_MAX の制限とは別に足す
  for (let k = 0; k < TRAIL_VOICES; k++) out.push({ key: `trail${k}`, name: '音の道', level: -1, pos: player.position, beep: true, trail: true });
  return out;
}

const center = (e: El) => e.g!.at((e.span![0] + e.span![1]) / 2, (e.y![0] + e.y![1]) / 2);

function names(): Want[] {
  const ctx = audio.ctx!, out: Want[] = [], p = player.position, eye = new THREE.Vector3(p.x, CAM_Y, p.z);
  const visible = (el: El) => !settings.onlySeen || el.seen;
  // スマホの向きで音が動くよう、接続中は回しても変わらない「いちばん近い点」から鳴らす。
  // 写っている部分の中心だと、近くの棚では音が視野についてきて左右が変わらない
  const nearest = (el: El) => ((el.rects ?? [el]) as RectEl[]).map((r) => closestOn(r, eye)).reduce((a, b) => (a.distanceTo(eye) <= b.distanceTo(eye) ? a : b));
  const source = (el: El) => (phoneLinked() ? nearest(el) : el.aimSeen ? el.aimSeen.clone() : nearest(el));

  if (nav.on && nav.isl) {   // 案内中: 行き先の島の名前と、次の曲がり角のピコピコだけ
    out.push({ key: nav.isl, name: nav.isl.name, level: 0, pos: source(nav.isl) });
    const wp = nav.wps[nav.i];
    if (wp) {   // 正面（左右 15° 以内）に向くと音が高くなる
      const to = Math.atan2(wp.x - p.x, -(wp.z - p.z)) + headYaw();
      const facing = Math.abs(Math.atan2(Math.sin(to), Math.cos(to))) < THREE.MathUtils.degToRad(15);
      out.push({ key: 'beep', name: '曲がり角', level: -1, pos: wp.clone().setY(1.2), beep: true, rate: facing ? 1.5 : 1 });
    }
    return out;
  }
  if (hand.point || hand.open) {   // パーも指さしも、手を向けた先の 1 つだけ
    const el = handTarget();
    if (el && hand.hit) out.push({ key: el, name: el.name, level: el.level, pos: el.level === 0 ? source(el) : hand.hit.p.clone() });
    return out;
  }
  // ふだん: 写っている棚ごとに、遠ければ棚の名前、近ければ画面のまん中の商品
  for (const isl of ISLANDS) {
    if (!isl.children.length) {   // 出口やトイレ
      if (visible(isl)) out.push({ key: isl, name: isl.name, level: 0, pos: source(isl) });
    } else for (const sh of isl.children) {
      if (!visible(sh)) continue;
      const it = sh.base === 3 ? itemInView(sh) : null;
      if (it) out.push({ key: it, name: it.name, level: 3, pos: center(it) });
      else out.push({ key: sh, name: sh.name, level: 1, pos: source(sh) });
    }
  }
  if (link.state.listenHold) {
    listen.heldAt ||= ctx.currentTime;
    if (ctx.currentTime - listen.heldAt >= HOLD_SEC) {   // 長押し: その時々の近い物を繰り返す
      listen.pending = false; listen.items = null;
      const sounding = new Set(voices.filter((v) => v.item).map((v) => v.item!.key));
      const dist = (w: Want) => w.pos.distanceTo(eye) - (sounding.has(w.key) ? HEAR_KEEP : 0);
      return out.map((w) => [dist(w), w] as const).sort((a, b) => a[0] - b[0]).slice(0, HEAR_MAX).map((e) => e[1]);
    }
  } else listen.heldAt = 0;
  if (listen.pending) {   // 短く押したときは、押した時の様子を固定して 1 回鳴らす
    listen.pending = false;
    listen.items = out.map((w) => [w.pos.distanceTo(eye), w] as const).sort((a, b) => a[0] - b[0]).slice(0, HEAR_MAX).map(([, w]) => ({ ...w, once: true }));
    listen.end = ctx.currentTime + 0.65 + Math.max(0, ...listen.items.map((w) => BUF[w.name]?.duration ?? 0));
    if (!listen.items.length) { gestureTick('empty'); announce.textContent = '写っている物はありません'; }   // 無音だと、押せたのか分からない
  }
  if (listen.items && ctx.currentTime < listen.end) return listen.items;
  listen.items = null;
  return [];
}
