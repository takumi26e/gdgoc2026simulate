// このアプリで使う店（store.json から一度だけ作る）
import { Vector3 } from 'three';
import { makeBlocked } from './core/geometry';
import { makeKemar, type KemarData } from './core/kemar';
import { buildRoads, junctions, roadPlan } from './core/roads';
import { makeRouter } from './core/route';
import { buildStore, type StoreData } from './core/store';
import kemarData from './data/kemar.json';
import soundFiles from './data/sounds.json';
import storeData from './data/store.json';

export const shop = buildStore(storeData as unknown as StoreData);
export const ISLANDS = shop.islands;
export const NODES = shop.nodes;
export const START = new Vector3(-4.9, 0, 4.2);   // 入口を入った所
export const blocked = makeBlocked(shop);
export const router = makeRouter(shop, blocked);
export const ROADS = buildRoads(NODES);
export const JUNCTIONS = junctions(ROADS);
export const planFrom = (p: { x: number; z: number }) => roadPlan(ROADS, JUNCTIONS, p);
export const kemar = makeKemar(kemarData as KemarData);
/** 名前 → public/sounds の WAV */
export const SOUND_FILES: Record<string, string> = soundFiles;
/** 店のデータの版。PC とスマホで違えば、古いほうを読み込み直すよう画面に出す */
export const BUILD = `${JSON.stringify(storeData).length}-${Object.keys(soundFiles).length}`;
