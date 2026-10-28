import { describe, it, expect } from 'vitest';
import { newSnowflake, snowflakeTime, isSnowflake } from '@subspace/database';

describe('Snowflake IDs', () => {
  it('are unique and rise with time, even many in one millisecond', () => {
    const ids = Array.from({ length: 20_000 }, () => newSnowflake());
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) expect(BigInt(ids[i]) > BigInt(ids[i - 1])).toBe(true);
  });

  it('carry their creation time', () => {
    const before = Date.now();
    const id = newSnowflake();
    const t = snowflakeTime(id).getTime();
    expect(t).toBeGreaterThanOrEqual(before - 1);
    expect(t).toBeLessThanOrEqual(Date.now());
  });

  it('are positive 64-bit integers written in decimal', () => {
    const id = newSnowflake();
    expect(isSnowflake(id)).toBe(true);
    expect(BigInt(id) < 1n << 63n).toBe(true);
    for (const bad of ['', '0', '01', '12a', '-5', '9223372036854775808', 'deefc586-cdcb-427e-b6a5-60d139deaf4b', 12 as unknown as string]) {
      expect(isSnowflake(bad)).toBe(false);
    }
  });
});
