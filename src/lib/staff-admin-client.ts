/**
 * Staff mutations need Supabase Auth admin privileges. Web server functions
 * already run on the hosted backend; Electron and Android must explicitly
 * send the same validated request there instead of invoking their local app
 * server, which deliberately carries no service-role key.
 */
import { isTerminalApp } from "@/platform-config/platform";
import { posFetch } from "./server-origin";
import {
  deleteStaffAccount as deleteStaffAccountFn,
  migrateCashiersToAccounts as migrateCashiersToAccountsFn,
  saveStaffAccount as saveStaffAccountFn,
  setStaffAccountActive as setStaffAccountActiveFn,
  updateStaffAccount as updateStaffAccountFn,
} from "./staff-admin.functions";

type DirectCall = (input: never) => Promise<unknown>;

async function callHosted<T>(action: string, data: unknown, direct: DirectCall): Promise<T> {
  if (!isTerminalApp()) return direct({ data } as never) as Promise<T>;
  const response = await posFetch("/api/v1/pos/sync?operation=staff_admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok && !(result && typeof result === "object" && "error" in result)) {
    throw new Error(`Staff service failed (${response.status})`);
  }
  return result;
}

export const saveStaffAccount = (input: NonNullable<Parameters<typeof saveStaffAccountFn>[0]>) =>
  callHosted<Awaited<ReturnType<typeof saveStaffAccountFn>>>(
    "save",
    input.data,
    saveStaffAccountFn as DirectCall,
  );

export const setStaffAccountActive = (
  input: NonNullable<Parameters<typeof setStaffAccountActiveFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof setStaffAccountActiveFn>>>(
    "set_active",
    input.data,
    setStaffAccountActiveFn as DirectCall,
  );

export const migrateCashiersToAccounts = (
  input: NonNullable<Parameters<typeof migrateCashiersToAccountsFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof migrateCashiersToAccountsFn>>>(
    "migrate",
    input.data,
    migrateCashiersToAccountsFn as DirectCall,
  );

export const updateStaffAccount = (
  input: NonNullable<Parameters<typeof updateStaffAccountFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof updateStaffAccountFn>>>(
    "update",
    input.data,
    updateStaffAccountFn as DirectCall,
  );

export const deleteStaffAccount = (
  input: NonNullable<Parameters<typeof deleteStaffAccountFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof deleteStaffAccountFn>>>(
    "delete",
    input.data,
    deleteStaffAccountFn as DirectCall,
  );
