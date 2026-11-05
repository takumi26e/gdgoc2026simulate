// マイク: 音を 16kHz・16bit・モノラルの PCM にして渡す（Gemini Live API の入力の形）
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.n = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) { this.buf.push(ch.slice()); this.n += ch.length; }
    if (this.n >= 2048) { this.port.postMessage(this.buf); this.buf = []; this.n = 0; }
    return true;
  }
}
registerProcessor('mic-tap', Tap);`;

export const RATE = 16000;
let ready: Promise<void> | null = null;
let onChunk: ((pcm: Int16Array) => void) | null = null;

/** 最初に 1 回だけマイクを開く（許可の確認はこのとき出る）。以後は onChunk を差し替えて送る・止める */
export function openMic(ctx: AudioContext) {
  ready ??= (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    const src = ctx.createMediaStreamSource(stream), tap = new AudioWorkletNode(ctx, 'mic-tap'), mute = new GainNode(ctx, { gain: 0 });
    src.connect(tap).connect(mute).connect(ctx.destination);   // 出力につないでおかないと、処理が止まるブラウザがある
    const ratio = ctx.sampleRate / RATE;
    let phase = 0;   // 前の塊から持ち越した読み位置（塊の境目で音が途切れないように）
    tap.port.onmessage = (e: MessageEvent<Float32Array[]>) => {
      if (!onChunk) { phase = 0; return; }
      const flat = new Float32Array(e.data.reduce((n, b) => n + b.length, 0));
      let o = 0; for (const b of e.data) { flat.set(b, o); o += b.length; }
      const out: number[] = [];
      for (; phase < flat.length - 1; phase += ratio) {   // 直線で補って 16kHz にする
        const i = Math.floor(phase), t = phase - i, v = flat[i] * (1 - t) + flat[i + 1] * t;
        out.push(Math.max(-1, Math.min(1, v)) * 0x7fff);
      }
      phase -= flat.length;
      onChunk(Int16Array.from(out));
    };
  })();
  return ready;
}
export const setMicTarget = (fn: ((pcm: Int16Array) => void) | null) => { onChunk = fn; };
