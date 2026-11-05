// MediaPipe Pose Landmarker で、映像に写った人の骨格（33 点）を取る。最大 4 人
import type { Landmark } from '../core/people';

const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

interface Landmarker { detectForVideo(v: HTMLVideoElement, t: number): { landmarks: Landmark[][] } }
let landmarker: Landmarker | null = null;
export let delegate = '';

export async function loadDetector() {
  const vision = await import(/* @vite-ignore */ `${VISION}/vision_bundle.mjs`);
  const files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
  const make = (d: 'GPU' | 'CPU') => vision.PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: 'VIDEO', numPoses: 4,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { landmarker = await make('GPU'); delegate = 'GPU'; }
  catch { landmarker = await make('CPU'); delegate = 'CPU'; }   // GPU が使えない端末
}
export function detect(video: HTMLVideoElement, t: number): Landmark[][] {
  return landmarker ? landmarker.detectForVideo(video, t).landmarks ?? [] : [];
}
