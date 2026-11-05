// 調整できる値をまとめる。店の座標（m）: x は左右、z は手前(+)と奥(-)、y は床からの高さ

export const W = 16, D = 10, H = 2.6;   // 店の横幅、奥行、天井の高さ
export const RADIUS = 0.3;              // 人の当たり判定
export const EAR_Y = 1.6, CAM_Y = 1.3;  // 耳（スマホの視点）の高さ、胸の高さ（距離の基準）
export const WALK_SPEED = 1.4;          // 歩く速さ(m/s)
export const DEPTH = 0.12;              // 商品の箱の奥行（棚の面から手前に出る）

// 音
export const MODES = ['resonance', 'kemar', 'browser'] as const;
export type Mode = (typeof MODES)[number];
export const GAP = 0.6;                 // 言葉と言葉のあいだの無音（秒）
export const REF = 1, ROLLOFF = 1.3;    // 距離による減衰（inverse モデル）
export const REVERB_SEND = 0.12;        // 店の反響を足すときの量

// 鳴らす物の選び方
export const LEVEL = ['島', '棚', 'カテゴリ', '商品'];
export const VIEW_RANGE = 4;            // 認識できる距離(m)。PC に表示する扇形の半径と同じ
export const READ_ANGLE = 70;           // 商品の面を正面から左右この角度までなら読み取れる
export const SEEN_HOLD = 4;             // 光線の格子が一巡する回数のあいだは、写っていることにする
export const GRID_X = 32, GRID_Y = 24;  // 認識に使う光線の数（毎回ずらして、4 回で 2 倍の細かさ）
export const NEAR_MARGIN = 0.15;        // 棚と商品の切り替えで、境目を行ったり来たりしないための余裕(m)
export const HEAR_MAX = 1;              // 「周りを聞く」で鳴らす数
export const HEAR_KEEP = 0.3;           // 長押しのとき、鳴っている物を近いものとして扱う量(m)
export const HOLD_SEC = 0.4;            // これより長く押すと長押し（秒）

// 音の道
export const TRAIL_GAIN = 0.3;
export const TRAIL_STEP = 1, TRAIL_POINTS = 5, TRAIL_Y = 1, TRAIL_JUNCTION = 0.5;   // 点の間隔(m)、1 方向の点の数、高さ(m)、交差点にいるとみなす距離(m)
export const TRAIL_PAUSE = 1.0, TRAIL_LOOK = 0.15, TRAIL_VOICES = 6;               // 長押しで繰り返す前の休み(秒)、予約の先読み(秒)、ボイスの数

// 色
export const NAVY = 0x1f3a68;

// 設定パネルの初期値（PC からスマホへ同期する）
export interface Settings {
  mode: Mode; roomOn: boolean; onlySeen: boolean; minRatio: number; minCover: number;
  fovManual: number | null; near: number; trailMs: number;
}
export const DEFAULT_SETTINGS: Settings = {
  mode: 'resonance', roomOn: false, onlySeen: true, minRatio: 0, minCover: 0, fovManual: null, near: 1, trailMs: 150,
};
