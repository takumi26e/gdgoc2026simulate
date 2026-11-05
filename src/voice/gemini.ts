// Gemini Live API で話す。スマホの「話す」を押しているあいだだけマイクの音を送り、Gemini の声は頭の中で鳴らす。
// API キーはサーバーが持ち、/gemini で中継する（server/relay.ts）
import { audio, duck } from '../audio/engine';
import { goalNames } from '../core/search';
import { $, announce } from '../dom';
import { navHooks } from '../sim/nav';
import { shop } from '../shop';
import { ROLE } from '../state';
import { RATE, openMic, setMicTarget } from './mic';
import { TOOLS, runTool, where } from './tools';

const MODEL = 'models/gemini-3.8-live';
const OUT_RATE = 24000;   // Gemini の声は 24kHz・16bit の PCM
const VOICE_GAIN = 0.35;  // Gemini の声の大きさ（そのままだと、店の音よりかなり大きい）

export const voice = {
  ws: null as WebSocket | null, ready: false, connecting: null as Promise<void> | null,
  talking: false, sending: false, speaking: false, heard: '', said: '', error: '',
};

function instruction() {
  return `あなたは、目の見えない・見えにくい人がコンビニで買い物をするのを、声で手伝うアシスタントです。
- 日本語だけで、1〜2 文で短く話してください。方向は時計の文字盤（12時が正面）と、メートルで伝えます。
- 行きたい棚や欲しい商品を言われたら go_to_shelf を呼びます。案内が始まったら「ピコピコ鳴っている所まで来てください」と、最初の地点の方向と距離を伝えます。
- 「[案内]」で始まるメッセージは、アプリからの知らせです。利用者への言葉にして短く伝えます。
- 「読み上げを止めて」「名前を読んで」などと言われたら set_reading を呼びます。
- 「周りに何がある？」などと聞かれたら describe_surroundings を呼び、近い物から 3 つほどを方向と距離で答えます。人が近ければ知らせます。
- 店にない物は、ないと伝えます。場所を推測で言わないでください。
店の棚と場所: ${goalNames(shop).join('、')}`;
}

function send(msg: unknown) { if (voice.ws?.readyState === WebSocket.OPEN) voice.ws.send(JSON.stringify(msg)); }
function show(text: string) {
  voice.error = text; announce.textContent = text;
  if (ROLE === 'phone') { $('pnotice').textContent = text; $('pnotice').hidden = false; }
}

function connect() {
  if (voice.ready) return Promise.resolve();
  return (voice.connecting ??= new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/gemini`);
    voice.ws = ws;
    ws.onopen = () => send({
      setup: {
        model: MODEL,
        generationConfig: { responseModalities: ['AUDIO'] },
        systemInstruction: { parts: [{ text: instruction() }] },
        tools: TOOLS,
        realtimeInputConfig: { automaticActivityDetection: { disabled: true } },   // 話す区切りは、ボタンを押している時間で決める
        inputAudioTranscription: {}, outputAudioTranscription: {},
      },
    });
    ws.onmessage = async (e) => {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : await (e.data as Blob).text());
      if (m.proxyError === 'no-key') { show('Gemini の API キーがありません。simulator の .gemini-key に置いてください'); reject(new Error('no-key')); return; }
      if (m.proxyClosed) { show(`Gemini との接続が切れました（${m.proxyClosed.code} ${m.proxyClosed.reason}）`); return; }
      if (m.setupComplete) { voice.ready = true; voice.error = ''; resolve(); return; }
      if (m.serverContent) onContent(m.serverContent);
      if (m.toolCall) onToolCall(m.toolCall.functionCalls ?? []);
    };
    ws.onclose = () => { voice.ws = null; voice.ready = false; voice.connecting = null; stopPlayback(); reject(new Error('closed')); };
    ws.onerror = () => show('Gemini につなげませんでした');
  }));
}

// ---------- 話す ----------
export async function talkStart() {
  if (!audio.started || !audio.ctx) { show('先に「開始」を押してください'); return; }
  voice.talking = true; voice.heard = '';
  stopPlayback();   // 話しかけたら、Gemini の話を止める
  try { await Promise.all([connect(), openMic(audio.ctx)]); }
  catch (e) {
    voice.talking = false;
    if ((e as Error).message !== 'no-key') { show('マイクか Gemini を使えませんでした'); console.error(e); }   // キーがないことは、もう画面に出している
    return;
  }
  if (!voice.talking) return;   // つながる前に離した
  send({ realtimeInput: { activityStart: {} } });
  voice.sending = true;
  setMicTarget((pcm) => send({ realtimeInput: { audio: { data: toBase64(new Uint8Array(pcm.buffer)), mimeType: `audio/pcm;rate=${RATE}` } } }));
}
export function talkStop() {
  voice.talking = false;
  setMicTarget(null);
  if (voice.sending) { voice.sending = false; send({ realtimeInput: { activityEnd: {} } }); }
}
/** アプリからの知らせを Gemini に話してもらう */
export async function notify(text: string) {
  try { await connect(); } catch { return; }
  send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });
}

// ---------- Gemini の返事 ----------
interface Part { inlineData?: { data: string; mimeType?: string } }
function onContent(c: { modelTurn?: { parts?: Part[] }; interrupted?: boolean; turnComplete?: boolean; inputTranscription?: { text?: string }; outputTranscription?: { text?: string } }) {
  if (c.interrupted) stopPlayback();
  for (const p of c.modelTurn?.parts ?? []) if (p.inlineData?.data) play(p.inlineData.data);
  if (c.inputTranscription?.text) voice.heard += c.inputTranscription.text;
  if (c.outputTranscription?.text) { voice.said += c.outputTranscription.text; announce.textContent = voice.said; }
}
async function onToolCall(calls: { id: string; name: string; args?: Record<string, unknown> }[]) {
  const functionResponses = [];
  for (const fc of calls) {
    let result: Record<string, unknown>;
    try { result = await runTool(fc.name, fc.args ?? {}); } catch (e) { result = { error: String(e) }; }
    functionResponses.push({ id: fc.id, name: fc.name, response: { result } });
  }
  send({ toolResponse: { functionResponses } });
}

// 届いた声を、途切れないように続けて鳴らす
let playEnd = 0, sources: AudioBufferSourceNode[] = [], gain: GainNode | null = null;
function play(b64: string) {
  const ctx = audio.ctx; if (!ctx || !audio.limiter) return;
  if (!gain) { gain = new GainNode(ctx, { gain: VOICE_GAIN }); gain.connect(audio.limiter); }
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)), pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const buf = ctx.createBuffer(1, pcm.length, OUT_RATE), d = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) d[i] = pcm[i] / 32768;
  if (!voice.speaking) { voice.speaking = true; voice.said = ''; duck(true); }
  const s = new AudioBufferSourceNode(ctx, { buffer: buf });
  s.connect(gain);
  playEnd = Math.max(ctx.currentTime + 0.05, playEnd);
  s.start(playEnd); playEnd += buf.duration;
  sources.push(s);
  s.onended = () => { sources = sources.filter((x) => x !== s); if (!sources.length) { voice.speaking = false; duck(false); } };
}
function stopPlayback() {
  for (const s of sources) { try { s.stop(); } catch { /* もう止まっている */ } }
  sources = []; playEnd = 0;
  if (voice.speaking) { voice.speaking = false; duck(false); }
}
function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// 棚への案内の途中経過を、Gemini に伝えてもらう
navHooks.onWaypoint = (reached, next) => {
  const w = where(next);
  void notify(`[案内] ${reached}つ目の地点に着きました。次の地点は${w.direction}、約${w.distance_m}m先です。ピコピコ鳴っている所まで来るよう、短く伝えてください。`);
};
navHooks.onArrive = (goal) => { void notify(`[案内] ${goal.name}の前に着きました。着いたことを短く伝えてください。`); };
navHooks.onReroute = () => { void notify('[案内] 道を外れたので、案内し直しました。ピコピコ鳴っている所まで来るよう、短く伝えてください。'); };
