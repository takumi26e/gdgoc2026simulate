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

export const snapToRoad = (roads: Road[], q: { x: number; z: number }) => {
  const p = new Vector3(q.x, 0, q.z);
  return roads.map((r) => closestOnRoad(p, r)).reduce((a, b) => (a.distanceTo(p) <= b.distanceTo(p) ? a : b));
};

/**
 * 道の上だけを通って、from から to へ行く点の列（ダイクストラ）。
 * どちらも、いちばん近い道の上の点に寄せる。点は道の端と交差点と、寄せた 2 点
 */
export function roadRoute(roads: Road[], juncs: Vector3[], from: { x: number; z: number }, to: { x: number; z: number }) {
  const a = snapToRoad(roads, from), b = snapToRoad(roads, to);
  const key = (p: Vector3) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`;
  const pts = new Map<string, Vector3>(), adj = new Map<string, { k: string; d: number }[]>();
  for (const r of roads) {
    const on = [r[0], r[1], ...juncs, a, b].filter((p) => closestOnRoad(p, r).distanceTo(p) < 1e-6)
      .sort((p, q) => p.distanceTo(r[0]) - q.distanceTo(r[0]));
    for (let i = 0; i + 1 < on.length; i++) {
      const p = on[i], q = on[i + 1], d = p.distanceTo(q);
      if (d < 1e-6) continue;
      pts.set(key(p), p); pts.set(key(q), q);
      (adj.get(key(p)) ?? adj.set(key(p), []).get(key(p))!).push({ k: key(q), d });
      (adj.get(key(q)) ?? adj.set(key(q), []).get(key(q))!).push({ k: key(p), d });
    }
  }
  const start = key(a), goal = key(b);
  if (start === goal) return [a];
  const dist = new Map([[start, 0]]), prev = new Map<string, string>(), todo = new Set(pts.keys());
  while (todo.size) {
    let u: string | null = null;
    for (const k of todo) if (dist.has(k) && (u === null || dist.get(k)! < dist.get(u)!)) u = k;
    if (u === null) break;
    todo.delete(u);
    if (u === goal) break;
    for (const { k, d } of adj.get(u) ?? []) { const nd = dist.get(u)! + d; if (nd < (dist.get(k) ?? Infinity)) { dist.set(k, nd); prev.set(k, u); } }
  }
  if (!dist.has(goal)) return null;
  const path = [goal];
  while (prev.has(path[0])) path.unshift(prev.get(path[0])!);
  return path.map((k) => pts.get(k)!);
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
