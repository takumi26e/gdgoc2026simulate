// 人の検知: カメラに写った人の骨格（MediaPipe Pose の 33 点）から、方向と距離を推定し、人ごとに追いかける。
// 座標は店のシーンと同じ: 床の上の x（右が +）と z（奥が -）。自分は原点、yaw は見ている向き（左回りが +）
export interface Landmark { x: number; y: number; z?: number; visibility?: number }
/** カメラ: 映像の大きさ(px)、横の画角(°)、鏡写しか（前面カメラ） */
export interface Camera { width: number; height: number; hfovDeg: number; mirrored: boolean }

// 体の長さの目安(m)。写った長さとの比で距離を出す
export const BODY = { full: 1.45, torso: 0.5, shoulders: 0.38, ears: 0.15 };
const L = { nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lHip: 23, rHip: 24, lAnk: 27, rAnk: 28 };

export interface Person { azimuth: number; distance: number; method: keyof typeof BODY; box: [number, number, number, number] }

/** 1 人の骨格から、正面からの角度（右が +、ラジアン）と距離(m) */
export function personFromPose(lm: Landmark[], cam: Camera): Person | null {
  const f = cam.width / 2 / Math.tan((cam.hfovDeg * Math.PI) / 360);   // 焦点距離(px)
  const ok = (i: number) => !!lm[i] && (lm[i].visibility ?? 1) > 0.5 && lm[i].x >= 0 && lm[i].x <= 1 && lm[i].y >= 0 && lm[i].y <= 1;
  const px = (i: number) => ({ x: lm[i].x * cam.width, y: lm[i].y * cam.height });
  const mid = (a: number, b: number) => { const p = px(a), q = px(b); return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; };
  const len = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

  // 長さの測り方: 全身 → 胴 → 肩幅 → 耳の間、の順に、写っているもので
  let method: keyof typeof BODY | null = null, size = 0;
  if (ok(L.nose) && ok(L.lAnk) && ok(L.rAnk)) { method = 'full'; size = Math.abs(mid(L.lAnk, L.rAnk).y - px(L.nose).y); }
  else if (ok(L.lSh) && ok(L.rSh) && ok(L.lHip) && ok(L.rHip)) { method = 'torso'; size = len(mid(L.lSh, L.rSh), mid(L.lHip, L.rHip)); }
  else if (ok(L.lSh) && ok(L.rSh)) { method = 'shoulders'; size = len(px(L.lSh), px(L.rSh)); }
  else if (ok(L.lEar) && ok(L.rEar)) { method = 'ears'; size = len(px(L.lEar), px(L.rEar)); }
  if (!method || size < 4) return null;

  const c = ok(L.lSh) && ok(L.rSh) ? mid(L.lSh, L.rSh) : ok(L.lHip) && ok(L.rHip) ? mid(L.lHip, L.rHip) : ok(L.nose) ? px(L.nose) : null;
  if (!c) return null;
  const az = Math.atan((c.x - cam.width / 2) / f) * (cam.mirrored ? -1 : 1);
  const distance = Math.min(15, Math.max(0.3, (BODY[method] * f) / size));
  const xs = lm.filter((_, i) => ok(i)).map((p) => p.x * cam.width), ys = lm.filter((_, i) => ok(i)).map((p) => p.y * cam.height);
  return { azimuth: az, distance, method, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/** 見ている向き yaw から、右へ azimuth の方向に distance 先の、床の上の点 */
export function toWorld(yaw: number, azimuth: number, distance: number) {
  const a = yaw - azimuth;   // 右へ回ると、yaw は減る
  return { x: -Math.sin(a) * distance, z: -Math.cos(a) * distance };
}

export interface Track { id: number; x: number; z: number; vx: number; vz: number; seenAt: number; firstAt: number; seen: boolean }
export const TRACK = {
  gate: 1.2,      // 同じ人とみなす距離(m)
  hold: 1.5,      // 見えなくなってから予測で鳴らし続ける時間(秒)
  maxSpeed: 2,    // 予測に使う速さの上限(m/s)
  smooth: 0.5,    // 位置をならす割合（1 でならさない）
};

/** 予測した位置（見えていなければ、最後の位置から速さで進める） */
export function predicted(t: Track, now: number) {
  const dt = Math.min(now - t.seenAt, TRACK.hold);
  return { x: t.x + t.vx * dt, z: t.z + t.vz * dt };
}

/** 新しく見えた人（床の上の点）を、今までの人に割り当てる。見えない人は予測にし、長く見えなければ消す */
export function updateTracks(tracks: Track[], seen: { x: number; z: number }[], now: number, nextId: () => number): Track[] {
  const free = new Set(tracks);
  for (const t of tracks) t.seen = false;
  // 近い組から順に割り当てる
  const pairs = seen.flatMap((s, i) => tracks.map((t) => { const p = predicted(t, now); return { i, t, d: Math.hypot(p.x - s.x, p.z - s.z) }; }))
    .filter((p) => p.d < TRACK.gate).sort((a, b) => a.d - b.d);
  const used = new Set<number>();
  for (const { i, t } of pairs) {
    if (used.has(i) || !free.has(t)) continue;
    used.add(i); free.delete(t);
    const s = seen[i], dt = Math.max(now - t.seenAt, 1e-3), k = TRACK.smooth;
    const nx = t.x + (s.x - t.x) * k, nz = t.z + (s.z - t.z) * k;
    const clamp = (v: number) => Math.max(-TRACK.maxSpeed, Math.min(TRACK.maxSpeed, v));
    t.vx = t.vx * 0.6 + clamp((nx - t.x) / dt) * 0.4; t.vz = t.vz * 0.6 + clamp((nz - t.z) / dt) * 0.4;
    t.x = nx; t.z = nz; t.seenAt = now; t.seen = true;
  }
  const out = tracks.filter((t) => t.seen || now - t.seenAt <= TRACK.hold);
  seen.forEach((s, i) => { if (!used.has(i)) out.push({ id: nextId(), x: s.x, z: s.z, vx: 0, vz: 0, seenAt: now, firstAt: now, seen: true }); });
  return out;
}

/** 近づいてくる人が、自分のどちら側を、どれだけ離れて、何秒後に通りそうか（近づいていなければ null） */
export function passing(t: Track, yaw: number, now: number) {
  const p = predicted(t, now), v2 = t.vx * t.vx + t.vz * t.vz;
  if (v2 < 0.05) return null;
  const tt = -(p.x * t.vx + p.z * t.vz) / v2;   // いちばん近づくまでの時間
  if (tt <= 0 || tt > 6) return null;
  const cx = p.x + t.vx * tt, cz = p.z + t.vz * tt, right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  return { side: cx * right.x + cz * right.z >= 0 ? '右' : '左', gap: Math.hypot(cx, cz), inSec: tt };
}
