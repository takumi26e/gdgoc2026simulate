// PC とスマホのあいだで、何をいつ送り、届いた値をどう使うか
import { audio, setMode, setRoom } from './audio/engine';
import { startTrail } from './audio/select';
import { $ } from './dom';
import { connect, link, linkFlush, linkSend, phoneLinked, report, type LinkState } from './link';
import { hand } from './sim/hand';
import { camHand } from './sim/handcam';
import { nav, startNav, startRoadNav, stopNav } from './sim/nav';
import { walkerState } from './sim/npc';
import { sensor } from './sim/orientation';
import { BUILD, byKey, blocked } from './shop';
import { ROLE, input, settings } from './state';
import { applyView, player, world } from './world';

/** PC のパネルの設定を、スマホの音に反映する */
function applySettings(c: LinkState['settings']) {
  if (!c || ROLE !== 'phone') return;
  const { mode, roomOn, ...rest } = c;
  Object.assign(settings, rest);
  applyView();
  if (mode !== settings.mode) setMode(mode);
  if (roomOn !== settings.roomOn) setRoom(roomOn);
}

function onValues(values: Partial<LinkState>, initial: boolean) {
  const before = nav.on ? (nav.kind === 'road' ? `road:${nav.isl!.key}` : nav.isl!.key) : null;
  Object.assign(link.state, values);
  // 受け取った値を送信済みとして記録する（同じ値をあとで自分から送れるように）。
  // 接続時の状態は前回の値なので記録しない。記録すると、古い値と同じ値（センサーが動いた合図など）を送れなくなる
  if (initial) {
    if (ROLE === 'phone') link.state.headLinked = sensor.events > 0;
    link.state.trailHold = false;
  } else for (const [k, v] of Object.entries(values)) link.sent[k] = JSON.stringify(v);
  if ('navTarget' in values && values.navTarget !== before) {
    const t = values.navTarget, goal = t && byKey.get(t.replace(/^road:/, ''));
    if (goal) { if (t!.startsWith('road:')) startRoadNav(goal, true); else startNav(goal, true); }
    else if (nav.on) stopNav(link.state.navMsg, true);
  }
  if (values.settings) applySettings(values.settings);
  if (!initial && ROLE === 'phone') {   // PC のボタン。接続時の前回の値では鳴らさない
    if ('trailAt' in values) startTrail();
  }
  // PC を開き直しても同じ位置から続ける。店の配置が変わって棚の中になる位置は使わない
  if (initial && ROLE === 'pc' && values.x != null && values.z != null && !blocked(values.x, values.z)) player.position.set(values.x, 0, values.z);
}

function verWarning() {
  const other = ROLE === 'pc' ? 'phoneVer' : 'pcVer';
  if (!link.peers.includes(ROLE === 'pc' ? 'phone' : 'pc') || link.state[other] === BUILD) return '';
  return ROLE === 'pc' ? '。スマホのページが古い版です。スマホで再読み込みしてください' : '。PC のページが古い版です。PC で再読み込みしてください';
}

/** 自分が担当する値を送る。状態の表示も更新する */
export function linkTick() {
  if (ROLE === 'pc') {
    const k = input.keys;
    linkSend({
      x: player.position.x, z: player.position.z,
      pcOpen: k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyP') || camHand.gesture === 'open',
      pcPoint: k.has('KeyF') || input.mouseDown || camHand.gesture === 'point',
      pcHandDir: camHand.on && camHand.tip ? hand.dir.toArray() : null,
      settings: { ...settings },
      npcs: walkerState(),
    });
    $<HTMLInputElement>('reading').checked = link.state.reading;
    const el = $('linkStatus');
    el.hidden = !link.socket;
    el.textContent = !link.connected ? 'サーバーに再接続しています'
      : !link.peers.includes('phone') ? 'スマホは未接続です。向きを変えるにはスマホをつなぎます'
      : (phoneLinked() ? 'スマホと接続しています。向きはスマホで変え、音はスマホで鳴ります' : 'スマホのセンサーが止まっています。スマホで「開始」を押してください') + verWarning();
  } else {
    linkSend({ viewAspect: world.screenAspect });
    $('phoneStatus').textContent = (!link.connected ? 'サーバーに再接続しています' : link.peers.includes('pc') ? 'PC と接続しています' + verWarning() : 'PC を待っています')
      + (audio.started && audio.ctx?.state !== 'running' ? '。音が止まっています。画面に触れると鳴り直します' : '');
    $('pGuideStop').hidden = !nav.on;
  }
  linkFlush();
}

export function startSync() {
  addEventListener('error', (e) => report('error', `${e.message} @${e.lineno}:${e.colno}\n${e.error?.stack ?? ''}`));
  addEventListener('unhandledrejection', (e) => report('rejection', e.reason?.stack ?? e.reason));
  connect({
    onOpen() {
      linkSend({ [`${ROLE}Ver`]: BUILD, trailHold: false });
      // センサーが動いていないスマホが、前回の値のまま向きの主導権を持たないようにする
      if (ROLE === 'phone') linkSend({ headLinked: sensor.events > 0, phoneMove: 0 });
      linkTick();   // つないだらすぐ、いまの位置などを送る
    },
    onValues,
  });
  // タブが裏にあると画面の更新が止まる。そのあいだはタイマーで送る
  setInterval(() => { if (document.hidden && link.connected) linkTick(); }, 250);
}
