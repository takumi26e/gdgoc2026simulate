// テスト用（URL に ?debug を付けたときだけ window.__sim に出す）
import * as THREE from 'three';
import { audio, voices } from './audio/engine';
import { listen, wanted } from './audio/select';
import { link } from './link';
import { hand, pointedElement } from './sim/hand';
import { nav, startNav, stopNav } from './sim/nav';
import { walkers } from './sim/npc';
import { onOrientation } from './sim/orientation';
import { recog } from './sim/recognition';
import { trail } from './sim/trail';
import { ISLANDS, JUNCTIONS, ROADS, planFrom } from './shop';
import { input, settings } from './state';
import { blockers, head, headCam, occluders, player, renderer, viewCam, world } from './world';

export function installDebug() {
  (window as unknown as { __sim: unknown }).__sim = {
    THREE, ISLANDS, ROADS, JUNCTIONS, roadPlan: planFrom, player, head, headCam, viewCam, occluders, blockers, renderer,
    nav, startNav, stopNav, hand, pointedElement, wanted, listen, trail, walkers, voices, link, settings, onOrientation,
    get keys() { return input.keys; }, get cam() { return world.cam; }, get gridTick() { return recog.tick; },
    get ctx() { return audio.ctx; }, get started() { return audio.started; }, get mode() { return settings.mode; },
    get modeGain() { return audio.modeGain; }, get limiter() { return audio.limiter; },
  };
}
