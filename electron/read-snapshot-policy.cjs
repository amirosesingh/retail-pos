const rules = require("./read-permissions.json");
const names = { tiers: "membership_tiers", settings: "pos_settings" };
function filterSnapshot(snapshot, authority) {
  return Object.fromEntries(Object.entries(snapshot).map(([key, value]) => {
    const flags = rules[names[key] ?? key];
    const allowed = !flags || (authority.hasPosAuthority() &&
      (authority.hasLevel("admin") || flags.some(flag => authority.hasPermission(flag))));
    return [key, allowed ? value : Array.isArray(value) ? [] : null];
  }));
}
module.exports = { filterSnapshot };
