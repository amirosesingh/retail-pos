import {execFileSync} from 'node:child_process';
import {describe,it,expect} from 'vitest';

describe('reviewed financial and sharing upgrades compose',()=>{
 it('runs both exact artifacts and guarded checkout/history paths in portable disposable PostgreSQL',()=>{
  const output=execFileSync(process.execPath,['scripts/test-shift-financial-sharing-composition.mjs'],{
   encoding:'utf8',windowsHide:true,timeout:90000,
  });
  expect(output).toMatch(/7 composed financial\/sharing groups passed \(portable PGlite\)/);
 },95000);
});
