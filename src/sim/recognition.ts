// カメラの認識: スマホの画面と同じ視野に光線を飛ばし、写っている棚と島を決める
import * as THREE from 'three';
import { GRID_X, GRID_Y, NEAR_MARGIN, SEEN_HOLD, VIEW_RANGE } from '../config';
import { closestOn, readable, rectAt } from '../core/geometry';
import type { El, RectEl } from '../core/store';
import { link } from '../link';
import { ISLANDS } from '../shop';
import { ROLE, settings } from '../state';
import { applyView, blockers, markSeen, player, viewCam, world } from '../world';

const ray = new THREE.Raycaster();
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3(), _grid = new THREE.Vector2();
export const recog = { tick: 0 };

// 写りの割合を測る点を、認識する面に約 30cm 間隔で並べる
for (const isl of ISLANDS) for (const r of isl.rects!) {
  r.samples = [];
  const nu = Math.max(1, Math.round(Math.abs(r.span[1] - r.span[0]) / 0.3)), nv = Math.max(1, Math.round((r.y[1] - r.y[0]) / 0.3));
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++)
    r.samples.push(r.g.at(r.span[0] + ((r.span[1] - r.span[0]) * (i + 0.5)) / nu, r.y[0] + ((r.y[1] - r.y[0]) * (j + 0.5)) / nv));
}
/** [こちらを向いた点の数, そのうち画面に入り隠れていない点の数] */
function sampleStats(r: RectEl): [number, number] {
  const s = r.samples!;
  viewCam.getWorldPosition(_o);
  if (_c.subVectors(_o, s[0]).dot(r.g.n) <= 0) return [0, 0];   // 面がカメラに背を向けている
  let inView = 0;
  for (const p of s) {
    _c.copy(p).project(viewCam);
    if (Math.abs(_c.x) > 1 || Math.abs(_c.y) > 1 || _c.z > 1) continue;
    _d.subVectors(p, _o); const dist = _d.length(); _d.normalize();
    if (dist > VIEW_RANGE || !readable(_d.x, _d.z, r.g.n)) continue;
    ray.set(_o, _d); ray.far = dist - 0.01;
    if (!ray.intersectObjects(blockers, false).length) inView++;
  }
  return [s.length, inView];
}

export function recognize() {
  if (ROLE === 'pc' && link.state.viewAspect) world.screenAspect = link.state.viewAspect;
  applyView();
  const hits = new Map<El, { n: number; sum: THREE.Vector3 }>();
  // 薄く写った物が格子のすき間を抜けないよう、毎回半マスずつずらし、4 回で 2 倍の細かさで調べる
  const t = ++recog.tick, px = t & 1 ? 0.75 : 0.25, py = t & 2 ? 0.75 : 0.25;
  for (let i = 0; i < GRID_X; i++) for (let j = 0; j < GRID_Y; j++) {
    _grid.set(((i + px) / GRID_X) * 2 - 1, ((j + py) / GRID_Y) * 2 - 1);
    ray.setFromCamera(_grid, viewCam); ray.far = VIEW_RANGE;
    const h = ray.intersectObjects(blockers, false)[0];
    const isl: El | undefined = h?.object.userData.island;
    if (!h || !isl) continue;
    const r = rectAt(isl, h.face!.normal, h.point);
    if (!r || !readable(ray.ray.direction.x, ray.ray.direction.z, r.g.n)) continue;   // 棚の端や裏、斜めすぎる面は読み取れない
    for (const key of [r, isl]) {
      const c = hits.get(key) ?? { n: 0, sum: new THREE.Vector3() };
      c.n++; c.sum.add(h.point); hits.set(key, c);
    }
  }
  const judge = (el: El, facing: number, inView: number) => {
    const c = hits.get(el), ratio = facing ? inView / facing : 0, cover = c ? c.n / (GRID_X * GRID_Y) : 0;
    el.aimSeen = c ? c.sum.divideScalar(c.n) : null;   // 写っている部分の中心
    // 初期設定（どちらも 0%）では、少しでも写れば認識する
    if ((c || inView > 0) && (ratio >= settings.minRatio || cover >= settings.minCover)) el.seenTick = t;
    const seen = el.seenTick !== undefined && t - el.seenTick < SEEN_HOLD;
    if (seen !== el.seen) markSeen(el, seen);
    el.seen = seen;
  };
  for (const isl of ISLANDS) {
    let F = 0, I = 0;
    for (const r of isl.rects!) {
      const [f, i] = settings.minRatio > 0 ? sampleStats(r) : [0, 0];   // 割合のスライダーが 0% なら計算しない
      F += f; I += i; judge(r, f, i);
    }
    judge(isl, F, I);
  }
}

/** 抽象度は棚（1）と商品（3）の 2 つ。棚までの距離で決める */
export function updateLevels() {
  const p = player.position, near = settings.near;
  for (const isl of ISLANDS) for (const sh of isl.children as RectEl[]) {
    const q = closestOn(sh, p), d = Math.hypot(q.x - p.x, q.z - p.z);
    sh.base = sh.base === 3 ? (d > near + NEAR_MARGIN ? 1 : 3) : d < (sh.base === 1 ? near - NEAR_MARGIN : near) ? 3 : 1;
  }
}

/** 近い棚で鳴らす商品: その棚の商品のうち、画面のまん中にいちばん近いもの */
const _fwd = new THREE.Vector3(), _eye = new THREE.Vector3(), _to = new THREE.Vector3();
export function itemInView(sh: El) {
  viewCam.getWorldDirection(_fwd); viewCam.getWorldPosition(_eye);
  let best: El | null = null, bestDot = -2;
  for (const it of sh.children.flatMap((c) => c.children)) {
    const dot = _to.copy(it.g!.at((it.span![0] + it.span![1]) / 2, (it.y![0] + it.y![1]) / 2)).sub(_eye).normalize().dot(_fwd);
    if (dot > bestDot) { bestDot = dot; best = it; }
  }
  return best;
}
