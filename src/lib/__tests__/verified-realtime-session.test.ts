import { expect, it } from "vitest";
import {
  setCentralAuthSessionPresent,
  subscribeCentralAuthSession,
  hasCentralAuthSession,
} from "../session-presence";
it("publishes only verified session changes and not repeated cached state", () => {
  setCentralAuthSessionPresent(false);
  const changes: boolean[] = [];
  const stop = subscribeCentralAuthSession(() => changes.push(hasCentralAuthSession()));
  setCentralAuthSessionPresent(false);
  setCentralAuthSessionPresent(true, "verified-token");
  setCentralAuthSessionPresent(true, "verified-token");
  setCentralAuthSessionPresent(true, "refreshed-token");
  setCentralAuthSessionPresent(false);
  stop();
  setCentralAuthSessionPresent(true, "next-token");
  expect(changes).toEqual([true, true, false]);
  setCentralAuthSessionPresent(false);
});
