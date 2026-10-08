/** UUID casing is presentation; preserve the case of ordinary text keys. */
function canonicalEntityKey(value) {
  return String(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    uuid => uuid.toLowerCase());
}
module.exports = { canonicalEntityKey };
