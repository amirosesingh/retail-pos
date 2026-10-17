import { readFileSync, existsSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PERMISSION_SECTIONS, PERMISSION_EDITOR_IDS, sectionVisibility, setSectionVisibility, permissionSubpages, permissionPageMatches, permissionRelatedKeys } from "../permission-editor";
import { PERMISSION_PAGES, pageEnabled } from "../permission-pages";
import { NO_PERMISSIONS, PERMISSION_KEYS, type StaffPermissions } from "../permissions";
import { SETTINGS_CARDS } from "../settings-catalog";
import { PermissionHierarchy } from "@/platforms/web/components/admin/PermissionHierarchy";

describe("permission editor hierarchy", () => {
 it("includes every existing page once and retains all action keys", () => {
  const ids = PERMISSION_SECTIONS.flatMap(section => section.pageIds);
  expect(ids.length).toBe(new Set(ids).size);
  expect([...ids].sort()).toEqual(PERMISSION_PAGES.map(page => page.id).sort());
  expect([...new Set(PERMISSION_PAGES.flatMap(page => page.keys))].sort()).toEqual([...PERMISSION_KEYS].sort());
  expect(new Set(PERMISSION_EDITOR_IDS).size).toBe(PERMISSION_EDITOR_IDS.length);
 });
 it("changes only section page visibility, retaining actions and unknown saved flags", () => {
  const section = PERMISSION_SECTIONS[0];
  const original: StaffPermissions = { ...NO_PERMISSIONS, can_process_sale:true, can_manage_staff:true, "page:future":false };
  const hidden = setSectionVisibility(original, section, false);
  expect(hidden.can_process_sale).toBe(true);
  expect(hidden.can_manage_staff).toBe(true);
  expect(hidden["page:future"]).toBe(false);
  expect(pageEnabled(hidden, "inventory")).toBe(pageEnabled(original,"inventory"));
  expect(sectionVisibility(hidden,section)).toBe(false);
  expect(sectionVisibility({...hidden,"page:register":true},section)).toBe("indeterminate");
  const shown = setSectionVisibility(hidden,section,true);
  expect(sectionVisibility(shown,section)).toBe(true);
  expect(shown.can_void_cart).toBe(false);
  expect(original["page:register"]).not.toBe(false);
 });
 it("finds report/settings subpages through the real navigation registries", () => {
  expect(permissionSubpages("reports").some(item => item.path === "/reports/sales")).toBe(true);
  expect(permissionPageMatches("reports","Sales Report")).toBe(true);
  for (const card of SETTINGS_CARDS.filter(card => !PERMISSION_PAGES.some(page => page.routes.includes(card.to)))) {
    const children = PERMISSION_PAGES.flatMap(page => permissionSubpages(page.id));
    expect(children.some(item => item.path === card.to),card.to).toBe(true);
  }
 });
 it("renders nested pages and shared controls without granting anything", () => {
  const before = structuredClone(NO_PERMISSIONS);
  const html = renderToStaticMarkup(h(PermissionHierarchy,{permissions:before,onChange:()=>{},admin:false,busy:false,search:"",expanded:new Set(PERMISSION_EDITOR_IDS),onExpandedChange:()=>{}}));
  for (const section of PERMISSION_SECTIONS) expect(html).toContain(section.label.replaceAll("&","&amp;"));
  expect(html).toContain("Visible information");
  expect(html).toContain("Allowed actions");
  expect(html).toContain("Shared with");
  expect(html).toContain("Subpages sharing this page access");
  expect(before).toEqual(NO_PERMISSIONS);
 });
 it("shows matching subpages during search and handles no results", () => {
  const render = (search:string) => renderToStaticMarkup(h(PermissionHierarchy,{permissions:NO_PERMISSIONS,onChange:()=>{},admin:false,busy:false,search,expanded:new Set<string>(),onExpandedChange:()=>{}}));
  expect(render("Sales Report")).toContain("Sales Report");
  expect(render("no-such-permission-xyz")).toContain("No matching pages or permissions");
 });
 it("keeps administrator controls locked and disables edits while saving", () => {
  for (const props of [{admin:true,busy:false},{admin:false,busy:true}]) {
    const html = renderToStaticMarkup(h(PermissionHierarchy,{permissions:NO_PERMISSIONS,onChange:()=>{},...props,search:"selling",expanded:new Set(PERMISSION_EDITOR_IDS),onExpandedChange:()=>{}}));
    expect(html).toContain('disabled=""');
  }
 });
});


describe("related permission controls", () => {
 it("includes existing direct page controls without changing permission ownership", () => {
  for (const page of PERMISSION_PAGES) {
    const visible = [...page.keys, ...permissionRelatedKeys(page.id)];
    for (const key of permissionRelatedKeys(page.id)) expect(PERMISSION_KEYS).toContain(key);
    for (const route of page.routes) {
      const path = `src/routes/${route === "/" ? "index" : route.slice(1).replaceAll("/", ".")}.tsx`;
      if (!existsSync(path)) continue;
      const direct = [...readFileSync(path,"utf8").matchAll(/can\(\s*["'](can_[a-z_]+)["']/g)].map(match => match[1]);
      for (const key of direct) expect(visible,`${page.id}: ${key}`).toContain(key);
    }
  }
  expect(PERMISSION_PAGES.find(page => page.id === "inventory")!.keys).not.toContain("can_view_sales_reports");
  expect(permissionRelatedKeys("inventory")).toContain("can_view_sales_reports");
 });
});
