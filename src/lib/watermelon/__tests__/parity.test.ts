import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WatermelonDrop, WatermelonSnapshot } from '../api';

const source = readFileSync(resolve('public/games/watermelon/engine.js'), 'utf8');
const engine = new Function(`${source}; return MelonMelt;`)() as {
  initial(seed: string): WatermelonSnapshot;
  replay(seed: string, state: WatermelonSnapshot, tick: number, drops: WatermelonDrop[]): WatermelonSnapshot;
  spawnLevel(seed: string, index: number): number;
};
const data = JSON.parse(readFileSync(resolve('backend/internal/gamewatermelon/testdata/fixtures.json'), 'utf8')) as {
  fixtures: { name: string; seed: string; initial_state?: WatermelonSnapshot; segments: { to_tick: number; drops: WatermelonDrop[]; expected: WatermelonSnapshot }[] }[];
};
const vectors = JSON.parse(readFileSync(resolve('backend/internal/gamewatermelon/testdata/spawn-vectors.json'), 'utf8')) as { seed: string; start_index: number; levels: number[] }[];

describe('与 Go 服务端共用的物理回放夹具', () => {
  for (const fixture of data.fixtures) {
    it(fixture.name, () => {
      let state = fixture.initial_state ?? engine.initial(fixture.seed);
      for (const segment of fixture.segments) {
        state = engine.replay(fixture.seed, state, segment.to_tick, segment.drops);
        expect(state).toEqual(segment.expected);
      }
    }, 60000);
  }
  it('水果序列与服务端完全一致', () => {
    for (const vector of vectors) expect(vector.levels.map((_, i) => engine.spawnLevel(vector.seed, vector.start_index + i))).toEqual(vector.levels);
  });
});
