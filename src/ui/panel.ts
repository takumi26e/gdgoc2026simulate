// PC の操作パネル
import { audio, setMode, setRoom, startAudio } from '../audio/engine';
import { MODES, type Mode } from '../config';
import { $, hud } from '../dom';
import { link } from '../link';
import { hand } from '../sim/hand';
import { camHand, startHandCam, stopHandCam } from '../sim/handcam';
import { nav, navHooks, startNav, stopNav } from '../sim/nav';
import { ISLANDS } from '../shop';
import { settings } from '../state';
import { applyView, topCam, toggleCam, world } from '../world';
import { bindSound } from './buttons';

const destSel = $<HTMLSelectElement>('dest');
const goBtn = $('go'), camBtn = $('cam'), startBtn = $<HTMLButtonElement>('start'), handBtn = $<HTMLButtonElement>('handBtn');
for (const isl of ISLANDS) destSel.add(new Option(isl.name, isl.id));
navHooks.onChange = () => { goBtn.textContent = nav.on ? '案内をやめる（G）' : '案内を始める（G）'; };
const canGuide = () => audio.started || link.connected;

export function toggleNav() {
  if (!canGuide()) { hud.innerHTML = '<span>先に「音を出す」を押してください</span>'; return; }
  if (nav.on) stopNav('案内を終わります');
  else startNav(ISLANDS.find((i) => i.id === destSel.value)!);
}
/** 手のひらの開閉: 案内中ならやめる。そうでなければ、指している島（なければ選んだ行き先）へ案内する */
export function grab() {
  if (!canGuide()) return;
  if (nav.on) { stopNav('案内を終わります'); return; }
  const isl = hand.hit?.isl ?? ISLANDS.find((i) => i.id === destSel.value)!;
  destSel.value = isl.id!; startNav(isl);
}
export function switchCam() {
  toggleCam();
  camBtn.textContent = world.cam === topCam ? 'カメラの映像で見る' : '上から見る';
}
/** 音を出す・止める。スマホの「開始」もこれを使う */
export async function toggleAudio() {
  if (!audio.started) {
    startBtn.disabled = true; startBtn.textContent = '音を読み込んでいます';
    try { await startAudio(); startBtn.textContent = '音を止める'; }
    catch (e) {
      startBtn.textContent = '音を出す'; console.error(e);
      hud.innerHTML = '<span>音を読み込めませんでした。ネットにつながっているか確かめてください</span>';
    }
    startBtn.disabled = false; return;
  }
  const ctx = audio.ctx!;
  if (ctx.state === 'running') { audio.userPaused = true; await ctx.suspend(); startBtn.textContent = '音を出す'; }
  else { audio.userPaused = false; await ctx.resume(); startBtn.textContent = '音を止める'; }
}

export function setupPanel() {
  goBtn.onclick = toggleNav;
  camBtn.onclick = switchCam;
  startBtn.onclick = toggleAudio;
  bindSound($('trailBtn'), 'trailAt');
  bindSound($('listenBtn'), 'listenAt');
  handBtn.onclick = async () => {
    if (camHand.on) { stopHandCam(); handBtn.textContent = 'カメラで手を使う'; return; }
    handBtn.disabled = true; handBtn.textContent = 'カメラを準備しています';
    try { await startHandCam(); handBtn.textContent = '手のカメラを止める'; }
    catch (e) { console.error(e); handBtn.textContent = 'カメラで手を使う'; hud.innerHTML = '<span>カメラを使えませんでした。ブラウザのカメラの許可を確かめてください</span>'; }
    handBtn.disabled = false;
  };
  document.querySelectorAll<HTMLInputElement>('input[name=mode]').forEach((r) => r.addEventListener('change', () => setMode(r.value as Mode)));
  $<HTMLInputElement>('room').addEventListener('change', (e) => setRoom((e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('onlySeen').addEventListener('change', (e) => { settings.onlySeen = (e.target as HTMLInputElement).checked; });
  const range = (id: string, unit: string, fn: (v: number) => void) => {
    const inp = $<HTMLInputElement>(id), out = $(`${id}Out`);
    inp.addEventListener('input', () => { out.textContent = (unit === 'm' ? (+inp.value).toFixed(1) : inp.value) + unit; fn(+inp.value); });
  };
  range('near', 'm', (v) => { settings.near = v; });
  range('trailMs', 'ms', (v) => { settings.trailMs = v; });
  range('ratio', '%', (v) => { settings.minRatio = v / 100; });
  range('cover', '%', (v) => { settings.minCover = v / 100; });
  range('fov', '°', (v) => { settings.fovManual = v; applyView(); });
  setupVoice();
}

/** 声で行き先を言う（Chrome の音声認識。使えない環境ではボタンを出さない） */
function setupVoice() {
  type Rec = { lang: string; start(): void; onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void; onend: () => void };
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition, btn = $('voice');
  if (!SR) return;
  btn.hidden = false;
  btn.onclick = () => {
    const rec = new SR(); rec.lang = 'ja-JP';
    btn.textContent = '聞いています';
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      const isl = ISLANDS.find((i) => text.includes(i.name) || i.name.split('・').some((part) => text.includes(part)));
      if (!isl) { hud.innerHTML = `<span>「${text}」に合う行き先がありませんでした</span>`; return; }
      destSel.value = isl.id!;
      if (nav.on) stopNav();
      if (canGuide()) startNav(isl);
    };
    rec.onend = () => { btn.textContent = '声で行き先を言う'; };
    rec.start();
  };
}
export const modeByKey = (code: string) => (/^Digit[123]$/.test(code) ? MODES[+code.at(-1)! - 1] : null);
