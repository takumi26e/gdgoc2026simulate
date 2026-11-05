// 入口: 画面と操作を用意し、毎フレームの処理を回す
import './style.css';
import * as THREE from 'three';
import { audio, gestureTick, updateAudio, updateRings, voices } from './audio/engine';
import { WALK_SPEED } from './config';
import { installDebug } from './debug';
import { headYaw, link, phoneLinked, report } from './link';
import { handTarget, updateGestures, updateHand, hand } from './sim/hand';
import { updateHandCam } from './sim/handcam';
import { nav, updateNav } from './sim/nav';
import { followWalkers, updateWalkers } from './sim/npc';
import { recognize, updateLevels } from './sim/recognition';
import { updateTrailView } from './sim/trail';
import { blocked } from './shop';
import { ROLE, display, input, reduceMotion } from './state';
import { linkTick, startSync } from './sync';
import { updateHud } from './ui/hud';
import { setupInput } from './ui/input';
import { grab, setupPanel } from './ui/panel';
import { setupPhone } from './ui/phone';
import { chest, head, player, renderer, resize, scene, world } from './world';

setupPanel();
if (ROLE === 'phone') setupPhone(); else setupInput();
addEventListener('resize', resize); resize();
startSync();
if (location.search.includes('debug')) installDebug();

/** PC: キーとスマホのスライドで歩く。前は見ている向き（スマホの向き） */
function walk(dt: number) {
  const k = input.keys, slide = link.peers.includes('phone') ? link.state.phoneMove : 0;
  const f = THREE.MathUtils.clamp((k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + slide, -1, 1);
  const r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
  const sp = WALK_SPEED * dt, yaw = headYaw();
  const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * r) * sp, dz = (-Math.cos(yaw) * f - Math.sin(yaw) * r) * sp;
  if (!blocked(player.position.x + dx, player.position.z)) player.position.x += dx;
  if (!blocked(player.position.x, player.position.z + dz)) player.position.z += dz;
}

const clock = new THREE.Clock();
let hudTimer = 1, visTimer = 1, linkTimer = 1, lastGesture = 'none', lastFrame = performance.now(), lastReport = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now(), gap = now - lastFrame; lastFrame = now;
  if (gap > 300 && !document.hidden && now - lastReport > 2000) {   // 0.3 秒以上止まったら、そのときの様子をサーバーへ送る
    lastReport = now;
    report('stall', `${gap.toFixed(0)}ms pos=${player.position.x.toFixed(2)},${player.position.z.toFixed(2)} head=${headYaw().toFixed(2)} gesture=${lastGesture} nav=${nav.on} voices=${voices.filter((v) => v.item).length} target=${hand.point || hand.open ? handTarget()?.name : '-'}`);
  }
  const dt = Math.min(clock.getDelta(), 0.05), ls = link.state, k = 1 - Math.exp(-dt * 18);
  if (ROLE === 'pc') { walk(dt); updateWalkers(dt); }
  else {   // スマホ: PC の位置と歩く人をなめらかに追う
    if (ls.x != null && ls.z != null) { player.position.x += (ls.x - player.position.x) * k; player.position.z += (ls.z - player.position.z) * k; }
    followWalkers(k);
  }
  const hy = headYaw();
  head.rotation.set(phoneLinked() ? ls.pitch : 0, hy, 0);
  chest.rotation.y = hy;
  if (world.fan) world.fan.rotation.z = hy;   // 認識する範囲の表示も、聞こえる向きに合わせる
  player.updateMatrixWorld(true);

  updateTrailView();
  updateHandCam(grab);
  const gesture = updateGestures();
  if (gesture !== lastGesture) { lastGesture = gesture; gestureTick(gesture); }
  updateLevels();
  updateHand();
  if ((visTimer += dt) > (ROLE === 'phone' ? 0.2 : 0.1)) { visTimer = 0; recognize(); }   // カメラの判定は PC で 10 回/秒、スマホで 5 回/秒
  updateNav(dt);
  if ((linkTimer += dt) > 0.05) { linkTimer = 0; linkTick(); }
  if (audio.started && audio.ctx?.state === 'running') updateAudio();
  updateRings(dt, reduceMotion);
  if ((hudTimer += dt) > 0.2) { hudTimer = 0; updateHud(); }
  if (!display.blackout) renderer.render(scene, world.cam);
});
