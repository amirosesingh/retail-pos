/** Main-process serialized reservation; renderer cannot reset an existing counter. */
function reserveBillCounter(store, prefix, minimum) {
  if (typeof prefix !== "string" || !/^[A-Z0-9-]{1,100}$/.test(prefix) ||
      !Number.isSafeInteger(minimum) || minimum < 1 || minimum >= Number.MAX_SAFE_INTEGER)
    return {ok:false, code:"EBILL_COUNTER", error:"Invalid bill counter request."};
  const key = `setting:pos.bill.counter:${prefix}`;
  const saved = Number(store.get(key) ?? 0);
  let legacy = null;
  try { legacy = JSON.parse(store.get("setting:pos.bill.seq") ?? "null"); } catch { /* old unset counter */ }
  const next = Math.max(minimum, Number.isSafeInteger(saved) ? saved : 0,
    legacy?.prefix === prefix && Number.isSafeInteger(legacy.next) ? legacy.next : 0);
  if (!Number.isSafeInteger(next + 1)) return {ok:false, code:"EBILL_COUNTER", error:"Bill counter limit reached."};
  const result = store.set(key, next + 1);
  return result.ok ? {ok:true, sequence:next} : {ok:false, code:"EBILL_COUNTER", error:"The device could not persist its bill counter."};
}
module.exports = { reserveBillCounter };
