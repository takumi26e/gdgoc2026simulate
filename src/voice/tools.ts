// Gemini が呼ぶ関数: 棚への案内、案内をやめる、読み上げのオン・オフ、周りにある物
import * as THREE from 'three';
import { clockDir, closestOn } from '../core/geometry';
import { roadRoute } from '../core/roads';
import { findGoals, goalNames } from '../core/search';
import type { El, RectEl } from '../core/store';
import { headYaw, link, linkSend } from '../link';
import { nav, startRoadNav, stopNav } from '../sim/nav';
import { people } from '../sim/npc';
import { ISLANDS, JUNCTIONS, NODES, ROADS, shop } from '../shop';
import { player } from '../world';

const AROUND = 6, PEOPLE_AROUND = 4;   // 周りの物として答える距離(m)、人の距離(m)

/** 方向（時計の文字盤）と距離を、Gemini が読みやすい形にする */
export function where(pos: THREE.Vector3) {
  const { h, d } = clockDir(player.position, headYaw(), pos);
  return { direction: `${h}時の方向`, distance_m: Math.round(d * 10) / 10 };
}
const facePoint = (g: El) => (g.level === 0 ? NODES[g.approach!] : (g as RectEl).g.at(((g as RectEl).span[0] + (g as RectEl).span[1]) / 2, 0));
const routeLength = (path: THREE.Vector3[]) => path.reduce((n, p, i) => n + (i ? p.distanceTo(path[i - 1]) : 0), 0);

export const TOOLS = [{
  functionDeclarations: [
    {
      name: 'go_to_shelf', behavior: 'BLOCKING',
      description: '利用者を店の中の棚や場所へ案内し始める。商品やカテゴリの名前でもよい（それが並ぶ棚へ案内する）。案内が始まると、次の地点でピコピコ音が鳴る。',
      parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: '行きたい棚・商品・カテゴリ・場所の名前（例: お茶、ツナマヨネーズ、レジ、出口）' } }, required: ['name'] },
    },
    { name: 'stop_guidance', behavior: 'BLOCKING', description: '棚への案内をやめる。' },
    {
      name: 'set_reading', behavior: 'BLOCKING',
      description: '近くの棚や商品の名前の読み上げを、オンまたはオフにする。',
      parameters: { type: 'OBJECT', properties: { on: { type: 'BOOLEAN', description: 'true で読み上げる、false で止める' } }, required: ['on'] },
    },
    {
      name: 'describe_surroundings', behavior: 'BLOCKING',
      description: `利用者の周り（${AROUND}m 以内）にある棚・場所・人を、近い順に、利用者から見た時計の方向と距離で返す。visible は、いまスマホのカメラに写っているか。`,
    },
  ],
}];

type Args = Record<string, unknown>;
export async function runTool(name: string, args: Args): Promise<Record<string, unknown>> {
  if (name === 'go_to_shelf') return goToShelf(String(args.name ?? ''));
  if (name === 'stop_guidance') { const was = nav.on; if (was) stopNav(); return { ok: true, was_guiding: was }; }
  if (name === 'set_reading') { linkSend({ reading: !!args.on }); return { ok: true, reading: link.state.reading }; }
  if (name === 'describe_surroundings') return describe();
  return { error: `知らない関数です: ${name}` };
}

function goToShelf(query: string) {
  const goals = findGoals(shop, query);
  if (!goals.length) return { ok: false, error: `「${query}」は店にありません`, places: goalNames(shop) };
  // 同じ名前の棚がいくつかあれば（両面のアイスなど）、道のりがいちばん短い棚へ
  const best = goals.map((g) => ({ g, path: roadRoute(ROADS, JUNCTIONS, player.position, facePoint(g)) }))
    .filter((c) => c.path).sort((a, b) => routeLength(a.path!) - routeLength(b.path!))[0];
  if (!best) return { ok: false, error: '道が見つかりません' };
  if (nav.on) stopNav();
  const started = startRoadNav(best.g);
  if (!started) return { ok: false, error: '案内を始められませんでした' };
  return {
    ok: true, goal: best.g.name, area: best.g.parent?.name ?? best.g.name,
    first_point: where(started.first), points: started.count, total_m: Math.round(routeLength(best.path!) * 10) / 10,
    matched: best.g.name === query ? undefined : `「${query}」は「${best.g.name}」にあります`,
  };
}

function describe() {
  const p = player.position, items: { name: string; kind: string; direction: string; distance_m: number; visible?: boolean }[] = [];
  for (const isl of ISLANDS) {
    if (!isl.children.length) {   // 出口やトイレ
      const q = closestOn(isl.rects![0], p);
      if (q.distanceTo(p) <= AROUND) items.push({ name: isl.name, kind: '場所', ...where(q), visible: !!isl.seen });
      continue;
    }
    for (const sh of isl.children as RectEl[]) {
      const q = closestOn(sh, p);
      if (new THREE.Vector2(q.x - p.x, q.z - p.z).length() <= AROUND) items.push({ name: sh.name, kind: `${isl.name}の棚`, ...where(q), visible: !!sh.seen });
    }
  }
  for (const q of people()) if (q.distanceTo(p) <= PEOPLE_AROUND) items.push({ name: '人', kind: '人', ...where(q) });
  items.sort((a, b) => a.distance_m - b.distance_m);
  return { items: items.slice(0, 12), guiding: nav.on ? nav.isl!.name : null, reading: link.state.reading };
}
