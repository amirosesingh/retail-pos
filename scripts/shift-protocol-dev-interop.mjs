import { resolve } from 'node:path';

const names = 'normalizeClosingStart, closingStartMessage, normalizeBinding, normalizeEnrollment, normalizeAttestation, enrollmentMessage, intentMessage';
const footer = `module.exports = { ${names} };`;
const normalizePath = value => value.replaceAll('\\', '/');

/** Vite's dev SSR evaluator needs ESM exports for this one shared wire module. */
export function shiftProtocolDevInterop() {
  let protocolPath;
  return {
    name: 'shift-protocol-dev-interop',
    apply: 'serve',
    enforce: 'pre',
    configResolved(config) {
      protocolPath = normalizePath(resolve(config.root, 'electron/security/shift-author-protocol.cjs'));
    },
    transform(source, id) {
      if (normalizePath(id.split('?')[0]) !== protocolPath) return null;
      if (!source.trimEnd().endsWith(footer) || source.split('module.exports').length !== 2) {
        throw new Error('Unexpected shared shift protocol exports; review the development interop boundary.');
      }
      const start = source.lastIndexOf(footer);
      return { code: `${source.slice(0, start)}export { ${names} };\n`, map: null };
    },
  };
}
