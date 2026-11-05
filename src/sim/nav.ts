// 案内。2 種類ある
// - 島への案内（G キー、スマホの「案内」）: 通路の点をつないだ道で、行き先の島の名前と曲がり角のピコピコ
// - 棚への案内（Gemini）: 音の道の通路だけを通り、次の地点をピコピコ鳴らす。地点に着くたびに Gemini が次を伝える
import * as THREE from 'three';
import { NAVY } from '../config';
import { roadRoute } from '../core/roads';
import { corners, segDist } from '../core/route';
import type { El, RectEl } from '../core/store';
import { link, linkSend } from '../link';
import { JUNCTIONS, NODES, ROADS, router } from '../shop';
import { ROLE } from '../state';
import { player, scene } from '../world';

export const nav = {
  on: false, kind: 'island' as 'island' | 'road',
  /** 行き先。島への案内なら島、棚への案内なら棚（棚のない島のこともある） */
  isl: null as El | null,
  wps: [] as THREE.Vector3[], i: 0, offSince: 0,
};
/** 音のモジュールと画面と Gemini が入れる */
export const navHooks = {
  say: (_text: string) => {},
  onChange: () => {},
  /** 棚への案内で、途中の地点に着いた（next は次の地点） */
  onWaypoint: (_reached: number, _next: THREE.Vector3) => {},
  onArrive: (_goal: El) => {},
  onReroute: () => {},
};
/** 着いたかどうかを決めて知らせる端末。音を出す端末（スマホがつながっていればスマホ）だけが決める */
const decides = () => ROLE === 'phone' || !link.peers.includes('phone');

const routeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: NAVY, dashSize: 0.25, gapSize: 0.15 }));
routeLine.visible = false; scene.add(routeLine);
const wpMark = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 24), new THREE.MeshBasicMaterial({ color: 0xc98a00 }));
wpMark.visible = false; scene.add(wpMark);

const here = () => new THREE.Vector3(player.position.x, 0, player.position.z);
/** 棚への案内の行き先の点: 棚の面の前（棚のない島は、島の前の通路の点） */
const goalPoint = (g: El) => (g.level === 0 ? NODES[g.approach!] : (g as RectEl).g.at(((g as RectEl).span[0] + (g as RectEl).span[1]) / 2, 0));

function planRoute() {
  const from = here(), goal = nav.isl!;
  const path = nav.kind === 'road' ? roadRoute(ROADS, JUNCTIONS, from, goalPoint(goal)) : router.route(from, goal.approach!);
  if (!path) return false;
  nav.wps = corners(path, from); nav.i = 0;
  routeLine.geometry.dispose();   // 前より短い経路で setFromPoints が失敗しないよう、線を作り直す
  routeLine.geometry = new THREE.BufferGeometry().setFromPoints([from, ...path].map((p) => p.clone().setY(0.03)));
  routeLine.computeLineDistances(); routeLine.visible = true;
  return true;
}
/** 島への案内。fromLink: 相手の端末から届いた案内（送り返さない） */
export function startNav(isl: El, fromLink = false) {
  nav.on = true; nav.kind = 'island'; nav.isl = isl; nav.offSince = 0;
  if (!planRoute()) { nav.on = false; return; }
  navHooks.say(`${isl.name}へ案内します`);
  if (!fromLink) linkSend({ navTarget: isl.key, navMsg: null });
  navHooks.onChange();
}
/** 棚への案内。始められたら、最初の地点を返す */
export function startRoadNav(goal: El, fromLink = false) {
  nav.on = true; nav.kind = 'road'; nav.isl = goal; nav.offSince = 0;
  if (!planRoute()) { nav.on = false; return null; }
  if (!fromLink) linkSend({ navTarget: `road:${goal.key}`, navMsg: null });
  navHooks.onChange();
  return { first: nav.wps[0], count: nav.wps.length };
}
export function stopNav(msg?: string | null, fromLink = false) {
  nav.on = false; routeLine.visible = wpMark.visible = false;
  if (msg) navHooks.say(msg);
  if (!fromLink) linkSend({ navTarget: null, navMsg: msg ?? null });
  navHooks.onChange();
}
export function updateNav(dt: number) {
  if (!nav.on) return;
  const p = here(), before = nav.i;
  while (nav.i < nav.wps.length && p.distanceTo(nav.wps[nav.i]) < 0.6) nav.i++;
  if (nav.i >= nav.wps.length) {
    if (nav.kind === 'island') { stopNav(`${nav.isl!.name}に着きました`); return; }
    nav.i = nav.wps.length - 1;
    if (decides()) { const goal = nav.isl!; stopNav(); navHooks.onArrive(goal); }
    return;
  }
  if (nav.kind === 'road' && nav.i > before && decides()) navHooks.onWaypoint(nav.i, nav.wps[nav.i]);
  wpMark.visible = true; wpMark.position.copy(nav.wps[nav.i]).setY(0.03);
  // 道から 1.5m 以上、2 秒続けて外れたら案内し直す
  const off = nav.i > 0 ? segDist(p, nav.wps[nav.i - 1], nav.wps[nav.i]) : 0;
  nav.offSince = off > 1.5 ? nav.offSince + dt : 0;
  if (nav.offSince > 2) {
    nav.offSince = 0; planRoute();
    if (nav.kind === 'island') navHooks.say('道を外れました。案内し直します');
    else if (decides()) navHooks.onReroute();
  }
}
