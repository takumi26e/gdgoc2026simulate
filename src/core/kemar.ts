// MIT KEMAR の HRIR（44.1kHz、128 タップ、ステレオ int16）。方位は 0〜180° だけなので、左は左右の耳を入れ替える
export interface KemarData { rate: number; taps: number; pos: [el: number, az: number][]; pcm: string }

export function makeKemar(data: KemarData) {
  const byEl: Record<number, { az: number; i: number }[]> = {};
  data.pos.forEach(([el, az], i) => (byEl[el] ??= []).push({ az, i }));
  const els = Object.keys(byEl).map(Number).sort((a, b) => a - b);
  const pcm = new Int16Array(Uint8Array.from(atob(data.pcm), (c) => c.charCodeAt(0)).buffer);
  /** azDeg: 正面 0・右が正（-180〜180）、elDeg: 仰角 */
  const pick = (azDeg: number, elDeg: number) => {
    const el = els.reduce((b, e) => (Math.abs(e - elDeg) < Math.abs(b - elDeg) ? e : b));
    const a = Math.abs(azDeg);
    const hit = byEl[el].reduce((b, p) => (Math.abs(p.az - a) < Math.abs(b.az - a) ? p : b));
    return { i: hit.i, mirror: azDeg < 0 && hit.az !== 0 && hit.az !== 180, el, az: hit.az };
  };
  /** 正面の応答の大きさを 1 にする係数（ほかの方式と音量を合わせる） */
  const norm = (() => {
    const { i } = pick(0, 0);
    let e = 0;
    for (let t = 0; t < data.taps * 2; t++) e += (pcm[i * data.taps * 2 + t] / 32768) ** 2;
    return 1 / Math.sqrt(e / 2);
  })();
  return { rate: data.rate, taps: data.taps, pcm, pick, norm };
}
export type Kemar = ReturnType<typeof makeKemar>;
