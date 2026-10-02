-- Non-destructive performance/security cleanup for the production POS API.
-- No business rows are updated or deleted.

-- These state tables are RPC-owned. Make the deny-by-default boundary
-- explicit and remove a stale direct-write grant on reconciliation rows.
revoke all on public.shift_reconciliations from anon, authenticated;
revoke all on public.sku_number_leases from anon, authenticated;
revoke all on public.sku_number_state from anon, authenticated;
drop policy if exists shift_reconciliations_no_direct_access on public.shift_reconciliations;
create policy shift_reconciliations_no_direct_access on public.shift_reconciliations
  for all to anon, authenticated using (false) with check (false);
drop policy if exists sku_number_leases_no_direct_access on public.sku_number_leases;
create policy sku_number_leases_no_direct_access on public.sku_number_leases
  for all to anon, authenticated using (false) with check (false);
drop policy if exists sku_number_state_no_direct_access on public.sku_number_state;
create policy sku_number_state_no_direct_access on public.sku_number_state
  for all to anon, authenticated using (false) with check (false);

-- Remove permissive duplicates that widened branch-scoped operational data.
drop policy if exists item_activity_staff_write on public.item_activity_logs;
drop policy if exists item_activity_staff_read on public.item_activity_logs;
drop policy if exists item_activity_staff_update on public.item_activity_logs;
drop policy if exists item_activity_logs_insert on public.item_activity_logs;
drop policy if exists item_activity_logs_read on public.item_activity_logs;
drop policy if exists item_activity_logs_update on public.item_activity_logs;
create policy item_activity_logs_insert on public.item_activity_logs
  for insert to authenticated
  with check ((select public.is_staff_now()) and (store_id is null or public.store_visible(store_id)));
create policy item_activity_logs_read on public.item_activity_logs
  for select to authenticated
  using ((select public.is_staff_now()) and (store_id is null or public.store_visible(store_id)));
create policy item_activity_logs_update on public.item_activity_logs
  for update to authenticated
  using ((select public.is_staff_now()) and (store_id is null or public.store_visible(store_id)))
  with check ((select public.is_staff_now()) and (store_id is null or public.store_visible(store_id)));

drop policy if exists payments_staff_write on public.payment_transactions;
drop policy if exists payments_staff_read on public.payment_transactions;
drop policy if exists payments_staff_update on public.payment_transactions;

-- Split ALL policies so their SELECT arm cannot overlap the dedicated read
-- policy. The predicates and effective access remain unchanged.
drop policy if exists "campaigns managed by staff" on public.coupon_campaigns;
drop policy if exists "campaigns readable by staff" on public.coupon_campaigns;
drop policy if exists campaigns_staff_insert on public.coupon_campaigns;
drop policy if exists campaigns_staff_update on public.coupon_campaigns;
drop policy if exists campaigns_staff_delete on public.coupon_campaigns;
create policy "campaigns readable by staff" on public.coupon_campaigns
  for select to authenticated using ((select public.is_staff_now()));
create policy campaigns_staff_insert on public.coupon_campaigns
  for insert to authenticated with check ((select public.is_staff_now()));
create policy campaigns_staff_update on public.coupon_campaigns
  for update to authenticated using ((select public.is_staff_now())) with check ((select public.is_staff_now()));
create policy campaigns_staff_delete on public.coupon_campaigns
  for delete to authenticated using ((select public.is_staff_now()));

drop policy if exists "vouchers managed by staff" on public.issued_vouchers;
drop policy if exists "vouchers readable by staff" on public.issued_vouchers;
drop policy if exists vouchers_staff_insert on public.issued_vouchers;
drop policy if exists vouchers_staff_update on public.issued_vouchers;
drop policy if exists vouchers_staff_delete on public.issued_vouchers;
create policy "vouchers readable by staff" on public.issued_vouchers
  for select to authenticated using ((select public.is_staff_now()));
create policy vouchers_staff_insert on public.issued_vouchers
  for insert to authenticated with check ((select public.is_staff_now()));
create policy vouchers_staff_update on public.issued_vouchers
  for update to authenticated using ((select public.is_staff_now())) with check ((select public.is_staff_now()));
create policy vouchers_staff_delete on public.issued_vouchers
  for delete to authenticated using ((select public.is_staff_now()));

drop policy if exists payment_types_write on public.payment_types;
drop policy if exists payment_types_read on public.payment_types;
drop policy if exists payment_types_insert on public.payment_types;
drop policy if exists payment_types_update on public.payment_types;
drop policy if exists payment_types_delete on public.payment_types;
create policy payment_types_read on public.payment_types
  for select to authenticated using ((select public.is_staff_now()));
create policy payment_types_insert on public.payment_types
  for insert to authenticated with check ((select public.is_supervisor_now()));
create policy payment_types_update on public.payment_types
  for update to authenticated using ((select public.is_supervisor_now())) with check ((select public.is_supervisor_now()));
create policy payment_types_delete on public.payment_types
  for delete to authenticated using ((select public.is_supervisor_now()));

drop policy if exists "Staff can manage product categories" on public.product_categories;
drop policy if exists "Staff can read product categories" on public.product_categories;
drop policy if exists product_categories_staff_insert on public.product_categories;
drop policy if exists product_categories_staff_update on public.product_categories;
drop policy if exists product_categories_staff_delete on public.product_categories;
create policy "Staff can read product categories" on public.product_categories
  for select to authenticated using ((select public.is_staff_now()));
create policy product_categories_staff_insert on public.product_categories
  for insert to authenticated with check ((select public.is_staff_now()));
create policy product_categories_staff_update on public.product_categories
  for update to authenticated using ((select public.is_staff_now())) with check ((select public.is_staff_now()));
create policy product_categories_staff_delete on public.product_categories
  for delete to authenticated using ((select public.is_staff_now()));

drop policy if exists "Staff can manage suppliers" on public.suppliers;
drop policy if exists "Staff can read suppliers" on public.suppliers;
drop policy if exists suppliers_staff_insert on public.suppliers;
drop policy if exists suppliers_staff_update on public.suppliers;
drop policy if exists suppliers_staff_delete on public.suppliers;
create policy "Staff can read suppliers" on public.suppliers
  for select to authenticated using ((select public.is_staff_now()));
create policy suppliers_staff_insert on public.suppliers
  for insert to authenticated with check ((select public.is_staff_now()));
create policy suppliers_staff_update on public.suppliers
  for update to authenticated using ((select public.is_staff_now())) with check ((select public.is_staff_now()));
create policy suppliers_staff_delete on public.suppliers
  for delete to authenticated using ((select public.is_staff_now()));

drop policy if exists "Staff can manage units" on public.uom_units;
drop policy if exists "Staff can read units" on public.uom_units;
drop policy if exists uom_units_staff_insert on public.uom_units;
drop policy if exists uom_units_staff_update on public.uom_units;
drop policy if exists uom_units_staff_delete on public.uom_units;
create policy "Staff can read units" on public.uom_units
  for select to authenticated using ((select public.is_staff_now()));
create policy uom_units_staff_insert on public.uom_units
  for insert to authenticated with check ((select public.is_staff_now()));
create policy uom_units_staff_update on public.uom_units
  for update to authenticated using ((select public.is_staff_now())) with check ((select public.is_staff_now()));
create policy uom_units_staff_delete on public.uom_units
  for delete to authenticated using ((select public.is_staff_now()));

drop policy if exists settings_locks_write on public.settings_locks;
drop policy if exists settings_locks_insert on public.settings_locks;
drop policy if exists settings_locks_update on public.settings_locks;
drop policy if exists settings_locks_delete on public.settings_locks;
create policy settings_locks_insert on public.settings_locks
  for insert to authenticated with check ((select public.is_supervisor_now()));
create policy settings_locks_update on public.settings_locks
  for update to authenticated using ((select public.is_supervisor_now())) with check ((select public.is_supervisor_now()));
create policy settings_locks_delete on public.settings_locks
  for delete to authenticated using ((select public.is_supervisor_now()));

drop policy if exists settings_overrides_write on public.settings_overrides;
drop policy if exists settings_overrides_insert on public.settings_overrides;
drop policy if exists settings_overrides_update on public.settings_overrides;
drop policy if exists settings_overrides_delete on public.settings_overrides;
create policy settings_overrides_insert on public.settings_overrides
  for insert to authenticated with check (public.settings_scope_manageable(scope, scope_id));
create policy settings_overrides_update on public.settings_overrides
  for update to authenticated using (public.settings_scope_manageable(scope, scope_id))
  with check (public.settings_scope_manageable(scope, scope_id));
create policy settings_overrides_delete on public.settings_overrides
  for delete to authenticated using (public.settings_scope_manageable(scope, scope_id));

-- A permissive ALL policy cannot be used as a deny guard: it ORs with other
-- policies. Fold terminal activity into the actual SKU audit permissions.
drop policy if exists sku_audit_revoked_terminal_block on public.sku_audit;
drop policy if exists "Staff can add sku audit" on public.sku_audit;
drop policy if exists "Staff can add to the SKU trail" on public.sku_audit;
drop policy if exists "Staff can read sku audit" on public.sku_audit;
drop policy if exists "Staff can read the SKU trail" on public.sku_audit;
drop policy if exists sku_audit_staff_insert on public.sku_audit;
drop policy if exists sku_audit_staff_read on public.sku_audit;
create policy sku_audit_staff_insert on public.sku_audit
  for insert to authenticated
  with check ((select public.is_terminal_active()) and (select public.is_staff_now()));
create policy sku_audit_staff_read on public.sku_audit
  for select to authenticated
  using ((select public.is_terminal_active()) and (select public.is_staff_now()));

drop policy if exists "Admins manage roles" on public.user_roles;
drop policy if exists "Users can read their own roles" on public.user_roles;
drop policy if exists user_roles_read on public.user_roles;
drop policy if exists user_roles_admin_insert on public.user_roles;
drop policy if exists user_roles_admin_update on public.user_roles;
drop policy if exists user_roles_admin_delete on public.user_roles;
create policy user_roles_read on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role((select auth.uid()), 'admin'::public.app_role));
create policy user_roles_admin_insert on public.user_roles
  for insert to authenticated with check (public.has_role((select auth.uid()), 'admin'::public.app_role));
create policy user_roles_admin_update on public.user_roles
  for update to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));
create policy user_roles_admin_delete on public.user_roles
  for delete to authenticated using (public.has_role((select auth.uid()), 'admin'::public.app_role));

-- Cache auth.uid() once per statement in the remaining hot RLS policies.
drop policy if exists nav_pins_delete_own on public.nav_pins;
create policy nav_pins_delete_own on public.nav_pins for delete to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and public.has_role((select auth.uid()), 'admin'::public.app_role)));
drop policy if exists nav_pins_insert_own on public.nav_pins;
create policy nav_pins_insert_own on public.nav_pins for insert to authenticated
  with check (owner_id = (select auth.uid()) or (owner_id is null and public.has_role((select auth.uid()), 'admin'::public.app_role)));
drop policy if exists nav_pins_read_own_and_company on public.nav_pins;
create policy nav_pins_read_own_and_company on public.nav_pins for select to authenticated
  using (owner_id = (select auth.uid()) or owner_id is null);
drop policy if exists nav_pins_update_own on public.nav_pins;
create policy nav_pins_update_own on public.nav_pins for update to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and public.has_role((select auth.uid()), 'admin'::public.app_role)))
  with check (owner_id = (select auth.uid()) or (owner_id is null and public.has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "Staff can read store groups" on public.store_groups;
create policy "Staff can read store groups" on public.store_groups
  for select to authenticated using (public.is_staff((select auth.uid())));

drop policy if exists "Staff can insert" on public.purchase_orders;
create policy "Staff can insert" on public.purchase_orders for insert to authenticated
  with check (public.is_staff((select auth.uid())) and (store_id is null or public.is_app_supervisor() or public.store_visible(store_id)));
drop policy if exists "Staff can read purchase orders" on public.purchase_orders;
create policy "Staff can read purchase orders" on public.purchase_orders for select to authenticated
  using (public.is_staff((select auth.uid())) and (store_id is null or public.is_app_supervisor() or public.store_visible(store_id)));
drop policy if exists "Staff can update" on public.purchase_orders;
create policy "Staff can update" on public.purchase_orders for update to authenticated
  using (public.is_staff((select auth.uid())) and (store_id is null or public.is_app_supervisor() or public.store_visible(store_id)))
  with check (public.is_staff((select auth.uid())) and (store_id is null or public.is_app_supervisor() or public.store_visible(store_id)));

drop policy if exists "Staff can insert" on public.purchase_order_items;
create policy "Staff can insert" on public.purchase_order_items for insert to authenticated
  with check (public.is_staff((select auth.uid())) and exists (
    select 1 from public.purchase_orders po where po.id=po_id
      and (po.store_id is null or public.is_app_supervisor() or public.store_visible(po.store_id))));
drop policy if exists "Staff can read purchase order items" on public.purchase_order_items;
create policy "Staff can read purchase order items" on public.purchase_order_items for select to authenticated
  using (public.is_staff((select auth.uid())) and exists (
    select 1 from public.purchase_orders po where po.id=po_id
      and (po.store_id is null or public.is_app_supervisor() or public.store_visible(po.store_id))));

notify pgrst, 'reload schema';
