// Type surface of the app's DOM-free engine (../../engine.js), which the
// Worker imports verbatim so server-side replays stay identical to the
// client's. Only the members the server uses are declared.
declare module "*engine.js" {
  export interface Battle {
    a: string;
    b: string;
    winner: string;
    mode: string;
    ts: number;
  }
  export interface EngineRecord {
    r: number;
    w: number;
    l: number;
    hist: number[];
  }
  export interface Engine {
    replayBattles(battles: unknown[]): { recs: Record<string, EngineRecord>; battles: Battle[] };
    validStore(doc: unknown): boolean;
  }
  const engine: Engine;
  export default engine;
}
