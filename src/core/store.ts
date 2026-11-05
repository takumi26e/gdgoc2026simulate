// 店のデータ: 島 → 棚 → カテゴリ → 商品。store.json から、面の座標つきの木を作る
import { Vector3 } from 'three';

export type Face = '+x' | '-x' | '+z' | '-z';
export type Box = [cx: number, cz: number, w: number, h: number, d: number];
export interface FaceGeo { n: Vector3; at(u: number, y: number): Vector3 }
/** 面の上の範囲。span は面に沿った座標（±z の面なら x、±x の面なら z）、y は高さ */
export interface Rect { face: Face; g: FaceGeo; span: [number, number]; y: [number, number] }

export interface StoreData {
  islands: {
    id: string; name: string; box: Box; approach: string; door?: Face;
    shelves: { name: string; face: Face; span: [number, number]; tiers: number; categories: { name: string; items: string[] }[] }[];
  }[];
  rooms?: { name: string; box: Box }[];
  nodes: Record<string, [number, number]>;
  edges: [string, string][];
  phrases: string[];
}

/** 島・棚・カテゴリ・商品と、扉の面。level は 0: 島、1: 棚、2: カテゴリ、3: 商品 */
export interface El extends Partial<Rect> {
  level: number; name: string; parent?: El; children: El[];
  /** 島は id、棚は「島の id/番号」。PC とスマホで同じ物を指すのに使う */
  key?: string;
  id?: string; box?: Box; approach?: string; tiers?: number; door?: boolean;
  /** 島の、認識に使う面（棚と扉） */
  rects?: RectEl[];
  // 実行中に決まる値
  seen?: boolean; seenTick?: number; aimSeen?: Vector3 | null; base?: number; samples?: Vector3[];
}
export type RectEl = El & Rect;

export interface Store {
  islands: El[];
  all: El[];
  rooms: { name: string; box: Box }[];
  nodes: Record<string, Vector3>;
  edges: [string, string][];
  /** 出口の左右の端の x */
  exit: [number, number];
  phrases: string[];
}

export const nameOf = (raw: string) => raw.split('|')[0];
/** 上の抽象度へたどる */
export const up = (el: El, level: number) => { let e: El | undefined = el; while (e && e.level > level) e = e.parent; return e ?? el; };

/** 面の上の点 (u, y) を世界座標へ */
export function faceGeo(box: Box, face: Face): FaceGeo {
  const [cx, cz, w, , d] = box, e = 0.02;
  if (face === '+z') return { n: new Vector3(0, 0, 1), at: (u, y) => new Vector3(u, y, cz + d / 2 + e) };
  if (face === '-z') return { n: new Vector3(0, 0, -1), at: (u, y) => new Vector3(u, y, cz - d / 2 - e) };
  if (face === '+x') return { n: new Vector3(1, 0, 0), at: (u, y) => new Vector3(cx + w / 2 + e, y, u) };
  return { n: new Vector3(-1, 0, 0), at: (u, y) => new Vector3(cx - w / 2 - e, y, u) };
}

export function buildStore(data: StoreData): Store {
  const islands: El[] = [];
  for (const src of data.islands) {
    const isl: El = { level: 0, name: src.name, key: src.id, id: src.id, box: src.box, approach: src.approach, children: [], rects: [] };
    const h = src.box[3], top = h - 0.05, bot = 0.08;
    for (const [k, sh] of src.shelves.entries()) {
      const g = faceGeo(src.box, sh.face);
      const shelf: RectEl = { level: 1, name: sh.name, key: `${src.id}/${k}`, parent: isl, face: sh.face, g, span: sh.span, y: [bot, top], tiers: sh.tiers, children: [] };
      // カテゴリは縦の区画（縦陳列）。幅は商品の数に比例させる
      const total = sh.categories.reduce((a, c) => a + c.items.length, 0);
      let u = sh.span[0];
      for (const c of sh.categories) {
        const u1 = u + (sh.span[1] - sh.span[0]) * c.items.length / total;
        const cat: RectEl = { level: 2, name: c.name, parent: shelf, face: sh.face, g, span: [u, u1], y: [bot, top], children: [] };
        // 商品は区画の中の縦の 1 列。どの段にも同じ商品を並べる
        c.items.forEach((raw, k) => {
          const a = u + (u1 - u) * k / c.items.length, b = u + (u1 - u) * (k + 1) / c.items.length;
          cat.children.push({ level: 3, name: nameOf(raw), parent: cat, face: sh.face, g, span: [a, b], y: [bot, top], children: [] });
        });
        shelf.children.push(cat); u = u1;
      }
      isl.children.push(shelf); isl.rects!.push(shelf);
    }
    if (src.door) {   // 出口やトイレの扉。認識にだけ使う面
      const [cx, cz, w, , d] = src.box;
      isl.rects!.push({ level: 1, name: src.name, parent: isl, children: [], door: true, face: src.door, g: faceGeo(src.box, src.door),
        span: src.door.endsWith('z') ? [cx - w / 2, cx + w / 2] : [cz - d / 2, cz + d / 2], y: [0.1, h] });
    }
    islands.push(isl);
  }
  const all: El[] = [];
  (function walk(list: El[]) { for (const e of list) { all.push(e); walk(e.children); } })(islands);
  const exit = data.islands.find((i) => i.door === '-z')!.box;
  return {
    islands, all, rooms: data.rooms ?? [], edges: data.edges, phrases: data.phrases,
    nodes: Object.fromEntries(Object.entries(data.nodes).map(([k, [x, z]]) => [k, new Vector3(x, 0, z)])),
    exit: [exit[0] - exit[2] / 2, exit[0] + exit[2] / 2],
  };
}
