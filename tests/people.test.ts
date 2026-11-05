// 人の検知の計算: 骨格から方向と距離、人の追跡、視野から出たあとの予測、すれ違う側
import { describe, expect, it } from 'vitest';
import { BODY, TRACK, passing, personFromPose, predicted, toWorld, updateTracks, type Camera, type Landmark, type Track } from '../src/core/people';

const cam: Camera = { width: 640, height: 480, hfovDeg: 60, mirrored: false };
const f = cam.width / 2 / Math.tan(Math.PI / 6);
// 正面から右へ az(°)、距離 d(m) に立つ人の骨格（画面の中の位置と大きさだけを合わせる）
function pose(azDeg: number, d: number, parts: 'full' | 'upper' = 'full'): Landmark[] {
  const cx = (cam.width / 2 + Math.tan((azDeg * Math.PI) / 180) * f) / cam.width;
  const ppm = f / d / cam.height;   // 1m が画面の高さの何割か
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: cx, y: 0.5, visibility: 0 }));
  const set = (i: number, dx: number, y: number) => { lm[i] = { x: cx + (dx * ppm * cam.height) / cam.width, y: 0.5 + y * ppm, visibility: 0.9 }; };
  set(0, 0, -0.75);                                   // 鼻
  set(7, -BODY.ears / 2, -0.75); set(8, BODY.ears / 2, -0.75);
  set(11, -BODY.shoulders / 2, -0.55); set(12, BODY.shoulders / 2, -0.55);
  set(23, -0.15, -0.05); set(24, 0.15, -0.05);         // 肩から腰まで 0.5m
  if (parts === 'full') { set(27, -0.1, 0.7); set(28, 0.1, 0.7); }   // 鼻から足首まで 1.45m
  return lm;
}

describe('骨格から方向と距離', () => {
  it('全身が写れば全身の長さで測る', () => {
    const p = personFromPose(pose(0, 4), cam)!;
    expect(p.method).toBe('full');
    expect(p.distance).toBeCloseTo(4, 1);
    expect(p.azimuth).toBeCloseTo(0, 3);
  });
  it('足が写らないときは胴で測る', () => {
    const p = personFromPose(pose(20, 1.5, 'upper'), cam)!;
    expect(p.method).toBe('torso');
    expect(p.distance).toBeCloseTo(1.5, 1);
    expect((p.azimuth * 180) / Math.PI).toBeCloseTo(20, 0);
  });
  it('前面カメラ（鏡写し）は左右を戻す', () => {
    const p = personFromPose(pose(20, 2), { ...cam, mirrored: true })!;
    expect((p.azimuth * 180) / Math.PI).toBeCloseTo(-20, 0);
  });
  it('点が足りなければ人にしない', () => {
    expect(personFromPose(Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 })), cam)).toBeNull();
  });
});

describe('床の上の位置', () => {
  it('正面は -z、右は +x。首を振っても世界の同じ点になる', () => {
    const a = toWorld(0, 0, 2), b = toWorld(0, Math.PI / 2, 2);
    expect(a.x).toBeCloseTo(0); expect(a.z).toBeCloseTo(-2);
    expect(b.x).toBeCloseTo(2); expect(b.z).toBeCloseTo(0);
    // 左へ 30° 向いた状態で、右 30° に見える人は、正面にいる
    const c = toWorld(Math.PI / 6, Math.PI / 6, 2);
    expect(c.x).toBeCloseTo(0); expect(c.z).toBeCloseTo(-2);
  });
});

describe('人の追跡とすれ違い', () => {
  let id = 1;
  const next = () => id++;
  it('同じ人を同じ番号で追い、速さを測る', () => {
    let tr: Track[] = [];
    for (let k = 0; k <= 10; k++) tr = updateTracks(tr, [{ x: 0.5, z: -4 + k * 0.1 }], k * 0.1, next);   // 1m/s で近づく
    expect(tr.length).toBe(1);
    expect(tr[0].vz).toBeGreaterThan(0.6);
  });
  it('視野から出たら予測で進め、長く見えなければ消す', () => {
    let tr: Track[] = [];
    for (let k = 0; k <= 10; k++) tr = updateTracks(tr, [{ x: 0.5, z: -3 + k * 0.1 }], k * 0.1, next);
    const t = tr[0], z0 = t.z;
    tr = updateTracks(tr, [], 1.6, next);   // 0.6 秒見えない
    expect(tr.length).toBe(1);
    expect(predicted(tr[0], 1.6).z).toBeGreaterThan(z0 + 0.3);
    tr = updateTracks(tr, [], 1 + TRACK.hold + 0.1, next);
    expect(tr.length).toBe(0);
  });
  it('右寄りを近づいてくる人は、右側を通る', () => {
    let tr: Track[] = [];
    for (let k = 0; k <= 10; k++) tr = updateTracks(tr, [{ x: 0.5, z: -4 + k * 0.1 }], k * 0.1, next);
    const p = passing(tr[0], 0, 1)!;
    expect(p.side).toBe('右');
    expect(p.gap).toBeLessThan(0.8);
  });
  it('2 人を取り違えない', () => {
    let tr: Track[] = [];
    for (let k = 0; k <= 5; k++) tr = updateTracks(tr, [{ x: -1, z: -3 }, { x: 1.2, z: -2 + k * 0.05 }], k * 0.1, next);
    expect(tr.length).toBe(2);
    const ids = tr.map((t) => t.id);
    tr = updateTracks(tr, [{ x: 1.2, z: -1.7 }, { x: -1, z: -3 }], 0.6, next);
    expect(tr.map((t) => t.id).sort()).toEqual(ids.sort());
  });
});
