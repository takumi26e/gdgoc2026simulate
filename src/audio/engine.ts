// 音: 同時に鳴らす音（ボイス）を用意し、選んだ物を割り当てて、頭の向きに合わせて立体音響で鳴らす。
// 各ボイス: 声 → ゲート ┬→ Resonance Audio ─────────→ 方式A ┐
//                        ├→ 距離 → 空気 → KEMAR HRIR → 方式B ├→ リミッタ → 出力
//                        │        └→ 部屋の残響 ──────→ 方式B │
//                        └→ PannerNode(HRTF) ─────────→ 方式C ┘
// 選んでいる方式の経路だけをつなぎ、負荷を抑える
import * as THREE from 'three';
import { ResonanceAudio, type Source } from 'resonance-audio';
import { D, GAP, H, HEAR_MAX, HOLD_SEC, MODES, NAVY, REF, REVERB_SEND, ROLLOFF, TRAIL_GAIN, TRAIL_LOOK, TRAIL_PAUSE, TRAIL_VOICES, W, type Mode } from '../config';
import { announce } from '../dom';
import { headYaw, link, linkSend, report } from '../link';
import { navHooks } from '../sim/nav';
import { trail } from '../sim/trail';
import { SOUND_FILES, kemar, planFrom } from '../shop';
import { settings } from '../state';
import { head, player, scene } from '../world';
import { wanted, type Want } from './select';

export interface Voice {
  item: Want | null; next: number; srcs: AudioBufferSourceNode[]; pos: THREE.Vector3; played: boolean;
  kKey: number; kActive: number; ringAt: number[]; ringAge: number;
  gate: GainNode; ra: Source; kDist: GainNode; kAir: BiquadFilterNode; conv: ConvolverNode[]; convGain: GainNode[];
  send: GainNode; panner: PannerNode; ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
}
export const audio = {
  ctx: null as AudioContext | null, started: false, userPaused: false, wired: settings.mode as Mode,
  limiter: null as DynamicsCompressorNode | null, mix: null as GainNode | null, ra: null as ResonanceAudio | null,
  modeGain: {} as Record<Mode, GainNode>, beepBuf: null as AudioBuffer | null, tickBufs: [] as AudioBuffer[],
};
/** 名前 → 読み上げの音声 */
export const BUF: Record<string, AudioBuffer> = {};
export const voices: Voice[] = [];

// 音の道の音: 方向ごとに、低く丸い「ポ」、木をたたいた「コ」、澄んだ「ピン」（ド・ソ・高いレで、重なっても濁りにくい）
const TRAIL_SOUNDS = [
  { freq: 523, glide: 400, decay: 0.04, sec: 0.14, harm: 2, harmGain: 0.15, gain: 0.5 },
  { freq: 784, glide: 0, decay: 0.025, sec: 0.1, harm: 3, harmGain: 0.3, gain: 0.45 },
  { freq: 1175, glide: 0, decay: 0.06, sec: 0.18, harm: 2, harmGain: 0.1, gain: 0.3 },
];
// 店の反響（Resonance）。壁ぎわは商品で埋まって音を吸うので吸音寄り
const ROOM = { left: 'curtain-heavy', right: 'curtain-heavy', front: 'glass-thick', back: 'glass-thick', down: 'linoleum-on-concrete', up: 'acoustic-ceiling-tiles' };
const DRY = Object.fromEntries(Object.keys(ROOM).map((k) => [k, 'transparent']));

// ---------- 音を作る ----------
const kemarCache = new Map<number, AudioBuffer>();
function kemarBuffer(ctx: AudioContext, i: number, mirror: boolean) {
  const key = i * 2 + (mirror ? 1 : 0), hit = kemarCache.get(key);
  if (hit) return hit;
  const T = kemar.taps, b = ctx.createBuffer(2, T, kemar.rate);
  const L = b.getChannelData(mirror ? 1 : 0), R = b.getChannelData(mirror ? 0 : 1);
  for (let t = 0; t < T; t++) { L[t] = (kemar.pcm[(i * T + t) * 2] / 32768) * kemar.norm; R[t] = (kemar.pcm[(i * T + t) * 2 + 1] / 32768) * kemar.norm; }
  kemarCache.set(key, b); return b;
}
function roomIR(ctx: AudioContext) {   // 0.45 秒で減衰する、左右で無相関なノイズ
  const rate = ctx.sampleRate, len = Math.round(rate * 0.6), b = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let t = Math.round(rate * 0.012); t < len; t++) d[t] = (Math.random() * 2 - 1) * Math.exp((-6.9 * t) / (rate * 0.45));
  }
  return b;
}
function makeBeep(ctx: AudioContext) {   // ピコピコ: 1.2kHz の短い音を 2 回
  const rate = ctx.sampleRate, b = ctx.createBuffer(1, Math.round(rate * 0.3), rate), d = b.getChannelData(0), len = Math.round(rate * 0.06);
  for (const s0 of [0, 0.13]) for (let t = 0; t < len; t++) d[Math.round(rate * s0) + t] = 0.5 * Math.sin((Math.PI * t) / len) * Math.sin((2 * Math.PI * 1200 * t) / rate);
  return b;
}
function makeTick(ctx: AudioContext, { freq, glide, decay, sec, harm, harmGain, gain }: (typeof TRAIL_SOUNDS)[number]) {
  const rate = ctx.sampleRate, len = Math.round(rate * sec), b = ctx.createBuffer(1, len, rate), d = b.getChannelData(0);
  let phase = 0;
  for (let t = 0; t < len; t++) {
    const s = t / rate;
    phase += (2 * Math.PI * (freq - glide * s)) / rate;
    const env = Math.min(1, s / 0.006) * Math.exp(-s / decay) * Math.min(1, (len - t) / (rate * 0.01));
    d[t] = gain * env * (Math.sin(phase) + harmGain * Math.sin(harm * phase));
  }
  return b;
}

// ---------- 設定 ----------
export function setRoom(on: boolean) {
  settings.roomOn = on;
  const ctx = audio.ctx; if (!ctx || !audio.ra) return;
  audio.ra.setRoomProperties({ width: W, height: H, depth: D }, on ? ROOM : DRY);
  for (const v of voices) v.send.gain.setTargetAtTime(on ? REVERB_SEND : 0, ctx.currentTime, 0.05);
}
const voicePath = (v: Voice, m: Mode): AudioNode => (m === 'resonance' ? v.ra.input : m === 'kemar' ? v.kDist : v.panner);
export function setMode(m: Mode) {
  settings.mode = m;
  const radio = document.querySelector<HTMLInputElement>(`input[name=mode][value=${m}]`); if (radio) radio.checked = true;
  const ctx = audio.ctx; if (!ctx) return;
  if (m !== audio.wired) for (const v of voices) { v.gate.disconnect(voicePath(v, audio.wired)); v.gate.connect(voicePath(v, m)); }
  audio.wired = m;
  for (const k of MODES) audio.modeGain[k].gain.setTargetAtTime(k === m ? 1 : 0, ctx.currentTime, 0.03);
}

// iPhone は画面を消したり、長く止まったりすると音を止める。自分で止めたとき以外は、戻ったときや画面に触れたときに鳴らし直す
function wakeAudio() {
  const ctx = audio.ctx;
  if (!ctx || audio.userPaused || ctx.state === 'running' || ctx.state === 'closed') return;
  ctx.resume().catch(() => {});
}
addEventListener('visibilitychange', () => { if (!document.hidden) wakeAudio(); });
addEventListener('pageshow', wakeAudio);
addEventListener('pointerdown', wakeAudio, true);   // iPhone は操作の直後でないと再開できないことがある

export async function startAudio() {
  // KEMAR の HRIR が 44.1kHz なので、ConvolverNode が使えるよう同じ周波数で動かす
  const ctx = new AudioContext({ sampleRate: kemar.rate, latencyHint: 'interactive' });
  audio.ctx = ctx;
  await ctx.resume();
  ctx.onstatechange = () => { report('audio', ctx.state); if (ctx.state !== 'running' && !audio.userPaused) wakeAudio(); };
  const limiter = new DynamicsCompressorNode(ctx, { threshold: -6, knee: 6, ratio: 12, attack: 0.003, release: 0.15 });
  limiter.connect(ctx.destination); audio.limiter = limiter;
  const mix = new GainNode(ctx); mix.connect(limiter); audio.mix = mix;   // 店の音をまとめる（Gemini が話すあいだ小さくする）
  for (const m of MODES) { audio.modeGain[m] = new GainNode(ctx, { gain: m === settings.mode ? 1 : 0 }); audio.modeGain[m].connect(mix); }
  const ra = new ResonanceAudio(ctx, { ambisonicOrder: 3 }); audio.ra = ra;
  ra.output.connect(audio.modeGain.resonance);
  const reverb = new ConvolverNode(ctx, { buffer: roomIR(ctx) });
  reverb.connect(audio.modeGain.kemar);
  const base = import.meta.env.BASE_URL;
  await Promise.all(Object.entries(SOUND_FILES).map(async ([name, file]) => {
    BUF[name] = await ctx.decodeAudioData(await (await fetch(`${base}sounds/${file}`)).arrayBuffer());
  }));
  audio.beepBuf = makeBeep(ctx); audio.tickBufs = TRAIL_SOUNDS.map((s) => makeTick(ctx, s));
  audio.wired = settings.mode;
  const ringGeo = new THREE.RingGeometry(0.92, 1, 64);
  // 名前のぶん（案内の 2 個より多く、近い物が入れ替わっても足りる）と、音の道のぶん
  for (let i = 0; i < HEAR_MAX + 3 + TRAIL_VOICES; i++) {
    const conv = [0, 1].map(() => new ConvolverNode(ctx, { disableNormalization: true }));
    const v: Voice = {
      item: null, next: 0, srcs: [], pos: new THREE.Vector3(0, 1, 0), played: false, kKey: -1, kActive: -1, ringAt: [], ringAge: 99,
      gate: new GainNode(ctx, { gain: 0 }), ra: ra.createSource({ rolloff: 'logarithmic', minDistance: REF, maxDistance: 30 }),
      kDist: new GainNode(ctx, { gain: 0 }), kAir: new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 16000, Q: 0.5 }),
      conv, convGain: conv.map(() => new GainNode(ctx, { gain: 0 })), send: new GainNode(ctx, { gain: 0 }),
      panner: new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: REF, rolloffFactor: ROLLOFF, maxDistance: 30 }),
      ring: new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: NAVY, transparent: true, opacity: 0, depthWrite: false })),
    };
    v.kDist.connect(v.kAir);
    v.conv.forEach((c, k) => { v.kAir.connect(c); c.connect(v.convGain[k]).connect(audio.modeGain.kemar); });
    v.gate.connect(v.send).connect(reverb);
    v.panner.connect(audio.modeGain.browser);
    v.gate.connect(voicePath(v, settings.mode));
    v.ring.rotation.x = -Math.PI / 2; scene.add(v.ring);
    voices.push(v);
  }
  setRoom(settings.roomOn);
  audio.started = true;
}

/** 店の音（名前、ピコピコ、音の道）の大きさ。Gemini が話すあいだは小さくする */
export function duck(on: boolean) {
  if (audio.ctx && audio.mix) audio.mix.gain.setTargetAtTime(on ? 0.25 : 1, audio.ctx.currentTime, 0.08);
}

/** 案内の言葉。頭の中で鳴らす（方向を持たせない） */
let sayQueueEnd = 0;
export function say(text: string) {
  announce.textContent = text;
  const ctx = audio.ctx, buf = BUF[text];
  if (!ctx || !buf || !audio.limiter) return;
  const s = new AudioBufferSourceNode(ctx, { buffer: buf });
  s.connect(audio.limiter);
  const at = Math.max(ctx.currentTime + 0.02, sayQueueEnd);
  s.start(at); sayQueueEnd = at + buf.duration + 0.2;
}
navHooks.say = say;

/** しぐさを認識したことなどを知らせる短い音。頭の中で鳴らす */
export function gestureTick(kind: 'open' | 'point' | 'none' | 'empty') {
  const ctx = audio.ctx; if (!ctx || !audio.started || !audio.limiter) return;
  const freqs = kind === 'open' ? [660, 880] : kind === 'point' ? [1320] : kind === 'empty' ? [330, 262] : [440];
  freqs.forEach((frequency, i) => {
    const at = ctx.currentTime + i * 0.05;
    const osc = new OscillatorNode(ctx, { frequency }), env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(0.15, at + 0.004); env.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
    osc.connect(env).connect(audio.limiter!); osc.start(at); osc.stop(at + 0.07);
  });
}

function release(v: Voice, t: number) {
  v.gate.gain.cancelScheduledValues(t); v.gate.gain.setTargetAtTime(0, t, 0.03);
  for (const s of v.srcs) { try { s.stop(t + 0.15); } catch { /* もう止まっている */ } }
  v.srcs = []; v.item = null; v.ringAt = [];
}

// 音の道: 押した時の位置で点の列を決め、全方向を 1 歩ずつ鳴らす。方向ごとに音の種類と鳴り始めを変える。
// 点ごとにボイスを替えるので、鳴っている音の位置を動かさずに先まで予約でき、描画が遅れてもリズムが揺れない
function trailSchedule(ctx: AudioContext, t: number) {
  const vs = voices.filter((v) => v.item?.trail), ms = settings.trailMs / 1000;
  if (vs.length < TRAIL_VOICES || trail.endAt) return;
  while (!trail.endAt && trail.next < t + TRAIL_LOOK) {
    if (!trail.plan) { trail.plan = planFrom(player.position); trail.step = 0; }
    const plan = trail.plan;
    if (!plan.length) break;
    const at = Math.max(trail.next, t + 0.01);
    plan.forEach((pts, k) => {
      const q = pts[trail.step]; if (!q) return;
      const when = at + (k * ms) / plan.length, v = vs[trail.n++ % TRAIL_VOICES];
      v.pos.copy(q);
      const s = new AudioBufferSourceNode(ctx, { buffer: audio.tickBufs[k % audio.tickBufs.length] });
      const lift = new GainNode(ctx, { gain: TRAIL_GAIN * Math.min(1 + 0.4 * q.distanceTo(player.position), 3) });   // 遠い点は距離で小さくなりすぎるので持ち上げる
      s.connect(lift).connect(v.gate); s.start(when); v.srcs.push(s);
      s.onended = () => { lift.disconnect(); v.srcs = v.srcs.filter((x) => x !== s); };
      v.ringAt.push(when);
    });
    trail.next = at + ms;
    if (++trail.step >= Math.max(...plan.map((pts) => pts.length))) {
      if (link.state.trailHold) { trail.plan = null; trail.next += TRAIL_PAUSE; }   // 長押しのあいだは、その時の位置からまた鳴らす
      else trail.endAt = at + ms + 0.3;   // 最後の音が鳴り終わるまで待つ
    }
  }
}
function trailHoldTick(t: number) {
  if (trail.endAt && t > trail.endAt) { trail.endAt = 0; trail.plan = null; linkSend({ trailOn: false }); }
  if (link.state.trailHold) { trail.heldAt ||= t; if (t - trail.heldAt >= HOLD_SEC) trail.long = true; }
  else {
    trail.heldAt = 0;
    if (trail.long) { trail.long = false; trail.plan = null; trail.endAt = 0; linkSend({ trailOn: false }); }   // 長押しを離したら止める。短く押したときは最後まで鳴らす
  }
}

const _h = new THREE.Vector3(), _m = new THREE.Matrix4();
export function updateAudio() {
  const ctx = audio.ctx!, ra = audio.ra!, t = ctx.currentTime, yaw = headYaw(), pitch = link.state.pitch;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const front = new THREE.Vector3(-sy * cp, sp, -cy * cp), right = new THREE.Vector3(cy, 0, -sy), upV = right.clone().cross(front);
  head.getWorldPosition(_h);
  _m.copy(head.matrixWorld); _m.elements[13] -= H / 2;   // Resonance の部屋は原点が中心
  ra.setListenerFromMatrix(_m);
  const L = ctx.listener;
  if (L.positionX) {
    L.positionX.value = _h.x; L.positionY.value = _h.y; L.positionZ.value = _h.z;
    L.forwardX.value = front.x; L.forwardY.value = front.y; L.forwardZ.value = front.z;
    L.upX.value = upV.x; L.upY.value = upV.y; L.upZ.value = upV.z;
  } else { L.setPosition(_h.x, _h.y, _h.z); L.setOrientation(front.x, front.y, front.z, upV.x, upV.y, upV.z); }

  // 鳴らす物を、ボイスに割り当てる（鳴り続けている物はそのまま）
  const want = wanted(), keep = new Set(want.map((w) => w.key));
  for (const v of voices) if (v.item && !keep.has(v.item.key)) release(v, t);
  for (const w of want) {
    let v = voices.find((x) => x.item?.key === w.key);
    if (!v) {
      v = voices.find((x) => !x.item); if (!v) break;
      v.pos.copy(w.pos); v.next = t + 0.05 + Math.random() * 0.4; v.played = false;   // 言い出しを少しずらす
      v.gate.gain.cancelScheduledValues(t); v.gate.gain.setTargetAtTime(1, t, 0.02);
    }
    v.item = w;
  }
  if (want.some((w) => w.trail)) trailSchedule(ctx, t);
  trailHoldTick(t);

  for (const v of voices) {
    const w = v.item; if (!w) continue;
    const buf = w.beep ? audio.beepBuf : BUF[w.name], snap = w.trail ? 0.004 : null;   // 音の道は点から点へ飛ばす
    if (!buf) continue;
    if (!w.trail && !(w.once && v.played)) while (v.next < t + 0.12) {   // 少し先まで、次の言葉を予約する
      const s = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: w.rate || 1 });
      s.connect(v.gate); s.start(v.next); v.srcs.push(s);
      s.onended = () => { v.srcs = v.srcs.filter((x) => x !== s); };
      v.ringAt.push(v.next);
      v.next += w.beep ? 0.5 : buf.duration + GAP;
      v.played = true;
      if (w.once) break;
    }
    if (!w.trail) v.pos.lerp(w.pos, 0.25);
    const { x, y, z } = v.pos, moveTc = snap ?? 0.02;
    v.ra.setPosition(x, y - H / 2, z);
    v.panner.positionX.setTargetAtTime(x, t, moveTc); v.panner.positionY.setTargetAtTime(y, t, moveTc); v.panner.positionZ.setTargetAtTime(z, t, moveTc);
    // KEMAR: 頭から見た方位と仰角
    const dx = x - _h.x, dy = y - _h.y, dz = z - _h.z;
    const lx = dx * right.x + dz * right.z, lf = dx * front.x + dy * front.y + dz * front.z, lu = dx * upV.x + dy * upV.y + dz * upV.z;
    const az = THREE.MathUtils.radToDeg(Math.atan2(lx, lf)), el = THREE.MathUtils.radToDeg(Math.atan2(lu, Math.hypot(lx, lf)));
    const d = Math.max(Math.hypot(dx, dy, dz), REF);
    v.kDist.gain.setTargetAtTime(REF / (REF + ROLLOFF * (d - REF)), t, snap ?? 0.03);
    v.kAir.frequency.setTargetAtTime(Math.max(6000, 16000 - d * 800), t, 0.05);
    const p = kemar.pick(az, el), key = p.i * 2 + (p.mirror ? 1 : 0);
    if (key !== v.kKey) {   // HRIR が変わったら 2 つの Convolver を入れ替えて、プツッという音を防ぐ
      const nx = v.kActive === 0 ? 1 : 0;
      v.conv[nx].buffer = kemarBuffer(ctx, p.i, p.mirror);
      v.convGain[nx].gain.setTargetAtTime(1, t, 0.015);
      if (v.kActive >= 0) v.convGain[v.kActive].gain.setTargetAtTime(0, t, 0.015);
      v.kActive = nx; v.kKey = key;
    }
  }
}

/** 言い始めに、その位置から輪を広げる */
export function updateRings(dt: number, reduceMotion: boolean) {
  const running = audio.ctx?.state === 'running';
  for (const v of voices) {
    if (running && v.ringAt.length && v.ringAt[0] <= audio.ctx!.currentTime) { v.ringAt.shift(); v.ringAge = 0; }
    v.ringAge += dt;
    const k = Math.min(v.ringAge / 1.0, 1);
    v.ring.position.set(v.pos.x, 0.02, v.pos.z);
    v.ring.material.opacity = v.item ? (1 - k) * 0.55 : 0;
    v.ring.scale.setScalar(reduceMotion ? 0.8 : 0.2 + 1.6 * (1 - (1 - k) ** 3));
  }
}
