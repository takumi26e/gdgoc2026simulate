// 手の形: MediaPipe の 21 点の骨格から、指が伸びているかを手首からの距離で決める
export interface Landmark { x: number; y: number; z: number }
export type Gesture = 'none' | 'open' | 'point' | 'fist' | 'other';

/** 指先が第二関節より手首から遠ければ、その指は伸びている */
export function classifyHand(lm: Landmark[]): Gesture {
  const d = (a: number, b: number) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y, lm[a].z - lm[b].z);
  const ext = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([tip, pip]) => d(tip, 0) > d(pip, 0) * 1.1);
  const n = ext.filter(Boolean).length;
  if (n >= 4) return 'open';
  if (ext[0] && n === 1) return 'point';
  if (n === 0) return 'fist';
  return 'other';
}
