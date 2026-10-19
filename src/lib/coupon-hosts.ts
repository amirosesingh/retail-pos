/**
 * Public-facing subdomains for member signup and coupon redemption.
 *
 * The hosts are NOT hardcoded: an administrator sets them in
 * System & Integrations and they are applied here at runtime. Until settings
 * have loaded (or when nothing is configured) the current origin is used, so
 * the pages always work on the main domain and in the preview.
 */
import { releasePublicHosts } from "./release-public-hosts";
type PublicHosts = { member: string; redeem: string };

let hosts: PublicHosts = { member: "", redeem: "" };

/** Strip scheme, path and trailing slash so only the hostname remains. */
export function toHostname(value: string): string {
  const v = (value || "").trim().toLowerCase();
  if (!v) return "";
  const stripped = v.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  return stripped.replace(/\/+$/, "");
}

/** Called whenever settings load or an admin saves new domains. */
export function setPublicHosts(memberDomain: string, redeemDomain: string) {
  const next = releasePublicHosts({ member: toHostname(memberDomain), redeem: toHostname(redeemDomain) });
  if (next.member === hosts.member && next.redeem === hosts.redeem) return;
  hosts = next;
}

const fallbackOrigin = () =>
  typeof window !== "undefined" ? window.location.origin : "";

const origin = (host: string) => {
  if (!host) return fallbackOrigin();
  if (typeof window !== "undefined" && window.location.hostname === host) {
    return window.location.origin;
  }
  return `https://${host}`;
};

/** Public link a customer opens to register as a member. */
export const joinUrl = () => `${origin(hosts.member)}/join`;

/** Public link that hands out a voucher for a campaign. */
export const claimUrl = (slug: string) => `${origin(hosts.redeem)}/claim/${slug}`;

/** Personal voucher link, the one printed as a QR code. */
export const voucherUrl = (token: string) => `${origin(hosts.redeem)}/c/${token}`;
