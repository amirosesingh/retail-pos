import { serviceRest } from "@/core/api/pos-relay.server";
import { isVisibleActiveSession, SESSION_ACTIVITY_WINDOW_MS } from "./session-activity";
import type { DeviceSession } from "./user-sessions.functions";

/** Read-only view: historical revocations remain available to server-side audit. */
export async function readActiveSessions(now = Date.now()): Promise<DeviceSession[]> {
  const sessions: DeviceSession[] = [];
  const pageSize = 200;
  // Page before filtering expired/deleted accounts so old rows cannot crowd live ones out.
  for (let offset = 0; sessions.length < 200; offset += pageSize) {
    const query = new URLSearchParams({
      select: "id,kind,label,staff_user_id,branch_id,terminal_id,platform,idle_timeout_minutes,last_activity_at,is_revoked,created_at",
      is_revoked: "eq.false",
      last_activity_at: `gt.${new Date(now - SESSION_ACTIVITY_WINDOW_MS).toISOString()}`,
      order: "last_activity_at.desc,id.desc", limit: String(pageSize), offset: String(offset),
    });
    const res = await serviceRest(`user_sessions?${query}`);
    if (!res.ok) throw new Error("Could not read active sessions. Try again.");
    const page = await res.json() as DeviceSession[];
    const live = page.filter(session => isVisibleActiveSession(session, now));
    const ids = [...new Set(live.map(session => session.staff_user_id).filter((id): id is string => !!id))];
    const activeStaff = new Set<string>();
    for (let start = 0; start < ids.length; start += 50) {
      const users = await serviceRest(`app_users?${new URLSearchParams({
        select: "user_id", is_active: "eq.true",
        user_id: `in.(${ids.slice(start, start + 50).map(id => JSON.stringify(id)).join(",")})`,
      })}`);
      if (!users.ok) throw new Error("Could not verify session accounts. Try again.");
      for (const user of await users.json() as {user_id: string}[]) activeStaff.add(user.user_id);
    }
    sessions.push(...live.filter(session => session.staff_user_id
      ? activeStaff.has(session.staff_user_id) : session.kind === "terminal"));
    if (page.length < pageSize) break;
  }
  return sessions.slice(0, 200);
}
