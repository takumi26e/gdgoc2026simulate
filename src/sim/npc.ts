// 店の中の人（見た目だけ。当たり判定と音はない）。歩く人は PC が動かし、位置をスマホへ送る
import * as THREE from 'three';
import { link } from '../link';
import { NODES, router } from '../shop';
import { scene } from '../world';

// rot は向き（0 で奥の -z、-π/2 で右の +x）
const STAND = [
  { x: -6.4, z: -0.2, rot: -Math.PI / 2, color: 0x2f7d4f },   // レジの店員
  { x: -4.8, z: 0.2, rot: Math.PI / 2, color: 0x8a5a44 },     // レジに並ぶ人（先頭）
  { x: -4.1, z: 0.2, rot: Math.PI / 2, color: 0x5b6c8f },     // レジに並ぶ人（最後尾）
  { x: 4.7, z: -0.5, rot: -Math.PI / 2, color: 0x9b4d6a },    // ドリンクを選ぶ人
  { x: -1.5, z: 3.9, rot: Math.PI, color: 0x6b7a3a },         // 雑誌を読む人
  { x: -6.9, z: 2.4, rot: Math.PI / 2, color: 0x7a5c99 },     // ATM を使う人
];
const WALK_COLORS = [0x3d6fb0, 0xb07a3d, 0x4f8f8a], SPEED = [0.7, 1.1];   // 歩く人の色（人数）、速さ(m/s)の範囲

function makePerson(color: number) {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 4, 12), new THREE.MeshLambertMaterial({ color }));
  torso.position.y = 0.85; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshLambertMaterial({ color: 0xe8c8a8 }));
  head.position.y = 1.6; g.add(head);
  scene.add(g);
  return g;
}
for (const s of STAND) { const g = makePerson(s.color); g.position.set(s.x, 0, s.z); g.rotation.y = s.rot; }

const next = router.adj, keys = Object.keys(next);
export const walkers = WALK_COLORS.map((color, k) => {
  const from = keys[(k * 7 + 3) % keys.length];
  const w = { g: makePerson(color), from, to: next[from][0], t: 0, wait: 0, speed: SPEED[0] };
  w.g.position.copy(NODES[from]);
  return w;
});

/** PC: 通路の点から点へ歩く。行き止まりでなければ来た道は戻らず、ときどき立ち止まる */
export function updateWalkers(dt: number) {
  for (const w of walkers) {
    if (w.wait > 0) { w.wait -= dt; continue; }
    const a = NODES[w.from], b = NODES[w.to];
    w.t += (w.speed * dt) / Math.max(a.distanceTo(b), 0.01);
    if (w.t >= 1) {
      const ahead = next[w.to].filter((n) => n !== w.from), choices = ahead.length ? ahead : next[w.to];
      w.from = w.to; w.to = choices[Math.floor(Math.random() * choices.length)];
      w.t = 0; w.speed = SPEED[0] + Math.random() * (SPEED[1] - SPEED[0]);
      if (Math.random() < 0.3) w.wait = 1 + Math.random() * 3;
      continue;
    }
    w.g.position.lerpVectors(a, b, w.t);
    w.g.rotation.y = Math.atan2(-(b.x - a.x), -(b.z - a.z));
  }
}
export const walkerState = () => walkers.map((w) => [+w.g.position.x.toFixed(2), +w.g.position.z.toFixed(2), +w.g.rotation.y.toFixed(2)]);
/** スマホ: PC から届いた位置をなめらかに追う */
export function followWalkers(k: number) {
  const s = link.state.npcs; if (!s) return;
  walkers.forEach((w, i) => {
    if (!s[i]) return;
    w.g.position.x += (s[i][0] - w.g.position.x) * k; w.g.position.z += (s[i][1] - w.g.position.z) * k;
    const a = s[i][2] - w.g.rotation.y; w.g.rotation.y += Math.atan2(Math.sin(a), Math.cos(a)) * k;
  });
}
