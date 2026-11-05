import {execFileSync} from 'node:child_process';
import {describe,it,expect} from 'vitest';

// These entry points accept no database URL and create only disposable fixtures.
// Actual native PostgreSQL/SQL Server contention is separately opt-in.
describe('FIN62 isolated cloud validation preparation',()=>{
  it.each([
    ['scripts/test-shift-financial-math.mjs',/FIN62.*groups passed|financial.*groups passed/i],
    ['scripts/test-shift-financial-cloud-receipts.mjs',/groups passed/],
    ['scripts/test-shift-financial-version-receipts.mjs',/groups passed/],
    ['scripts/test-shift-financial-known-basis.mjs',/groups passed/],
    ['scripts/test-shift-financial-admission.mjs',/guarded financial admission groups passed/],
  ])('passes %s without an operator connection',(script,summary)=>{
    const output=execFileSync(process.execPath,[script],{encoding:'utf8',windowsHide:true,timeout:90000});
    expect(output).toMatch(summary);
  },95000);
});