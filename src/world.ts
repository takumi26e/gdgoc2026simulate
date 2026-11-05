// 3D の店: シーン、棚と商品、人、カメラ、認識する範囲の扇形
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAM_Y, D, DEPTH, EAR_Y, H, NAVY, VIEW_RANGE, W } from './config';
import type { El } from './core/store';
import { $ } from './dom';
import { ISLANDS, START, shop } from './shop';
import { ROLE, settings } from './state';

declare module './core/store' {
  interface El {
    label?: THREE.Sprite; tex?: { on: THREE.Texture; off: THREE.Texture }; plane?: THREE.Mesh; mesh?: THREE.Mesh;
  }
}

export const viewEl = $('view');
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(ROLE === 'phone' ? Math.min(devicePixelRatio, 1.5) : devicePixelRatio);
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', 'コンビニの見取り図。人、胸のカメラの視野、手の向き、島と棚を表示します。');
viewEl.prepend(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f5f8);
scene.add(new THREE.HemisphereLight(0xffffff, 0xc8ccd2, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(3, 8, 4); scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ color: 0xffffff }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
const grid = new THREE.GridHelper(12, 24, 0xe3e6ea, 0xe3e6ea);   // 50cm の床タイル
grid.scale.z = D / W; grid.position.y = 0.001; scene.add(grid);

// 壁。手前の壁は出口の幅だけ空ける
const wallMat = new THREE.MeshLambertMaterial({ color: 0xdfe3e8, transparent: true, opacity: 0.6 });
function wall(w: number, x: number, z: number, rotY: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, 0.08), wallMat);
  m.position.set(x, H / 2, z); m.rotation.y = rotY; scene.add(m);
}
const [EX0, EX1] = shop.exit;
wall(W, 0, -D / 2, 0); wall(D, -W / 2, 0, Math.PI / 2); wall(D, W / 2, 0, Math.PI / 2);
wall(EX0 + W / 2, (EX0 - W / 2) / 2, D / 2, 0); wall(W / 2 - EX1, (EX1 + W / 2) / 2, D / 2, 0);

// ---------- 名前の札 ----------
function labelTex(text: string, on: boolean, small: boolean) {   // 文字数に合わせて札の幅を決める
  const size = small ? 38 : 46, m = document.createElement('canvas').getContext('2d')!;
  m.font = `700 ${size}px "Hiragino Sans", sans-serif`;
  const c = document.createElement('canvas'); c.width = Math.ceil(m.measureText(text).width + 44); c.height = 88;
  const g = c.getContext('2d')!;
  g.fillStyle = on ? '#1f3a68' : '#ffffff'; g.beginPath(); g.roundRect(2, 2, c.width - 4, 84, 14); g.fill();
  if (!on) { g.strokeStyle = 'rgba(20,23,28,.15)'; g.lineWidth = 2; g.stroke(); }
  g.font = m.font; g.fillStyle = on ? '#ffffff' : '#4a5260';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, 46);
  return new THREE.CanvasTexture(c);
}
function makeLabel(el: El, pos: THREE.Vector3, scale: number) {
  el.tex = { on: labelTex(el.name, true, el.level > 0), off: labelTex(el.name, false, el.level > 0) };
  el.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: el.tex.off }));   // 手前の物に隠れるようにする
  const aspect = (el.tex.off.image as HTMLCanvasElement).width / 88;
  el.label.scale.set(0.4 * scale * aspect, 0.4 * scale, 1); el.label.renderOrder = 2; el.label.position.copy(pos); scene.add(el.label);
}
/** 認識できた物の札と棚の板を紺にする */
export function markSeen(el: El, seen: boolean) {
  if (el.label && el.tex) el.label.material.map = seen ? el.tex.on : el.tex.off;
  if (el.plane) el.plane.material = seen ? shelfMat.on : shelfMat.off;
}

// ---------- 棚と商品 ----------
/** 手の光線が当たる物（商品の箱を含む） */
export const occluders: THREE.Object3D[] = [];
/** カメラの判定で視線をさえぎる物（島と部屋の箱だけ。商品の箱まで調べるとスマホが固まる） */
export const blockers: THREE.Object3D[] = [];
const shelfMat = { on: new THREE.MeshBasicMaterial({ color: 0x8c9bb5 }), off: new THREE.MeshBasicMaterial({ color: 0xdde1e7 }) };

// 商品の色は名前から決める（緑の 50〜160° は使わない）。正面には名前を書く
const hueOf = (n: string) => ([...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 250, 7) + 160) % 360;
// 商品の箱は数百個あるので、名前の札を 1 枚の画像（アトラス）に並べ、全部の箱を 1 つのメッシュにまとめて描く
const TILE_W = 128, TILE_H = 160, ATLAS = 2048, COLS = ATLAS / TILE_W;
const atlasCanvas = document.createElement('canvas'); atlasCanvas.width = atlasCanvas.height = ATLAS;
const atlasTiles = new Map<string, { col: number; row: number }>();
function atlasTile(name: string) {
  const known = atlasTiles.get(name); if (known) return known;
  const i = atlasTiles.size, col = i % COLS, row = Math.floor(i / COLS);
  console.assert((row + 1) * TILE_H <= ATLAS, '商品が多すぎてアトラスに入らない');
  const g = atlasCanvas.getContext('2d')!; g.save(); g.translate(col * TILE_W, row * TILE_H);
  g.fillStyle = `hsl(${hueOf(name)}, 35%, 62%)`; g.fillRect(0, 0, 128, 160);
  g.fillStyle = '#ffffff'; g.fillRect(6, 40, 116, 80);
  g.fillStyle = '#14171c'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const words = name.split(' '), size = Math.min(26, 220 / Math.max(...words.map((w) => w.length)));
  g.font = `700 ${size}px "Hiragino Sans", sans-serif`;
  words.slice(0, 2).forEach((w, k, a) => g.fillText(w, 64, 80 + (k - (a.length - 1) / 2) * (size + 4)));
  g.restore();
  const t = { col, row }; atlasTiles.set(name, t); return t;
}
function tileUV(geo: THREE.BufferGeometry, { col, row }: { col: number; row: number }) {   // 正面（+z、頂点 16〜19）に札、ほかの面は札のふちの色
  const uv = geo.attributes.uv, x0 = (col * TILE_W) / ATLAS, y0 = 1 - ((row + 1) * TILE_H) / ATLAS;
  for (let i = 0; i < uv.count; i++) {
    if (i >= 16 && i < 20) uv.setXY(i, x0 + (uv.getX(i) * TILE_W) / ATLAS, y0 + (uv.getY(i) * TILE_H) / ATLAS);
    else uv.setXY(i, x0 + 3 / ATLAS, y0 + (TILE_H - 10) / ATLAS);
  }
  return geo;
}

{
  const hitMat = new THREE.MeshBasicMaterial();
  const productGeos: THREE.BufferGeometry[] = [], boardGeos: THREE.BufferGeometry[] = [];
  const islandMat = new THREE.MeshLambertMaterial({ color: 0xc3c8d0 });
  // 客が入れない部屋（事務所・バックヤードなど）。歩けず、視線もさえぎる。名前は鳴らさない
  const roomMat = new THREE.MeshLambertMaterial({ color: 0x9aa1ab, transparent: true, opacity: 0.55 });
  for (const r of shop.rooms) {
    const [cx, cz, w, h, d] = r.box, m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), roomMat);
    m.position.set(cx, h / 2, cz); scene.add(m); occluders.push(m); blockers.push(m);
    makeLabel({ name: r.name, level: 0, children: [] }, new THREE.Vector3(cx, h + 0.4, cz), 0.8);
  }
  for (const isl of ISLANDS) {
    const [cx, cz, w, h, d] = isl.box!;
    const doorRect = isl.rects!.find((r) => r.door);
    isl.mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), islandMat);
    isl.mesh.position.set(cx, h / 2, cz); isl.mesh.userData.island = isl; scene.add(isl.mesh); occluders.push(isl.mesh); blockers.push(isl.mesh);
    if (doorRect) isl.mesh.visible = false;   // 出口は見えない扉の面。カメラの判定にだけ使う
    // 扉の札は店の側へ少し出す（奥の部屋に隠れないように）
    makeLabel(isl, doorRect ? new THREE.Vector3(cx, 1.2, cz).addScaledVector(doorRect.g.n, 0.4) : new THREE.Vector3(cx, h + 0.75, cz), 1);
    for (const sh of isl.children) {   // 棚の面に薄い板を貼る（認識できたら紺）
      const g = sh.g!, span = sh.span!, y = sh.y!, tiers = sh.tiers!;
      const len = Math.abs(span[1] - span[0]) - 0.04, hh = y[1] - y[0];
      const mid = g.at((span[0] + span[1]) / 2, (y[0] + y[1]) / 2);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(len, hh), shelfMat.off);
      plane.position.copy(mid); plane.lookAt(mid.clone().add(g.n)); scene.add(plane); sh.plane = plane;
      makeLabel(sh, mid.clone().add(g.n.clone().multiplyScalar(0.35)).setY(h + 0.3), 0.7);
      for (let t = 0; tiers && t <= tiers; t++) {   // 棚板（ATM の画面など、棚板のない棚には作らない）
        const by = y[0] + ((y[1] - y[0]) * t) / tiers - 0.01;
        const board = new THREE.Object3D();
        board.position.copy(g.at((span[0] + span[1]) / 2, by)).add(g.n.clone().multiplyScalar((DEPTH + 0.04) / 2));
        board.lookAt(board.position.clone().add(g.n)); board.updateMatrixWorld();
        boardGeos.push(new THREE.BoxGeometry(len, 0.015, DEPTH + 0.04).applyMatrix4(board.matrixWorld));
      }
      for (const cat of sh.children) {
        makeLabel(cat, g.at((cat.span![0] + cat.span![1]) / 2, cat.y![1] + 0.06).add(g.n.clone().multiplyScalar(DEPTH + 0.03)), 0.42);
        for (const it of cat.children) {   // 商品は、正面に名前を書いた箱を各段に 1 つずつ
          const w2 = Math.abs(it.span![1] - it.span![0]) * 0.86, rowH = (it.y![1] - it.y![0]) / tiers, hh2 = rowH * 0.78;
          const geo = new THREE.BoxGeometry(w2, hh2, DEPTH), tile = atlasTile(it.name);
          for (let t = 0; t < tiers; t++) {
            // 当たり判定用の見えない箱（光線は見えない物にも当たる）。描くのは、まとめた 1 つのメッシュ
            const box = new THREE.Mesh(geo, hitMat); box.visible = false;
            box.position.copy(g.at((it.span![0] + it.span![1]) / 2, it.y![0] + rowH * t + hh2 / 2 + 0.005)).add(g.n.clone().multiplyScalar(DEPTH / 2));
            box.lookAt(box.position.clone().add(g.n));
            box.userData = { island: isl, el: it }; scene.add(box); occluders.push(box);
            box.updateMatrixWorld(); productGeos.push(tileUV(geo.clone(), tile).applyMatrix4(box.matrixWorld));
          }
        }
      }
    }
  }
  const tex = new THREE.CanvasTexture(atlasCanvas); tex.anisotropy = 4;
  scene.add(new THREE.Mesh(mergeGeometries(productGeos), new THREE.MeshLambertMaterial({ map: tex })));
  scene.add(new THREE.Mesh(mergeGeometries(boardGeos), new THREE.MeshLambertMaterial({ color: 0xf7f8fa })));
}

// ---------- 人とカメラ ----------
export const player = new THREE.Object3D();
player.position.copy(START);
scene.add(player);
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 4, 12), new THREE.MeshLambertMaterial({ color: NAVY }));
body.position.y = 0.8; player.add(body);
export const head = new THREE.Object3D(); head.position.y = EAR_Y; head.rotation.order = 'YXZ'; player.add(head);
const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 12), new THREE.MeshLambertMaterial({ color: 0xc98a00 }));   // 上からの視点で頭の向きが分かるように
nose.rotation.x = -Math.PI / 2; nose.position.z = -0.22; head.add(nose);
/** スマホの画面 */
export const headCam = new THREE.PerspectiveCamera(75, 1, 0.05, 100); head.add(headCam);
export const chest = new THREE.Object3D(); chest.position.y = CAM_Y; player.add(chest);
/** PC の「カメラの映像で見る」 */
export const fpCam = new THREE.PerspectiveCamera(60, 1, 0.05, 100); chest.add(fpCam);
export const topCam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
topCam.position.set(0, 17, 8); topCam.lookAt(0, 0, 0.5);
/** 認識に使う、スマホの画面と同じ視野のカメラ */
export const viewCam = new THREE.PerspectiveCamera(headCam.fov, 0.5, 0.05, 100); head.add(viewCam);

export const world = {
  cam: (ROLE === 'phone' ? headCam : topCam) as THREE.PerspectiveCamera,
  /** スマホの画面の縦横比（PC にはスマホから届く） */
  screenAspect: 0.5,
  /** 認識する横の視野角 */
  fovDeg: 80,
  fan: null as THREE.Mesh | null,
};

// 認識する範囲の扇形（PC の上からの視点だけ）
const fanMat = new THREE.MeshBasicMaterial({ color: NAVY, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
function setFan(deg: number) {
  if (world.fan) { player.remove(world.fan); world.fan.geometry.dispose(); }
  const a = THREE.MathUtils.degToRad(deg);
  world.fan = new THREE.Mesh(new THREE.CircleGeometry(VIEW_RANGE, 48, Math.PI / 2 - a / 2, a), fanMat);
  world.fan.rotation.x = -Math.PI / 2; world.fan.position.y = 0.015; world.fan.visible = world.cam === topCam; player.add(world.fan);
}
function fitFpCam() {   // 横の画角を視野角にそろえる（three.js の fov は縦）
  fpCam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(Math.min(world.fovDeg, 170)) / 2) / fpCam.aspect));
  fpCam.updateProjectionMatrix();
}
/** 認識の視野を、スマホの画面（またはスライダーで固定した視野角）に合わせる */
export function applyView() {
  const tanV = Math.tan(THREE.MathUtils.degToRad(viewCam.fov) / 2);
  const deg = settings.fovManual ?? THREE.MathUtils.radToDeg(2 * Math.atan(tanV * world.screenAspect));
  const a = Math.tan(THREE.MathUtils.degToRad(Math.min(deg, 170)) / 2) / tanV;
  if (deg === world.fovDeg && viewCam.aspect === a && world.fan) return;
  world.fovDeg = deg; viewCam.aspect = a; viewCam.updateProjectionMatrix();
  setFan(deg); fitFpCam();
}
/** PC の視点を、上からとカメラの映像で切り替える */
export function toggleCam() {
  world.cam = world.cam === topCam ? fpCam : topCam;
  body.visible = nose.visible = world.cam === topCam;
  if (world.fan) world.fan.visible = world.cam === topCam;
}
body.visible = nose.visible = world.cam === topCam;

// 手の向きを示す線と、指した点
export const handLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
  new THREE.LineBasicMaterial({ color: 0xb8bec8 }));
scene.add(handLine);
export const handDot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color: 0xc98a00 }));
handDot.visible = false; scene.add(handDot);

export function resize() {
  const w = viewEl.clientWidth, h = viewEl.clientHeight;
  renderer.setSize(w, h); fpCam.aspect = topCam.aspect = headCam.aspect = w / h;
  topCam.updateProjectionMatrix(); headCam.updateProjectionMatrix(); fitFpCam();
  if (ROLE === 'phone') world.screenAspect = w / h;
  applyView();
}
