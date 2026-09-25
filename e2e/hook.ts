/** The window.__hotTail automation hook exposed by src/main.ts (tests only use this shape). */
export interface HotTailHook {
  state: string;
  simTime: number;
  score: number;
  errors: string[];
  probe: () => Promise<string>;
  debug?: {
    turbo(): void;
    damagePlayer(n: number): void;
    destroyBoss(): void;
    clearStage(): void;
    startGame(mode: string, stage: number): void;
  };
  app: {
    fps: number;
    stageIndex: number;
    save: { settings: Record<string, unknown>; progress: { furthestStage: number } };
    view: { style: string };
    sim: {
      score: { lives: number; score: number };
      player: { armor: number; invuln: number; missiles: number };
    };
  };
}

declare global {
  interface Window {
    __hotTail?: HotTailHook;
  }
}
