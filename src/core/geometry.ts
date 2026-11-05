// 面と床の上の計算
import { MathUtils, Vector3 } from 'three';
import { D, RADIUS, READ_ANGLE, W } from '../config';
import type { El, Rect, RectEl, Store } from './store';

/** 面の上の範囲で、点 p にいちばん近い点（高さは面の中ほど） */
export function closestOn(el: Rect, p: { x: number; z: number }, out = new Vector3()) {
  const along = el.face[1] === 'z' ? p.x : p.z;
  const u = MathUtils.clamp(along, Math.min(...el.span), Math.max(...el.span));
  return out.copy(el.g.at(u, (el.y[0] + el.y[1]) / 2));
}

/** 島の面の上の点が、どの棚（扉）に当たるか */
export function rectAt(isl: El, normal: Vector3, p: Vector3): RectEl | undefined {
  return isl.rects?.find((r) => {
    if (r.g.n.dot(normal) < 0.9) return false;
    const u = r.face[1] === 'z' ? p.x : p.z;
    return u >= Math.min(...r.span) - 0.01 && u <= Math.max(...r.span) + 0.01;
  });
}

const READ_COS = Math.cos(MathUtils.degToRad(READ_ANGLE));
/** 視線 (dx, dz) で、法線 n の面を読み取れるか。正面から左右 READ_ANGLE 度以内（上下の傾きは見ない） */
export function readable(dx: number, dz: number, n: Vector3) {
  const len = Math.hypot(dx, dz);
  return len > 1e-6 && -(dx * n.x + dz * n.z) / len >= READ_COS;
}

/** 床の上の (x, z) に人が立てないか（壁、島、部屋） */
export function makeBlocked(store: Store) {
  const boxes = [...store.islands.filter((i) => !i.rects?.some((r) => r.door)).map((i) => i.box!), ...store.rooms.map((r) => r.box)]
    .map(([cx, cz, w, , d]) => ({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 }));
  const [ex0, ex1] = store.exit;
  return (x: number, z: number) => {
    if (x < -W / 2 + RADIUS || x > W / 2 - RADIUS || z < -D / 2 + RADIUS) return true;
    if (z > D / 2 - RADIUS && !(x > ex0 && x < ex1)) return true;   // 入口以外の手前の壁
    if (z > D / 2 + 1) return true;
    return boxes.some((o) => x > o.x0 - RADIUS && x < o.x1 + RADIUS && z > o.z0 - RADIUS && z < o.z1 + RADIUS);
  };
}

/** p から見た pos の方向を時計の文字盤で言う（12 時が正面）。yaw は見ている向き */
export function clockDir(p: Vector3, yaw: number, pos: Vector3) {
  const ang = Math.atan2(pos.x - p.x, -(pos.z - p.z)) + yaw;
  let h = Math.round(((ang / (2 * Math.PI)) * 12 % 12 + 12) % 12);
  if (h === 0) h = 12;
  return { h, d: Math.hypot(pos.x - p.x, pos.z - p.z) };
}
