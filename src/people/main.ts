// 人の検知のシーン: スマホのカメラで人を見つけ、その方向からピコピコを鳴らす
import '../style.css';
import './people.css';
import { personFromPose, toWorld, updateTracks, type Camera, type Person, type Track } from '../core/people';
import { deviceAngles, enableSensors } from '../sim/orientation';
import { setupTabs } from '../tabs';
import { audioReady, setMode, startAudio, updateAudio, type Mode } from './audio';
import { delegate, detect, loadDetector } from './detect';
import { describe, drawOverlay, drawRadar } from './view';

document.title = '人の検知';
document.body.className = 'people';
document.body.innerHTML = `<main id="stage">
  <video id="video" playsinline muted></video>
  <canvas id="overlay" aria-hidden="true"></canvas>
  <canvas id="radar" role="img" aria-label="上から見た図。自分を中心に、見えている人と、見えなくなった人の予測の位置"></canvas>
  <div id="info">
    <p id="list" role="status">人は見えていません</p>
    <p id="status"></p>
  </div>
  <div id="controls">
    <button id="recenter" class="ghost">向きを合わせる</button>
    <label class="range">
      <span>カメラの横の画角</span><output id="fovOut">65°</output>
      <input type="range" id="fov" min="40" max="120" step="1" value="65">
    </label>
    <select id="mode" aria-label="立体音響の方式">
      <option value="resonance">Resonance Audio</option>
      <option value="browser">ブラウザ標準</option>
    </select>
  </div>
</main>
<div id="overlayStart">
  <h1>人の検知</h1>
  <p>スマホの背面カメラで人を見つけ、その方向からピコピコを鳴らします。近いほど速く鳴ります。カメラに写らなくなった人は、1.5 秒だけ動きを予測して、小さめの音で鳴らします。</p>
  <p>イヤホンをつけ、スマホを正面に立てて持ちます。カメラとモーションセンサーを許可してください。</p>
  <button id="start">開始</button>
</div>`;
setupTabs('people');
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video'), overlay = $<HTMLCanvasElement>('overlay'), radar = $<HTMLCanvasElement>('radar');
const status = $('status'), list = $('list'), startBtn = $<HTMLButtonElement>('start');

const cam: Camera = { width: 640, height: 480, hfovDeg: 65, mirrored: false };
let yaw = 0, yawOffset = 0, needCal = true, tracks: Track[] = [], lastDetect = 0, lastVideoTime = -1, nextId = 1, fps = 0;
let poses: ReturnType<typeof detect> = [], people: (Person | null)[] = [];

// 端末の向き（左右）。首を振っても、人の音が同じ場所にとどまるように使う
function onOrientation(e: { alpha: number | null; beta: number | null; gamma: number | null }) {
  const a = deviceAngles(e); if (!a) return;
  if (needCal) { yawOffset = -a.yaw; needCal = false; }
  yaw = a.yaw + yawOffset;
}

async function openCamera() {
  // 背面カメラ（なければ PC のカメラ）。前面カメラは鏡写しなので、左右を戻して計算する
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } } });
  video.srcObject = stream;
  await video.play();
  const s = stream.getVideoTracks()[0].getSettings();
  cam.mirrored = s.facingMode === 'user' || (!s.facingMode && !matchMedia('(pointer: coarse)').matches);
  video.classList.toggle('mirror', cam.mirrored);
}

startBtn.onclick = async () => {
  startBtn.disabled = true; startBtn.textContent = '準備しています';
  try {
    const sensors = enableSensors(onOrientation);   // 許可の確認はユーザー操作の直後に出す
    await Promise.all([startAudio(), openCamera(), loadDetector(), sensors]);
    $('overlayStart').hidden = true;
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    status.textContent = `始められませんでした: ${(e as Error).message}。カメラの許可と、ネットへの接続を確かめてください`;
    startBtn.disabled = false; startBtn.textContent = '開始';
  }
};
$('recenter').onclick = () => { needCal = true; };
$<HTMLInputElement>('fov').addEventListener('input', (e) => { cam.hfovDeg = +(e.target as HTMLInputElement).value; $('fovOut').textContent = `${cam.hfovDeg}°`; });
$<HTMLSelectElement>('mode').addEventListener('change', (e) => setMode((e.target as HTMLSelectElement).value as Mode));

function loop() {
  const now = performance.now() / 1000;
  // 検出は 1 秒に 15 回まで（スマホが重くならないように）。映像が進んだときだけ
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastDetect > 1 / 15) {
    fps = fps * 0.9 + (1 / Math.max(now - lastDetect, 1e-3)) * 0.1;
    lastDetect = now; lastVideoTime = video.currentTime;
    cam.width = video.videoWidth; cam.height = video.videoHeight;
    poses = detect(video, performance.now());
    people = poses.map((lm) => personFromPose(lm, cam));
    const seen = people.filter((p): p is Person => !!p).map((p) => toWorld(yaw, p.azimuth, p.distance));
    tracks = updateTracks(tracks, seen, now, () => nextId++);
  } else {
    tracks = updateTracks(tracks, [], now, () => nextId++);   // 見えない人の予測を進め、古い人を消す
    for (const t of tracks) t.seen = now - t.seenAt < 0.2;   // 検出の合間は、直前に見えていた人を見えていることにする
  }
  updateAudio(tracks, yaw, now);
  drawOverlay(overlay, video, poses, people, cam.mirrored);
  drawRadar(radar, tracks, yaw, now, cam.hfovDeg);
  list.textContent = describe(tracks, yaw, now);
  status.textContent = `検出 ${fps.toFixed(0)} 回/秒（${delegate}）${audioReady() ? '' : '・音が止まっています。画面に触れると鳴り直します'}`;
  requestAnimationFrame(loop);
}

if (location.search.includes('debug')) (window as unknown as { __people: unknown }).__people = { cam, get tracks() { return tracks; }, get yaw() { return yaw; }, onOrientation };
