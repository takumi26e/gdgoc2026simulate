// PC とスマホの同期。サーバーの /ws に、変わった値だけを送り合う
import type { Settings } from './config';
import { ROLE } from './state';

export type Gesture = 'none' | 'open' | 'point';
export interface LinkState {
  x: number | null; z: number | null;          // 位置（PC）
  headYaw: number; pitch: number;               // 頭の向き（スマホ）
  headLinked: boolean;                          // スマホのセンサーが動いているか
  phoneGesture: Gesture; phoneMove: number;     // スマホのボタンとスライド
  pcOpen: boolean; pcPoint: boolean; pcHandDir: number[] | null;   // PC のキーと手のカメラ
  navTarget: string | null; navMsg: string | null;
  trailOn: boolean; trailHold: boolean;
  trailAt?: number;                             // PC で音の道を押した時刻（スマホで鳴らす合図）
  reading: boolean;                             // 近い物の名前を読み上げるか（PC でも Gemini でも変えられる）
  settings: Settings | null;
  viewAspect?: number;                          // スマホの画面の縦横比
  npcs?: number[][];                            // 歩き回る人の位置（PC）
  pcVer?: string; phoneVer?: string;
}

export const link = {
  socket: null as WebSocket | null, connected: false, peers: [] as string[],
  pending: {} as Partial<LinkState>, sent: {} as Record<string, string>,
  state: {
    x: null, z: null, headYaw: 0, pitch: 0, headLinked: false, phoneGesture: 'none', phoneMove: 0,
    pcOpen: false, pcPoint: false, pcHandDir: null, navTarget: null, navMsg: null,
    trailOn: false, trailHold: false, reading: true, settings: null,
  } as LinkState,
};

export const phoneLinked = () => link.peers.includes('phone') && link.state.headLinked;
/** 頭の向き。スマホが切れたら正面に戻す */
export const headYaw = () => (phoneLinked() ? link.state.headYaw : 0);

/** 変わった値だけを次の送信に積む */
export function linkSend(values: Partial<LinkState>) {
  Object.assign(link.state, values);
  for (const [k, v] of Object.entries(values)) {
    const json = JSON.stringify(v);
    if (link.sent[k] !== json) { link.sent[k] = json; (link.pending as Record<string, unknown>)[k] = v; }
  }
}
export function linkFlush() {
  if (link.socket?.readyState !== WebSocket.OPEN || !Object.keys(link.pending).length) return;
  link.socket.send(JSON.stringify({ type: 'patch', patch: link.pending }));
  link.pending = {};
}

/** 止まった原因を調べるため、エラーなどをサーバーの画面に送る */
export function report(kind: string, detail: unknown) {
  try { if (link.socket?.readyState === WebSocket.OPEN) link.socket.send(JSON.stringify({ type: 'log', role: ROLE, kind, detail: String(detail).slice(0, 800) })); } catch { /* 送れなくてもよい */ }
}

export function connect(h: { onOpen(): void; onValues(values: Partial<LinkState>, initial: boolean): void }) {
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  link.socket = socket;
  socket.onopen = () => {
    link.connected = true;
    socket.send(JSON.stringify({ type: 'hello', role: ROLE }));
    link.sent = {}; link.pending = {};
    h.onOpen();
  };
  socket.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') h.onValues(m.state, true);
    else if (m.type === 'patch') h.onValues(m.patch, false);
    else if (m.type === 'peers') link.peers = m.roles;
  };
  socket.onclose = () => { link.connected = false; link.peers = []; setTimeout(() => connect(h), 1000); };
}
