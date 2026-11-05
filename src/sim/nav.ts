// 案内: 行き先の島までの経路を、曲がり角ごとのピコピコ音で知らせる
import * as THREE from 'three';
import { NAVY } from '../config';
import { corners, segDist } from '../core/route';
import type { El } from '../core/store';
import { linkSend } from '../link';
import { router } from '../shop';
import { player, scene } from '../world';

export const nav = { on: false, isl: null as El | null, wps: [] as THREE.Vector3[], i: 0, offSince: 0 };
/** 案内の言葉を言う（音のモジュールが入れる）と、案内の状態が変わったとき（画面が入れる） */
export const navHooks = { say: (_text: string) => {}, onChange: () => {} };

const routeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: NAVY, dashSize: 0.25, gapSize: 0.15 }));
routeLine.visible = false; scene.add(routeLine);
const wpMark = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 24), new THREE.MeshBasicMaterial({ color: 0xc98a00 }));
wpMark.visible = false; scene.add(wpMark);

const here = () => new THREE.Vector3(player.position.x, 0, player.position.z);
function planRoute() {
  const from = here(), path = router.route(from, nav.isl!.approach!);
  if (!path) return false;
  nav.wps = corners(path, from); nav.i = 0;
  routeLine.geometry.dispose();   // 前より短い経路で setFromPoints が失敗しないよう、線を作り直す
  routeLine.geometry = new THREE.BufferGeometry().setFromPoints([from, ...path].map((p) => p.clone().setY(0.03)));
  routeLine.computeLineDistances(); routeLine.visible = true;
  return true;
}
/** fromLink: 相手の端末から届いた案内（送り返さない） */
export function startNav(isl: El, fromLink = false) {
  nav.on = true; nav.isl = isl; nav.offSince = 0;
  if (!planRoute()) { nav.on = false; return; }
  navHooks.say(`${isl.name}へ案内します`);
  if (!fromLink) linkSend({ navTarget: isl.id, navMsg: null });
  navHooks.onChange();
}
export function stopNav(msg?: string | null, fromLink = false) {
  nav.on = false; routeLine.visible = wpMark.visible = false;
  if (msg) navHooks.say(msg);
  if (!fromLink) linkSend({ navTarget: null, navMsg: msg ?? null });
  navHooks.onChange();
}
export function updateNav(dt: number) {
  if (!nav.on) return;
  const p = here();
  while (nav.i < nav.wps.length && p.distanceTo(nav.wps[nav.i]) < 0.6) nav.i++;
  if (nav.i >= nav.wps.length) { stopNav(`${nav.isl!.name}に着きました`); return; }
  wpMark.visible = true; wpMark.position.copy(nav.wps[nav.i]).setY(0.03);
  // 道から 1.5m 以上、2 秒続けて外れたら案内し直す
  const off = nav.i > 0 ? segDist(p, nav.wps[nav.i - 1], nav.wps[nav.i]) : 0;
  nav.offSince = off > 1.5 ? nav.offSince + dt : 0;
  if (nav.offSince > 2) { nav.offSince = 0; planRoute(); navHooks.say('道を外れました。案内し直します'); }
}
