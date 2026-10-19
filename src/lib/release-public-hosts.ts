import { RELEASE_CHANNEL } from "./release-channel";

/** Beta links never change the production domains stored in shared settings. */
export function releasePublicHosts<T extends { member: string; redeem: string }>(hosts: T): T {
  return RELEASE_CHANNEL === "beta" ? {
    ...hosts,
    member: "beta-member.luckycharmsdnbhd.com",
    redeem: "beta-redeem.luckycharmsdnbhd.com",
  } : hosts;
}
