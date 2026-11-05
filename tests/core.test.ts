// ブラウザなしで確かめられる計算（店のデータ、通路、音の道、手の形、HRTF の選び方）
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { clockDir, closestOn, makeBlocked, readable } from '../src/core/geometry';
import { classifyHand, type Landmark } from '../src/core/gesture';
import { makeKemar, type KemarData } from '../src/core/kemar';
import { buildRoads, junctions, roadPlan } from '../src/core/roads';
import { corners, makeRouter } from '../src/core/route';
import { buildStore, type RectEl, type StoreData } from '../src/core/store';
import kemarData from '../src/data/kemar.json';
import sounds from '../src/data/sounds.json';
import storeData from '../src/data/store.json';

const store = buildStore(storeData as unknown as StoreData);
const blocked = makeBlocked(store), router = makeRouter(store, blocked), N = store.nodes;
const START = new Vector3(-4.9, 0, 4.2);

describe('店のデータ', () => {
  it('島・棚・カテゴリ・商品と、案内の言葉に音声がある', () => {
    const missing = [...store.all.map((e) => e.name), ...store.islands.flatMap((i) => [`${i.name}に着きました`, `${i.name}へ案内します`]), ...store.phrases]
      .filter((n) => !(n in sounds));
    expect(missing).toEqual([]);
  });
  it('棚の面は箱の外側にある', () => {
    for (const isl of store.islands) for (const r of isl.rects!) {
      const p = r.g.at((r.span[0] + r.span[1]) / 2, 1), [cx, cz, w, , d] = isl.box!;
      expect(Math.abs(p.x - cx) > w / 2 || Math.abs(p.z - cz) > d / 2).toBe(true);
    }
  });
});

describe('通路と案内', () => {
  it('通路の点どうしは棚に当たらない', () => {
    for (const [a, b] of store.edges) expect(router.clearLine(N[a], N[b]), `${a}-${b}`).toBe(true);
  });
  it('入口からすべての島へ行ける', () => {
    for (const isl of store.islands) expect(router.route(START, isl.approach!), isl.name).not.toBeNull();
  });
  it('曲がる点だけを残す', () => {
    const c = corners([N.F1, N.CAFE, N.L2, N.M23], START);
    expect(c.length).toBe(3);
    expect(c[1]).toBe(N.L2);
  });
});

describe('音の道', () => {
  const roads = buildRoads(N), juncs = junctions(roads), plan = (x: number, z: number) => roadPlan(roads, juncs, { x, z });
  it('道は棚に当たらない', () => {
    for (const [a, b] of roads) for (let k = 0; k <= 20; k++) { const q = a.clone().lerp(b, k / 20); expect(blocked(q.x, q.z)).toBe(false); }
  });
  it('交差点は 8 つ', () => expect(juncs.length).toBe(8));
  it('辺は 2 方向、角は 2 方向、T 字路は 3 方向、道の端は 1 方向', () => {
    expect(plan(0, -3.8).length).toBe(2);
    expect(plan(N.L0.x, N.L0.z).length).toBe(2);
    expect(plan(N.L1.x, N.L1.z).length).toBe(3);
    expect(plan(N.F1.x, N.F1.z).length).toBe(3);
    expect(plan(-6.6, N.F1.z).length).toBe(1);
  });
  it('交差点の 0.5m 手前でも交差点として扱う', () => expect(plan(N.L1.x, N.L1.z + 0.35).length).toBe(3));
  it('点は 1m 間隔で最大 5 点、高さ 1m', () => {
    for (const pts of plan(0, -3.8)) {
      expect(pts.length).toBeLessThanOrEqual(5);
      pts.forEach((q, i) => { expect(q.y).toBe(1); if (i) expect(q.distanceTo(pts[i - 1])).toBeCloseTo(1); });
    }
  });
  it('方向は右、左、奥、手前の順', () => {
    const p = plan(N.L1.x, N.L1.z), o = new Vector3(N.L1.x, 1, N.L1.z);
    expect(p.map((pts) => pts[0].clone().sub(o).round().toArray().join(','))).toEqual(['1,0,0', '0,0,-1', '0,0,1']);
  });
});

describe('見え方と方向', () => {
  it('正面から 70° までは読み取れ、それより斜めは読み取れない', () => {
    const n = new Vector3(0, 0, 1), at = (deg: number) => readable(Math.sin(deg * Math.PI / 180), -Math.cos(deg * Math.PI / 180), n);
    expect(at(0)).toBe(true); expect(at(65)).toBe(true); expect(at(75)).toBe(false); expect(at(180)).toBe(false);
  });
  it('棚の面のいちばん近い点', () => {
    const sh = store.islands[0].children[0] as RectEl, q = closestOn(sh, { x: -100, z: 0 });
    expect(q.x).toBeCloseTo(Math.min(...sh.span));
  });
  it('時計の文字盤で方向を言う', () => {
    expect(clockDir(START, 0, START.clone().setZ(0)).h).toBe(12);
    expect(clockDir(START, 0, START.clone().setX(0)).h).toBe(3);
  });
});

describe('手の形', () => {
  // 手首(0)から真上に指を並べた手で確かめる
  const mk = (ext: number[]) => {
    const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
    [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]].forEach((f, k) => f.forEach((j, n) => {
      lm[j] = { x: k * 0.05, y: -(0.1 + (ext[k] ? n * 0.05 : ([0.04, 0.02, 0.01][n - 1] ?? 0))), z: 0 };
    }));
    return lm;
  };
  it('パー・指さし・グー', () => {
    expect(classifyHand(mk([1, 1, 1, 1]))).toBe('open');
    expect(classifyHand(mk([1, 0, 0, 0]))).toBe('point');
    expect(classifyHand(mk([0, 0, 0, 0]))).toBe('fist');
  });
});

describe('KEMAR', () => {
  const k = makeKemar(kemarData as KemarData);
  it('右 90° はそのまま、左 90° は左右を入れ替える', () => {
    const r = k.pick(90, 0), l = k.pick(-90, 0);
    expect([r.az, r.mirror, l.az, l.mirror]).toEqual([90, false, 90, true]);
  });
});
