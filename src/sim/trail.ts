// 音の道の表示と状態。鳴らす処理は audio/engine.ts
import * as THREE from 'three';
import { TRAIL_POINTS } from '../config';
import { link } from '../link';
import { ROADS, planFrom } from '../shop';
import { player, scene } from '../world';

export const trail = {
  plan: null as THREE.Vector3[][] | null, step: 0, next: 0, n: 0, endAt: 0, heldAt: 0, long: false,
  group: new THREE.Group(), marks: [] as THREE.Mesh[],
};
export const trailOn = () => link.state.trailOn;

// 道の線と、いま鳴らす点の印。どちらも当たり判定に入れないので、すり抜けられる
{
  const lineGeo = new THREE.BufferGeometry().setFromPoints(ROADS.flat().map((p) => new THREE.Vector3(p.x, 0.03, p.z)));
  trail.group.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xe02020 })));
  const geo = new THREE.SphereGeometry(0.1, 16, 12), mat = new THREE.MeshBasicMaterial({ color: 0xe02020 });
  for (let k = 0; k < 3 * TRAIL_POINTS; k++) { const m = new THREE.Mesh(geo, mat); m.visible = false; trail.group.add(m); trail.marks.push(m); }
  trail.group.visible = false; scene.add(trail.group);
}

/** 毎フレーム。鳴らしているあいだ、いまの位置から鳴らす点を表示する */
export function updateTrailView() {
  trail.group.visible = trailOn();
  if (!trailOn()) { trail.plan = null; return; }
  const pts = planFrom(player.position).flat();
  trail.marks.forEach((m, k) => { m.visible = k < pts.length; if (m.visible) m.position.copy(pts[k]); });
}
