// 音の道: 通路を横 4 本と縦 2 本の道として定義し、いまいる所から行ける方向の点の列を作る
import { MathUtils, Vector3 } from 'three';
import { TRAIL_JUNCTION, TRAIL_POINTS, TRAIL_STEP, TRAIL_Y } from '../config';

export type Road = [Vector3, Vector3];

/** 手前の道は、左の縦の道より左（ATM の前）まで延びる */
export function buildRoads(n: Record<string, Vector3>): Road[] {
  return [
    [new Vector3(-6.6, 0, n.F1.z), n.FR], [n.L0, n.R0], [n.L1, n.R1], [n.L2, n.R2],
    [n.L0, n.F1], [n.R0, n.FR],
  ];
}

export function closestOnRoad(q: { x: number; z: number }, [a, b]: Road) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const k = MathUtils.clamp(((q.x - a.x) * dx + (q.z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
  return new Vector3(a.x + dx * k, 0, a.z + dz * k);
}

/** 横の道と縦の道が交わる点 */
export function junctions(roads: Road[]) {
  const out: Vector3[] = [];
  for (const r of roads.filter((r) => r[0].z === r[1].z)) for (const c of roads.filter((r) => r[0].x === r[1].x)) {
    const j = new Vector3(c[0].x, 0, r[0].z);
    if (closestOnRoad(j, r).distanceTo(j) < 1e-6 && closestOnRoad(j, c).distanceTo(j) < 1e-6) out.push(j);
  }
  return out;
}

/**
 * from からいちばん近い道の点を起点に、行ける方向ごとの点の列を返す。交差点も通り抜けて進む。
 * 方向は右、左、奥、手前の順に並べる（同じ向きに、なるべく同じ音を当てるため）
 */
export function roadPlan(roads: Road[], juncs: Vector3[], from: { x: number; z: number }) {
  const q = new Vector3(from.x, 0, from.z);
  const near = roads.map((r) => closestOnRoad(q, r)).reduce((a, b) => (a.distanceTo(q) <= b.distanceTo(q) ? a : b));
  const origin = juncs.find((j) => j.distanceTo(near) <= TRAIL_JUNCTION) ?? near;
  const plan: Vector3[][] = [];
  for (const r of roads) {
    if (closestOnRoad(origin, r).distanceTo(origin) > 1e-6) continue;
    for (const end of r) {
      const len = origin.distanceTo(end);
      if (len < 0.01) continue;   // 道の端には、その先がない
      const pts: Vector3[] = [];
      for (let k = 1; k <= TRAIL_POINTS && k * TRAIL_STEP <= len; k++) pts.push(origin.clone().lerp(end, (k * TRAIL_STEP) / len).setY(TRAIL_Y));
      if (!pts.length) pts.push(end.clone().setY(TRAIL_Y));   // 端まで 1m もないときは、端の 1 点だけ
      plan.push(pts);
    }
  }
  const rank = (pts: Vector3[]) => {
    const dx = pts[0].x - origin.x, dz = pts[0].z - origin.z;
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 0 : 1) : dz < 0 ? 2 : 3;
  };
  return plan.sort((a, b) => rank(a) - rank(b));
}
