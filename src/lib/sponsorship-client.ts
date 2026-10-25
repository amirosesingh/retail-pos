import { hostedFunction } from "./hosted-function-client";
import {
  loadSponsorships as load,
  requestSponsorship as request,
  handOverSponsorship as handOver,
  loadSponsorshipDailyValues as daily,
} from "./sponsorship.functions";
export const loadSponsorships = hostedFunction("sponsorship.loadSponsorships", load);
export const requestSponsorship = hostedFunction("sponsorship.requestSponsorship", request);
export const handOverSponsorship = hostedFunction("sponsorship.handOverSponsorship", handOver);

export const loadSponsorshipDailyValues = hostedFunction(
  "sponsorship.loadSponsorshipDailyValues",
  daily,
);

import {
  getSponsorshipAccess as access,
  getSponsorshipDirectPolicy as directPolicy,
  saveSponsorshipDirectPolicy as savePolicy,
} from "./sponsorship.functions";
export const getSponsorshipAccess = hostedFunction("sponsorship.getSponsorshipAccess", access);
export const getSponsorshipDirectPolicy = hostedFunction(
  "sponsorship.getSponsorshipDirectPolicy",
  directPolicy,
);
export const saveSponsorshipDirectPolicy = hostedFunction(
  "sponsorship.saveSponsorshipDirectPolicy",
  savePolicy,
);
