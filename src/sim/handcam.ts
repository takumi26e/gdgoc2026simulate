// PC のカメラで手を読み取る（MediaPipe Hand Landmarker）。人さし指だけで指さし、開くとパー、開いた手を握ると開閉
import { classifyHand, type Gesture, type Landmark } from '../core/gesture';
import { $ } from '../dom';

const MEDIAPIPE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const GESTURE_JA: Record<Gesture, string> = { none: '手が見えません', open: 'パー', point: '指さし', fist: 'グー', other: 'そのほか' };

interface Tracker { detectForVideo(v: HTMLVideoElement, t: number): { landmarks?: Landmark[][] } }
export const camHand = {
  on: false, tracker: null as Tracker | null, video: null as HTMLVideoElement | null,
  gesture: 'none' as Gesture, tip: null as { x: number; y: number } | null, cand: 'none' as Gesture, candN: 0, openAt: -1,
};

export async function startHandCam() {
  const vision = await import(/* @vite-ignore */ `${MEDIAPIPE}/vision_bundle.mjs`);
  const files = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
  camHand.tracker = await vision.HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 1,
  });
  camHand.video = $<HTMLVideoElement>('handVideo');
  camHand.video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  await camHand.video.play();
  $('handCam').hidden = false;
  camHand.on = true;
}
export function stopHandCam() {
  camHand.on = false; camHand.gesture = 'none'; camHand.tip = null;
  (camHand.video?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
  $('handCam').hidden = true;
}
/** 毎フレーム。開いた手を 0.8 秒以内に握ったら onGrab を呼ぶ */
export function updateHandCam(onGrab: () => void) {
  const v = camHand.video;
  if (!camHand.on || !v || !camHand.tracker || v.readyState < 2) return;
  const lm = camHand.tracker.detectForVideo(v, performance.now()).landmarks?.[0];
  const g: Gesture = lm ? classifyHand(lm) : 'none';
  // 3 フレーム続いたらしぐさを切り替える（読み取りの揺れで切り替わらないように）
  if (g === camHand.cand) camHand.candN++; else { camHand.cand = g; camHand.candN = 1; }
  if (camHand.candN >= 3 && g !== camHand.gesture) {
    if (camHand.gesture === 'open') camHand.openAt = performance.now();
    if (g === 'fist' && performance.now() - camHand.openAt < 800) { onGrab(); camHand.openAt = -1; }
    camHand.gesture = g;
  }
  // 指さしは人さし指の先、それ以外は手のひらの中心を、画面の中の手の位置にする（鏡写しを戻す）
  const p = lm && (camHand.gesture === 'point' ? lm[8] : lm[9]);
  camHand.tip = p ? { x: -(p.x * 2 - 1), y: -(p.y * 2 - 1) } : null;
  $('handLabel').textContent = GESTURE_JA[camHand.gesture];
}
