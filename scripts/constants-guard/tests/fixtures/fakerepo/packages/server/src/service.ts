import { WIRED_LIMIT } from '@fake/shared';

export function capped(n: number): number {
  return Math.min(n, WIRED_LIMIT);
}
