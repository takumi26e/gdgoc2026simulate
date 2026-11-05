// 手: 向き（スマホの向き、PC のマウスや手のカメラ）と、手を向けた先の物
import * as THREE from 'three';
import { closestOn, rectAt } from '../core/geometry';
import { up, type El, type RectEl } from '../core/store';
import { headYaw, link, phoneLinked } from '../link';
import { ROLE, input } from '../state';
import { chest, fpCam, handDot, handLine, head, occluders, topCam, world } from '../world';
import { camHand } from './handcam';

export const hand = {
  dir: new THREE.Vector3(0, 0, -1), height: 1.1, mouse: null as { x: number; y: number } | null,
  open: false, point: false,
  hit: null as { isl: El; el?: El; normal: THREE.Vector3; p: THREE.Vector3 } | null,
};
const ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** パーと指さしの状態を、キー・PC のカメラ・スマホのボタンから決める */
export function updateGestures() {
  const k = input.keys, s = link.state;
  hand.open = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyP') || camHand.gesture === 'open' || s.phoneGesture === 'open' || (ROLE === 'phone' && s.pcOpen);
  hand.point = k.has('KeyF') || input.mouseDown || camHand.gesture === 'point' || s.phoneGesture === 'point' || (ROLE === 'phone' && s.pcPoint);
  return hand.point ? 'point' : hand.open ? 'open' : 'none';
}

export function updateHand() {
  const s = link.state;
  const useHead = ROLE === 'phone' ? !s.pcHandDir : phoneLinked() && !camHand.on;   // PC のカメラの手を使っていないときは頭の向きで指す
  const o = (useHead ? head : chest).getWorldPosition(new THREE.Vector3());
  if (useHead) {
    const hy = headYaw(), cp = Math.cos(s.pitch);
    hand.dir.set(-Math.sin(hy) * cp, Math.sin(s.pitch), -Math.cos(hy) * cp);
  } else if (ROLE === 'phone') hand.dir.fromArray(s.pcHandDir!);
  else if (camHand.on && camHand.tip) {
    ray.setFromCamera(_ndc.set(camHand.tip.x, camHand.tip.y), fpCam); hand.dir.copy(ray.ray.direction);
  } else if (!hand.mouse) hand.dir.set(0, 0, -1);
  else if (world.cam === fpCam) {   // カメラの映像では、マウスの位置がそのまま画面の中の手
    ray.setFromCamera(_ndc.set(hand.mouse.x, hand.mouse.y), fpCam); hand.dir.copy(ray.ray.direction);
  } else {   // 上からの視点では、マウスの床の位置を手の高さで指す
    ray.setFromCamera(_ndc.set(hand.mouse.x, hand.mouse.y), topCam);
    const pt = ray.ray.intersectPlane(_floor, new THREE.Vector3());
    if (pt) hand.dir.set(pt.x - o.x, hand.height - o.y, pt.z - o.z).normalize();
  }
  ray.set(o, hand.dir); ray.far = 15;
  let h = ray.intersectObjects(occluders, false)[0];
  if (ROLE === 'pc' && !useHead && !hand.mouse && !(camHand.on && camHand.tip)) {   // キーだけのときは、少し下向き（15°）にも指し、近いほうを選ぶ（低いレジも指せるように）
    const down = hand.dir.clone().multiplyScalar(Math.cos(0.26)).setY(-Math.sin(0.26));
    ray.set(o, down);
    const h2 = ray.intersectObjects(occluders, false)[0];
    if (h2 && (!h || h2.distance < h.distance)) { h = h2; hand.dir.copy(down); }
  }
  // 部屋（事務所・トイレなど）の箱は壁と同じで、何も指していない扱いにする
  const isl: El | undefined = h?.object.userData.island;
  hand.hit = h && isl ? { isl, el: h.object.userData.el, normal: h.face!.normal.clone(), p: h.point.clone() } : null;
  handLine.geometry.setFromPoints([o, h ? h.point : o.clone().add(hand.dir.clone().multiplyScalar(3))]);
  handLine.material.color.set(hand.point ? 0xc98a00 : hand.open ? 0x1f3a68 : 0xb8bec8);
  handDot.visible = !!h && (hand.point || hand.open);
  if (h) handDot.position.copy(h.point);
}

/** 手を向けた先の物。商品のない所なら、その棚でいちばん近い商品 */
export function pointedElement(): El | null {
  const h = hand.hit; if (!h) return null;
  if (h.el) return h.el;   // 商品の箱
  const isl = h.isl; if (!isl.children.length) return isl;   // 出口など
  // 天板など棚の面でない所を指したら、いちばん近い棚にする
  const shelf = rectAt(isl, h.normal, h.p) ?? isl.rects!.filter((r) => !r.door).reduce((b, r) =>
    (closestOn(r, h.p).distanceTo(h.p) < closestOn(b, h.p).distanceTo(h.p) ? r : b));
  if (!shelf || shelf.door) return isl;
  const items = shelf.children.flatMap((c) => c.children);
  if (!items.length) return shelf;   // ATM の画面など、商品のない棚
  const dist = (e: El) => closestOn(e as RectEl, h.p).distanceTo(h.p);
  return items.reduce((b, it) => (dist(it) < dist(b) ? it : b));
}

/** 鳴らす物: パーは棚までの距離で棚か商品、指さしはいつも商品 */
export function handTarget(): El | null {
  const el = pointedElement();
  if (!el || el.level === 0) return el;   // 出口など
  const lv = hand.point ? 3 : up(el, 1).base ?? 1;
  return el.level > lv ? up(el, lv) : el;
}
