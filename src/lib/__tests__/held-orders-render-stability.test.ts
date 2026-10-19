import { createElement, useRef, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/business-storage", () => ({ readBusinessValue: () => JSON.stringify([
 {id:'active-a',storeId:'a',status:'held'}, {id:'done-a',storeId:'a',status:'completed'},
 {id:'cancel-a',storeId:'a',status:'cancelled'}, {id:'active-b',storeId:'b',status:'held'},
]), writeBusinessValue: vi.fn() }));
import { useHeldOrders, type HeldOrder } from "../held-orders";
afterEach(() => vi.unstubAllGlobals());
it("keeps the held-order effect dependency stable across unrelated renders", () => {
 vi.stubGlobal('window', {});
 function Probe() {
  const [pass,setPass]=useState(0);
  const snapshot=useHeldOrders('a');
  const first=useRef<HeldOrder[] | null>(null);
  if(pass===0){ first.current=snapshot; setPass(1); }
  else {
   expect(snapshot).toBe(first.current);
   expect(snapshot.map(order=>order.id)).toEqual(['active-a']);
  }
  return null;
 }
 renderToString(createElement(Probe));
});
