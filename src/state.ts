// ページ全体で共有する状態
import { DEFAULT_SETTINGS, type Settings } from './config';

/** PC は移動と設定、スマホは左右の向き・手のボタン・音を担当する */
export const ROLE: 'pc' | 'phone' = location.pathname.includes('phone') ? 'phone' : 'pc';
/** 設定パネルの値。PC で変えるとスマホにも届く */
export const settings: Settings = { ...DEFAULT_SETTINGS };
export const input = { keys: new Set<string>(), mouseDown: false };
export const display = { blackout: false };
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
