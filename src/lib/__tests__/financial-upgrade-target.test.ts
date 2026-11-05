import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { validateReviewTarget } = require('../../../scripts/generate-shift-financial-upgrade.cjs');
const valid = { organizationId: 'a'.repeat(20), project: 'isolated-test', projectId: 'b'.repeat(20), url: `https://${'b'.repeat(20)}.supabase.co`, database: 'postgres' };
describe('financial upgrade approval-target metadata', () => {
  it('accepts a canonical matching review target without making a connection', () => {
    expect(validateReviewTarget(valid)).toBe(valid);
  });
  it.each([
    { ...valid, url: `https://${'c'.repeat(20)}.supabase.co` },
    { ...valid, url: valid.url.replace('https:', 'http:') },
    { ...valid, url: valid.url + '/' },
    { ...valid, url: valid.url + '?project=other' },
    { ...valid, url: valid.url + '#other' },
    { ...valid, url: valid.url.replace('https://', 'https://user:password@') },
    { ...valid, projectId: 'invalid' },
    { ...valid, database: 'another_database' },
    { ...valid, connectionString: 'not-supported' },
  ])('rejects mismatched or noncanonical approval metadata %#', (target) => {
    expect(() => validateReviewTarget(target)).toThrow();
  });
});
