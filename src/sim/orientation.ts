// スマホの向きを頭の向きへ変換する。端末の背面が視線の方向
import * as THREE from 'three';
import { linkSend } from '../link';

const qAlign = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2), qTurn = new THREE.Quaternion();
const qDev = new THREE.Quaternion(), eDev = new THREE.Euler(), vDev = new THREE.Vector3(), uDev = new THREE.Vector3();
const zAxis = new THREE.Vector3(0, 0, 1), DEG = Math.PI / 180;
export const sensor = { events: 0, yawOffset: 0, needCal: true };
/** いまの端末の向きを体の正面にする */
export const recenter = () => { sensor.needCal = true; };

type Orientation = { alpha: number | null; beta: number | null; gamma: number | null };
/** 端末の向きから、水平の向き（左回りが +、基準はセンサーまかせ）と上下の傾き。ラジアン */
export function deviceAngles(e: Orientation) {
  if (e.alpha === null || e.beta === null || e.gamma === null) return null;
  eDev.set(e.beta * DEG, e.alpha * DEG, -e.gamma * DEG, 'YXZ');
  const angle = screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0;
  qDev.setFromEuler(eDev).multiply(qAlign).multiply(qTurn.setFromAxisAngle(zAxis, -angle * DEG));
  vDev.set(0, 0, -1).applyQuaternion(qDev);
  // 端末を寝かせると背面の方向では水平の向きが決まらないので、端末の上端の方向で補う
  uDev.set(0, 1, 0).applyQuaternion(qDev);
  return { yaw: Math.atan2(-(vDev.x - vDev.y * uDev.x), -(vDev.z - vDev.y * uDev.z)), pitch: Math.asin(THREE.MathUtils.clamp(vDev.y, -1, 1)) };
}

export function onOrientation(e: Orientation) {
  const a = deviceAngles(e); if (!a) return;
  sensor.events++;
  const raw = a.yaw;
  if (sensor.needCal) { sensor.yawOffset = -raw; sensor.needCal = false; }
  linkSend({ headYaw: raw + sensor.yawOffset, pitch: a.pitch, headLinked: true });
}

type PermissionApi = { requestPermission?: () => Promise<string> };
/** 'ok' | 'unsupported' | 'denied'。ブラウザにより 'prompt' なども返るので、結果によらず登録する */
export async function enableSensors(handler: (e: Orientation) => void = onOrientation) {
  if (typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
  addEventListener('deviceorientation', handler);
  const api = DeviceOrientationEvent as unknown as PermissionApi;
  if (typeof api.requestPermission === 'function' && (await api.requestPermission().catch(() => 'denied')) === 'denied') return 'denied';
  return 'ok';
}
