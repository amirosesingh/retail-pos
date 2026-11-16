"use strict";

// SQL diagnostics only: never replace an error, retry decision or pending count.
// Driver errors can carry row values, SQL text and credentials. Read only these
// bounded own data fields, and export only the positive numeric SQL identifier.
const own = (object, key) => {
  try { return Object.getOwnPropertyDescriptor(object, key)?.value; }
  catch { return undefined; }
};
const sqlNumber = value => {
  if (typeof value === "string") {
    if (!/^[0-9]{1,10}$/.test(value)) return null;
    value = Number(value);
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647 ? value : null;
};
function sqlErrorDiagnostic(error) {
  try {
    const seen = new WeakSet(), numbers = []; let visited = 0;
    const visit = (value, inheritedSql = false, depth = 0) => {
      if (!value || !["object", "function"].includes(typeof value) || depth > 5 || visited >= 32 || seen.has(value)) return;
      seen.add(value); visited++;
      const code = own(value, "code"), name = own(value, "name"), state = own(value, "sqlstate");
      const nativeSql = inheritedSql || code === "EREQUEST" || code === "ESQLSERVER_WRITE" || name === "RequestError" ||
        (typeof state === "string" && /^[0-9A-Z]{5}$/i.test(state));
      const array = candidate => {
        try {
          if (!Array.isArray(candidate)) return;
          const length = own(candidate, "length");
          if (!Number.isInteger(length) || length < 0) return;
          for (let i = 0; i < Math.min(length, 8); i++) visit(own(candidate, String(i)), nativeSql, depth + 1);
        } catch { /* A malformed diagnostic branch does not hide its parent. */ }
      };
      // Earlier SQL errors are commonly wrapped by 3621, "statement terminated".
      // Preserve the meaningful cause when present without changing the error.
      array(own(value, "precedingErrors"));
      array(value);
      const tagged = sqlNumber(own(value, "sqlNumber"));
      if (tagged !== null) numbers.push(tagged);
      if (nativeSql) {
        for (const candidate of [own(value, "number"), code]) {
          const number = sqlNumber(candidate); if (number !== null) numbers.push(number);
        }
      }
      for (const key of ["info", "originalError", "cause"]) visit(own(value, key), nativeSql, depth + 1);
    };
    visit(error);
    const number = numbers.find(value => value !== 3621) ?? numbers[0];
    return number === undefined ? {} : { sqlNumber: number };
  } catch { return {}; }
}
module.exports = { sqlErrorDiagnostic };
