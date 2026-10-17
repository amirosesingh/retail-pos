export type PublicHostConfig = { member: string; redeem: string };

/** Host matching is exact; unrelated POS and preview hosts keep their own routes. */
export function configuredPublicHost(host: string, config: PublicHostConfig) {
  const normalize = (value: string) => {
    try { return new URL(value.includes("://") ? value : `https://${value}`).host.toLowerCase(); }
    catch { return ""; }
  };
  const current = normalize(host);
  return {
    member: !!current && !!config.member && current === normalize(config.member),
    redeem: !!current && !!config.redeem && current === normalize(config.redeem),
  };
}

export function publicHostPage(
  host: { member: boolean; redeem: boolean },
  pathname: string,
  flags: { member: boolean; redeem: boolean },
): "pos" | "member-root" | "voucher-root" | "customer" | "closed" {
  if (!host.member && !host.redeem) return "pos";
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    if (host.member && flags.member) return "member-root";
    if (host.redeem && flags.redeem) return "voucher-root";
    return "closed";
  }
  if (host.member && flags.member && ["/join", "/membership"].includes(path)) return "customer";
  if (host.redeem && flags.redeem && (/^\/claim\/[^/]+$/.test(path) || /^\/c\/[^/]+$/.test(path))) return "customer";
  return "closed";
}
