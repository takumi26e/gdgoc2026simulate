export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const hud = $('hud');
/** 読み上げ機能へ伝える文（画面には出さない） */
export const announce = $('announce');
