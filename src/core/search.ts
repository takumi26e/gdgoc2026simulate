// 名前から行き先を探す。商品やカテゴリの名前でも、それが並ぶ棚を行き先にする
import type { El, Store } from './store';

/** 比べやすくする: 全角半角をそろえ、空白・中黒・記号を除き、ひらがなをカタカナにする */
export function normalize(s: string) {
  return s.normalize('NFKC').replace(/[\s・･、。,.!！?？「」『』()（）〜~ー-]/g, '')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)).toLowerCase();
}

/** 行き先にできる物: 棚、または棚のない島（出口・トイレ・ATM の画面など） */
export const goalOf = (el: El): El => {
  let e = el;
  while (e.level > 1 && e.parent) e = e.parent;
  return e.level === 0 && e.children.length ? e.children[0] : e;
};

/** 名前に合う行き先の候補。完全に一致する物を優先し、なければ一部が一致する物 */
export function findGoals(store: Store, query: string) {
  const q = normalize(query);
  if (!q) return [];
  const pick = (list: El[]) => { const lower = list.filter((e) => e.level > 0); return lower.length ? lower : list; };   // 棚や商品の名前で合えば、島の名前より優先する
  const exact = pick(store.all.filter((e) => normalize(e.name) === q));
  const hits = exact.length ? exact : pick(store.all.filter((e) => { const n = normalize(e.name); return n.includes(q) || q.includes(n); }));
  // 島の名前で言われたら、その島の棚をすべて候補にする（いちばん近い棚へ案内する）
  const goals = hits.flatMap((e) => (e.level === 0 && e.children.length ? e.children : [goalOf(e)]));
  return [...new Set(goals)];
}

/** 案内できる行き先の名前（Gemini に教える一覧） */
export const goalNames = (store: Store) => [...new Set(store.islands.flatMap((i) => (i.children.length ? i.children.map((s) => s.name) : [i.name])))];
