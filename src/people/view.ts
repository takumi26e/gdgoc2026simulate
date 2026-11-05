// 人の検知の表示: 映像に重ねる骨格と距離、上から見た図（自分を中心に、上が見ている向き）
import { passing, predicted, type Landmark, type Person, type Track } from '../core/people';

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [0, 11], [0, 12]];
const METHOD_JA = { full: '全身', torso: '胴', shoulders: '肩幅', ears: '頭' };

/** 映像の上に骨格と距離を描く。canvas は映像と同じ大きさで重ねる */
export function drawOverlay(cv: HTMLCanvasElement, video: HTMLVideoElement, poses: Landmark[][], people: (Person | null)[], mirrored: boolean) {
  const r = video.getBoundingClientRect(), dpr = devicePixelRatio;
  if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
  // object-fit: cover で切り取られた分を考えて、映像の座標を画面の座標へ
  const s = Math.max(r.width / video.videoWidth, r.height / video.videoHeight), ox = (r.width - video.videoWidth * s) / 2, oy = (r.height - video.videoHeight * s) / 2;
  const X = (x: number) => { const v = ox + x * video.videoWidth * s; return mirrored ? r.width - v : v; }, Y = (y: number) => oy + y * video.videoHeight * s;
  poses.forEach((lm, k) => {
    g.strokeStyle = '#ffd34d'; g.lineWidth = 3;
    for (const [a, b] of BONES) {
      if ((lm[a].visibility ?? 1) < 0.5 || (lm[b].visibility ?? 1) < 0.5) continue;
      g.beginPath(); g.moveTo(X(lm[a].x), Y(lm[a].y)); g.lineTo(X(lm[b].x), Y(lm[b].y)); g.stroke();
    }
    const p = people[k]; if (!p) return;
    const label = `${p.distance.toFixed(1)}m（${METHOD_JA[p.method]}）`;
    g.font = '700 16px system-ui, sans-serif';
    const x = X((lm[11].x + lm[12].x) / 2), y = Y(Math.min(lm[11].y, lm[12].y)) - 14, w = g.measureText(label).width + 12;
    g.fillStyle = 'rgba(20,23,28,.75)'; g.fillRect(x - w / 2, y - 18, w, 24);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(label, x, y);
  });
}

/** 上から見た図。自分は真ん中、上が見ている向き。見えている人は塗り、予測の人は輪、線はこの先 1 秒の動き */
export function drawRadar(cv: HTMLCanvasElement, tracks: Track[], yaw: number, now: number, hfovDeg: number) {
  const size = cv.clientWidth, dpr = devicePixelRatio, R = size / 2, scale = R / 6;   // 半径 6m
  if (cv.width !== Math.round(size * dpr)) { cv.width = cv.height = Math.round(size * dpr); }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, size, size);
  g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(20,23,28,.12)';
  for (const m of [1, 2, 4]) { g.beginPath(); g.arc(R, R, m * scale, 0, Math.PI * 2); g.stroke(); }
  // カメラの視野
  const half = (hfovDeg * Math.PI) / 360;
  g.fillStyle = 'rgba(31,58,104,.10)'; g.beginPath(); g.moveTo(R, R); g.arc(R, R, R, -Math.PI / 2 - half, -Math.PI / 2 + half); g.fill();
  // 床の点を、見ている向きが上になるように回す
  const toScreen = (x: number, z: number) => {
    const c = Math.cos(yaw), s = Math.sin(yaw), rx = x * c - z * s, rz = x * s + z * c;
    return { x: R + rx * scale, y: R + rz * scale };
  };
  for (const t of tracks) {
    const p = predicted(t, now), a = toScreen(p.x, p.z), b = toScreen(p.x + t.vx, p.z + t.vz);
    g.strokeStyle = '#c98a00'; g.lineWidth = 2; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    g.beginPath(); g.arc(a.x, a.y, 7, 0, Math.PI * 2);
    if (t.seen) { g.fillStyle = '#1f3a68'; g.fill(); } else { g.strokeStyle = '#1f3a68'; g.stroke(); }
  }
  g.fillStyle = '#c98a00'; g.beginPath(); g.moveTo(R, R - 9); g.lineTo(R - 6, R + 6); g.lineTo(R + 6, R + 6); g.closePath(); g.fill();   // 自分
}

/** 文の説明: 近い順に、方向・距離と、すれ違いそうなら側 */
export function describe(tracks: Track[], yaw: number, now: number) {
  if (!tracks.length) return '人は見えていません';
  return tracks.map((t) => {
    const p = predicted(t, now), a = Math.atan2(p.x, -p.z) + yaw;
    let h = Math.round(((a / (2 * Math.PI)) * 12 % 12 + 12) % 12); if (h === 0) h = 12;
    const ps = passing(t, yaw, now), d = Math.hypot(p.x, p.z);
    return { d, text: `${h}時・${d.toFixed(1)}m${t.seen ? '' : '（予測）'}${ps && ps.gap < 1.5 ? `・${ps.side}側を通りそう` : ''}` };
  }).sort((a, b) => a.d - b.d).map((x) => x.text).join('　');
}
