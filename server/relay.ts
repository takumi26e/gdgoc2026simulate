// 開発用サーバーに足す部分: 自己署名の証明書と、PC・スマホ間の状態の中継（WebSocket の /ws）。
// スマホのセンサーは HTTPS でないと使えないので、LAN の IP アドレスも入れた証明書を作る。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import selfsigned from 'selfsigned';
import type { Plugin } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';

const lanAddresses = () =>
  Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address);

// 証明書は .cert に置く。IP アドレスが変わったら作り直す
export async function loadCertificate(root: string) {
  const dir = join(root, '.cert'), keyPath = join(dir, 'key.pem'), certPath = join(dir, 'cert.pem'), ipPath = join(dir, 'ips.txt');
  const ips = lanAddresses().sort().join(',');
  if (existsSync(keyPath) && existsSync(certPath) && existsSync(ipPath) && readFileSync(ipPath, 'utf8') === ips) {
    return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  }
  const altNames = [{ type: 2 as const, value: 'localhost' }, { type: 7 as const, ip: '127.0.0.1' }, ...lanAddresses().map((ip) => ({ type: 7 as const, ip }))];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'konbini-simulator.local' }], {
    keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames }],
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(keyPath, pems.private); writeFileSync(certPath, pems.cert); writeFileSync(ipPath, ips);
  return { key: pems.private, cert: pems.cert };
}

type Client = WebSocket & { role?: string };

// 最新の共有状態を持ち、受け取った差分を送り主以外へ中継する
function attachRelay(server: HttpServer) {
  const state: Record<string, unknown> = {};
  const wss = new WebSocketServer({ noServer: true });
  const open = () => [...wss.clients].filter((c) => c.readyState === c.OPEN) as Client[];
  const broadcastPeers = () => {
    const msg = JSON.stringify({ type: 'peers', roles: open().map((c) => c.role).filter(Boolean) });
    for (const c of open()) c.send(msg);
  };
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'https://x').pathname !== '/ws') return;   // それ以外は Vite の HMR
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (socket: Client) => {
    socket.send(JSON.stringify({ type: 'state', state }));
    socket.on('message', (raw) => {
      let msg: { type?: string; role?: string; patch?: Record<string, unknown>; kind?: string; detail?: unknown };
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'log') {   // ページで起きたエラーや長い停止を、サーバーの画面に出す
        console.log(`[${new Date().toLocaleTimeString()}] ${msg.role} ${msg.kind}: ${String(msg.detail).slice(0, 800)}`);
      } else if (msg.type === 'hello') {
        socket.role = msg.role; broadcastPeers();
      } else if (msg.type === 'patch' && msg.patch && typeof msg.patch === 'object') {
        Object.assign(state, msg.patch);
        const out = JSON.stringify({ type: 'patch', patch: msg.patch });
        for (const c of open()) if (c !== socket) c.send(out);
      }
    });
    socket.on('close', () => {
      // 全員が切れたら状態を捨てる（次に開いた人へ前回の案内などを引き継がない）
      if (wss.clients.size === 0) for (const k of Object.keys(state)) delete state[k];
      broadcastPeers();
    });
  });
}

// Gemini Live API への中継（/gemini）。API キーはサーバーだけが持ち、ページには渡さない。
// キーは環境変数 GEMINI_API_KEY か、.gemini-key ファイル（接続のたびに読むので、置けばすぐ使える）
const GEMINI_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
function geminiKey(root: string) {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const file = join(root, '.gemini-key');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}
function attachGemini(server: HttpServer, root: string) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'https://x').pathname !== '/gemini') return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (client: WebSocket) => {
    const key = geminiKey(root);
    if (!key) { client.send(JSON.stringify({ proxyError: 'no-key' })); client.close(); return; }
    const upstream = new WebSocket(`${GEMINI_URL}?key=${encodeURIComponent(key)}`);
    const queue: string[] = [];
    client.on('message', (raw) => { const text = raw.toString(); if (upstream.readyState === upstream.OPEN) upstream.send(text); else queue.push(text); });
    upstream.on('open', () => { for (const m of queue.splice(0)) upstream.send(m); });
    // Google から届くのはバイナリのこともあるので、文字にして渡す
    upstream.on('message', (data) => { if (client.readyState === client.OPEN) client.send(data.toString()); });
    upstream.on('close', (code, reason) => {
      if (code !== 1000) console.log(`[gemini] closed ${code} ${reason.toString().slice(0, 300)}`);
      if (client.readyState === client.OPEN) { client.send(JSON.stringify({ proxyClosed: { code, reason: reason.toString().slice(0, 300) } })); client.close(); }
    });
    upstream.on('error', (e) => { console.log(`[gemini] ${e.message}`); if (client.readyState === client.OPEN) client.close(); });
    client.on('close', () => upstream.close());
  });
}

export function relay(root: string): Plugin {
  const hint = (server: HttpServer, port: number) => server.once('listening', () => setTimeout(() => {
    console.log('\n  PC    : https://localhost:%d/pc.html', port);
    for (const ip of lanAddresses()) console.log('  スマホ: https://%s:%d/phone.html', ip, port);
    console.log('  自己署名証明書の警告が出たら、詳細設定から続行してください\n');
  }, 50));
  return {
    name: 'konbini-relay',
    configureServer(server) { if (server.httpServer) { attachRelay(server.httpServer as HttpServer); attachGemini(server.httpServer as HttpServer, root); hint(server.httpServer as HttpServer, server.config.server.port ?? 8443); } },
    configurePreviewServer(server) { attachRelay(server.httpServer as HttpServer); attachGemini(server.httpServer as HttpServer, root); hint(server.httpServer as HttpServer, server.config.preview.port ?? 8443); },
  };
}
