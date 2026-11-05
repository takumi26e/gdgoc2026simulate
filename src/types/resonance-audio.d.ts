// resonance-audio（Google）の、このアプリで使う部分だけの型
declare module 'resonance-audio' {
  export interface Source { input: AudioNode; setPosition(x: number, y: number, z: number): void }
  export class ResonanceAudio {
    constructor(ctx: AudioContext, options?: { ambisonicOrder?: number });
    output: AudioNode;
    createSource(options?: { rolloff?: string; minDistance?: number; maxDistance?: number }): Source;
    setRoomProperties(dimensions: { width: number; height: number; depth: number }, materials: Record<string, string>): void;
    setListenerFromMatrix(matrix: { elements: ArrayLike<number> }): void;
  }
}
