// 人の検知の音: 人ごとに、その方向からピコピコを鳴らす。近いほど速く、予測で鳴らしているあいだは小さく
import { ResonanceAudio, type Source } from 'resonance-audio';
import { predicted, type Track } from '../core/people';

export type Mode = 'resonance' | 'browser';
const EAR_Y = 1.6, REF = 1, ROLLOFF = 1.3, LOOK = 0.12;
/** 鳴らす間隔(秒): 近いほど短く */
export const beepInterval = (d: number) => Math.min(1.0, Math.max(0.15, 0.1 + 0.2 * d));

interface Voice { gate: GainNode; ra: Source; panner: PannerNode; next: number }
const state = { ctx: null as AudioContext | null, ra: null as ResonanceAudio | null, mode: 'resonance' as Mode, out: {} as Record<Mode, GainNode>, tick: null as AudioBuffer | null };
const voices = new Map<number, Voice>();

function makeTick(ctx: AudioContext) {   // 「ピコ」: 短く澄んだ音。方向が分かるよう、弱い倍音を足す
  const rate = ctx.sampleRate, len = Math.round(rate * 0.09), b = ctx.createBuffer(1, len, rate), d = b.getChannelData(0);
  for (let t = 0; t < len; t++) {
    const s = t / rate, env = Math.min(1, s / 0.004) * Math.exp(-s / 0.025) * Math.min(1, (len - t) / (rate * 0.005));
    d[t] = 0.45 * env * (Math.sin(2 * Math.PI * 1320 * s) + 0.25 * Math.sin(2 * Math.PI * 2640 * s));
  }
  return b;
}

export async function startAudio() {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.resume();
  const limiter = new DynamicsCompressorNode(ctx, { threshold: -6, knee: 6, ratio: 12, attack: 0.003, release: 0.15 });
  limiter.connect(ctx.destination);
  for (const m of ['resonance', 'browser'] as Mode[]) { state.out[m] = new GainNode(ctx, { gain: m === state.mode ? 1 : 0 }); state.out[m].connect(limiter); }
  state.ra = new ResonanceAudio(ctx, { ambisonicOrder: 3 });
  state.ra.output.connect(state.out.resonance);
  state.tick = makeTick(ctx);
  state.ctx = ctx;
  // iPhone は画面を消すなどすると音を止めるので、戻ったときや触れたときに鳴らし直す
  const wake = () => { if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {}); };
  addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  addEventListener('pointerdown', wake, true);
}
export const audioReady = () => state.ctx?.state === 'running';
export function setMode(m: Mode) {
  state.mode = m;
  const ctx = state.ctx; if (!ctx) return;
  for (const k of Object.keys(state.out) as Mode[]) state.out[k].gain.setTargetAtTime(k === m ? 1 : 0, ctx.currentTime, 0.03);
}

function voiceFor(id: number) {
  let v = voices.get(id);
  if (v) return v;
  const ctx = state.ctx!, gate = new GainNode(ctx, { gain: 0 });
  const ra = state.ra!.createSource({ rolloff: 'logarithmic', minDistance: REF, maxDistance: 30 });
  const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: REF, rolloffFactor: ROLLOFF, maxDistance: 30 });
  gate.connect(ra.input); gate.connect(panner).connect(state.out.browser);
  v = { gate, ra, panner, next: ctx.currentTime + 0.05 };
  voices.set(id, v);
  return v;
}

/** 毎フレーム: 聞く人の向きを合わせ、人ごとに位置を動かして、次のピコを予約する */
export function updateAudio(tracks: Track[], yaw: number, now: number) {
  const ctx = state.ctx; if (!ctx || ctx.state !== 'running' || !state.ra) return;
  const t = ctx.currentTime, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  state.ra.setListenerOrientation(fx, 0, fz, 0, 1, 0);
  const L = ctx.listener;
  if (L.forwardX) { L.positionX.value = 0; L.positionY.value = EAR_Y; L.positionZ.value = 0; L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  else { L.setPosition(0, EAR_Y, 0); L.setOrientation(fx, 0, fz, 0, 1, 0); }
  const alive = new Set(tracks.map((tr) => tr.id));
  for (const [id, v] of voices) if (!alive.has(id)) { v.gate.gain.setTargetAtTime(0, t, 0.05); voices.delete(id); setTimeout(() => { v.gate.disconnect(); }, 500); }
  for (const tr of tracks) {
    const v = voiceFor(tr.id), p = predicted(tr, now), d = Math.hypot(p.x, p.z);
    v.ra.setPosition(p.x, 0, p.z);   // Resonance は聞く人の高さを 0 とみなす（部屋は使わない）
    v.panner.positionX.setTargetAtTime(p.x, t, 0.03); v.panner.positionY.setTargetAtTime(EAR_Y, t, 0.03); v.panner.positionZ.setTargetAtTime(p.z, t, 0.03);
    v.gate.gain.setTargetAtTime(tr.seen ? 1 : 0.45, t, 0.05);   // 見えていない（予測の）あいだは小さく
    while (v.next < t + LOOK) {
      const s = new AudioBufferSourceNode(ctx, { buffer: state.tick });
      s.connect(v.gate); s.start(Math.max(v.next, t + 0.01));
      v.next = Math.max(v.next, t) + beepInterval(d);
    }
  }
}
