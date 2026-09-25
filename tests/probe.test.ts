import { expect, it } from 'vitest';
import { determinismProbe } from '@/sim/probe';
import { GOLDEN_PROBE } from '../e2e/golden';

it('determinism probe matches the golden value shared with the browser e2e suite', () => {
  expect(determinismProbe()).toBe(GOLDEN_PROBE);
});
