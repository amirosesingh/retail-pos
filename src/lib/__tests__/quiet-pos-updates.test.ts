import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/core/activation/connection-health",()=>({connectivity:()=>"online",lastHealth:()=>null,subscribeConnectivity:()=>()=>{}}));
vi.mock("@/lib/sync-status",()=>({syncState:()=>({phase:"idle"}),subscribeSyncState:()=>()=>{}}));
vi.mock("@/lib/live-mode",()=>({isOnlineOnly:()=>true}));
vi.mock("@/platforms/web/components/pos/status/SystemStatus",()=>({CloudStateIcon:()=>null}));
import { TillLoader } from "@/components/shared/TillLoader";
import { retainUnchangedFields } from "../live-state";
describe("quiet POS updates",()=>{
  it("keeps exactly one original progress indicator on the startup screen",()=>{
    const html=renderToStaticMarkup(h(TillLoader));
    expect(html.match(/role="progressbar"/g)).toHaveLength(1);
    expect(html).toContain("w-1/2 animate-pulse");
  });
  it("does not show a global progress strip after login or reload routes on resume",()=>{
    expect(readFileSync("src/platforms/web/components/pos/AppShell.tsx","utf8")).not.toContain("<DataProgress");
    const root=readFileSync("src/routes/__root.tsx","utf8");
    const recovery=root.slice(root.indexOf("const recover = () =>"),root.indexOf("// Coalesce a committed sync page"));
    expect(recovery).not.toContain("router.invalidate()");
    expect(recovery).toContain('queryClient.refetchQueries({ type: "active" })');
    expect(root).toContain("queryReadsChangedTables(query.meta, changed)");
  });
  it("does not recreate state when a background snapshot has no changes",()=>{
    const previous={products:[{id:"one",price:10}],members:[{id:"member"}],settings:{theme:"emerald"}};
    expect(retainUnchangedFields(previous,structuredClone(previous))).toBe(previous);
  });
  it("updates changed values without replacing unrelated slices or mutating the previous state",()=>{
    const previous={products:[{id:"one",price:10}],members:[{id:"member"}],settings:{theme:"emerald"}};
    const incoming=structuredClone(previous);incoming.products[0].price=12;
    const next=retainUnchangedFields(previous,incoming);
    expect(next.products[0].price).toBe(12);
    expect(next.members).toBe(previous.members);
    expect(next.settings).toBe(previous.settings);
    expect(previous.products[0].price).toBe(10);
    expect(retainUnchangedFields(previous,{...incoming,products:[]}).products).toEqual([]);
  });
});
