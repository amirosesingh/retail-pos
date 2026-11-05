import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('financial upgrade captured-source compatibility', () => {
  it('accepts reviewed source variants while rejecting altered permissions and owners atomically', () => {
    const output = execFileSync(process.execPath, ['scripts/test-shift-financial-web-live-compatibility.mjs'], {
      encoding: 'utf8', windowsHide: true, timeout: 90_000,
    });
    expect(output).toContain('PASS 5 captured-source artifact groups');
  }, 95_000);
});
