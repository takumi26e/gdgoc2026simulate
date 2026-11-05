// 案内の経路: 通路の点をつないだ道を、ダイクストラで探す
import { MathUtils, Vector3 } from 'three';
import type { Store } from './store';

export function makeRouter(store: Store, blocked: (x: number, z: number) => boolean) {
  const nodes = store.nodes, adj: Record<string, string[]> = {};
  for (const [a, b] of store.edges) { (adj[a] ??= []).push(b); (adj[b] ??= []).push(a); }
  /** a→b をまっすぐ歩けるか */
  const clearLine = (a: Vector3, b: Vector3) => {
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.1));
    for (let i = 0; i <= n; i++) { const t = i / n; if (blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; }
    return true;
  };
  /** いまの位置から、行き先の点までの点の列。たどり着けなければ null */
  const route = (from: Vector3, goal: string) => {
    const dist: Record<string, number> = {}, prev: Record<string, string> = {}, todo = new Set(Object.keys(nodes));
    for (const k of todo) dist[k] = clearLine(from, nodes[k]) ? from.distanceTo(nodes[k]) : Infinity;
    while (todo.size) {
      let u: string | null = null;
      for (const k of todo) if (u === null || dist[k] < dist[u]) u = k;
      if (u === null || dist[u] === Infinity) break;
      todo.delete(u);
      for (const v of adj[u] ?? []) { const nd = dist[u] + nodes[u].distanceTo(nodes[v]); if (nd < dist[v]) { dist[v] = nd; prev[v] = u; } }
    }
    if (dist[goal] === undefined || dist[goal] === Infinity) return null;
    const path = [goal];
    while (prev[path[0]]) path.unshift(prev[path[0]]);
    return path.map((k) => nodes[k]);
  };
  return { adj, clearLine, route };
}

/** 曲がる点と最後の点だけを残す。まっすぐ通り過ぎる点は鳴らさない */
export function corners(path: Vector3[], from: Vector3) {
  const pts = [from, ...path], out: Vector3[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (i === pts.length - 1) { out.push(pts[i]); break; }
    const a = pts[i].clone().sub(pts[i - 1]).normalize(), b = pts[i + 1].clone().sub(pts[i]).normalize();
    if (a.dot(b) < 0.97) out.push(pts[i]);
  }
  return out;
}

/** 点 p と線分 ab の床の上の距離 */
export function segDist(p: Vector3, a: Vector3, b: Vector3) {
  const ab = b.clone().sub(a).setY(0), ap = new Vector3(p.x - a.x, 0, p.z - a.z);
  const t = MathUtils.clamp(ap.dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
  return a.clone().add(ab.multiplyScalar(t)).setY(0).distanceTo(new Vector3(p.x, 0, p.z));
}
