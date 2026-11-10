import { resolve } from 'node:path';

const authorNames = 'normalizeClosingStart, closingStartMessage, normalizeBinding, normalizeEnrollment, normalizeAttestation, enrollmentMessage, intentMessage';
const contracts = [
  { file: 'shift-author-protocol.cjs', names: authorNames, footer: `module.exports = { ${authorNames} };`, bindingImport: false },
  { file: 'shift-financial-protocol.cjs', names: 'financialBasisMessage,normalizeFinancialBasisAttestation,openingFinancialBasisMessage,normalizeOpeningFinancialBasisAttestation', bindingImport: true },
  { file: 'financial-author-protocol.cjs', names: 'financialOperationMessage,normalizeFinancialAttestation,cashCheckoutMessage,normalizeCashCheckoutAttestation', bindingImport: true },
  { file: 'legacy-shift-recovery-protocol.cjs', names: 'ACTION, MAX_UPLOAD_BYTES, normalizeLegacyPayload, unsignedLegacyRecovery, normalizeLegacyRecovery, legacyRecoveryMessage, legacyRecoveryWire', bindingImport: true, spacedFooter: true },
];
const normalizePath = value => value.replaceAll('\\', '/');
const bindingRequire = /^const[ \t]+\{[ \t]*normalizeBinding[ \t]*\}[ \t]*=[ \t]*require\((['"])\.\/shift-author-protocol\.cjs\1\);[ \t]*$/m;

/** Vite dev SSR evaluates these exact shared CommonJS wire modules as ESM. */
export function shiftProtocolDevInterop() {
  let protocols = new Map();
  return {
    name: 'shift-protocol-dev-interop',
    apply: 'serve',
    enforce: 'pre',
    configResolved(config) {
      protocols = new Map(contracts.map(contract => [
        normalizePath(resolve(config.root, 'electron/security', contract.file)), contract,
      ]));
    },
    transform(source, id) {
      const contract = protocols.get(normalizePath(id.split('?')[0]));
      if (!contract) return null;
      const footer = contract.footer ?? (contract.spacedFooter
        ? `module.exports = { ${contract.names} };` : `module.exports={${contract.names}};`);
      if (!source.trimEnd().endsWith(footer) || source.split('module.exports').length !== 2) {
        throw new Error('Unexpected shared shift protocol exports; review the development interop boundary.');
      }
      let body = source.slice(0, source.lastIndexOf(footer));
      const requires = body.match(/\brequire[ \t]*\(/g) ?? [];
      if (contract.bindingImport) {
        if (requires.length !== 1 || !bindingRequire.test(body)) {
          throw new Error('Unexpected shared shift protocol imports; review the development interop boundary.');
        }
        body = body.replace(bindingRequire, "import { normalizeBinding } from './shift-author-protocol.cjs';");
      } else if (requires.length) {
        throw new Error('Unexpected shared shift protocol imports; review the development interop boundary.');
      }
      return { code: `${body}export { ${contract.names} };\n`, map: null };
    },
  };
}
