-- ============================================================
-- supabase/schema.sql - full cloud schema (Postgres / Supabase)
-- Retail
-- Target: the Supabase project currently open in the SQL editor. Supabase
-- selects the PostgreSQL database for the project, so no database name or
-- CREATE DATABASE statement should be added to this portable online script.
--
-- Works for BOTH cases:
--   * fresh project  -> every table, view, function, trigger, grant and
--                       row-level-security policy is created
--   * live database  -> no table or column is dropped; missing objects are
--                       added and known compatible legacy types are repaired
--
-- Re-runnable: run it as many times as you like.
-- Order: enums -> tables -> columns -> routines -> constraints -> indexes
--        -> views -> triggers -> grants -> RLS + policies -> verification.
-- ============================================================

SET statement_timeout = 0;
-- Skip body validation while the script runs: routines are created before
-- some of the tables they read, exactly as a database restore does.
SET check_function_bodies = off;

SET client_min_messages = warning;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

DO $do$ BEGIN
CREATE TYPE public.app_role AS ENUM (
    'admin',
    'manager',
    'staff'
);
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

CREATE TABLE IF NOT EXISTS public.coupon_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    discount_type text DEFAULT 'PERCENTAGE'::text NOT NULL,
    discount_value numeric DEFAULT 0 NOT NULL,
    scope text DEFAULT 'BILL'::text NOT NULL,
    scope_value text,
    max_claims integer,
    max_per_member integer DEFAULT 1,
    claims_count integer DEFAULT 0 NOT NULL,
    starts_at timestamp with time zone,
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    is_welcome boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT coupon_campaigns_discount_type_check CHECK ((discount_type = ANY (ARRAY['PERCENTAGE'::text, 'FIXED_AMOUNT'::text]))),
    CONSTRAINT coupon_campaigns_scope_check CHECK ((scope = ANY (ARRAY['BILL'::text, 'CATEGORY'::text, 'PRODUCT'::text])))
);

CREATE TABLE IF NOT EXISTS public.shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id text NOT NULL,
    terminal_id text,
    terminal_name text,
    opened_by_name text DEFAULT 'Cashier'::text NOT NULL,
    opened_by_staff_id text,
    opened_by_role text,
    closed_by_name text,
    closed_by_staff_id text,
    closed_by_role text,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    opening_float numeric DEFAULT 0 NOT NULL,
    counted_cash numeric,
    expected_cash numeric,
    note text DEFAULT ''::text NOT NULL,
    overdue boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    closing_float numeric,
    user_id uuid,
    row_version integer DEFAULT 1 NOT NULL,
    counted_card numeric,
    counted_digital numeric,
    expected_card numeric,
    expected_digital numeric,
    variance_cash numeric,
    variance_card numeric,
    variance_digital numeric,
    variance_total numeric,
    CONSTRAINT shifts_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'CLOSED'::text])))
);

CREATE TABLE IF NOT EXISTS public.issued_vouchers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_slug text NOT NULL,
    campaign_id uuid NOT NULL,
    member_id uuid,
    status text DEFAULT 'ISSUED'::text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    issued_by text,
    issued_source text DEFAULT 'PUBLIC'::text NOT NULL,
    redeemed_at timestamp with time zone,
    redeemed_by text,
    redeemed_sale_id text,
    disabled_at timestamp with time zone,
    disabled_by text,
    disable_reason text,
    store_id text,
    row_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT issued_vouchers_status_check CHECK ((status = ANY (ARRAY['ISSUED'::text, 'REDEEMED'::text, 'EXPIRED'::text, 'DISABLED'::text])))
);

CREATE TABLE IF NOT EXISTS public.activity_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    title text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    actor_id text,
    actor_name text,
    actor_role text,
    terminal_id text,
    terminal_name text,
    store_id text,
    entity_type text,
    entity_id text,
    amount numeric,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    whatsapp_status text DEFAULT 'skipped'::text NOT NULL,
    whatsapp_error text,
    client_event_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.app_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying(64) NOT NULL,
    full_name character varying(160) NOT NULL,
    email character varying(255) NOT NULL,
    role public.app_role DEFAULT 'staff'::public.app_role NOT NULL,
    store_id character varying(64),
    is_active boolean DEFAULT true NOT NULL,
    permissions jsonb DEFAULT jsonb_build_object('can_open_drawer', true, 'can_close_drawer', true, 'can_view_drawer_balance', false, 'can_process_sale', true, 'can_give_discount', false, 'can_void_item', false, 'can_hold_cart', true, 'can_process_refund', false, 'can_process_exchange', false, 'can_view_inventory', true, 'can_edit_product_price', false, 'can_add_new_product', false, 'can_receive_purchase_order', false, 'can_add_member', true, 'can_edit_member_points', false, 'can_apply_member_discount', true, 'can_view_sales_reports', false, 'can_access_pos_settings', false, 'can_manage_staff', false) NOT NULL,
    pin_hash text DEFAULT ''::text NOT NULL,
    auth_user_id uuid,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    role_slug text,
    pin_length smallint DEFAULT 6 NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_name text,
    action_category text NOT NULL,
    action_name text NOT NULL,
    target_module text,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id text,
    action text,
    entity text,
    before_state jsonb,
    after_state jsonb
);

CREATE TABLE IF NOT EXISTS public.booking_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    method text DEFAULT 'cash'::text NOT NULL,
    cashier text,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ref text NOT NULL,
    store_id text,
    shift_id text,
    customer_name text DEFAULT ''::text NOT NULL,
    customer_phone text DEFAULT ''::text NOT NULL,
    member_id uuid,
    service_type_id text,
    service_name text,
    service_fee numeric DEFAULT 0 NOT NULL,
    payment_timing text,
    lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    subtotal numeric DEFAULT 0 NOT NULL,
    discount numeric DEFAULT 0 NOT NULL,
    tax numeric DEFAULT 0 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    paid numeric DEFAULT 0 NOT NULL,
    due_date date,
    note text DEFAULT ''::text NOT NULL,
    cashier text,
    status text DEFAULT 'active'::text NOT NULL,
    sale_receipt_no text,
    closed_at timestamp with time zone,
    racket_model text,
    string_type text,
    tension_main numeric,
    tension_cross numeric,
    tension_unit text DEFAULT 'lb'::text NOT NULL,
    grommet_notes text,
    job_notes text,
    dropped_off_at timestamp with time zone,
    promised_at timestamp with time zone,
    job_status text DEFAULT 'received'::text NOT NULL,
    job_status_by text,
    job_status_at timestamp with time zone,
    notify_whatsapp boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tag_id text,
    intake_note text,
    string_origin text,
    string_source_product_id uuid,
    grip_product_id uuid,
    charges jsonb DEFAULT '{}'::jsonb NOT NULL,
    technician text,
    liability_accepted boolean DEFAULT false NOT NULL,
    incident_note text,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.branch_telemetry (
    terminal_id text NOT NULL,
    store_id text,
    terminal_name text,
    staff_name text,
    staff_role text,
    db_mode text DEFAULT 'online'::text NOT NULL,
    connection_status text DEFAULT 'online'::text NOT NULL,
    storage_engine text DEFAULT 'cloud'::text NOT NULL,
    pending_count integer DEFAULT 0 NOT NULL,
    conflict_count integer DEFAULT 0 NOT NULL,
    last_synced_at timestamp with time zone,
    app_version text,
    platform text,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id text,
    pending_queue_count integer,
    last_ping timestamp with time zone,
    status text
);

CREATE TABLE IF NOT EXISTS public.cashiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username text NOT NULL,
    full_name text DEFAULT ''::text NOT NULL,
    pin_hash text NOT NULL,
    store_id text,
    permissions jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    role_slug text,
    idle_timeout_minutes integer,
    CONSTRAINT cashiers_idle_timeout_minutes_check
      CHECK (idle_timeout_minutes IS NULL OR idle_timeout_minutes BETWEEN 1 AND 1440)
);

CREATE TABLE IF NOT EXISTS public.coupon_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    campaign_id uuid,
    campaign_name text,
    voucher_token text,
    member_id uuid,
    member_phone text,
    store_id text,
    terminal_id text,
    staff_name text,
    staff_role text,
    sale_id text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coupon_events_event_type_check CHECK ((event_type = ANY (ARRAY['CLAIMED'::text, 'ISSUED_MANUAL'::text, 'REDEEMED'::text, 'BLOCKED'::text, 'DISABLED'::text, 'REENABLED'::text])))
);

CREATE TABLE IF NOT EXISTS public.drawer_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id text,
    terminal_id text,
    shift_id text,
    staff_id text,
    staff_name text,
    role text,
    reason text NOT NULL,
    note text,
    approved_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.held_orders (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    store_id text,
    shift_id text,
    held_by text,
    total numeric DEFAULT 0 NOT NULL,
    lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    cart_discount numeric DEFAULT 0 NOT NULL,
    cart_discount_type text DEFAULT 'amount'::text NOT NULL,
    exchange_ref text,
    member_id text,
    member_name text,
    coupon jsonb,
    note text DEFAULT ''::text NOT NULL,
    cancelled_from text,
    held_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.integration_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_name text NOT NULL,
    api_keys_encrypted jsonb DEFAULT '{}'::jsonb NOT NULL,
    verification_channel text DEFAULT 'whatsapp'::text NOT NULL,
    strict_verification boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.item_activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    product_name text,
    sku text,
    barcode text,
    store_id text,
    terminal_id text,
    activity_type text NOT NULL,
    reference text,
    quantity_delta integer DEFAULT 0 NOT NULL,
    stock_before integer,
    stock_after integer,
    unit_cost numeric DEFAULT 0 NOT NULL,
    staff_id text,
    staff_name text,
    role text,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT item_activity_logs_activity_type_check CHECK ((activity_type = ANY (ARRAY['sale'::text, 'return'::text, 'receive'::text, 'transfer_in'::text, 'transfer_out'::text, 'adjustment'::text, 'count'::text, 'archive'::text])))
);

CREATE TABLE IF NOT EXISTS public.member_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid,
    phone text,
    email text,
    channel text DEFAULT 'whatsapp'::text NOT NULL,
    otp_code text,
    attempts integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    sent_by text,
    store_id text,
    expires_at timestamp with time zone DEFAULT (now() + '00:10:00'::interval) NOT NULL,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_code text NOT NULL,
    full_name text NOT NULL,
    phone text NOT NULL,
    email text,
    address text,
    date_of_birth date,
    tier_id uuid,
    loyalty_points numeric DEFAULT 0 NOT NULL,
    total_spent numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    verified_channel text
);

CREATE TABLE IF NOT EXISTS public.membership_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    discount_percentage numeric DEFAULT 0 NOT NULL,
    points_multiplier numeric DEFAULT 1.0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.offline_sync_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    terminal_id text,
    store_id text,
    direction text NOT NULL,
    table_name text NOT NULL,
    record_id text,
    records integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'ok'::text NOT NULL,
    error_message text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT offline_sync_audit_log_direction_check CHECK ((direction = ANY (ARRAY['push'::text, 'pull'::text]))),
    CONSTRAINT offline_sync_audit_log_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'failed'::text, 'partial'::text, 'skipped'::text])))
);

CREATE TABLE IF NOT EXISTS public.payment_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_type text NOT NULL,
    sale_id uuid,
    booking_id uuid,
    member_id uuid,
    store_id text,
    shift_id text,
    terminal_id text,
    amount numeric DEFAULT 0 NOT NULL,
    method text DEFAULT 'cash'::text NOT NULL,
    kind text DEFAULT 'payment'::text NOT NULL,
    reference text,
    cashier_id text,
    cashier_name text,
    note text DEFAULT ''::text NOT NULL,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'completed'::text,
    metadata jsonb DEFAULT '{}'::jsonb,
    client_transaction_id text,
    CONSTRAINT payment_transactions_kind_check CHECK ((kind = ANY (ARRAY['deposit'::text, 'payment'::text, 'settlement'::text, 'refund'::text, 'change'::text]))),
    CONSTRAINT payment_transactions_source_type_check CHECK ((source_type = ANY (ARRAY['sale'::text, 'booking'::text])))
);

CREATE TABLE IF NOT EXISTS public.payment_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type_code text NOT NULL,
    requires_reference boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    icon text DEFAULT 'Wallet'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.pin_attempts (
    key text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    window_started_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.pos_settings (
    id integer DEFAULT 1 NOT NULL,
    tax_percentage numeric DEFAULT 0 NOT NULL,
    enable_tax boolean DEFAULT true NOT NULL,
    tax_mode text DEFAULT 'exclusive'::text NOT NULL,
    paper_size text DEFAULT '80mm'::text NOT NULL,
    header_text text,
    footer_text text,
    show_logo boolean DEFAULT true NOT NULL,
    show_points boolean DEFAULT true NOT NULL,
    show_barcode boolean DEFAULT true NOT NULL,
    show_tax_details boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_name text DEFAULT 'RETAIL'::text NOT NULL,
    tax_number text,
    reg_number text,
    phone text,
    website text,
    fonts jsonb DEFAULT '{}'::jsonb NOT NULL,
    custom_lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    qr jsonb DEFAULT '{}'::jsonb NOT NULL,    ui_visibility jsonb DEFAULT '{"hidden": {}}'::jsonb NOT NULL,
    integration_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    region_country text DEFAULT ''::text NOT NULL,
    time_zone text DEFAULT ''::text NOT NULL,
    date_format text DEFAULT 'dd/MM/yyyy'::text NOT NULL,
    time_format text DEFAULT '24h'::text NOT NULL,
    booking_slip jsonb DEFAULT '{}'::jsonb NOT NULL,
    notification_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    row_version integer DEFAULT 1 NOT NULL,
    logo_data_url text,
    receipt_design jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.product_barcodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    barcode text NOT NULL,
    label text,
    pack_size numeric DEFAULT 1 NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.product_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'category'::text NOT NULL,
    row_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT product_categories_kind_check CHECK ((kind = ANY (ARRAY['category'::text, 'group'::text, 'sub'::text])))
);

CREATE TABLE IF NOT EXISTS public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    barcode text NOT NULL,
    name text NOT NULL,
    category text,
    cost_price numeric DEFAULT 0 NOT NULL,
    selling_price numeric DEFAULT 0 NOT NULL,
    ecom_price numeric,
    stock_quantity integer DEFAULT 0 NOT NULL,
    custom_points numeric,
    point_multiplier numeric DEFAULT 1.0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sku text,
    reorder_level integer DEFAULT 0 NOT NULL,
    tax_rate numeric DEFAULT 0 NOT NULL,
    ecom_visible boolean DEFAULT true NOT NULL,
    stock_by_store jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    landing_pct numeric,
    sub_category text,
    unit text,
    packs jsonb DEFAULT '[]'::jsonb NOT NULL,
    barcode_aliases text[] DEFAULT '{}'::text[] NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    archived_at timestamp with time zone,
    brand text,
    product_group text,
    barcode_variants jsonb DEFAULT '[]'::jsonb NOT NULL,
    row_version integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    promo_type text NOT NULL,
    min_spend numeric DEFAULT 0 NOT NULL,
    discount_percent numeric DEFAULT 0 NOT NULL,
    discount_amount numeric DEFAULT 0 NOT NULL,
    foc_product_id uuid,
    points_per_dollar numeric DEFAULT 1 NOT NULL,
    tier_rates jsonb,
    is_active boolean DEFAULT true NOT NULL,
    start_date date,
    end_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.public_flags (
    key text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid NOT NULL,
    product_id uuid,
    barcode text,
    product_name text,
    cost_price numeric DEFAULT 0 NOT NULL,
    selling_price numeric DEFAULT 0 NOT NULL,
    quantity_received integer DEFAULT 0 NOT NULL,
    subtotal_cost numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sku text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_number text NOT NULL,
    supplier_name text,
    operator_name text,
    total_cost numeric DEFAULT 0 NOT NULL,
    total_items_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier_id uuid,
    store_id text,
    store_code text,
    invoice_date date,
    invoice_entry_date timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sale_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_id uuid NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    unit_price numeric DEFAULT 0 NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    discount_percent numeric DEFAULT 0 NOT NULL,
    discount_amount numeric DEFAULT 0 NOT NULL,
    is_return boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tax_rate numeric DEFAULT 0 NOT NULL,
    is_foc boolean DEFAULT false NOT NULL,
    promo_id text,
    coupon_code text,
    coupon_discount numeric DEFAULT 0 NOT NULL,
    unit_cost numeric DEFAULT 0 NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bill_number text NOT NULL,
    member_id uuid,
    store_id text,
    cashier_name text,
    subtotal_amount numeric DEFAULT 0 NOT NULL,
    total_amount numeric DEFAULT 0 NOT NULL,
    discount_amount numeric DEFAULT 0 NOT NULL,
    tax_amount numeric DEFAULT 0 NOT NULL,
    payment_type text DEFAULT 'cash'::text NOT NULL,
    points_earned numeric DEFAULT 0 NOT NULL,
    points_redeemed numeric DEFAULT 0 NOT NULL,
    is_exchange boolean DEFAULT false NOT NULL,
    original_bill_number text,
    is_refunded boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    shift_id text,
    paid_amount numeric DEFAULT 0 NOT NULL,
    change_amount numeric DEFAULT 0 NOT NULL,
    exchange_credit numeric DEFAULT 0 NOT NULL,
    exchanged_to_bill_number text,
    coupon_code text,
    coupon_promo_id text,
    coupon_scope text,
    coupon_discount numeric DEFAULT 0 NOT NULL,
    payments jsonb DEFAULT '[]'::jsonb NOT NULL,
    client_transaction_id text,
    cashier_id text,
    created_by text,
    updated_by text,
    row_version integer DEFAULT 1 NOT NULL,
    store_name_snapshot text,
    store_address_snapshot text,
    authorization_request_id uuid,
    authorized_by text,
    authorized_at timestamp with time zone,
    rounding_adjustment numeric(18,4) DEFAULT 0 NOT NULL,
    rounding_label text
);

CREATE TABLE IF NOT EXISTS public.secure_settings (
    key text NOT NULL,
    ciphertext text NOT NULL,
    hint text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.security_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fingerprint text NOT NULL,
    source text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    title text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    deployment_ref text,
    status text DEFAULT 'open'::text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    acknowledged_by text,
    acknowledged_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT security_findings_severity_check CHECK ((severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text, 'info'::text]))),
    CONSTRAINT security_findings_source_check CHECK ((source = ANY (ARRAY['ci'::text, 'selfcheck'::text, 'manual'::text]))),
    CONSTRAINT security_findings_status_check CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'resolved'::text])))
);

CREATE TABLE IF NOT EXISTS public.settings_locks (
    section text NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.settings_overrides (
    scope text DEFAULT 'BRANCH'::text NOT NULL,
    scope_id text DEFAULT ''::text NOT NULL,
    section text NOT NULL,
    patch jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
    ,row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.shift_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shift_id text,
    store_id text NOT NULL,
    terminal_id text,
    terminal_name text,
    staff_id text,
    staff_name text NOT NULL,
    role text,
    signed_in_at timestamp with time zone DEFAULT now() NOT NULL,
    signed_out_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sku_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku text NOT NULL,
    product_id uuid,
    product_name text,
    source text DEFAULT 'auto'::text NOT NULL,
    previous_sku text,
    store_id text,
    store_name text,
    terminal_id text,
    staff_id text,
    staff_name text,
    role text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.staff_roles (
    slug text NOT NULL,
    name text NOT NULL,
    base_level text DEFAULT 'cashier'::text NOT NULL,
    permissions jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_core boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_roles_base_level_valid CHECK ((base_level = ANY (ARRAY['cashier'::text, 'warehouse'::text, 'supervisor'::text, 'admin'::text])))
);

CREATE TABLE IF NOT EXISTS public.stock_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    product_name text,
    sku text,
    barcode text,
    store_id text,
    terminal_id text,
    reason text DEFAULT 'manual'::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    previous_stock integer DEFAULT 0 NOT NULL,
    updated_stock integer DEFAULT 0 NOT NULL,
    delta integer DEFAULT 0 NOT NULL,
    cost_impact numeric DEFAULT 0 NOT NULL,
    staff_id text,
    staff_name text,
    role text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.stock_delta_applied (
    movement_id uuid NOT NULL,
    product_id uuid,
    store_id text,
    delta integer DEFAULT 0 NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.stock_transfer_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transfer_id uuid NOT NULL,
    product_id uuid,
    barcode text,
    sku text,
    product_name text,
    quantity integer DEFAULT 0 NOT NULL,
    quantity_received integer DEFAULT 0 NOT NULL,
    unit_cost numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.stock_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ref text NOT NULL,
    kind text DEFAULT 'transfer'::text NOT NULL,
    transfer_scope text DEFAULT 'INTRA_GROUP'::text NOT NULL,
    from_store_id text NOT NULL,
    from_store_name text,
    from_group_id text,
    to_store_id text NOT NULL,
    to_store_name text,
    to_group_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    created_by text,
    approved_by text,
    approved_at timestamp with time zone,
    received_by text,
    received_at timestamp with time zone,
    rejected_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT stock_transfers_kind_check CHECK ((kind = ANY (ARRAY['transfer'::text, 'request'::text]))),
    CONSTRAINT stock_transfers_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'approved'::text, 'in_transit'::text, 'received'::text, 'rejected'::text, 'cancelled'::text]))),
    CONSTRAINT stock_transfers_transfer_scope_check CHECK ((transfer_scope = ANY (ARRAY['INTRA_GROUP'::text, 'INTER_GROUP'::text])))
);

CREATE TABLE IF NOT EXISTS public.stores (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    address text,
    phone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    group_id text,
    row_version integer DEFAULT 1 NOT NULL,
    location_type text DEFAULT 'store'::text NOT NULL,
    parent_id text,
    is_central boolean DEFAULT false NOT NULL,
    building_name text,
    floor_label text,
    is_active boolean DEFAULT true NOT NULL,
    archived_at timestamp with time zone,
    is_primary_sub boolean DEFAULT false NOT NULL,
    CONSTRAINT stores_location_type_check CHECK ((location_type = ANY (ARRAY['store'::text, 'main_building'::text, 'sub_warehouse'::text, 'central_warehouse'::text])))
);

CREATE TABLE IF NOT EXISTS public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    contact_name text,
    phone text,
    email text,
    address text,
    tax_number text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sync_metadata (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id text,
    terminal_id text,
    table_name text NOT NULL,
    last_synced_at timestamp with time zone,
    last_pushed_at timestamp with time zone,
    rows_pushed integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.system_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id text,
    actor_name text,
    actor_role text,
    action_type text NOT NULL,
    entity_affected text,
    entity_id text,
    old_value jsonb,
    new_value jsonb,
    terminal_id text,
    ip_address text,
    store_id text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.terminal_commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    terminal_id text NOT NULL,
    store_id text,
    command text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    note text,
    result text,
    issued_by text,
    issued_role text,
    picked_up_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.terminal_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id text,
    location_name text,
    device_name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    app_version text,
    last_sync_at timestamp with time zone,
    reissued_at timestamp with time zone,
    replaced_by uuid,
    claimed_by_device text,
    claimed_at timestamp with time zone,
    platform text DEFAULT 'pc'::text NOT NULL,
    row_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT terminal_tokens_status_check CHECK ((status = ANY (ARRAY['active'::text, 'used'::text, 'revoked'::text]))),
    CONSTRAINT terminal_tokens_platform_check CHECK (platform = ANY (ARRAY['pc'::text, 'mobile'::text]))
);

CREATE TABLE IF NOT EXISTS public.uom_units (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    allow_decimal boolean DEFAULT false NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE OR REPLACE VIEW public.v_sale_line_facts WITH (security_invoker='true') AS
 SELECT si.id AS line_id,
    si.sale_id,
    s.bill_number,
    s.store_id,
    s.cashier_name,
    s.created_at,
    (s.created_at)::date AS sale_day,
    to_char(s.created_at, 'YYYY-MM'::text) AS sale_month,
    s.payment_type,
    s.is_refunded,
    si.product_id,
    si.product_name,
    si.quantity,
    si.unit_price,
    si.unit_cost,
    si.is_foc,
    si.is_return,
    round(
        CASE
            WHEN (si.discount_percent > (0)::numeric) THEN ((si.unit_price * si.discount_percent) / 100.0)
            ELSE si.discount_amount
        END, 2) AS unit_discount,
    round(((
        CASE
            WHEN (si.discount_percent > (0)::numeric) THEN ((si.unit_price * si.discount_percent) / 100.0)
            ELSE si.discount_amount
        END * (si.quantity)::numeric) + COALESCE(si.coupon_discount, (0)::numeric)), 2) AS line_discount,
    round(((GREATEST((si.unit_price -
        CASE
            WHEN (si.discount_percent > (0)::numeric) THEN ((si.unit_price * si.discount_percent) / 100.0)
            ELSE si.discount_amount
        END), (0)::numeric) * (si.quantity)::numeric) - COALESCE(si.coupon_discount, (0)::numeric)), 2) AS line_revenue,
    round((COALESCE(si.unit_cost, (0)::numeric) * (si.quantity)::numeric), 2) AS line_cost
   FROM (public.sale_items si
     JOIN public.sales s ON ((s.id = si.sale_id)));

CREATE OR REPLACE VIEW public.v_daily_item_sales WITH (security_invoker='true') AS
 SELECT f.sale_day,
    f.sale_month,
    f.store_id,
    f.product_id,
    f.product_name,
    round((sum(f.quantity))::numeric, 2) AS units,
    round(sum(f.line_revenue), 2) AS revenue,
    round(sum(f.line_cost), 2) AS cost,
    round(sum((f.line_revenue - f.line_cost)), 2) AS profit,
    COALESCE(NULLIF(btrim(p.category), ''), 'Uncategorized') AS product_category
   FROM (public.v_sale_line_facts f
     LEFT JOIN public.products p ON ((p.id = f.product_id)))
  GROUP BY f.sale_day, f.sale_month, f.store_id, f.product_id, f.product_name,
    COALESCE(NULLIF(btrim(p.category), ''), 'Uncategorized');

CREATE OR REPLACE VIEW public.v_daily_store_sales WITH (security_invoker='true') AS
 SELECT sale_day,
    sale_month,
    store_id,
    count(DISTINCT sale_id) AS bills,
    round(sum(line_revenue), 2) AS revenue,
    round(sum(line_cost), 2) AS cost,
    round(sum((line_revenue - line_cost)), 2) AS profit,
    round(sum(line_discount), 2) AS discount,
    round(sum(
        CASE
            WHEN is_foc THEN (unit_price * (quantity)::numeric)
            ELSE (0)::numeric
        END), 2) AS foc_value,
    round((sum(quantity))::numeric, 2) AS units
   FROM public.v_sale_line_facts f
  GROUP BY sale_day, sale_month, store_id;

CREATE TABLE IF NOT EXISTS public.whatsapp_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_number_id text DEFAULT ''::text NOT NULL,
    recipient text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    reference text,
    store_id text,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    error text,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================================
-- Additive column top-up: brings an older database up to date.
-- Existing rows are never touched.
-- ============================================================
DO $do$
BEGIN
  IF to_regclass('public.authorization_actions') IS NOT NULL THEN
    ALTER TABLE public.authorization_actions ADD COLUMN IF NOT EXISTS requester_roles text[] NOT NULL DEFAULT ARRAY['cashier','staff','manager','admin']::text[];
    ALTER TABLE public.authorization_actions ADD COLUMN IF NOT EXISTS requester_user_ids text[] NOT NULL DEFAULT ARRAY[]::text[];
    ALTER TABLE public.authorization_actions ADD COLUMN IF NOT EXISTS authority_limits jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE public.authorization_actions ADD COLUMN IF NOT EXISTS extra_authority jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE public.authorization_actions ADD COLUMN IF NOT EXISTS absolute_ceilings jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE public.authorization_actions ADD COLUMN IF NOT EXISTS approval_timeout_minutes integer NOT NULL DEFAULT 15;
    ALTER TABLE public.authorization_actions ADD COLUMN IF NOT EXISTS escalation_after_minutes integer;
    ALTER TABLE public.authorization_actions ADD COLUMN IF NOT EXISTS escalation_roles text[] NOT NULL DEFAULT ARRAY[]::text[];
    UPDATE public.authorization_actions SET mode = 'request', updated_at = now()
     WHERE mode NOT IN ('none', 'pin', 'request', 'either');
    BEGIN
      ALTER TABLE public.authorization_actions ADD CONSTRAINT authorization_actions_timeout_chk CHECK (approval_timeout_minutes BETWEEN 1 AND 1440);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TABLE public.authorization_actions ADD CONSTRAINT authorization_actions_mode_chk CHECK (mode IN ('none', 'pin', 'request', 'either'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TABLE public.authorization_actions ADD CONSTRAINT authorization_actions_escalation_chk CHECK (escalation_after_minutes IS NULL OR escalation_after_minutes BETWEEN 1 AND 1440);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$do$;

DO $do$
BEGIN
  IF to_regclass('public.authorization_requests') IS NOT NULL THEN
    ALTER TABLE public.authorization_requests ADD COLUMN IF NOT EXISTS requester_direct_limit numeric;
    ALTER TABLE public.authorization_requests ADD COLUMN IF NOT EXISTS value_unit text NOT NULL DEFAULT 'number';
  END IF;
END
$do$;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS slug text;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS discount_type text DEFAULT 'PERCENTAGE'::text NOT NULL;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS discount_value numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS scope text DEFAULT 'BILL'::text NOT NULL;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS scope_value text;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS max_claims integer;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS max_per_member integer DEFAULT 1;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS claims_count integer DEFAULT 0 NOT NULL;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS starts_at timestamp with time zone;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS is_welcome boolean DEFAULT false NOT NULL;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.coupon_campaigns ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS terminal_name text;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS opened_by_name text DEFAULT 'Cashier'::text NOT NULL;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS opened_by_staff_id text;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS opened_by_role text;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS closed_by_name text;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS closed_by_staff_id text;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS closed_by_role text;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS opened_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS closed_at timestamp with time zone;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS opening_float numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS counted_cash numeric;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS expected_cash numeric;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS note text DEFAULT ''::text NOT NULL;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS overdue boolean DEFAULT false NOT NULL;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS status text DEFAULT 'OPEN'::text NOT NULL;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS closing_float numeric;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS counted_card numeric;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS counted_digital numeric;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS expected_card numeric;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS expected_digital numeric;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS variance_cash numeric;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS variance_card numeric;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS variance_digital numeric;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS variance_total numeric;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS token_slug text;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS campaign_id uuid;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS member_id uuid;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS status text DEFAULT 'ISSUED'::text NOT NULL;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS issued_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS issued_by text;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS issued_source text DEFAULT 'PUBLIC'::text NOT NULL;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS redeemed_at timestamp with time zone;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS redeemed_by text;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS redeemed_sale_id text;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS disabled_at timestamp with time zone;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS disabled_by text;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS disable_reason text;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.issued_vouchers ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS event_type text;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS severity text DEFAULT 'info'::text NOT NULL;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS title text;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS message text DEFAULT ''::text NOT NULL;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS actor_id text;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS actor_name text;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS actor_role text;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS terminal_name text;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS entity_type text;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS entity_id text;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS amount numeric;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS whatsapp_status text DEFAULT 'skipped'::text NOT NULL;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS whatsapp_error text;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS client_event_id text;

ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS user_id character varying(64);

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS full_name character varying(160);

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS email character varying(255);

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS role public.app_role DEFAULT 'staff'::public.app_role NOT NULL;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS store_id character varying(64);

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT jsonb_build_object('can_open_drawer', true, 'can_close_drawer', true, 'can_view_drawer_balance', false, 'can_process_sale', true, 'can_give_discount', false, 'can_void_item', false, 'can_hold_cart', true, 'can_process_refund', false, 'can_process_exchange', false, 'can_view_inventory', true, 'can_edit_product_price', false, 'can_add_new_product', false, 'can_receive_purchase_order', false, 'can_add_member', true, 'can_edit_member_points', false, 'can_apply_member_discount', true, 'can_view_sales_reports', false, 'can_access_pos_settings', false, 'can_manage_staff', false) NOT NULL;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS pin_hash text DEFAULT ''::text NOT NULL;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS auth_user_id uuid;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS last_login_at timestamp with time zone;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS role_slug text;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS pin_length smallint DEFAULT 6 NOT NULL;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_name text;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action_category text;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action_name text;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS target_module text;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS details jsonb;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_id text;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action text;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS entity text;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS before_state jsonb;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS after_state jsonb;

ALTER TABLE public.booking_payments ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.booking_payments ADD COLUMN IF NOT EXISTS booking_id uuid;

ALTER TABLE public.booking_payments ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.booking_payments ADD COLUMN IF NOT EXISTS method text DEFAULT 'cash'::text NOT NULL;

ALTER TABLE public.booking_payments ADD COLUMN IF NOT EXISTS cashier text;

ALTER TABLE public.booking_payments ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.booking_payments ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.booking_payments ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS ref text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS shift_id text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS customer_name text DEFAULT ''::text NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS customer_phone text DEFAULT ''::text NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS member_id uuid;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS service_type_id text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS service_name text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS service_fee numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payment_timing text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS lines jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS subtotal numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS discount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS tax numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS total numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS paid numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS note text DEFAULT ''::text NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cashier text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'::text NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS sale_receipt_no text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS closed_at timestamp with time zone;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS racket_model text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS string_type text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS tension_main numeric;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS tension_cross numeric;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS tension_unit text DEFAULT 'lb'::text NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS grommet_notes text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS job_notes text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS dropped_off_at timestamp with time zone;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS promised_at timestamp with time zone;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS job_status text DEFAULT 'received'::text NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS job_status_by text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS job_status_at timestamp with time zone;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS notify_whatsapp boolean DEFAULT false NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS tag_id text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS intake_note text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS string_origin text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS string_source_product_id uuid;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS grip_product_id uuid;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS charges jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS technician text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS liability_accepted boolean DEFAULT false NOT NULL;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS incident_note text;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS terminal_name text;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS staff_name text;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS staff_role text;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS db_mode text DEFAULT 'online'::text NOT NULL;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS connection_status text DEFAULT 'online'::text NOT NULL;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS storage_engine text DEFAULT 'cloud'::text NOT NULL;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS pending_count integer DEFAULT 0 NOT NULL;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS conflict_count integer DEFAULT 0 NOT NULL;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS last_synced_at timestamp with time zone;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS app_version text;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS platform text;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS last_seen_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS branch_id text;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS pending_queue_count integer;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS last_ping timestamp with time zone;

ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS branch_code text;
ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS session_status text;
ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS sql_server_state text;
ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS database_name text;
ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS schema_version integer;
ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS failed_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS sync_phase text;
ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS current_table text;
ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS last_push_at timestamp with time zone;
ALTER TABLE public.branch_telemetry ADD COLUMN IF NOT EXISTS last_pull_at timestamp with time zone;

ALTER TABLE public.cashiers ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.cashiers ADD COLUMN IF NOT EXISTS username text;

ALTER TABLE public.cashiers ADD COLUMN IF NOT EXISTS full_name text DEFAULT ''::text NOT NULL;

ALTER TABLE public.cashiers ADD COLUMN IF NOT EXISTS pin_hash text;

ALTER TABLE public.cashiers ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.cashiers ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.cashiers ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;

ALTER TABLE public.cashiers ADD COLUMN IF NOT EXISTS last_login_at timestamp with time zone;

ALTER TABLE public.cashiers ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.cashiers ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.cashiers ADD COLUMN IF NOT EXISTS role_slug text;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS event_type text;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS campaign_id uuid;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS campaign_name text;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS voucher_token text;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS member_id uuid;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS member_phone text;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS staff_name text;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS staff_role text;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS sale_id text;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE public.coupon_events ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.drawer_events ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.drawer_events ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.drawer_events ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.drawer_events ADD COLUMN IF NOT EXISTS shift_id text;

ALTER TABLE public.drawer_events ADD COLUMN IF NOT EXISTS staff_id text;

ALTER TABLE public.drawer_events ADD COLUMN IF NOT EXISTS staff_name text;

ALTER TABLE public.drawer_events ADD COLUMN IF NOT EXISTS role text;

ALTER TABLE public.drawer_events ADD COLUMN IF NOT EXISTS reason text;

ALTER TABLE public.drawer_events ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE public.drawer_events ADD COLUMN IF NOT EXISTS approved_by text;

ALTER TABLE public.drawer_events ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS id text DEFAULT (gen_random_uuid())::text NOT NULL;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS label text DEFAULT ''::text NOT NULL;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS shift_id text;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS held_by text;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS total numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS lines jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS cart_discount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS cart_discount_type text DEFAULT 'amount'::text NOT NULL;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS exchange_ref text;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS member_id text;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS member_name text;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS coupon jsonb;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS note text DEFAULT ''::text NOT NULL;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS cancelled_from text;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS held_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.integration_settings ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.integration_settings ADD COLUMN IF NOT EXISTS provider_name text;

ALTER TABLE public.integration_settings ADD COLUMN IF NOT EXISTS api_keys_encrypted jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.integration_settings ADD COLUMN IF NOT EXISTS verification_channel text DEFAULT 'whatsapp'::text NOT NULL;

ALTER TABLE public.integration_settings ADD COLUMN IF NOT EXISTS strict_verification boolean DEFAULT false NOT NULL;

ALTER TABLE public.integration_settings ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;

ALTER TABLE public.integration_settings ADD COLUMN IF NOT EXISTS updated_by text;

ALTER TABLE public.integration_settings ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.integration_settings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS product_id uuid;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS product_name text;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS sku text;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS barcode text;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS activity_type text;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS reference text;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS quantity_delta integer DEFAULT 0 NOT NULL;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS stock_before integer;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS stock_after integer;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS unit_cost numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS staff_id text;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS staff_name text;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS role text;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS note text DEFAULT ''::text NOT NULL;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.item_activity_logs ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS member_id uuid;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS channel text DEFAULT 'whatsapp'::text NOT NULL;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS otp_code text;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS attempts integer DEFAULT 0 NOT NULL;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS sent_by text;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone DEFAULT (now() + '00:10:00'::interval) NOT NULL;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS verified_at timestamp with time zone;

ALTER TABLE public.member_verifications ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS member_code text;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS full_name text;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS address text;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS date_of_birth date;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS tier_id uuid;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS loyalty_points numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS total_spent numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false NOT NULL;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS verified_at timestamp with time zone;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS verified_channel text;

ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS discount_percentage numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS points_multiplier numeric DEFAULT 1.0 NOT NULL;

ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.offline_sync_audit_log ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.offline_sync_audit_log ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.offline_sync_audit_log ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.offline_sync_audit_log ADD COLUMN IF NOT EXISTS direction text;

ALTER TABLE public.offline_sync_audit_log ADD COLUMN IF NOT EXISTS table_name text;

ALTER TABLE public.offline_sync_audit_log ADD COLUMN IF NOT EXISTS record_id text;

ALTER TABLE public.offline_sync_audit_log ADD COLUMN IF NOT EXISTS records integer DEFAULT 0 NOT NULL;

ALTER TABLE public.offline_sync_audit_log ADD COLUMN IF NOT EXISTS status text DEFAULT 'ok'::text NOT NULL;

ALTER TABLE public.offline_sync_audit_log ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE public.offline_sync_audit_log ADD COLUMN IF NOT EXISTS started_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.offline_sync_audit_log ADD COLUMN IF NOT EXISTS finished_at timestamp with time zone;

ALTER TABLE public.offline_sync_audit_log ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS source_type text;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS sale_id uuid;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS booking_id uuid;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS member_id uuid;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS shift_id text;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS method text DEFAULT 'cash'::text NOT NULL;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS kind text DEFAULT 'payment'::text NOT NULL;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS reference text;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS cashier_id text;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS cashier_name text;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS note text DEFAULT ''::text NOT NULL;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS status text DEFAULT 'completed'::text;

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.payment_types ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.payment_types ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.payment_types ADD COLUMN IF NOT EXISTS type_code text;

ALTER TABLE public.payment_types ADD COLUMN IF NOT EXISTS requires_reference boolean DEFAULT false NOT NULL;

ALTER TABLE public.payment_types ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;

ALTER TABLE public.payment_types ADD COLUMN IF NOT EXISTS icon text DEFAULT 'Wallet'::text NOT NULL;

ALTER TABLE public.payment_types ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;

ALTER TABLE public.payment_types ADD COLUMN IF NOT EXISTS is_system boolean DEFAULT false NOT NULL;

ALTER TABLE public.payment_types ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.payment_types ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.payment_types ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.pin_attempts ADD COLUMN IF NOT EXISTS key text;

ALTER TABLE public.pin_attempts ADD COLUMN IF NOT EXISTS attempts integer DEFAULT 0 NOT NULL;

ALTER TABLE public.pin_attempts ADD COLUMN IF NOT EXISTS window_started_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.pin_attempts ADD COLUMN IF NOT EXISTS locked_until timestamp with time zone;

ALTER TABLE public.pin_attempts ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.pin_attempts ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS id integer DEFAULT 1 NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS tax_percentage numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS enable_tax boolean DEFAULT true NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS tax_mode text DEFAULT 'exclusive'::text NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS paper_size text DEFAULT '80mm'::text NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS header_text text;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS footer_text text;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS show_logo boolean DEFAULT true NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS show_points boolean DEFAULT true NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS show_barcode boolean DEFAULT true NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS show_tax_details boolean DEFAULT true NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS company_name text DEFAULT 'RETAIL'::text NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS tax_number text;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS reg_number text;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS website text;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS fonts jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS custom_lines jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS qr jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS ui_visibility jsonb DEFAULT '{"hidden": {}}'::jsonb NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS integration_settings jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS region_country text DEFAULT ''::text NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS time_zone text DEFAULT ''::text NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS date_format text DEFAULT 'dd/MM/yyyy'::text NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS time_format text DEFAULT '24h'::text NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS booking_slip jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS notification_settings jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS logo_data_url text;

ALTER TABLE public.pos_settings ADD COLUMN IF NOT EXISTS receipt_design jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.product_barcodes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.product_barcodes ADD COLUMN IF NOT EXISTS product_id uuid;

ALTER TABLE public.product_barcodes ADD COLUMN IF NOT EXISTS barcode text;

ALTER TABLE public.product_barcodes ADD COLUMN IF NOT EXISTS label text;

ALTER TABLE public.product_barcodes ADD COLUMN IF NOT EXISTS pack_size numeric DEFAULT 1 NOT NULL;

ALTER TABLE public.product_barcodes ADD COLUMN IF NOT EXISTS is_primary boolean DEFAULT false NOT NULL;

ALTER TABLE public.product_barcodes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.product_barcodes ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.product_barcodes ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS parent_id uuid;

ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS sort integer DEFAULT 0 NOT NULL;

ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS kind text DEFAULT 'category'::text NOT NULL;

ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode text;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS selling_price numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ecom_price numeric;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_quantity integer DEFAULT 0 NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS custom_points numeric;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS point_multiplier numeric DEFAULT 1.0 NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sku text;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS reorder_level integer DEFAULT 0 NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tax_rate numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ecom_visible boolean DEFAULT true NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_by_store jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS landing_pct numeric;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sub_category text;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit text;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS packs jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode_aliases text[] DEFAULT '{}'::text[] NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand text;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS product_group text;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode_variants jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 0 NOT NULL;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS title text;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS promo_type text;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS min_spend numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS discount_percent numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS foc_product_id uuid;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS points_per_dollar numeric DEFAULT 1 NOT NULL;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS tier_rates jsonb;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS start_date date;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS end_date date;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.public_flags ADD COLUMN IF NOT EXISTS key text;

ALTER TABLE public.public_flags ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;

ALTER TABLE public.public_flags ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS po_id uuid;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS product_id uuid;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS barcode text;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS product_name text;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS selling_price numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS quantity_received integer DEFAULT 0 NOT NULL;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS subtotal_cost numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS sku text;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS po_number text;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS supplier_name text;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS operator_name text;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS total_cost numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS total_items_count integer DEFAULT 0 NOT NULL;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS supplier_id uuid;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS store_code text;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS invoice_date date;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS invoice_entry_date timestamp with time zone DEFAULT now();

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS sale_id uuid;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS product_id uuid;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS product_name text;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1 NOT NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS discount_percent numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS is_return boolean DEFAULT false NOT NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS tax_rate numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS is_foc boolean DEFAULT false NOT NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS promo_id text;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS coupon_code text;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS coupon_discount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS unit_cost numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS bill_number text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS member_id uuid;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cashier_name text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS subtotal_amount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS total_amount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tax_amount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_type text DEFAULT 'cash'::text NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS points_earned numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS points_redeemed numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS is_exchange boolean DEFAULT false NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS original_bill_number text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS is_refunded boolean DEFAULT false NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS shift_id text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS paid_amount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS change_amount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS exchange_credit numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS exchanged_to_bill_number text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS coupon_code text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS coupon_promo_id text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS coupon_scope text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS coupon_discount numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payments jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS client_transaction_id text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cashier_id text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS created_by text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS updated_by text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS store_name_snapshot text;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS store_address_snapshot text;

ALTER TABLE public.secure_settings ADD COLUMN IF NOT EXISTS key text;

ALTER TABLE public.secure_settings ADD COLUMN IF NOT EXISTS ciphertext text;

ALTER TABLE public.secure_settings ADD COLUMN IF NOT EXISTS hint text;

ALTER TABLE public.secure_settings ADD COLUMN IF NOT EXISTS updated_by text;

ALTER TABLE public.secure_settings ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.secure_settings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS fingerprint text;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS severity text DEFAULT 'medium'::text NOT NULL;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS title text;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS detail text DEFAULT ''::text NOT NULL;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS deployment_ref text;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS status text DEFAULT 'open'::text NOT NULL;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS first_seen_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS last_seen_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS acknowledged_by text;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS acknowledged_at timestamp with time zone;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS resolved_at timestamp with time zone;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.security_findings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.settings_locks ADD COLUMN IF NOT EXISTS section text;

ALTER TABLE public.settings_locks ADD COLUMN IF NOT EXISTS locked boolean DEFAULT false NOT NULL;

ALTER TABLE public.settings_locks ADD COLUMN IF NOT EXISTS updated_by text;

ALTER TABLE public.settings_locks ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.settings_locks ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.settings_overrides ADD COLUMN IF NOT EXISTS scope text DEFAULT 'BRANCH'::text NOT NULL;

ALTER TABLE public.settings_overrides ADD COLUMN IF NOT EXISTS scope_id text DEFAULT ''::text NOT NULL;

ALTER TABLE public.settings_overrides ADD COLUMN IF NOT EXISTS section text;

ALTER TABLE public.settings_overrides ADD COLUMN IF NOT EXISTS patch jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.settings_overrides ADD COLUMN IF NOT EXISTS updated_by text;

ALTER TABLE public.settings_overrides ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.settings_overrides ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS shift_id text;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS terminal_name text;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS staff_id text;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS staff_name text;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS role text;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS signed_in_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS signed_out_at timestamp with time zone;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.shift_sessions ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS sku text;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS product_id uuid;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS product_name text;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS source text DEFAULT 'auto'::text NOT NULL;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS previous_sku text;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS store_name text;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS staff_id text;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS staff_name text;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS role text;

ALTER TABLE public.sku_audit ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.staff_roles ADD COLUMN IF NOT EXISTS slug text;

ALTER TABLE public.staff_roles ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.staff_roles ADD COLUMN IF NOT EXISTS base_level text DEFAULT 'cashier'::text NOT NULL;

ALTER TABLE public.staff_roles ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.staff_roles ADD COLUMN IF NOT EXISTS is_core boolean DEFAULT false NOT NULL;

ALTER TABLE public.staff_roles ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.staff_roles ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS product_id uuid;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS product_name text;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS sku text;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS barcode text;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS reason text DEFAULT 'manual'::text NOT NULL;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS note text DEFAULT ''::text NOT NULL;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS previous_stock integer DEFAULT 0 NOT NULL;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS updated_stock integer DEFAULT 0 NOT NULL;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS delta integer DEFAULT 0 NOT NULL;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS cost_impact numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS staff_id text;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS staff_name text;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS role text;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.stock_delta_applied ADD COLUMN IF NOT EXISTS movement_id uuid;

ALTER TABLE public.stock_delta_applied ADD COLUMN IF NOT EXISTS product_id uuid;

ALTER TABLE public.stock_delta_applied ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.stock_delta_applied ADD COLUMN IF NOT EXISTS delta integer DEFAULT 0 NOT NULL;

ALTER TABLE public.stock_delta_applied ADD COLUMN IF NOT EXISTS applied_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS transfer_id uuid;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS product_id uuid;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS barcode text;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS sku text;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS product_name text;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 0 NOT NULL;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS quantity_received integer DEFAULT 0 NOT NULL;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS quantity_approved integer;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS quantity_dispatched integer;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS quantity_verified integer;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS unit_cost numeric DEFAULT 0 NOT NULL;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

-- Older hand-built databases sometimes created transfer quantities as text or
-- numeric. ADD COLUMN IF NOT EXISTS cannot correct an existing column's type,
-- and mixed types later fail with 42804 inside COALESCE. Convert only values
-- that are exact integers; otherwise stop and name the offending column so no
-- row is silently rounded, discarded or replaced.
DO $quantity_types$
DECLARE
  target_column text;
  type_name text;
  invalid_count bigint;
BEGIN
  FOREACH target_column IN ARRAY ARRAY[
    'quantity', 'quantity_received', 'quantity_approved',
    'quantity_dispatched', 'quantity_verified'
  ] LOOP
    SELECT c.data_type
      INTO type_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'stock_transfer_items'
       AND c.column_name = target_column;

    IF type_name = 'integer' THEN
      CONTINUE;
    ELSIF type_name IN ('smallint', 'bigint', 'numeric', 'decimal',
                        'text', 'character varying', 'character') THEN
      EXECUTE format(
        'SELECT count(*) FROM public.stock_transfer_items WHERE %1$I IS NOT NULL AND (' ||
        'btrim(%1$I::text) !~ ''^[+-]?[0-9]+([.]0+)?$'' OR ' ||
        'CASE WHEN btrim(%1$I::text) ~ ''^[+-]?[0-9]+([.]0+)?$'' ' ||
        'THEN (%1$I::text)::numeric NOT BETWEEN -2147483648 AND 2147483647 ELSE false END)',
        target_column
      ) INTO invalid_count;

      IF invalid_count > 0 THEN
        RAISE EXCEPTION
          'Cannot safely convert public.stock_transfer_items.% to integer: % incompatible value(s). Correct those values and run this file again.',
          target_column, invalid_count
          USING ERRCODE = '42804';
      END IF;

      EXECUTE format(
        'ALTER TABLE public.stock_transfer_items ALTER COLUMN %1$I TYPE integer ' ||
        'USING CASE WHEN %1$I IS NULL OR btrim(%1$I::text) = '''' THEN NULL ' ||
        'ELSE (%1$I::text)::numeric::integer END',
        target_column
      );
    ELSIF type_name IS NOT NULL THEN
      RAISE EXCEPTION
        'Cannot automatically convert public.stock_transfer_items.% from % to integer. Correct this column type and run this file again.',
        target_column, type_name
        USING ERRCODE = '42804';
    END IF;
  END LOOP;
END
$quantity_types$;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS ref text;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS kind text DEFAULT 'transfer'::text NOT NULL;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS transfer_scope text DEFAULT 'INTRA_GROUP'::text NOT NULL;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS from_store_id text;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS from_store_name text;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS from_group_id text;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS to_store_id text;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS to_store_name text;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS to_group_id text;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS note text DEFAULT ''::text NOT NULL;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS created_by text;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS approved_by text;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS received_by text;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS received_at timestamp with time zone;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS rejected_reason text;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS id text;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS code text;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS address text;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS group_id text;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS location_type text DEFAULT 'store'::text NOT NULL;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS parent_id text;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS is_central boolean DEFAULT false NOT NULL;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS building_name text;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS floor_label text;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS is_primary_sub boolean DEFAULT false NOT NULL;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS contact_name text;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS address text;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS tax_number text;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS table_name text;

ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS last_synced_at timestamp with time zone;

ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS last_pushed_at timestamp with time zone;

ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS rows_pushed integer DEFAULT 0 NOT NULL;

ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS last_error text;

ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS actor_id text;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS actor_name text;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS actor_role text;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS action_type text;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS entity_affected text;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS entity_id text;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS old_value jsonb;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS new_value jsonb;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS ip_address text;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE public.system_audit_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS command text;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS result text;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS issued_by text;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS issued_role text;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS picked_up_at timestamp with time zone;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS finished_at timestamp with time zone;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.terminal_commands ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS location_id text;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS location_name text;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS device_name text;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'::text NOT NULL;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS activated_at timestamp with time zone;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS revoked_at timestamp with time zone;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS last_seen_at timestamp with time zone;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS app_version text;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS last_sync_at timestamp with time zone;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS reissued_at timestamp with time zone;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS replaced_by uuid;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS claimed_by_device text;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS claimed_at timestamp with time zone;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS platform text DEFAULT 'pc'::text NOT NULL;

ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.uom_units ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.uom_units ADD COLUMN IF NOT EXISTS code text;

ALTER TABLE public.uom_units ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.uom_units ADD COLUMN IF NOT EXISTS allow_decimal boolean DEFAULT false NOT NULL;

ALTER TABLE public.uom_units ADD COLUMN IF NOT EXISTS sort integer DEFAULT 0 NOT NULL;

ALTER TABLE public.uom_units ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.uom_units ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.uom_units ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS role public.app_role;

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.whatsapp_queue ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public.whatsapp_queue ADD COLUMN IF NOT EXISTS phone_number_id text DEFAULT ''::text NOT NULL;

ALTER TABLE public.whatsapp_queue ADD COLUMN IF NOT EXISTS recipient text;

ALTER TABLE public.whatsapp_queue ADD COLUMN IF NOT EXISTS body text DEFAULT ''::text NOT NULL;

ALTER TABLE public.whatsapp_queue ADD COLUMN IF NOT EXISTS reference text;

ALTER TABLE public.whatsapp_queue ADD COLUMN IF NOT EXISTS store_id text;

ALTER TABLE public.whatsapp_queue ADD COLUMN IF NOT EXISTS status text DEFAULT 'QUEUED'::text NOT NULL;

ALTER TABLE public.whatsapp_queue ADD COLUMN IF NOT EXISTS error text;

ALTER TABLE public.whatsapp_queue ADD COLUMN IF NOT EXISTS queued_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.whatsapp_queue ADD COLUMN IF NOT EXISTS sent_at timestamp with time zone;

ALTER TABLE public.whatsapp_queue ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE public.whatsapp_queue ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

-- ============================================================
-- Routine re-run guard.
--
-- Postgres refuses CREATE OR REPLACE FUNCTION when an existing function of
-- the same name/arguments returns a different row shape (42P13). This block
-- checks each routine this script defines: if it does not exist, nothing
-- happens; if it exists with the same return signature, it is left alone;
-- only when the return signature differs is that ONE function dropped so the
-- definition below can recreate it. No table, row, index or policy is ever
-- touched, and each drop is guarded so a routine still pinned by a trigger or
-- policy is skipped instead of aborting the script.
-- ============================================================
DO $guard$
DECLARE
  expected  record;
  existing  record;
  norm_want text;
  norm_have text;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
    ('activity_events_immutable', $sig$trigger$sig$),
    ('app_users_require_store', $sig$trigger$sig$),
    ('booking_payment_within_total', $sig$trigger$sig$),
    ('bump_row_version', $sig$trigger$sig$),
    ('campaign_is_live', $sig$boolean$sig$),
    ('coupon_claim', $sig$text$sig$),
    ('coupon_events_readonly', $sig$trigger$sig$),
    ('coupon_issue_manual', $sig$text$sig$),
    ('coupon_log', $sig$void$sig$),
    ('current_app_user', $sig$TABLE(id uuid, user_id text, full_name text, role public.app_role, store_id text, email text, permissions jsonb, is_active boolean)$sig$),
    ('delete_cashier', $sig$void$sig$),
    ('delete_terminal_user', $sig$void$sig$),
    ('enforce_booking_permissions', $sig$trigger$sig$),
    ('enforce_member_points_permissions', $sig$trigger$sig$),
    ('enforce_product_price_permissions', $sig$trigger$sig$),
    ('enforce_sale_item_permissions', $sig$trigger$sig$),
    ('enforce_sale_permissions', $sig$trigger$sig$),
    ('has_perm', $sig$boolean$sig$),
    ('has_role', $sig$boolean$sig$),
    ('is_app_supervisor', $sig$boolean$sig$),
    ('is_staff', $sig$boolean$sig$),
    ('is_staff_now', $sig$boolean$sig$),
    ('is_supervisor_now', $sig$boolean$sig$),
    ('legacy_cashiers_for_migration', $sig$TABLE(username text, full_name text, pin_hash text, role_slug text, store_id text, is_active boolean)$sig$),
    ('list_app_users', $sig$TABLE(id uuid, auth_user_id uuid, user_id text, full_name text, email text, role public.app_role, role_slug text, store_id text, is_active boolean, permissions jsonb, has_pin boolean, pin_length smallint, last_login_at timestamp with time zone, created_at timestamp with time zone)$sig$),
    ('list_cashiers', $sig$TABLE(id uuid, username text, full_name text, store_id text, permissions jsonb, is_active boolean, last_login_at timestamp with time zone, created_at timestamp with time zone)$sig$),
    ('member_join', $sig$uuid$sig$),
    ('member_welcome_claim', $sig$text$sig$),
    ('normalize_phone', $sig$text$sig$),
    ('operational_relational_health', $sig$jsonb$sig$),
    ('pin_throttle_fail', $sig$jsonb$sig$),
    ('pin_throttle_reset', $sig$void$sig$),
    ('pin_throttle_status', $sig$jsonb$sig$),
    ('products_bump_row_version', $sig$trigger$sig$),
    ('schema_inventory', $sig$jsonb$sig$),
    ('security_report_findings', $sig$jsonb$sig$),
    ('security_selfcheck', $sig$jsonb$sig$),
    ('security_set_finding_status', $sig$void$sig$),
    ('set_app_user_permissions', $sig$void$sig$),
    ('set_app_user_profile', $sig$void$sig$),
    ('set_cashier_permissions', $sig$void$sig$),
    ('set_terminal_active', $sig$void$sig$),
    ('shift_active_for_branch', $sig$public.shifts$sig$),
    ('shift_open', $sig$public.shifts$sig$),
    ('shifts_sync_status', $sig$trigger$sig$),
    ('skip_stale_update', $sig$trigger$sig$),
    ('staff_account_adopt_legacy', $sig$void$sig$),
    ('staff_account_delete_profile', $sig$void$sig$),
    ('staff_account_set_active', $sig$void$sig$),
    ('staff_account_set_pin', $sig$void$sig$),
    ('staff_account_upsert', $sig$void$sig$),
    ('staff_role_delete', $sig$void$sig$),
    ('staff_role_save', $sig$void$sig$),
    ('stock_apply_delta', $sig$integer$sig$),
    ('stock_transfer_receive', $sig$void$sig$),
    ('store_visible', $sig$boolean$sig$),
    ('stores_hierarchy_guard', $sig$trigger$sig$),
    ('sync_auth_user_to_public', $sig$trigger$sig$),
    ('system_audit_immutable', $sig$trigger$sig$),
    ('terminal_staff_list', $sig$TABLE(user_id text, full_name text, role_slug text, store_id text, kind text, pin_length smallint)$sig$),
    ('terminal_token_claim', $sig$boolean$sig$),
    ('terminal_token_heartbeat', $sig$void$sig$),
    ('terminal_token_status', $sig$TABLE(status text, location_name text, location_id text, is_claimed boolean, expires_at timestamp with time zone)$sig$),
    ('touch_updated_at', $sig$trigger$sig$),
    ('update_updated_at_column', $sig$trigger$sig$),
    ('upsert_cashier', $sig$uuid$sig$),
    ('upsert_terminal_user', $sig$void$sig$),
    ('user_cluster_id', $sig$text$sig$),
    ('user_has_store_access', $sig$boolean$sig$),
    ('user_store_id', $sig$text$sig$),
    ('verify_cashier_pin', $sig$TABLE(id uuid, username text, full_name text, store_id text, permissions jsonb)$sig$),
    ('verify_terminal_pin', $sig$TABLE(user_id text, full_name text, role public.app_role, store_id text, email text)$sig$),
    ('voucher_by_token', $sig$TABLE(voucher jsonb, campaign jsonb, member_name text, member_code text)$sig$),
    ('voucher_redeem', $sig$public.issued_vouchers$sig$),
    ('voucher_set_status', $sig$public.issued_vouchers$sig$),
    ('voucher_token', $sig$text$sig$)
    ) AS t(fn_name, fn_result)
  LOOP
    norm_want := lower(btrim(regexp_replace(replace(expected.fn_result, 'public.', ''), '\s+', ' ', 'g')));
    FOR existing IN
      SELECT p.oid::regprocedure AS sig, pg_get_function_result(p.oid) AS result
        FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname = expected.fn_name
    LOOP
      norm_have := lower(btrim(regexp_replace(replace(existing.result, 'public.', ''), '\s+', ' ', 'g')));
      IF norm_have IS DISTINCT FROM norm_want THEN
        BEGIN
          EXECUTE 'DROP FUNCTION IF EXISTS ' || existing.sig;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'routine % kept in place: %', existing.sig, SQLERRM;
        END;
      END IF;
    END LOOP;
  END LOOP;
END
$guard$;

-- ============================================================
-- Routines. Created after the tables they read, so a fresh
-- project resolves every reference.
-- ============================================================

CREATE OR REPLACE FUNCTION public.activity_events_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'cleared_by') = (to_jsonb(OLD) - 'cleared_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'activity_events rows cannot be % ', TG_OP;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_activity_event_cleared(
  p_event_id uuid,
  p_cleared boolean
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  _user_id text;
BEGIN
  SELECT a.user_id INTO _user_id
    FROM public.app_users a
   WHERE a.auth_user_id = auth.uid()
      OR lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
   LIMIT 1;
  IF _user_id IS NULL OR NOT public.is_app_supervisor() THEN
    RAISE EXCEPTION 'A signed-in supervisor is required';
  END IF;
  UPDATE public.activity_events
     SET cleared_by = CASE
       WHEN p_cleared THEN array(SELECT DISTINCT x FROM unnest(cleared_by || _user_id) x)
       ELSE array_remove(cleared_by, _user_id)
     END
   WHERE id = p_event_id;
END;
$$;

-- Electron calls Supabase directly, so bulk clear derives both the person and
-- branch from the authenticated database session. No caller-controlled user
-- id or cross-branch selector is accepted.
CREATE OR REPLACE FUNCTION public.set_all_activity_events_cleared()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id text;
  v_role public.app_role;
  v_store_id text;
  v_count integer;
BEGIN
  SELECT a.user_id, a.role, a.store_id
    INTO v_user_id, v_role, v_store_id
    FROM public.app_users a
   WHERE a.is_active
     AND (
       a.auth_user_id = (SELECT auth.uid())
       OR lower(a.email) = lower(coalesce((SELECT auth.jwt()) ->> 'email', ''))
     )
   LIMIT 1;

  IF v_user_id IS NULL OR NOT public.has_perm('can_view_audit_trail') THEN
    RAISE EXCEPTION 'A signed-in activity supervisor is required';
  END IF;

  UPDATE public.activity_events
     SET cleared_by = array(
       SELECT DISTINCT value FROM unnest(cleared_by || v_user_id) AS value
     )
   WHERE (v_role = 'admin'::public.app_role OR v_store_id IS NULL OR store_id = v_store_id)
     AND NOT (v_user_id = ANY(cleared_by));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.set_all_activity_events_cleared() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_all_activity_events_cleared() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_all_activity_events_cleared() TO service_role;

-- The hosted POS backend uses this only after it has verified the staff proof
-- and re-read app_users. Clients cannot call it with another person's id.
CREATE OR REPLACE FUNCTION public.pos_set_activity_event_cleared(
  p_event_id uuid,
  p_user_id text,
  p_cleared boolean
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = p_user_id AND is_active) THEN
    RAISE EXCEPTION 'Active staff account required';
  END IF;
  UPDATE public.activity_events
     SET cleared_by = CASE
       WHEN p_cleared THEN array(SELECT DISTINCT x FROM unnest(cleared_by || p_user_id) x)
       ELSE array_remove(cleared_by, p_user_id)
     END
   WHERE id = p_event_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_set_activity_event_cleared(uuid,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_set_activity_event_cleared(uuid,text,boolean) TO service_role;

-- Bulk clear is still a per-user state transition. The immutable event stays
-- in the audit log and becomes that person's notification history.
CREATE OR REPLACE FUNCTION public.pos_set_all_activity_events_cleared(
  p_user_id text,
  p_store_id text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_users WHERE user_id = p_user_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Active staff account required';
  END IF;

  UPDATE public.activity_events
     SET cleared_by = array(
       SELECT DISTINCT value FROM unnest(cleared_by || p_user_id) AS value
     )
   WHERE (p_store_id IS NULL OR store_id = p_store_id)
     AND NOT (p_user_id = ANY(cleared_by));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_set_all_activity_events_cleared(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_set_all_activity_events_cleared(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.app_users_require_store() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- NULL is an explicit "All branches" assignment. The physical terminal
  -- supplies the branch when this person signs in and performs operations.
  IF NEW.store_id IS NOT NULL AND btrim(NEW.store_id) = '' THEN
    NEW.store_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_payment_within_total() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  booking_total numeric;
  already_paid numeric;
BEGIN
  SELECT total INTO booking_total FROM public.bookings WHERE id = NEW.booking_id;
  IF booking_total IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(sum(amount), 0) INTO already_paid
  FROM public.booking_payments
  WHERE booking_id = NEW.booking_id
    AND (TG_OP = 'INSERT' OR id <> NEW.id);
  IF already_paid + NEW.amount > booking_total + 0.005 THEN
    RAISE EXCEPTION 'Payment of % exceeds the amount still due on this booking (% of % already paid)',
      NEW.amount, already_paid, booking_total;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_row_version() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.row_version := COALESCE(OLD.row_version, 0) + 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.campaign_is_live(_c public.coupon_campaigns) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT _c.is_active
    AND (_c.starts_at IS NULL OR now() >= _c.starts_at)
    AND (_c.expires_at IS NULL OR now() <= _c.expires_at)
    AND (_c.max_claims IS NULL OR _c.claims_count < _c.max_claims)
$$;

CREATE OR REPLACE FUNCTION public.coupon_claim(_slug text, _phone text, _full_name text DEFAULT NULL::text, _email text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  _c public.coupon_campaigns;
  _member uuid;
  _token text;
  _held integer;
BEGIN
  SELECT * INTO _c FROM public.coupon_campaigns WHERE slug = _slug FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND'; END IF;
  IF NOT _c.is_active THEN RAISE EXCEPTION 'CAMPAIGN_INACTIVE'; END IF;
  IF _c.starts_at IS NOT NULL AND now() < _c.starts_at THEN RAISE EXCEPTION 'CAMPAIGN_NOT_STARTED'; END IF;
  IF _c.expires_at IS NOT NULL AND now() > _c.expires_at THEN RAISE EXCEPTION 'CAMPAIGN_EXPIRED'; END IF;

  _member := public.member_join(_phone, _full_name, _email);

  SELECT count(*) INTO _held FROM public.issued_vouchers
   WHERE campaign_id = _c.id AND member_id = _member;

  SELECT token_slug INTO _token FROM public.issued_vouchers
   WHERE campaign_id = _c.id AND member_id = _member AND status = 'ISSUED'
   ORDER BY issued_at DESC LIMIT 1;
  IF _token IS NOT NULL THEN RETURN _token; END IF;

  IF _c.max_per_member IS NOT NULL AND _held >= _c.max_per_member THEN
    PERFORM public.coupon_log('BLOCKED', _c, NULL, _member, _phone, NULL, NULL, NULL, NULL, NULL,
      'Per-member limit reached');
    RAISE EXCEPTION 'MEMBER_LIMIT_REACHED';
  END IF;

  IF _c.max_claims IS NOT NULL AND _c.claims_count >= _c.max_claims THEN
    PERFORM public.coupon_log('BLOCKED', _c, NULL, _member, _phone, NULL, NULL, NULL, NULL, NULL,
      'Campaign fully claimed');
    RAISE EXCEPTION 'CAMPAIGN_FULLY_CLAIMED';
  END IF;

  _token := public.voucher_token();
  INSERT INTO public.issued_vouchers (token_slug, campaign_id, member_id, issued_source)
  VALUES (_token, _c.id, _member, 'PUBLIC');

  UPDATE public.coupon_campaigns SET claims_count = claims_count + 1 WHERE id = _c.id;

  PERFORM public.coupon_log('CLAIMED', _c, _token, _member, _phone);
  RETURN _token;
END $$;

CREATE OR REPLACE FUNCTION public.coupon_events_readonly() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN RAISE EXCEPTION 'coupon_events is append-only'; END; $$;

CREATE OR REPLACE FUNCTION public.coupon_issue_manual(_slug text, _phone text, _full_name text DEFAULT NULL::text, _expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _staff text DEFAULT NULL::text, _role text DEFAULT NULL::text, _store text DEFAULT NULL::text, _ignore_limit boolean DEFAULT false) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  _c public.coupon_campaigns;
  _member uuid;
  _token text;
  _held integer;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can issue vouchers';
  END IF;

  SELECT * INTO _c FROM public.coupon_campaigns WHERE slug = _slug FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND'; END IF;

  _member := public.member_join(_phone, _full_name, NULL);

  SELECT count(*) INTO _held FROM public.issued_vouchers
   WHERE campaign_id = _c.id AND member_id = _member;

  IF NOT _ignore_limit AND _c.max_per_member IS NOT NULL AND _held >= _c.max_per_member THEN
    PERFORM public.coupon_log('BLOCKED', _c, NULL, _member, _phone, _store, NULL, _staff, _role, NULL,
      'Manual issue blocked by per-member limit');
    RAISE EXCEPTION 'MEMBER_LIMIT_REACHED';
  END IF;

  _token := public.voucher_token();
  INSERT INTO public.issued_vouchers
    (token_slug, campaign_id, member_id, expires_at, issued_by, issued_source)
  VALUES (_token, _c.id, _member, _expires_at, _staff, 'MANUAL');

  UPDATE public.coupon_campaigns SET claims_count = claims_count + 1 WHERE id = _c.id;

  PERFORM public.coupon_log('ISSUED_MANUAL', _c, _token, _member, _phone, _store, NULL, _staff, _role,
    NULL, CASE WHEN _expires_at IS NULL THEN NULL ELSE 'Custom expiry' END);

  RETURN _token;
END $$;

CREATE OR REPLACE FUNCTION public.coupon_log(_type text, _campaign public.coupon_campaigns, _token text DEFAULT NULL::text, _member uuid DEFAULT NULL::uuid, _phone text DEFAULT NULL::text, _store text DEFAULT NULL::text, _terminal text DEFAULT NULL::text, _staff text DEFAULT NULL::text, _role text DEFAULT NULL::text, _sale text DEFAULT NULL::text, _note text DEFAULT NULL::text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  INSERT INTO public.coupon_events (
    event_type, campaign_id, campaign_name, voucher_token, member_id, member_phone,
    store_id, terminal_id, staff_name, staff_role, sale_id, note
  ) VALUES (
    _type, _campaign.id, _campaign.name, _token, _member, _phone,
    _store, _terminal, _staff, _role, _sale, _note
  );
$$;

CREATE OR REPLACE FUNCTION public.current_app_user() RETURNS TABLE(id uuid, user_id text, full_name text, role public.app_role, store_id text, email text, permissions jsonb, is_active boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT a.id, a.user_id::text, a.full_name::text, a.role, a.store_id::text,
         a.email::text, a.permissions, a.is_active
  FROM public.app_users a
  WHERE a.auth_user_id = (SELECT auth.uid())
     OR lower(a.email) = lower(coalesce((SELECT auth.jwt()) ->> 'email', ''))
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.delete_cashier(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_app_supervisor() THEN
    RAISE EXCEPTION 'Only supervisors and admins can manage cashiers';
  END IF;
  DELETE FROM public.cashiers WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION public.delete_terminal_user(p_user_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Only admins can delete terminal users';
  END IF;
  DELETE FROM public.app_users a WHERE lower(a.user_id) = lower(trim(p_user_id));
END $$;

CREATE OR REPLACE FUNCTION public.enforce_booking_permissions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN NEW; END IF;

  IF coalesce(NEW.discount, 0) > 0
     AND (TG_OP = 'INSERT' OR coalesce(NEW.discount, 0) <> coalesce(OLD.discount, 0)) THEN
    IF NOT public.has_perm('can_give_discount') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_DISCOUNT';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_member_points_permissions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE'
     AND (coalesce(NEW.loyalty_points, 0) <> coalesce(OLD.loyalty_points, 0)
       OR coalesce(NEW.total_spent, 0)    <> coalesce(OLD.total_spent, 0)
       OR NEW.tier_id IS DISTINCT FROM OLD.tier_id) THEN
    IF NOT public.has_perm('can_edit_member_points') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_MEMBER_POINTS';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NOT public.has_perm('can_add_member') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_MEMBER';
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_product_price_permissions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE'
     AND (coalesce(NEW.selling_price, 0) <> coalesce(OLD.selling_price, 0)
       OR coalesce(NEW.cost_price, 0)    <> coalesce(OLD.cost_price, 0)
       OR coalesce(NEW.ecom_price, -1)   IS DISTINCT FROM coalesce(OLD.ecom_price, -1)) THEN
    IF NOT public.has_perm('can_edit_product_price') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_PRICE';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NOT public.has_perm('can_add_new_product') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT';
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_sale_item_permissions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN NEW; END IF;

  IF coalesce(NEW.discount_percent, 0) > 0
     OR coalesce(NEW.discount_amount, 0) > 0
     OR coalesce(NEW.coupon_discount, 0) > 0 THEN
    IF NOT public.has_perm('can_give_discount') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_DISCOUNT';
    END IF;
  END IF;

  IF coalesce(NEW.is_return, false) OR coalesce(NEW.quantity, 0) < 0 THEN
    IF NOT public.has_perm('can_process_refund') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_REFUND';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_sale_permissions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN NEW; END IF;

  IF coalesce(NEW.discount_amount, 0) > 0 OR coalesce(NEW.coupon_discount, 0) > 0 THEN
    IF NOT public.has_perm('can_give_discount') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_DISCOUNT';
    END IF;
  END IF;

  IF coalesce(NEW.is_refunded, false) THEN
    IF NOT public.has_perm('can_process_refund') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_REFUND';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.payment_type IS DISTINCT FROM OLD.payment_type
          OR NEW.payments IS DISTINCT FROM OLD.payments)
     AND NOT public.has_perm('can_edit_tenders') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_TENDER_EDIT';
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.has_perm(_flag text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL THEN false
    WHEN public.is_app_supervisor() THEN true
    ELSE coalesce((
      SELECT (a.permissions ->> _flag)::boolean
        FROM public.app_users a
       WHERE a.is_active
         AND (a.auth_user_id = (SELECT auth.uid())
              OR lower(a.email) = lower(coalesce((SELECT auth.jwt()) ->> 'email', '')))
       LIMIT 1), false)
  END
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_app_supervisor() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE ok boolean := false;
BEGIN
  SELECT exists (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin','manager')
  ) INTO ok;
  IF ok THEN RETURN true; END IF;
  BEGIN
    SELECT exists (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role::text IN ('admin','manager')
    ) INTO ok;
  EXCEPTION WHEN undefined_table OR undefined_column THEN ok := false;
  END;
  RETURN coalesce(ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT _user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id AND role IN ('admin','manager','staff')
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users a
       WHERE a.is_active
         AND a.auth_user_id = _user_id
         AND a.role::text IN ('admin','manager','staff')
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_staff_now() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT public.is_staff((SELECT auth.uid())) $$;

CREATE OR REPLACE FUNCTION public.is_terminal_active() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users a
    WHERE a.is_active
      AND (
        a.auth_user_id = (SELECT auth.uid())
        OR lower(a.email) = lower(coalesce((SELECT auth.jwt()) ->> 'email', ''))
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_supervisor_now() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT public.is_app_supervisor() $$;

CREATE OR REPLACE FUNCTION public.legacy_cashiers_for_migration() RETURNS TABLE(username text, full_name text, pin_hash text, role_slug text, store_id text, is_active boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT c.username, c.full_name, c.pin_hash, coalesce(c.role_slug, 'cashier'), c.store_id, c.is_active
  FROM public.cashiers c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.app_users a
    WHERE lower(a.user_id) = lower(c.username) AND coalesce(a.pin_hash, '') <> ''
  )
$$;

CREATE OR REPLACE FUNCTION public.list_app_users() RETURNS TABLE(id uuid, auth_user_id uuid, user_id text, full_name text, email text, role public.app_role, role_slug text, store_id text, is_active boolean, permissions jsonb, has_pin boolean, pin_length smallint, last_login_at timestamp with time zone, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT a.id, a.auth_user_id, a.user_id::text, a.full_name::text, a.email::text,
         a.role, a.role_slug, a.store_id::text, a.is_active, a.permissions,
         coalesce(a.pin_hash, '') <> '', a.pin_length, a.last_login_at, a.created_at
  FROM public.app_users a
  WHERE public.has_perm('can_manage_staff')
  ORDER BY a.full_name, a.user_id
$$;

CREATE OR REPLACE FUNCTION public.list_cashiers() RETURNS TABLE(id uuid, username text, full_name text, store_id text, permissions jsonb, is_active boolean, last_login_at timestamp with time zone, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT c.id, c.username, c.full_name, c.store_id, c.permissions,
         c.is_active, c.last_login_at, c.created_at
  FROM public.cashiers c
  WHERE public.has_perm('can_manage_staff')
  ORDER BY c.username
$$;

CREATE OR REPLACE FUNCTION public.member_join(_phone text, _full_name text, _email text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  _digits text := public.normalize_phone(_phone);
  _id uuid;
  _code text;
BEGIN
  IF length(_digits) < 6 THEN RAISE EXCEPTION 'A valid mobile number is required'; END IF;

  SELECT id INTO _id FROM public.members
   WHERE public.normalize_phone(phone) = _digits LIMIT 1;

  IF _id IS NOT NULL THEN
    IF coalesce(_email, '') <> '' THEN
      UPDATE public.members SET email = _email WHERE id = _id AND coalesce(email, '') = '';
    END IF;
    RETURN _id;
  END IF;

  IF coalesce(trim(_full_name), '') = '' THEN RAISE EXCEPTION 'NEW_MEMBER_NAME_REQUIRED'; END IF;

  _code := 'M' || to_char(now(), 'YYMMDD') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);

  INSERT INTO public.members (member_code, full_name, phone, email, loyalty_points, total_spent)
  VALUES (_code, trim(_full_name), _phone, nullif(_email, ''), 0, 0)
  RETURNING id INTO _id;

  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.member_welcome_claim(_phone text, _full_name text, _email text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  _slug text;
  _auto boolean;
BEGIN
  PERFORM public.member_join(_phone, _full_name, _email);

  SELECT coalesce((integration_settings->>'autoIssueWelcome')::boolean, false)
    INTO _auto FROM public.pos_settings WHERE id = 1;

  IF coalesce(_auto, false) IS NOT TRUE THEN RETURN NULL; END IF;

  SELECT slug INTO _slug FROM public.coupon_campaigns c
   WHERE c.is_welcome AND public.campaign_is_live(c)
   ORDER BY c.created_at DESC LIMIT 1;

  IF _slug IS NULL THEN RETURN NULL; END IF;
  RETURN public.coupon_claim(_slug, _phone, _full_name, _email);
END $$;

CREATE OR REPLACE FUNCTION public.normalize_phone(_phone text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT regexp_replace(coalesce(_phone, ''), '[^0-9]', '', 'g')
$$;

CREATE OR REPLACE FUNCTION public.operational_relational_health() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tables text[] := ARRAY[
    'sales','sale_items','bookings','booking_payments','payment_transactions',
    'products','product_barcodes','product_categories','members','membership_tiers',
    'purchase_orders','purchase_order_items','stock_transfers','stock_transfer_items',
    'promotions','coupon_campaigns','issued_vouchers','stock_adjustments','item_activity_logs'
  ];
  _t text;
  _fk record;
  _orphans bigint;
  _rows bigint;
  _links jsonb;
  _out jsonb := '[]'::jsonb;
BEGIN
  FOREACH _t IN ARRAY _tables LOOP
    IF to_regclass('public.' || _t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I', _t) INTO _rows;
    _links := '[]'::jsonb;

    FOR _fk IN
      SELECT c.conname,
             a.attname   AS child_column,
             pt.relname  AS parent_table,
             pa.attname  AS parent_column
      FROM pg_constraint c
      JOIN pg_class ct ON ct.oid = c.conrelid
      JOIN pg_class pt ON pt.oid = c.confrelid
      JOIN unnest(c.conkey)  WITH ORDINALITY AS ck(attnum, ord) ON true
      JOIN unnest(c.confkey) WITH ORDINALITY AS pk(attnum, ord) ON pk.ord = ck.ord
      JOIN pg_attribute a  ON a.attrelid  = c.conrelid  AND a.attnum  = ck.attnum
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = pk.attnum
      WHERE c.contype = 'f'
        AND ct.relnamespace = 'public'::regnamespace
        AND ct.relname = _t
    LOOP
      EXECUTE format(
        'SELECT count(*) FROM public.%I ch WHERE ch.%I IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.%I pr WHERE pr.%I = ch.%I)',
        _t, _fk.child_column, _fk.parent_table, _fk.parent_column, _fk.child_column
      ) INTO _orphans;

      _links := _links || jsonb_build_object(
        'constraint', _fk.conname,
        'column', _fk.child_column,
        'parent_table', _fk.parent_table,
        'parent_column', _fk.parent_column,
        'orphans', _orphans
      );
    END LOOP;

    _out := _out || jsonb_build_object(
      'table', _t,
      'rows', _rows,
      'links', _links
    );
  END LOOP;

  RETURN jsonb_build_object('at', now(), 'tables', _out);
END;
$$;

CREATE OR REPLACE FUNCTION public.pin_throttle_fail(_key text, _limit integer DEFAULT 5, _window_secs integer DEFAULT 900, _lock_secs integer DEFAULT 300) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  row public.pin_attempts;
BEGIN
  INSERT INTO public.pin_attempts (key, attempts, window_started_at, updated_at)
  VALUES (_key, 1, now(), now())
  ON CONFLICT (key) DO UPDATE
    SET attempts = CASE
          WHEN public.pin_attempts.window_started_at < now() - make_interval(secs => _window_secs)
            THEN 1
          ELSE public.pin_attempts.attempts + 1
        END,
        window_started_at = CASE
          WHEN public.pin_attempts.window_started_at < now() - make_interval(secs => _window_secs)
            THEN now()
          ELSE public.pin_attempts.window_started_at
        END,
        updated_at = now()
  RETURNING * INTO row;

  IF row.attempts >= _limit THEN
    UPDATE public.pin_attempts
      SET locked_until = now() + make_interval(secs => _lock_secs),
          attempts = 0,
          window_started_at = now(),
          updated_at = now()
      WHERE key = _key
      RETURNING * INTO row;
  END IF;

  RETURN jsonb_build_object(
    'locked', (row.locked_until IS NOT NULL AND row.locked_until > now()),
    'locked_until', row.locked_until,
    'attempts', row.attempts);
END;
$$;

CREATE OR REPLACE FUNCTION public.pin_throttle_reset(_key text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  DELETE FROM public.pin_attempts WHERE key = _key;
$$;

CREATE OR REPLACE FUNCTION public.pin_throttle_status(_key text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
        'locked', (a.locked_until IS NOT NULL AND a.locked_until > now()),
        'locked_until', a.locked_until,
        'attempts', a.attempts)
     FROM public.pin_attempts a WHERE a.key = _key),
    jsonb_build_object('locked', false, 'attempts', 0));
$$;

CREATE OR REPLACE FUNCTION public.products_bump_row_version() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.row_version := COALESCE(OLD.row_version, 0) + 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.schema_inventory() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'at', now(),
    'tables', COALESCE((
      SELECT jsonb_agg(t ORDER BY t->>'table')
      FROM (
        SELECT jsonb_build_object(
          'table', c.relname,
          'rls', c.relrowsecurity,
          'policies', (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname),
          'columns', (
            SELECT jsonb_agg(jsonb_build_object(
              'name', a.attname,
              'type', format_type(a.atttypid, a.atttypmod),
              'notnull', a.attnotnull,
              'has_default', a.atthasdef
            ) ORDER BY a.attnum)
            FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          ),
          'indexes', (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid),
          'foreign_keys', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('name', con.conname, 'definition', pg_get_constraintdef(con.oid)))
            FROM pg_constraint con WHERE con.conrelid = c.oid AND con.contype = 'f'
          ), '[]'::jsonb)
        ) AS t
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
      ) s
    ), '[]'::jsonb),
    'functions', COALESCE((
      SELECT jsonb_agg(p.proname ORDER BY p.proname)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    ), '[]'::jsonb)
  );
$$;

-- Guard for routines only a supervisor (or the system itself) may run.
CREATE OR REPLACE FUNCTION public.assert_supervisor_caller() RETURNS void
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role'
     OR session_user IN ('postgres', 'supabase_admin') THEN RETURN; END IF;
  IF NOT public.is_app_supervisor() THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.assert_supervisor_caller() TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_supervisor_caller() TO service_role;

CREATE OR REPLACE FUNCTION public.security_report_findings(_source text, _deployment_ref text, _findings jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  _item jsonb;
  _fp text;
  _seen text[] := ARRAY[]::text[];
  _new integer := 0;
  _inserted boolean;
  _resolved integer := 0;
BEGIN
  PERFORM public.assert_supervisor_caller();
  IF coalesce(_source, '') NOT IN ('ci', 'selfcheck') THEN
    RAISE EXCEPTION 'INVALID_SOURCE';
  END IF;
  IF _findings IS NULL OR jsonb_typeof(_findings) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD';
  END IF;
  IF jsonb_array_length(_findings) > 200 THEN
    RAISE EXCEPTION 'TOO_MANY_FINDINGS';
  END IF;
  IF (SELECT count(*) FROM public.security_findings
       WHERE created_at > now() - interval '1 hour') > 200 THEN
    RAISE EXCEPTION 'REPORT_RATE_LIMITED';
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_findings) LOOP
    IF coalesce(trim(_item ->> 'title'), '') = '' THEN CONTINUE; END IF;

    _fp := _source || ':' || coalesce(
      nullif(trim(_item ->> 'id'), ''),
      md5(lower(trim(_item ->> 'title'))));

    _seen := _seen || _fp;

    INSERT INTO public.security_findings AS f
      (fingerprint, source, severity, title, detail, deployment_ref)
    VALUES (
      left(_fp, 200),
      _source,
      CASE lower(coalesce(_item ->> 'severity', 'medium'))
        WHEN 'critical' THEN 'critical' WHEN 'high' THEN 'high'
        WHEN 'low' THEN 'low' WHEN 'info' THEN 'info' ELSE 'medium' END,
      left(trim(_item ->> 'title'), 200),
      left(coalesce(_item ->> 'detail', ''), 4000),
      left(coalesce(_deployment_ref, ''), 200)
    )
    ON CONFLICT (fingerprint) DO UPDATE
      SET last_seen_at    = now(),
          severity        = excluded.severity,
          detail          = excluded.detail,
          deployment_ref  = coalesce(nullif(excluded.deployment_ref, ''), f.deployment_ref),
          status          = CASE WHEN f.status = 'resolved' THEN 'open' ELSE f.status END,
          resolved_at     = CASE WHEN f.status = 'resolved' THEN NULL ELSE f.resolved_at END
    RETURNING (xmax = 0) INTO _inserted;

    IF _inserted THEN _new := _new + 1; END IF;
  END LOOP;

  UPDATE public.security_findings
     SET status = 'resolved', resolved_at = now()
   WHERE source = _source AND status <> 'resolved' AND NOT (fingerprint = ANY (_seen));
  GET DIAGNOSTICS _resolved = ROW_COUNT;

  RETURN jsonb_build_object('new', _new, 'reported', array_length(_seen, 1),
                            'resolved', _resolved);
END $$;

CREATE OR REPLACE FUNCTION public.security_selfcheck() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  _found jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT public.has_role((SELECT auth.uid()), 'admin') THEN
    RAISE EXCEPTION 'Only admins can run the security self-check';
  END IF;

  FOR r IN
    SELECT c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    _found := _found || jsonb_build_object(
      'id', 'rls_disabled:' || r.name, 'severity', 'critical',
      'title', 'Table "' || r.name || '" has no row protection',
      'detail', 'Row level security is switched off, so the data API exposes every row of this table.');
  END LOOP;

  FOR r IN
    SELECT c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
      AND (has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('authenticated', c.oid, 'SELECT'))
  LOOP
    _found := _found || jsonb_build_object(
      'id', 'rls_no_policy:' || r.name, 'severity', 'high',
      'title', 'Table "' || r.name || '" is reachable but has no access rules',
      'detail', 'Row protection is on with no policies, so every read of this table fails or leaks depending on grants.');
  END LOOP;

  FOR r IN
    SELECT p.proname AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'execute')
      AND p.proname NOT IN ('coupon_claim', 'member_welcome_claim', 'voucher_by_token',
                            'terminal_token_status', 'terminal_token_claim',
                            'terminal_token_heartbeat')
  LOOP
    _found := _found || jsonb_build_object(
      'id', 'anon_definer:' || r.name, 'severity', 'high',
      'title', 'Privileged routine "' || r.name || '" is callable by visitors',
      'detail', 'This routine runs with elevated rights and is no longer restricted to signed-in staff.');
  END LOOP;

  FOR r IN
    SELECT p.proname AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path%'
  LOOP
    _found := _found || jsonb_build_object(
      'id', 'unlocked_path:' || r.name, 'severity', 'medium',
      'title', 'Privileged routine "' || r.name || '" has no locked lookup path',
      'detail', 'Without a locked search path this routine can be hijacked by a look-alike object.');
  END LOOP;

  RETURN public.security_report_findings('selfcheck', 'nightly', _found);
END
$$;

CREATE OR REPLACE FUNCTION public.security_set_finding_status(_id uuid, _status text, _by text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin') THEN
    RAISE EXCEPTION 'Only admins can manage security alerts';
  END IF;
  IF _status NOT IN ('open', 'acknowledged', 'resolved') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  UPDATE public.security_findings
     SET status          = _status,
         acknowledged_by = CASE WHEN _status = 'open' THEN NULL
                                ELSE left(coalesce(_by, ''), 120) END,
         acknowledged_at = CASE WHEN _status = 'open' THEN NULL ELSE now() END,
         resolved_at     = CASE WHEN _status = 'resolved' THEN now() ELSE NULL END
   WHERE id = _id;
END $$;

CREATE OR REPLACE FUNCTION public.set_app_user_permissions(p_user_id text, p_permissions jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.has_perm('can_manage_staff') THEN
    RAISE EXCEPTION 'Staff management permission is required';
  END IF;
  UPDATE public.app_users a
     SET permissions = coalesce(a.permissions, '{}'::jsonb) || p_permissions,
         updated_at = now()
   WHERE lower(a.user_id) = lower(trim(p_user_id));
END $$;

CREATE OR REPLACE FUNCTION public.set_app_user_profile(p_user_id text, p_full_name text, p_role public.app_role, p_store_id text, p_is_active boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.has_perm('can_manage_staff') THEN
    RAISE EXCEPTION 'Staff management permission is required';
  END IF;
  UPDATE public.app_users a
     SET full_name  = coalesce(nullif(trim(p_full_name), ''), a.full_name),
         role       = coalesce(p_role, a.role),
         store_id   = nullif(trim(coalesce(p_store_id, '')), ''),
         is_active  = coalesce(p_is_active, a.is_active),
         updated_at = now()
   WHERE lower(a.user_id) = lower(trim(p_user_id));
END $$;

CREATE OR REPLACE FUNCTION public.set_cashier_permissions(p_id uuid, p_permissions jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.has_perm('can_manage_staff') THEN
    RAISE EXCEPTION 'Staff management permission is required';
  END IF;
  UPDATE public.cashiers
     SET permissions = coalesce(permissions, '{}'::jsonb) || coalesce(p_permissions, '{}'::jsonb)
   WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION public.set_terminal_active(p_user_id text, p_active boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.has_perm('can_manage_staff') THEN
    RAISE EXCEPTION 'Staff management permission is required';
  END IF;
  UPDATE public.app_users a SET is_active = p_active, updated_at = now()
   WHERE lower(a.user_id) = lower(trim(p_user_id));
END $$;

CREATE OR REPLACE FUNCTION public.shift_active_for_branch(p_store_id text) RETURNS public.shifts
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  _branch text := coalesce(nullif(btrim(coalesce(p_store_id, '')), ''), public.user_store_id());
  _row public.shifts;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can read shifts';
  END IF;
  SELECT * INTO _row FROM public.shifts
   WHERE store_id = _branch AND status = 'OPEN' AND closed_at IS NULL
   ORDER BY opened_at DESC LIMIT 1;
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.shift_open(p_id uuid, p_store_id text, p_opened_by_name text, p_opening_float numeric DEFAULT 0, p_terminal_id text DEFAULT NULL::text, p_terminal_name text DEFAULT NULL::text, p_opened_by_staff_id text DEFAULT NULL::text, p_opened_by_role text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid) RETURNS public.shifts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  _branch text := coalesce(nullif(btrim(coalesce(p_store_id, '')), ''), public.user_store_id());
  _row public.shifts;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can open a shift';
  END IF;
  IF coalesce(_branch, '') = '' THEN
    RAISE EXCEPTION 'SHIFT_BRANCH_REQUIRED';
  END IF;

  SELECT * INTO _row FROM public.shifts
   WHERE store_id = _branch AND status = 'OPEN' AND closed_at IS NULL
   ORDER BY opened_at DESC LIMIT 1;
  IF FOUND THEN RETURN _row; END IF;

  INSERT INTO public.shifts (
    id, store_id, terminal_id, terminal_name, opened_by_name,
    opened_by_staff_id, opened_by_role, opening_float, status, user_id
  ) VALUES (
    coalesce(p_id, gen_random_uuid()), _branch, p_terminal_id, p_terminal_name,
    coalesce(nullif(btrim(coalesce(p_opened_by_name, '')), ''), 'Cashier'),
    p_opened_by_staff_id, p_opened_by_role, coalesce(p_opening_float, 0), 'OPEN',
    coalesce(p_user_id, auth.uid())
  )
  RETURNING * INTO _row;

  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.shifts_sync_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.closed_at IS NOT NULL THEN
    NEW.status := 'CLOSED';
  ELSIF NEW.status = 'CLOSED' THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  ELSE
    NEW.status := 'OPEN';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.skip_stale_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  new_stamp text;
  old_stamp text;
BEGIN
  IF NEW.row_version IS NULL OR NEW.row_version = 0 OR OLD.row_version IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.row_version < OLD.row_version THEN
    RETURN NULL;
  END IF;

  IF NEW.row_version = OLD.row_version THEN
    new_stamp := to_jsonb(NEW) ->> 'updated_at';
    old_stamp := to_jsonb(OLD) ->> 'updated_at';
    IF new_stamp IS NOT NULL AND old_stamp IS NOT NULL AND new_stamp < old_stamp THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_account_adopt_legacy(p_username text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE c public.cashiers%rowtype;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_perm('can_manage_staff') THEN
    RAISE EXCEPTION 'Staff management permission is required';
  END IF;
  SELECT * INTO c FROM public.cashiers WHERE lower(username) = lower(trim(p_username));
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.app_users
    (user_id, full_name, email, role, role_slug, store_id, is_active, pin_hash, pin_length, permissions)
  VALUES
    (lower(c.username), coalesce(nullif(trim(c.full_name), ''), c.username),
     lower(c.username) || '@pos-internal.local', 'staff'::public.app_role,
     coalesce(c.role_slug, 'cashier'), c.store_id, c.is_active, c.pin_hash, 6,
     coalesce(c.permissions, '{}'::jsonb))
  ON CONFLICT (user_id) DO UPDATE SET
    pin_hash = CASE WHEN public.app_users.pin_hash = '' THEN EXCLUDED.pin_hash ELSE public.app_users.pin_hash END,
    role_slug = coalesce(public.app_users.role_slug, EXCLUDED.role_slug),
    updated_at = now();
END
$$;

CREATE OR REPLACE FUNCTION public.staff_account_delete_profile(p_user_id text, p_auth_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  _target public.app_users%rowtype;
  _admin_count integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_perm('can_manage_staff') THEN
    RAISE EXCEPTION 'Staff management permission is required';
  END IF;
  SELECT * INTO _target FROM public.app_users
  WHERE lower(user_id) = lower(trim(p_user_id)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_NOT_FOUND'; END IF;
  IF _target.is_active THEN RAISE EXCEPTION 'DEACTIVATE_ACCOUNT_FIRST'; END IF;
  IF _target.auth_user_id IS DISTINCT FROM p_auth_user_id THEN RAISE EXCEPTION 'STAFF_IDENTITY_MISMATCH'; END IF;
  IF _target.auth_user_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_DELETE_CURRENT_ACCOUNT'; END IF;
  IF _target.role = 'admin'::public.app_role THEN
    SELECT count(*) INTO _admin_count FROM public.app_users
    WHERE role = 'admin'::public.app_role AND is_active AND id <> _target.id;
    IF _admin_count = 0 THEN RAISE EXCEPTION 'CANNOT_DELETE_LAST_ADMIN'; END IF;
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _target.auth_user_id;
  DELETE FROM public.app_users WHERE id = _target.id;
  DELETE FROM public.cashiers WHERE lower(username) = lower(_target.user_id);
END
$$;

CREATE OR REPLACE FUNCTION public.staff_account_set_active(p_user_id text, p_active boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_perm('can_manage_staff') THEN
    RAISE EXCEPTION 'Staff management permission is required';
  END IF;
  UPDATE public.app_users
  SET is_active = coalesce(p_active, false), updated_at = now()
  WHERE lower(user_id) = lower(trim(p_user_id));
  UPDATE public.cashiers
  SET is_active = coalesce(p_active, false)
  WHERE lower(username) = lower(trim(p_user_id));
END
$$;

CREATE OR REPLACE FUNCTION public.staff_account_set_pin(p_user_id text, p_pin text, p_pin_length smallint DEFAULT 4) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_perm('can_manage_staff') THEN
    RAISE EXCEPTION 'Staff management permission is required';
  END IF;
  IF coalesce(p_pin, '') = '' OR length(p_pin) < 4 OR length(p_pin) > 32 THEN
    RAISE EXCEPTION 'STAFF_PIN_INVALID';
  END IF;
  UPDATE public.app_users
  SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
      pin_length = least(length(p_pin), 32)::smallint,
      updated_at = now()
  WHERE lower(user_id) = lower(trim(p_user_id));
END
$$;

CREATE OR REPLACE FUNCTION public.staff_account_upsert(p_user_id text, p_full_name text, p_email text, p_role public.app_role, p_role_slug text, p_store_id text, p_is_active boolean, p_pin text, p_pin_length smallint, p_auth_user_id uuid, p_permissions jsonb DEFAULT NULL::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  _user_id text := lower(trim(coalesce(p_user_id, '')));
  _name text := trim(coalesce(p_full_name, ''));
  _email text := lower(trim(coalesce(p_email, '')));
  _slug text := lower(trim(coalesce(p_role_slug, '')));
  _hash text := CASE WHEN coalesce(p_pin, '') = '' THEN ''
                     ELSE extensions.crypt(p_pin, extensions.gen_salt('bf', 10)) END;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_perm('can_manage_staff') THEN
    RAISE EXCEPTION 'Staff management permission is required';
  END IF;
  IF _user_id = '' THEN RAISE EXCEPTION 'STAFF_USERNAME_REQUIRED'; END IF;
  IF _name = '' THEN RAISE EXCEPTION 'STAFF_NAME_REQUIRED'; END IF;
  IF _email = '' THEN RAISE EXCEPTION 'STAFF_EMAIL_REQUIRED'; END IF;
  IF p_role IS NULL THEN RAISE EXCEPTION 'STAFF_BASE_ROLE_REQUIRED'; END IF;
  IF _slug = '' OR NOT EXISTS (SELECT 1 FROM public.staff_roles WHERE slug = _slug) THEN
    RAISE EXCEPTION 'STAFF_ROLE_REQUIRED';
  END IF;
  IF p_auth_user_id IS NULL THEN RAISE EXCEPTION 'STAFF_AUTH_ACCOUNT_REQUIRED'; END IF;
  IF coalesce(p_pin, '') <> '' AND (length(p_pin) < 4 OR length(p_pin) > 32) THEN
    RAISE EXCEPTION 'STAFF_PIN_INVALID';
  END IF;

  INSERT INTO public.app_users
    (id, user_id, full_name, email, role, role_slug, store_id, is_active,
     pin_hash, pin_length, auth_user_id, permissions)
  VALUES
    (coalesce(p_auth_user_id, gen_random_uuid()), _user_id, _name, _email, p_role, _slug,
     nullif(trim(coalesce(p_store_id, '')), ''), coalesce(p_is_active, true), _hash,
     CASE WHEN coalesce(p_pin, '') = '' THEN 0
          ELSE least(coalesce(nullif(p_pin_length, 0), length(p_pin)), 32) END,
     p_auth_user_id, coalesce(p_permissions, '{}'::jsonb))
  ON CONFLICT (user_id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    role_slug = EXCLUDED.role_slug,
    store_id = EXCLUDED.store_id,
    is_active = EXCLUDED.is_active,
    pin_hash = CASE WHEN EXCLUDED.pin_hash = '' THEN public.app_users.pin_hash ELSE EXCLUDED.pin_hash END,
    pin_length = CASE WHEN EXCLUDED.pin_hash = '' THEN public.app_users.pin_length ELSE EXCLUDED.pin_length END,
    auth_user_id = EXCLUDED.auth_user_id,
    permissions = CASE WHEN p_permissions IS NULL THEN public.app_users.permissions ELSE EXCLUDED.permissions END,
    updated_at = now();
END
$$;

CREATE OR REPLACE FUNCTION public.staff_role_delete(_slug text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE _s text := lower(trim(_slug));
BEGIN
  IF NOT public.has_perm('can_manage_staff') THEN
    RAISE EXCEPTION 'Staff management permission is required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_roles WHERE slug = _s AND is_core) THEN
    RAISE EXCEPTION 'Built-in roles cannot be removed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_users WHERE role_slug = _s) THEN
    RAISE EXCEPTION 'ROLE_IN_USE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cashiers WHERE role_slug = _s) THEN
    RAISE EXCEPTION 'ROLE_IN_USE';
  END IF;
  DELETE FROM public.staff_roles WHERE slug = _s AND NOT is_core;
END
$$;

CREATE OR REPLACE FUNCTION public.staff_role_save(_slug text, _name text, _base_level text, _permissions jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.has_perm('can_manage_staff') THEN
    RAISE EXCEPTION 'Staff management permission is required';
  END IF;
  IF coalesce(trim(_slug), '') = '' OR coalesce(trim(_name), '') = '' THEN
    RAISE EXCEPTION 'A role needs a name';
  END IF;
  IF coalesce(_base_level, '') NOT IN ('cashier','warehouse','supervisor','admin') THEN
    RAISE EXCEPTION 'INVALID_BASE_ROLE';
  END IF;
  INSERT INTO public.staff_roles (slug, name, base_level, permissions)
  VALUES (lower(trim(_slug)), trim(_name), _base_level, coalesce(_permissions, '{}'::jsonb))
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    base_level = CASE WHEN public.staff_roles.is_core THEN public.staff_roles.base_level ELSE EXCLUDED.base_level END,
    permissions = EXCLUDED.permissions,
    updated_at = now();
END
$$;

CREATE OR REPLACE FUNCTION public.stock_apply_delta(_movement_id uuid, _product_id uuid, _store_id text, _delta integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _stock jsonb;
  _current integer;
  _next integer;
BEGIN
  IF _movement_id IS NULL OR _product_id IS NULL THEN
    RAISE EXCEPTION 'movement id and product id are required';
  END IF;
  IF _store_id IS NULL OR NOT public.store_visible(_store_id) THEN
    RAISE EXCEPTION 'You can only adjust stock for your own branch';
  END IF;

  INSERT INTO public.stock_delta_applied (movement_id, product_id, store_id, delta)
  VALUES (_movement_id, _product_id, _store_id, COALESCE(_delta, 0))
  ON CONFLICT (movement_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT COALESCE((stock_by_store ->> _store_id)::int, 0) INTO _current
      FROM public.products WHERE id = _product_id;
    RETURN COALESCE(_current, 0);
  END IF;

  SELECT COALESCE(stock_by_store, '{}'::jsonb) INTO _stock
    FROM public.products WHERE id = _product_id FOR UPDATE;
  IF _stock IS NULL THEN
    RAISE EXCEPTION 'Unknown product';
  END IF;

  _current := COALESCE((_stock ->> _store_id)::int, 0);
  _next := _current + COALESCE(_delta, 0);
  _stock := jsonb_set(_stock, ARRAY[_store_id], to_jsonb(_next), true);

  UPDATE public.products
     SET stock_by_store = _stock,
         stock_quantity = (
           SELECT COALESCE(SUM(value::int), 0) FROM jsonb_each_text(_stock)
         ),
         updated_at = now()
   WHERE id = _product_id;

  RETURN _next;
END;
$$;

CREATE OR REPLACE FUNCTION public.stock_transfer_receive(p_transfer_id uuid, p_received_by text DEFAULT NULL::text, p_deduct_source boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  t public.stock_transfers;
  it record;
  v_target uuid;
  v_qty integer;
  v_src public.products;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can receive a transfer';
  END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF t.status = 'received' THEN RAISE EXCEPTION 'TRANSFER_ALREADY_RECEIVED'; END IF;
  IF t.status IN ('rejected', 'cancelled') THEN RAISE EXCEPTION 'TRANSFER_CLOSED'; END IF;

  FOR it IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = t.id LOOP
    v_qty := CASE WHEN it.quantity_received > 0 THEN it.quantity_received ELSE it.quantity END;
    CONTINUE WHEN v_qty <= 0;

    SELECT * INTO v_src FROM public.products WHERE id = it.product_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_target := it.product_id;

    IF t.transfer_scope = 'INTER_GROUP' AND coalesce(v_src.barcode, '') <> '' THEN
      SELECT p.id INTO v_target
        FROM public.products p
       WHERE p.barcode = v_src.barcode
         AND coalesce(p.stock_by_store ? t.to_store_id, false)
       LIMIT 1;
      IF v_target IS NULL THEN v_target := it.product_id; END IF;
    END IF;

    IF p_deduct_source THEN
      UPDATE public.products
         SET stock_by_store = jsonb_set(
               coalesce(stock_by_store, '{}'::jsonb), ARRAY[t.from_store_id],
               to_jsonb(greatest(
                 coalesce((stock_by_store ->> t.from_store_id)::int, 0) - v_qty, 0)), true),
             stock_quantity = greatest(stock_quantity - v_qty, 0)
       WHERE id = it.product_id;
    END IF;

    UPDATE public.products
       SET stock_by_store = jsonb_set(
             coalesce(stock_by_store, '{}'::jsonb), ARRAY[t.to_store_id],
             to_jsonb(coalesce((stock_by_store ->> t.to_store_id)::int, 0) + v_qty), true),
           stock_quantity = stock_quantity + v_qty
     WHERE id = v_target;

    UPDATE public.stock_transfer_items SET quantity_received = v_qty WHERE id = it.id;
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'received', received_at = now(),
         received_by = coalesce(p_received_by, received_by)
   WHERE id = t.id;
END $$;

CREATE OR REPLACE FUNCTION public.store_visible(_store_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT public.is_supervisor_now()
      OR coalesce(btrim(_store_id), '') = ''
      OR public.user_store_id() IS NULL
      OR btrim(_store_id) = public.user_store_id()
$$;

CREATE OR REPLACE FUNCTION public.stores_hierarchy_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  walker text;
  hops int := 0;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'A location cannot be its own parent';
    END IF;
    walker := NEW.parent_id;
    WHILE walker IS NOT NULL AND hops < 50 LOOP
      SELECT parent_id INTO walker FROM public.stores WHERE id = walker;
      IF walker = NEW.id THEN
        RAISE EXCEPTION 'Locations cannot be nested in a loop';
      END IF;
      hops := hops + 1;
    END LOOP;
  END IF;

  IF NEW.is_active = false AND (TG_OP = 'INSERT' OR OLD.is_active = true) THEN
    IF EXISTS (SELECT 1 FROM public.stores c WHERE c.parent_id = NEW.id AND c.is_active) THEN
      RAISE EXCEPTION 'Archive the sub-locations of this location first';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.products p
      WHERE COALESCE((p.stock_by_store ->> NEW.id)::numeric, 0) > 0
    ) THEN
      RAISE EXCEPTION 'This location still holds stock — transfer it out before archiving';
    END IF;
    NEW.archived_at := COALESCE(NEW.archived_at, now());
  END IF;

  IF NEW.is_active = true THEN
    NEW.archived_at := NULL;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sync_auth_user_to_public() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_code text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'user_id'), ''),
                          split_part(new.email, '@', 1));
  v_name text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), v_code);
  v_store text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'store_id', '')), '');
  v_existing public.app_users%rowtype;
BEGIN
  SELECT * INTO v_existing FROM public.app_users WHERE user_id = v_code;

  IF FOUND THEN
    IF (v_existing.auth_user_id IS NOT NULL AND v_existing.auth_user_id <> new.id)
       OR lower(coalesce(v_existing.email, '')) <> lower(new.email) THEN
      RETURN new;
    END IF;

    UPDATE public.app_users
       SET full_name    = v_name,
           store_id     = coalesce(v_store, store_id),
           auth_user_id = new.id,
           updated_at   = now()
     WHERE id = v_existing.id;
    RETURN new;
  END IF;

  INSERT INTO public.app_users (user_id, full_name, role, store_id, email, auth_user_id, is_active)
  VALUES (v_code, v_name, 'staff'::app_role, v_store, lower(new.email), new.id, false)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.system_audit_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'system_audit_logs entries cannot be changed or removed';
END;
$$;

CREATE OR REPLACE FUNCTION public.terminal_staff_list(p_store_id text DEFAULT NULL::text) RETURNS TABLE(user_id text, full_name text, role_slug text, store_id text, kind text, pin_length smallint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT a.user_id::text, a.full_name::text, coalesce(a.role_slug, 'cashier'),
         a.store_id::text, 'account'::text, coalesce(a.pin_length, 6)::smallint
  FROM public.app_users a
  WHERE a.is_active AND coalesce(a.pin_hash, '') <> ''
    AND (coalesce(trim(p_store_id), '') = '' OR coalesce(a.store_id, '') IN ('', trim(p_store_id)))
  ORDER BY a.full_name
$$;

-- Older shapes of the activation helpers must go before the current ones can
-- be defined: the return type of the status helper changed, and a leftover
-- two-argument heartbeat makes every short call ambiguous (PGRST203).
DROP FUNCTION IF EXISTS public.terminal_token_claim(uuid, text);
DROP FUNCTION IF EXISTS public.terminal_token_heartbeat(uuid, boolean);
DROP FUNCTION IF EXISTS public.terminal_token_heartbeat(uuid, boolean, text, boolean);
DROP FUNCTION IF EXISTS public.terminal_token_status(uuid);

CREATE OR REPLACE FUNCTION public.terminal_token_claim(p_token_id uuid, p_device text DEFAULT NULL::text, p_proof_hash text DEFAULT NULL::text, p_platform text DEFAULT NULL::text, p_os text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  t public.terminal_tokens%ROWTYPE;
  claimed boolean;
BEGIN
  SELECT * INTO t FROM public.terminal_tokens WHERE id = p_token_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF t.status = 'revoked' OR t.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'TERMINAL_TOKEN_REVOKED';
  END IF;

  IF btrim(coalesce(t.location_id, '')) = '' THEN
    RAISE EXCEPTION 'TERMINAL_BRANCH_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = t.location_id
      AND (s.deleted_at IS NOT NULL OR s.archived_at IS NOT NULL OR s.is_active IS FALSE)
  ) THEN
    RAISE EXCEPTION 'TERMINAL_BRANCH_INACTIVE';
  END IF;

  IF nullif(btrim(coalesce(p_proof_hash, '')), '') IS NULL THEN
    RAISE EXCEPTION 'TERMINAL_DEVICE_PROOF_REQUIRED';
  END IF;

  -- An interrupted client may have committed the claim before it persisted
  -- its sealed local config. Let that same device recover even after the
  -- redemption deadline; another device still receives only false.
  IF t.status <> 'active' OR t.claimed_at IS NOT NULL THEN
    IF coalesce(t.claim_proof, t.claimed_proof_hash) = p_proof_hash THEN
      UPDATE public.terminal_tokens
      SET last_seen_at = now()
      WHERE id = p_token_id;
      RETURN true;
    END IF;
    RETURN false;
  END IF;


  IF t.expires_at IS NOT NULL AND t.expires_at < now() THEN
    RAISE EXCEPTION 'TERMINAL_TOKEN_EXPIRED';
  END IF;

  IF (
    (t.platform = 'mobile' AND p_platform = 'android')
    OR (t.platform = 'pc' AND p_platform = 'electron')
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'TERMINAL_PLATFORM_MISMATCH';
  END IF;

  UPDATE public.terminal_tokens
  SET status = 'used',
      claimed_by_device = left(coalesce(p_device, claimed_by_device), 120),
      claim_proof = p_proof_hash,
      claimed_proof_hash = p_proof_hash,
      claimed_platform = coalesce(nullif(btrim(coalesce(p_platform, '')), ''), claimed_platform),
      claimed_os = coalesce(nullif(btrim(coalesce(p_os, '')), ''), claimed_os),
      is_claimed = true,
      claimed_at = now(),
      activated_at = coalesce(activated_at, now()),
      last_seen_at = now()
  WHERE id = p_token_id AND status = 'active' AND claimed_at IS NULL
  RETURNING true INTO claimed;

  RETURN coalesce(claimed, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.terminal_token_heartbeat(p_token_id uuid, p_activate boolean DEFAULT false, p_version text DEFAULT NULL::text, p_synced boolean DEFAULT false, p_proof_hash text DEFAULT NULL::text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  UPDATE public.terminal_tokens
  SET last_seen_at = now(),
      app_version = coalesce(nullif(btrim(p_version), ''), app_version),
      last_sync_at = CASE WHEN p_synced THEN now() ELSE last_sync_at END,
      activated_at = CASE WHEN p_activate THEN coalesce(activated_at, now()) ELSE activated_at END
  WHERE id = p_token_id
    AND status IN ('active', 'used')
    AND nullif(btrim(coalesce(p_proof_hash, '')), '') IS NOT NULL
    AND coalesce(claim_proof, claimed_proof_hash) = p_proof_hash
$$;

CREATE OR REPLACE FUNCTION public.terminal_token_status(p_token_id uuid) RETURNS TABLE(status text, location_name text, location_id text, is_claimed boolean, expires_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT t.status,
         coalesce(t.location_name, ''),
         coalesce(t.location_id, ''),
         (t.claimed_at IS NOT NULL OR t.status = 'used'),
         t.expires_at
  FROM public.terminal_tokens t
  WHERE t.id = p_token_id
$$;


CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_cashier(p_id uuid, p_username text, p_full_name text, p_pin text, p_store_id text, p_is_active boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $_$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_app_supervisor() THEN
    RAISE EXCEPTION 'Only supervisors and admins can manage cashiers';
  END IF;
  IF coalesce(trim(p_username), '') = '' THEN
    RAISE EXCEPTION 'Username is required';
  END IF;
  IF p_pin IS NOT NULL AND p_pin <> '' AND p_pin !~ '^\d{4,6}$' THEN
    RAISE EXCEPTION 'PIN must be 4 to 6 digits';
  END IF;

  IF p_id IS NULL THEN
    IF p_pin IS NULL OR p_pin = '' THEN
      RAISE EXCEPTION 'A PIN is required for a new cashier';
    END IF;
    INSERT INTO public.cashiers (username, full_name, pin_hash, store_id, is_active)
    VALUES (lower(trim(p_username)), coalesce(p_full_name, ''),
            extensions.crypt(p_pin::text, extensions.gen_salt('bf'::text, 10)),
            p_store_id, coalesce(p_is_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.cashiers SET
      username = lower(trim(p_username)),
      full_name = coalesce(p_full_name, full_name),
      store_id = p_store_id,
      is_active = coalesce(p_is_active, is_active),
      pin_hash = CASE WHEN p_pin IS NULL OR p_pin = '' THEN pin_hash
                      ELSE extensions.crypt(p_pin::text, extensions.gen_salt('bf'::text, 10)) END
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $_$;

CREATE OR REPLACE FUNCTION public.upsert_terminal_user(p_user_id text, p_full_name text, p_role public.app_role, p_store_id text, p_email text, p_pin text, p_password text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $_$
BEGIN
  IF NOT public.is_app_supervisor() THEN
    RAISE EXCEPTION 'Only supervisors can manage terminal users';
  END IF;
  IF p_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'PIN must be 4 to 6 digits';
  END IF;
  INSERT INTO public.app_users (user_id, full_name, role, store_id, email, pin_hash)
  VALUES (trim(p_user_id), trim(p_full_name), p_role,
          nullif(trim(coalesce(p_store_id,'')),''), lower(trim(p_email)),
          extensions.crypt(p_pin::text, extensions.gen_salt('bf'::text, 10)))
  ON CONFLICT (user_id) DO UPDATE
    SET full_name = excluded.full_name, role = excluded.role,
        store_id = excluded.store_id, email = excluded.email,
        pin_hash = excluded.pin_hash, updated_at = now();
END $_$;

CREATE OR REPLACE FUNCTION public.user_cluster_id() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT coalesce(nullif(s.group_id, ''), 'default')
    FROM public.stores s
   WHERE s.id = public.user_store_id()
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.user_has_store_access(_store_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN _store_id IS NULL THEN public.is_staff_now()
    WHEN public.is_app_supervisor() THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.auth_user_id = (SELECT auth.uid())
        AND u.is_active
        AND (u.store_id = _store_id
             OR nullif(btrim(coalesce(u.store_id, '')), '') IS NULL)
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.user_store_id() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT nullif(btrim(coalesce(a.store_id, '')), '')
    FROM public.app_users a
   WHERE a.is_active
     AND (a.auth_user_id = (SELECT auth.uid())
          OR lower(a.email) = lower(coalesce((SELECT auth.jwt()) ->> 'email', '')))
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.verify_cashier_pin(p_username text, p_pin text) RETURNS TABLE(id uuid, username text, full_name text, store_id text, permissions jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE v_row public.cashiers;
BEGIN
  SELECT * INTO v_row FROM public.cashiers c
   WHERE lower(c.username) = lower(trim(p_username)) AND c.is_active
   LIMIT 1;
  IF v_row.id IS NULL THEN RETURN; END IF;
  IF v_row.pin_hash <> extensions.crypt(p_pin::text, v_row.pin_hash::text) THEN RETURN; END IF;
  UPDATE public.cashiers SET last_login_at = now() WHERE public.cashiers.id = v_row.id;
  id := v_row.id; username := v_row.username; full_name := v_row.full_name;
  store_id := v_row.store_id; permissions := coalesce(v_row.permissions, '{}'::jsonb);
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.verify_terminal_pin(p_user_id text, p_pin text) RETURNS TABLE(user_id text, full_name text, role public.app_role, store_id text, email text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE u public.app_users%rowtype;
BEGIN
  SELECT * INTO u FROM public.app_users a
   WHERE lower(a.user_id) = lower(trim(p_user_id)) AND a.is_active;
  IF NOT FOUND THEN RETURN; END IF;
  IF u.pin_hash = '' OR u.pin_hash <> extensions.crypt(p_pin::text, u.pin_hash::text) THEN RETURN; END IF;
  UPDATE public.app_users SET last_login_at = now() WHERE id = u.id;
  RETURN QUERY SELECT u.user_id::text, u.full_name::text, u.role, u.store_id::text, u.email::text;
END $$;

CREATE OR REPLACE FUNCTION public.voucher_by_token(_token text) RETURNS TABLE(voucher jsonb, campaign jsonb, member_name text, member_code text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT to_jsonb(v) - 'issued_by' - 'redeemed_by' - 'disabled_by',
         to_jsonb(c),
         coalesce(m.full_name, ''),
         coalesce(m.member_code, '')
  FROM public.issued_vouchers v
  JOIN public.coupon_campaigns c ON c.id = v.campaign_id
  LEFT JOIN public.members m ON m.id = v.member_id
  WHERE v.token_slug = _token
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.voucher_redeem(_token text, _sale_id text DEFAULT NULL::text, _store_id text DEFAULT NULL::text, _staff text DEFAULT NULL::text) RETURNS public.issued_vouchers
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  _v public.issued_vouchers;
  _c public.coupon_campaigns;
  _deadline timestamptz;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can redeem a voucher';
  END IF;

  SELECT * INTO _v FROM public.issued_vouchers WHERE token_slug = _token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOUCHER_NOT_FOUND'; END IF;
  IF _v.status = 'REDEEMED' THEN RAISE EXCEPTION 'VOUCHER_ALREADY_REDEEMED'; END IF;

  SELECT * INTO _c FROM public.coupon_campaigns WHERE id = _v.campaign_id;

  IF _v.status = 'DISABLED' THEN
    PERFORM public.coupon_log('BLOCKED', _c, _token, _v.member_id, NULL, _store_id, NULL, _staff,
      NULL, _sale_id, 'Disabled voucher presented');
    RAISE EXCEPTION 'VOUCHER_DISABLED';
  END IF;

  _deadline := coalesce(_v.expires_at, _c.expires_at);
  IF _deadline IS NOT NULL AND now() > _deadline THEN
    UPDATE public.issued_vouchers SET status = 'EXPIRED' WHERE id = _v.id;
    PERFORM public.coupon_log('BLOCKED', _c, _token, _v.member_id, NULL, _store_id, NULL, _staff,
      NULL, _sale_id, 'Expired voucher presented');
    RAISE EXCEPTION 'VOUCHER_EXPIRED';
  END IF;

  UPDATE public.issued_vouchers
     SET status = 'REDEEMED', redeemed_at = now(), redeemed_by = _staff,
         redeemed_sale_id = _sale_id, store_id = _store_id
   WHERE id = _v.id
  RETURNING * INTO _v;

  PERFORM public.coupon_log('REDEEMED', _c, _token, _v.member_id, NULL, _store_id, NULL, _staff,
    NULL, _sale_id);
  RETURN _v;
END $$;

CREATE OR REPLACE FUNCTION public.voucher_set_status(_token text, _status text, _reason text DEFAULT NULL::text, _staff text DEFAULT NULL::text, _role text DEFAULT NULL::text, _store text DEFAULT NULL::text) RETURNS public.issued_vouchers
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  _v public.issued_vouchers;
  _c public.coupon_campaigns;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can change a voucher status';
  END IF;
  IF _status NOT IN ('ISSUED', 'DISABLED') THEN RAISE EXCEPTION 'VOUCHER_STATUS_INVALID'; END IF;

  SELECT * INTO _v FROM public.issued_vouchers WHERE token_slug = _token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOUCHER_NOT_FOUND'; END IF;
  IF _v.status = 'REDEEMED' THEN RAISE EXCEPTION 'VOUCHER_ALREADY_REDEEMED'; END IF;

  SELECT * INTO _c FROM public.coupon_campaigns WHERE id = _v.campaign_id;

  UPDATE public.issued_vouchers
     SET status = _status,
         disabled_at = CASE WHEN _status = 'DISABLED' THEN now() ELSE NULL END,
         disabled_by = CASE WHEN _status = 'DISABLED' THEN _staff ELSE NULL END,
         disable_reason = CASE WHEN _status = 'DISABLED' THEN _reason ELSE NULL END
   WHERE id = _v.id
  RETURNING * INTO _v;

  PERFORM public.coupon_log(
    CASE WHEN _status = 'DISABLED' THEN 'DISABLED' ELSE 'REENABLED' END,
    _c, _token, _v.member_id, NULL, _store, NULL, _staff, _role, NULL,
    coalesce(_reason, CASE WHEN _status = 'DISABLED' THEN 'Disabled from backoffice'
                           ELSE 'Re-enabled from backoffice' END));
  RETURN _v;
END $$;

CREATE OR REPLACE FUNCTION public.voucher_token() RETURNS text
    LANGUAGE sql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT 'vch_' || substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10)
$$;

DO $do$ BEGIN
ALTER TABLE ONLY public.activity_events
    ADD CONSTRAINT activity_events_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_user_id_key UNIQUE (user_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.booking_payments
    ADD CONSTRAINT booking_payments_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.branch_telemetry
    ADD CONSTRAINT branch_telemetry_pkey PRIMARY KEY (terminal_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.cashiers
    ADD CONSTRAINT cashiers_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.coupon_campaigns
    ADD CONSTRAINT coupon_campaigns_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.coupon_campaigns
    ADD CONSTRAINT coupon_campaigns_slug_key UNIQUE (slug);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.coupon_events
    ADD CONSTRAINT coupon_events_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.drawer_events
    ADD CONSTRAINT drawer_events_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.held_orders
    ADD CONSTRAINT held_orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.integration_settings
    ADD CONSTRAINT integration_settings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.issued_vouchers
    ADD CONSTRAINT issued_vouchers_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.issued_vouchers
    ADD CONSTRAINT issued_vouchers_token_slug_key UNIQUE (token_slug);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.item_activity_logs
    ADD CONSTRAINT item_activity_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.member_verifications
    ADD CONSTRAINT member_verifications_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_member_code_key UNIQUE (member_code);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_phone_key UNIQUE (phone);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.membership_tiers
    ADD CONSTRAINT membership_tiers_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.membership_tiers
    ADD CONSTRAINT membership_tiers_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.offline_sync_audit_log
    ADD CONSTRAINT offline_sync_audit_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.payment_types
    ADD CONSTRAINT payment_types_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.payment_types
    ADD CONSTRAINT payment_types_type_code_key UNIQUE (type_code);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.pin_attempts
    ADD CONSTRAINT pin_attempts_pkey PRIMARY KEY (key);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.pos_settings
    ADD CONSTRAINT pos_settings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.product_barcodes
    ADD CONSTRAINT product_barcodes_barcode_key UNIQUE (barcode);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.product_barcodes
    ADD CONSTRAINT product_barcodes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_barcode_key UNIQUE (barcode);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.public_flags
    ADD CONSTRAINT public_flags_pkey PRIMARY KEY (key);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_po_number_key UNIQUE (po_number);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_bill_number_key UNIQUE (bill_number);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.secure_settings
    ADD CONSTRAINT secure_settings_pkey PRIMARY KEY (key);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.security_findings
    ADD CONSTRAINT security_findings_fingerprint_key UNIQUE (fingerprint);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.security_findings
    ADD CONSTRAINT security_findings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.settings_locks
    ADD CONSTRAINT settings_locks_pkey PRIMARY KEY (section);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.settings_overrides
    ADD CONSTRAINT settings_overrides_pkey PRIMARY KEY (scope, scope_id, section);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.shift_sessions
    ADD CONSTRAINT shift_sessions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.sku_audit
    ADD CONSTRAINT sku_audit_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.staff_roles
    ADD CONSTRAINT staff_roles_pkey PRIMARY KEY (slug);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.stock_delta_applied
    ADD CONSTRAINT stock_delta_applied_pkey PRIMARY KEY (movement_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_ref_key UNIQUE (ref);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.sync_metadata
    ADD CONSTRAINT sync_metadata_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.sync_metadata
    ADD CONSTRAINT sync_metadata_store_id_terminal_id_table_name_key UNIQUE (store_id, terminal_id, table_name);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.system_audit_logs
    ADD CONSTRAINT system_audit_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.terminal_commands
    ADD CONSTRAINT terminal_commands_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.terminal_tokens
    ADD CONSTRAINT terminal_tokens_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.uom_units
    ADD CONSTRAINT uom_units_code_key UNIQUE (code);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.uom_units
    ADD CONSTRAINT uom_units_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.whatsapp_queue
    ADD CONSTRAINT whatsapp_queue_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_index ix
      JOIN pg_class idx ON idx.oid = ix.indexrelid
      JOIN pg_namespace ns ON ns.oid = idx.relnamespace
     WHERE ns.nspname = 'public'
       AND idx.relname = 'activity_events_client_event_id_key'
       AND ix.indpred IS NOT NULL
  ) THEN
    DROP INDEX public.activity_events_client_event_id_key;
  END IF;
END $do$;
CREATE UNIQUE INDEX IF NOT EXISTS activity_events_client_event_id_key ON public.activity_events USING btree (client_event_id);

CREATE INDEX IF NOT EXISTS activity_events_created_idx ON public.activity_events USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS activity_events_store_idx ON public.activity_events USING btree (store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_events_type_idx ON public.activity_events USING btree (event_type, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_auth_user_id_key ON public.app_users USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS app_users_email_lower_idx ON public.app_users USING btree (lower((email)::text));

CREATE INDEX IF NOT EXISTS app_users_store_idx ON public.app_users USING btree (store_id);

CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON public.audit_logs USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_module_created_idx ON public.audit_logs USING btree (target_module, created_at DESC);

CREATE INDEX IF NOT EXISTS booking_payments_booking_idx ON public.booking_payments USING btree (booking_id);

CREATE INDEX IF NOT EXISTS bookings_member_idx ON public.bookings USING btree (member_id);

CREATE INDEX IF NOT EXISTS bookings_phone_idx ON public.bookings USING btree (customer_phone);

CREATE INDEX IF NOT EXISTS bookings_ref_idx ON public.bookings USING btree (ref);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_ref_key ON public.bookings USING btree (ref);

CREATE INDEX IF NOT EXISTS bookings_status_idx ON public.bookings USING btree (job_status, created_at DESC);

CREATE INDEX IF NOT EXISTS bookings_store_idx ON public.bookings USING btree (store_id);

CREATE INDEX IF NOT EXISTS bookings_store_status_created_idx ON public.bookings USING btree (store_id, job_status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS cashiers_username_key ON public.cashiers USING btree (lower(username));

CREATE INDEX IF NOT EXISTS coupon_campaigns_active_slug_idx ON public.coupon_campaigns USING btree (slug) WHERE is_active;

CREATE INDEX IF NOT EXISTS coupon_events_campaign_idx ON public.coupon_events USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS coupon_events_created_idx ON public.coupon_events USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS coupon_events_type_created_idx ON public.coupon_events USING btree (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS drawer_events_store_created_idx ON public.drawer_events USING btree (store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS held_orders_store_idx ON public.held_orders USING btree (store_id);

CREATE INDEX IF NOT EXISTS idx_app_users_is_active ON public.app_users USING btree (is_active);

CREATE INDEX IF NOT EXISTS idx_app_users_role_slug ON public.app_users USING btree (role_slug);


CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON public.purchase_order_items USING btree (po_id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_store_entry ON public.purchase_orders USING btree (store_id, invoice_entry_date DESC);



CREATE INDEX IF NOT EXISTS idx_sales_member_id ON public.sales USING btree (member_id);

CREATE INDEX IF NOT EXISTS idx_stores_location_type ON public.stores USING btree (location_type);


CREATE UNIQUE INDEX IF NOT EXISTS integration_settings_provider_idx ON public.integration_settings USING btree (provider_name);

CREATE INDEX IF NOT EXISTS issued_vouchers_active_member_idx ON public.issued_vouchers USING btree (member_id) WHERE (status = 'ISSUED'::text);

CREATE INDEX IF NOT EXISTS issued_vouchers_campaign_idx ON public.issued_vouchers USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS issued_vouchers_campaign_member_idx ON public.issued_vouchers USING btree (campaign_id, member_id);

CREATE INDEX IF NOT EXISTS issued_vouchers_member_idx ON public.issued_vouchers USING btree (member_id);

CREATE INDEX IF NOT EXISTS item_activity_logs_created_idx ON public.item_activity_logs USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS item_activity_logs_product_idx ON public.item_activity_logs USING btree (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS item_activity_logs_store_idx ON public.item_activity_logs USING btree (store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS member_verifications_created_idx ON public.member_verifications USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS member_verifications_member_idx ON public.member_verifications USING btree (member_id);

CREATE INDEX IF NOT EXISTS members_code_idx ON public.members USING btree (member_code);

CREATE INDEX IF NOT EXISTS members_phone_idx ON public.members USING btree (phone);

CREATE INDEX IF NOT EXISTS offline_sync_audit_created_idx ON public.offline_sync_audit_log USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS offline_sync_audit_terminal_idx ON public.offline_sync_audit_log USING btree (terminal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_transactions_booking_idx ON public.payment_transactions USING btree (booking_id);

CREATE INDEX IF NOT EXISTS payment_transactions_created_idx ON public.payment_transactions USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS payment_transactions_paid_at_idx ON public.payment_transactions USING btree (paid_at DESC);

CREATE INDEX IF NOT EXISTS payment_transactions_sale_idx ON public.payment_transactions USING btree (sale_id);

CREATE INDEX IF NOT EXISTS payment_transactions_store_idx ON public.payment_transactions USING btree (store_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_client_txn_idx ON public.payment_transactions USING btree (client_transaction_id) WHERE (client_transaction_id IS NOT NULL);


CREATE INDEX IF NOT EXISTS product_barcodes_product_idx ON public.product_barcodes USING btree (product_id);

CREATE INDEX IF NOT EXISTS products_barcode_idx ON public.products USING btree (barcode);

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_normalized_uidx
  ON public.products (lower(btrim(barcode)))
  WHERE nullif(btrim(barcode), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON public.products USING gin (name extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_barcode_trgm_idx
  ON public.products USING gin (barcode extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_sku_trgm_idx
  ON public.products USING gin (sku extensions.gin_trgm_ops)
  WHERE sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_category_idx ON public.products USING btree (category);

CREATE INDEX IF NOT EXISTS products_is_archived_idx ON public.products USING btree (is_archived);

CREATE INDEX IF NOT EXISTS products_name_idx ON public.products USING btree (lower(name));

CREATE INDEX IF NOT EXISTS products_sku_idx ON public.products USING btree (sku);

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique_idx ON public.products USING btree (lower(sku)) WHERE ((sku IS NOT NULL) AND (sku <> ''::text));

CREATE INDEX IF NOT EXISTS purchase_order_items_product_idx ON public.purchase_order_items USING btree (product_id);

CREATE INDEX IF NOT EXISTS purchase_orders_entry_idx ON public.purchase_orders USING btree (invoice_entry_date DESC);

CREATE INDEX IF NOT EXISTS purchase_orders_store_idx ON public.purchase_orders USING btree (store_id);

CREATE INDEX IF NOT EXISTS purchase_orders_store_status_entry_idx
  ON public.purchase_orders (store_id, status, invoice_entry_date DESC);

CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx ON public.purchase_orders USING btree (supplier_id);

CREATE INDEX IF NOT EXISTS sale_items_created_idx ON public.sale_items USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS sale_items_product_idx ON public.sale_items USING btree (product_id);

CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON public.sale_items USING btree (sale_id);

CREATE INDEX IF NOT EXISTS sales_bill_number_idx ON public.sales USING btree (bill_number);

CREATE INDEX IF NOT EXISTS sales_cashier_id_idx ON public.sales USING btree (cashier_id);


CREATE UNIQUE INDEX IF NOT EXISTS sales_client_transaction_id_uidx ON public.sales USING btree (client_transaction_id) WHERE (client_transaction_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS sales_created_idx ON public.sales USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS sales_shift_created_idx ON public.sales USING btree (shift_id, created_at);

CREATE INDEX IF NOT EXISTS sales_shift_idx ON public.sales USING btree (shift_id);

CREATE UNIQUE INDEX IF NOT EXISTS sales_store_bill_number_key ON public.sales USING btree (COALESCE(store_id, ''::text), bill_number);

CREATE INDEX IF NOT EXISTS sales_store_created_idx ON public.sales USING btree (store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_store_idx ON public.sales USING btree (store_id);

CREATE INDEX IF NOT EXISTS security_findings_open_idx ON public.security_findings USING btree (severity, last_seen_at DESC) WHERE (status <> 'resolved'::text);

CREATE INDEX IF NOT EXISTS security_findings_seen_idx ON public.security_findings USING btree (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS security_findings_source_idx ON public.security_findings USING btree (source, status);

CREATE INDEX IF NOT EXISTS shift_sessions_shift_idx ON public.shift_sessions USING btree (shift_id);

CREATE INDEX IF NOT EXISTS shift_sessions_staff_idx ON public.shift_sessions USING btree (staff_id);

CREATE INDEX IF NOT EXISTS shift_sessions_store_idx ON public.shift_sessions USING btree (store_id, signed_in_at DESC);

CREATE INDEX IF NOT EXISTS shifts_open_by_store ON public.shifts USING btree (store_id) WHERE (closed_at IS NULL);

CREATE INDEX IF NOT EXISTS shifts_open_by_store_idx ON public.shifts USING btree (store_id, opened_at DESC) WHERE (status = 'OPEN'::text);


CREATE INDEX IF NOT EXISTS sku_audit_created_idx ON public.sku_audit USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS sku_audit_product_idx ON public.sku_audit USING btree (product_id);

CREATE INDEX IF NOT EXISTS stock_adjustments_created_idx ON public.stock_adjustments USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS stock_adjustments_product_idx ON public.stock_adjustments USING btree (product_id);

CREATE INDEX IF NOT EXISTS stock_adjustments_store_idx ON public.stock_adjustments USING btree (store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS stock_transfer_items_transfer_idx ON public.stock_transfer_items USING btree (transfer_id);

CREATE INDEX IF NOT EXISTS stock_transfers_from_idx ON public.stock_transfers USING btree (from_store_id);

CREATE INDEX IF NOT EXISTS stock_transfers_status_idx ON public.stock_transfers USING btree (status);

CREATE INDEX IF NOT EXISTS stock_transfers_to_idx ON public.stock_transfers USING btree (to_store_id);

CREATE INDEX IF NOT EXISTS stock_transfers_to_status_idx ON public.stock_transfers USING btree (to_store_id, status);

CREATE INDEX IF NOT EXISTS stores_group_idx ON public.stores USING btree (group_id);

CREATE INDEX IF NOT EXISTS stores_is_active_idx ON public.stores USING btree (is_active);

CREATE INDEX IF NOT EXISTS stores_parent_id_idx ON public.stores USING btree (parent_id);

CREATE INDEX IF NOT EXISTS system_audit_logs_action_idx ON public.system_audit_logs USING btree (action_type);

CREATE INDEX IF NOT EXISTS system_audit_logs_actor_idx ON public.system_audit_logs USING btree (actor_id);

CREATE INDEX IF NOT EXISTS system_audit_logs_created_idx ON public.system_audit_logs USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS terminal_commands_pending_idx ON public.terminal_commands USING btree (terminal_id, status, created_at);

CREATE INDEX IF NOT EXISTS terminal_tokens_active_idx ON public.terminal_tokens USING btree (location_id) WHERE (status = 'active'::text);

CREATE INDEX IF NOT EXISTS terminal_tokens_location_idx ON public.terminal_tokens USING btree (location_id);

CREATE INDEX IF NOT EXISTS user_roles_user_idx ON public.user_roles USING btree (user_id);

CREATE INDEX IF NOT EXISTS whatsapp_queue_pending_idx ON public.whatsapp_queue USING btree (queued_at) WHERE (status = 'QUEUED'::text);

DROP TRIGGER IF EXISTS activity_events_no_update ON public.activity_events;

CREATE TRIGGER activity_events_no_update BEFORE DELETE OR UPDATE ON public.activity_events FOR EACH ROW EXECUTE FUNCTION public.activity_events_immutable();

DROP TRIGGER IF EXISTS app_users_aa_stale_guard ON public.app_users;

CREATE TRIGGER app_users_aa_stale_guard BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS app_users_bump_row_version ON public.app_users;

CREATE TRIGGER app_users_bump_row_version BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS app_users_require_store ON public.app_users;

CREATE TRIGGER app_users_require_store BEFORE INSERT OR UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.app_users_require_store();

DROP TRIGGER IF EXISTS app_users_touch_updated_at ON public.app_users;

CREATE TRIGGER app_users_touch_updated_at BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS booking_payment_within_total_trg ON public.booking_payments;

CREATE TRIGGER booking_payment_within_total_trg BEFORE INSERT OR UPDATE ON public.booking_payments FOR EACH ROW EXECUTE FUNCTION public.booking_payment_within_total();

DROP TRIGGER IF EXISTS booking_payments_aa_stale_guard ON public.booking_payments;

CREATE TRIGGER booking_payments_aa_stale_guard BEFORE UPDATE ON public.booking_payments FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS booking_payments_bump_row_version ON public.booking_payments;

CREATE TRIGGER booking_payments_bump_row_version BEFORE UPDATE ON public.booking_payments FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS bookings_aa_stale_guard ON public.bookings;

CREATE TRIGGER bookings_aa_stale_guard BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS bookings_bump_row_version ON public.bookings;

CREATE TRIGGER bookings_bump_row_version BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS bookings_enforce_permissions ON public.bookings;

CREATE TRIGGER bookings_enforce_permissions BEFORE INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_permissions();

DROP TRIGGER IF EXISTS bookings_set_updated_at ON public.bookings;

CREATE TRIGGER bookings_set_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS branch_telemetry_touch ON public.branch_telemetry;

CREATE TRIGGER branch_telemetry_touch BEFORE UPDATE ON public.branch_telemetry FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS cashiers_touch_updated_at ON public.cashiers;

CREATE TRIGGER cashiers_touch_updated_at BEFORE UPDATE ON public.cashiers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS coupon_campaigns_aa_stale_guard ON public.coupon_campaigns;

CREATE TRIGGER coupon_campaigns_aa_stale_guard BEFORE UPDATE ON public.coupon_campaigns FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS coupon_campaigns_bump_row_version ON public.coupon_campaigns;

CREATE TRIGGER coupon_campaigns_bump_row_version BEFORE UPDATE ON public.coupon_campaigns FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS coupon_campaigns_set_updated_at ON public.coupon_campaigns;

CREATE TRIGGER coupon_campaigns_set_updated_at BEFORE UPDATE ON public.coupon_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS coupon_events_no_change ON public.coupon_events;

CREATE TRIGGER coupon_events_no_change BEFORE DELETE OR UPDATE ON public.coupon_events FOR EACH ROW EXECUTE FUNCTION public.coupon_events_readonly();

DROP TRIGGER IF EXISTS held_orders_aa_stale_guard ON public.held_orders;

CREATE TRIGGER held_orders_aa_stale_guard BEFORE UPDATE ON public.held_orders FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS held_orders_bump_row_version ON public.held_orders;

CREATE TRIGGER held_orders_bump_row_version BEFORE UPDATE ON public.held_orders FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS held_orders_touch_updated_at ON public.held_orders;

CREATE TRIGGER held_orders_touch_updated_at BEFORE UPDATE ON public.held_orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS issued_vouchers_aa_stale_guard ON public.issued_vouchers;

CREATE TRIGGER issued_vouchers_aa_stale_guard BEFORE UPDATE ON public.issued_vouchers FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS issued_vouchers_bump_row_version ON public.issued_vouchers;

CREATE TRIGGER issued_vouchers_bump_row_version BEFORE UPDATE ON public.issued_vouchers FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS item_activity_logs_aa_stale_guard ON public.item_activity_logs;

CREATE TRIGGER item_activity_logs_aa_stale_guard BEFORE UPDATE ON public.item_activity_logs FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS item_activity_logs_bump_row_version ON public.item_activity_logs;

CREATE TRIGGER item_activity_logs_bump_row_version BEFORE UPDATE ON public.item_activity_logs FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS members_aa_stale_guard ON public.members;

CREATE TRIGGER members_aa_stale_guard BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS members_bump_row_version ON public.members;

CREATE TRIGGER members_bump_row_version BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS members_enforce_permissions ON public.members;

CREATE TRIGGER members_enforce_permissions BEFORE INSERT OR UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.enforce_member_points_permissions();

DROP TRIGGER IF EXISTS membership_tiers_aa_stale_guard ON public.membership_tiers;

CREATE TRIGGER membership_tiers_aa_stale_guard BEFORE UPDATE ON public.membership_tiers FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS membership_tiers_bump_row_version ON public.membership_tiers;

CREATE TRIGGER membership_tiers_bump_row_version BEFORE UPDATE ON public.membership_tiers FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS payment_transactions_aa_stale_guard ON public.payment_transactions;

CREATE TRIGGER payment_transactions_aa_stale_guard BEFORE UPDATE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS payment_transactions_bump_row_version ON public.payment_transactions;

CREATE TRIGGER payment_transactions_bump_row_version BEFORE UPDATE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS payment_transactions_touch ON public.payment_transactions;

CREATE TRIGGER payment_transactions_touch BEFORE UPDATE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS payment_types_touch ON public.payment_types;

CREATE TRIGGER payment_types_touch BEFORE UPDATE ON public.payment_types FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS payment_types_version ON public.payment_types;

CREATE TRIGGER payment_types_version BEFORE UPDATE ON public.payment_types FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS pos_settings_aa_stale_guard ON public.pos_settings;

CREATE TRIGGER pos_settings_aa_stale_guard BEFORE UPDATE ON public.pos_settings FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS pos_settings_bump_row_version ON public.pos_settings;

CREATE TRIGGER pos_settings_bump_row_version BEFORE UPDATE ON public.pos_settings FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS product_barcodes_aa_stale_guard ON public.product_barcodes;

CREATE TRIGGER product_barcodes_aa_stale_guard BEFORE UPDATE ON public.product_barcodes FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS product_barcodes_bump_row_version ON public.product_barcodes;

CREATE TRIGGER product_barcodes_bump_row_version BEFORE UPDATE ON public.product_barcodes FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS product_barcodes_touch ON public.product_barcodes;

CREATE TRIGGER product_barcodes_touch BEFORE UPDATE ON public.product_barcodes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS product_categories_aa_stale_guard ON public.product_categories;

CREATE TRIGGER product_categories_aa_stale_guard BEFORE UPDATE ON public.product_categories FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS product_categories_bump_row_version ON public.product_categories;

CREATE TRIGGER product_categories_bump_row_version BEFORE UPDATE ON public.product_categories FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS product_categories_set_updated_at ON public.product_categories;

CREATE TRIGGER product_categories_set_updated_at BEFORE UPDATE ON public.product_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS products_aa_stale_guard ON public.products;

CREATE TRIGGER products_aa_stale_guard BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS products_enforce_permissions ON public.products;

CREATE TRIGGER products_enforce_permissions BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.enforce_product_price_permissions();

DROP TRIGGER IF EXISTS products_row_version ON public.products;

CREATE TRIGGER products_row_version BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.products_bump_row_version();

DROP TRIGGER IF EXISTS products_set_updated_at ON public.products;

CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS promotions_aa_stale_guard ON public.promotions;

CREATE TRIGGER promotions_aa_stale_guard BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS promotions_bump_row_version ON public.promotions;

CREATE TRIGGER promotions_bump_row_version BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS public_flags_touch ON public.public_flags;

CREATE TRIGGER public_flags_touch BEFORE UPDATE ON public.public_flags FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS purchase_order_items_aa_stale_guard ON public.purchase_order_items;

CREATE TRIGGER purchase_order_items_aa_stale_guard BEFORE UPDATE ON public.purchase_order_items FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS purchase_order_items_bump_row_version ON public.purchase_order_items;

CREATE TRIGGER purchase_order_items_bump_row_version BEFORE UPDATE ON public.purchase_order_items FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS purchase_order_items_touch_updated_at ON public.purchase_order_items;

CREATE TRIGGER purchase_order_items_touch_updated_at BEFORE UPDATE ON public.purchase_order_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS purchase_orders_aa_stale_guard ON public.purchase_orders;

CREATE TRIGGER purchase_orders_aa_stale_guard BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS purchase_orders_bump_row_version ON public.purchase_orders;

CREATE TRIGGER purchase_orders_bump_row_version BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS purchase_orders_touch_updated_at ON public.purchase_orders;

CREATE TRIGGER purchase_orders_touch_updated_at BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS sale_items_aa_stale_guard ON public.sale_items;

CREATE TRIGGER sale_items_aa_stale_guard BEFORE UPDATE ON public.sale_items FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS sale_items_bump_row_version ON public.sale_items;

CREATE TRIGGER sale_items_bump_row_version BEFORE UPDATE ON public.sale_items FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS sale_items_enforce_permissions ON public.sale_items;

CREATE TRIGGER sale_items_enforce_permissions BEFORE INSERT OR UPDATE ON public.sale_items FOR EACH ROW EXECUTE FUNCTION public.enforce_sale_item_permissions();

DROP TRIGGER IF EXISTS sales_aa_stale_guard ON public.sales;

CREATE TRIGGER sales_aa_stale_guard BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS sales_bump_row_version ON public.sales;

CREATE TRIGGER sales_bump_row_version BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS sales_enforce_permissions ON public.sales;

CREATE TRIGGER sales_enforce_permissions BEFORE INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.enforce_sale_permissions();

DROP TRIGGER IF EXISTS security_findings_touch ON public.security_findings;

CREATE TRIGGER security_findings_touch BEFORE UPDATE ON public.security_findings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS set_members_updated_at ON public.members;

CREATE TRIGGER set_members_updated_at BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_membership_tiers_updated_at ON public.membership_tiers;

CREATE TRIGGER set_membership_tiers_updated_at BEFORE UPDATE ON public.membership_tiers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_promotions_updated_at ON public.promotions;

CREATE TRIGGER set_promotions_updated_at BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS settings_locks_touch ON public.settings_locks;

CREATE TRIGGER settings_locks_touch BEFORE UPDATE ON public.settings_locks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS settings_overrides_touch ON public.settings_overrides;

CREATE TRIGGER settings_overrides_touch BEFORE UPDATE ON public.settings_overrides FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS shift_sessions_aa_stale_guard ON public.shift_sessions;

CREATE TRIGGER shift_sessions_aa_stale_guard BEFORE UPDATE ON public.shift_sessions FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS shift_sessions_bump_row_version ON public.shift_sessions;

CREATE TRIGGER shift_sessions_bump_row_version BEFORE UPDATE ON public.shift_sessions FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS shift_sessions_set_updated_at ON public.shift_sessions;

CREATE TRIGGER shift_sessions_set_updated_at BEFORE UPDATE ON public.shift_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS shifts_aa_stale_guard ON public.shifts;

CREATE TRIGGER shifts_aa_stale_guard BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS shifts_bump_row_version ON public.shifts;

CREATE TRIGGER shifts_bump_row_version BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS shifts_set_updated_at ON public.shifts;

CREATE TRIGGER shifts_set_updated_at BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS shifts_sync_status_trg ON public.shifts;

CREATE TRIGGER shifts_sync_status_trg BEFORE INSERT OR UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.shifts_sync_status();

DROP TRIGGER IF EXISTS staff_roles_touch_updated_at ON public.staff_roles;

CREATE TRIGGER staff_roles_touch_updated_at BEFORE UPDATE ON public.staff_roles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS stock_adjustments_aa_stale_guard ON public.stock_adjustments;

CREATE TRIGGER stock_adjustments_aa_stale_guard BEFORE UPDATE ON public.stock_adjustments FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS stock_adjustments_bump_row_version ON public.stock_adjustments;

CREATE TRIGGER stock_adjustments_bump_row_version BEFORE UPDATE ON public.stock_adjustments FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS stock_transfer_items_aa_stale_guard ON public.stock_transfer_items;

CREATE TRIGGER stock_transfer_items_aa_stale_guard BEFORE UPDATE ON public.stock_transfer_items FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS stock_transfer_items_bump_row_version ON public.stock_transfer_items;

CREATE TRIGGER stock_transfer_items_bump_row_version BEFORE UPDATE ON public.stock_transfer_items FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS stock_transfers_aa_stale_guard ON public.stock_transfers;

CREATE TRIGGER stock_transfers_aa_stale_guard BEFORE UPDATE ON public.stock_transfers FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS stock_transfers_bump_row_version ON public.stock_transfers;

CREATE TRIGGER stock_transfers_bump_row_version BEFORE UPDATE ON public.stock_transfers FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS stock_transfers_touch ON public.stock_transfers;

CREATE TRIGGER stock_transfers_touch BEFORE UPDATE ON public.stock_transfers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS stores_aa_stale_guard ON public.stores;

CREATE TRIGGER stores_aa_stale_guard BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS stores_bump_row_version ON public.stores;

CREATE TRIGGER stores_bump_row_version BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS stores_hierarchy_guard_trg ON public.stores;

CREATE TRIGGER stores_hierarchy_guard_trg BEFORE INSERT OR UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.stores_hierarchy_guard();

DROP TRIGGER IF EXISTS suppliers_aa_stale_guard ON public.suppliers;

CREATE TRIGGER suppliers_aa_stale_guard BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS suppliers_bump_row_version ON public.suppliers;

CREATE TRIGGER suppliers_bump_row_version BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS suppliers_set_updated_at ON public.suppliers;

CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS sync_metadata_touch ON public.sync_metadata;

CREATE TRIGGER sync_metadata_touch BEFORE UPDATE ON public.sync_metadata FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS system_audit_logs_immutable ON public.system_audit_logs;

CREATE TRIGGER system_audit_logs_immutable BEFORE DELETE OR UPDATE ON public.system_audit_logs FOR EACH ROW EXECUTE FUNCTION public.system_audit_immutable();

DROP TRIGGER IF EXISTS terminal_commands_touch ON public.terminal_commands;

CREATE TRIGGER terminal_commands_touch BEFORE UPDATE ON public.terminal_commands FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS terminal_tokens_aa_stale_guard ON public.terminal_tokens;

CREATE TRIGGER terminal_tokens_aa_stale_guard BEFORE UPDATE ON public.terminal_tokens FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS terminal_tokens_bump_row_version ON public.terminal_tokens;

CREATE TRIGGER terminal_tokens_bump_row_version BEFORE UPDATE ON public.terminal_tokens FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS uom_units_aa_stale_guard ON public.uom_units;

CREATE TRIGGER uom_units_aa_stale_guard BEFORE UPDATE ON public.uom_units FOR EACH ROW EXECUTE FUNCTION public.skip_stale_update();

DROP TRIGGER IF EXISTS uom_units_bump_row_version ON public.uom_units;

CREATE TRIGGER uom_units_bump_row_version BEFORE UPDATE ON public.uom_units FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS uom_units_set_updated_at ON public.uom_units;

CREATE TRIGGER uom_units_set_updated_at BEFORE UPDATE ON public.uom_units FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_secure_settings_updated_at ON public.secure_settings;

CREATE TRIGGER update_secure_settings_updated_at BEFORE UPDATE ON public.secure_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_stores_updated_at ON public.stores;

CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS whatsapp_queue_touch_updated_at ON public.whatsapp_queue;

CREATE TRIGGER whatsapp_queue_touch_updated_at BEFORE UPDATE ON public.whatsapp_queue FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $do$ BEGIN
ALTER TABLE ONLY public.booking_payments
    ADD CONSTRAINT booking_payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.coupon_events
    ADD CONSTRAINT coupon_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.coupon_campaigns(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.coupon_events
    ADD CONSTRAINT coupon_events_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.member_verifications
    ADD CONSTRAINT fk_member_verifications_member FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.issued_vouchers
    ADD CONSTRAINT issued_vouchers_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.coupon_campaigns(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.issued_vouchers
    ADD CONSTRAINT issued_vouchers_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.item_activity_logs
    ADD CONSTRAINT item_activity_logs_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES public.membership_tiers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.product_barcodes
    ADD CONSTRAINT product_barcodes_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.product_categories(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_foc_product_id_fkey FOREIGN KEY (foc_product_id) REFERENCES public.products(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.stock_transfers(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.stores(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DO $do$ BEGIN
ALTER TABLE ONLY public.terminal_tokens
    ADD CONSTRAINT terminal_tokens_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stores(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
          WHEN duplicate_column THEN NULL; WHEN invalid_table_definition THEN NULL;
          WHEN unique_violation THEN NULL; END $do$;

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;

CREATE POLICY "Admins manage roles" ON public.user_roles TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Anyone can read public flags" ON public.public_flags;

CREATE POLICY "Anyone can read public flags" ON public.public_flags FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "Branch staff append drawer events" ON public.drawer_events;

CREATE POLICY "Branch staff append drawer events" ON public.drawer_events FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff append stock adjustments" ON public.stock_adjustments;

CREATE POLICY "Branch staff append stock adjustments" ON public.stock_adjustments FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff delete booking payments" ON public.booking_payments;

CREATE POLICY "Branch staff delete booking payments" ON public.booking_payments FOR DELETE TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE ((b.id = booking_payments.booking_id) AND public.store_visible(b.store_id))))));

DROP POLICY IF EXISTS "Branch staff delete bookings" ON public.bookings;

CREATE POLICY "Branch staff delete bookings" ON public.bookings FOR DELETE TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff insert booking payments" ON public.booking_payments;

CREATE POLICY "Branch staff insert booking payments" ON public.booking_payments FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE ((b.id = booking_payments.booking_id) AND public.user_has_store_access(b.store_id))))));

DROP POLICY IF EXISTS "Branch staff insert bookings" ON public.bookings;

CREATE POLICY "Branch staff insert bookings" ON public.bookings FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff insert sale items" ON public.sale_items;

CREATE POLICY "Branch staff insert sale items" ON public.sale_items FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.sales s
  WHERE ((s.id = sale_items.sale_id) AND public.user_has_store_access(s.store_id))))));

DROP POLICY IF EXISTS "Branch staff insert sales" ON public.sales;

CREATE POLICY "Branch staff insert sales" ON public.sales FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff insert shift sessions" ON public.shift_sessions;

CREATE POLICY "Branch staff insert shift sessions" ON public.shift_sessions FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff manage held orders" ON public.held_orders;

CREATE POLICY "Branch staff manage held orders" ON public.held_orders TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id))) WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff manage whatsapp queue" ON public.whatsapp_queue;

CREATE POLICY "Branch staff manage whatsapp queue" ON public.whatsapp_queue TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id))) WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff open shifts" ON public.shifts;

CREATE POLICY "Branch staff open shifts" ON public.shifts FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff read booking payments" ON public.booking_payments;

CREATE POLICY "Branch staff read booking payments" ON public.booking_payments FOR SELECT TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE ((b.id = booking_payments.booking_id) AND public.store_visible(b.store_id))))));

DROP POLICY IF EXISTS "Branch staff read bookings" ON public.bookings;

CREATE POLICY "Branch staff read bookings" ON public.bookings FOR SELECT TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff read drawer events" ON public.drawer_events;

CREATE POLICY "Branch staff read drawer events" ON public.drawer_events FOR SELECT TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff read sale items" ON public.sale_items;

CREATE POLICY "Branch staff read sale items" ON public.sale_items FOR SELECT TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.sales s
  WHERE ((s.id = sale_items.sale_id) AND public.store_visible(s.store_id))))));

DROP POLICY IF EXISTS "Branch staff read sales" ON public.sales;

CREATE POLICY "Branch staff read sales" ON public.sales FOR SELECT TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff read shift sessions" ON public.shift_sessions;

CREATE POLICY "Branch staff read shift sessions" ON public.shift_sessions FOR SELECT TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff read shifts" ON public.shifts;

CREATE POLICY "Branch staff read shifts" ON public.shifts FOR SELECT TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff read stock adjustments" ON public.stock_adjustments;

CREATE POLICY "Branch staff read stock adjustments" ON public.stock_adjustments FOR SELECT TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff update booking payments" ON public.booking_payments;

CREATE POLICY "Branch staff update booking payments" ON public.booking_payments FOR UPDATE TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE ((b.id = booking_payments.booking_id) AND public.store_visible(b.store_id)))))) WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE ((b.id = booking_payments.booking_id) AND public.store_visible(b.store_id))))));

DROP POLICY IF EXISTS "Branch staff update bookings" ON public.bookings;

CREATE POLICY "Branch staff update bookings" ON public.bookings FOR UPDATE TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id))) WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff update sale items" ON public.sale_items;

CREATE POLICY "Branch staff update sale items" ON public.sale_items FOR UPDATE TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.sales s
  WHERE ((s.id = sale_items.sale_id) AND public.store_visible(s.store_id)))))) WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.sales s
  WHERE ((s.id = sale_items.sale_id) AND public.store_visible(s.store_id))))));

DROP POLICY IF EXISTS "Branch staff update sales" ON public.sales;

CREATE POLICY "Branch staff update sales" ON public.sales FOR UPDATE TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id))) WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff update shift sessions" ON public.shift_sessions;

CREATE POLICY "Branch staff update shift sessions" ON public.shift_sessions FOR UPDATE TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id))) WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff update shifts" ON public.shifts;

CREATE POLICY "Branch staff update shifts" ON public.shifts FOR UPDATE TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id))) WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND public.store_visible(store_id)));

DROP POLICY IF EXISTS "Branch staff write transfer items" ON public.stock_transfer_items;

CREATE POLICY "Branch staff write transfer items" ON public.stock_transfer_items TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.stock_transfers t
  WHERE ((t.id = stock_transfer_items.transfer_id) AND (public.user_has_store_access(t.from_store_id) OR public.user_has_store_access(t.to_store_id))))))) WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.stock_transfers t
  WHERE ((t.id = stock_transfer_items.transfer_id) AND (public.user_has_store_access(t.from_store_id) OR public.user_has_store_access(t.to_store_id)))))));

DROP POLICY IF EXISTS "Service role manages secure settings" ON public.secure_settings;

CREATE POLICY "Service role manages secure settings" ON public.secure_settings TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Staff can add public flags" ON public.public_flags;

CREATE POLICY "Staff can add public flags" ON public.public_flags FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can add sku audit" ON public.sku_audit;

CREATE POLICY "Staff can add sku audit" ON public.sku_audit FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can append audit logs" ON public.audit_logs;

CREATE POLICY "Staff can append audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can change public flags" ON public.public_flags;

CREATE POLICY "Staff can change public flags" ON public.public_flags FOR UPDATE TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now)) WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can delete" ON public.members;

CREATE POLICY "Staff can delete" ON public.members FOR DELETE TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can delete" ON public.membership_tiers;

CREATE POLICY "Staff can delete" ON public.membership_tiers FOR DELETE TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can delete" ON public.pos_settings;

CREATE POLICY "Staff can delete" ON public.pos_settings FOR DELETE TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can delete" ON public.products;

CREATE POLICY "Staff can delete" ON public.products FOR DELETE TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can delete" ON public.promotions;

CREATE POLICY "Staff can delete" ON public.promotions FOR DELETE TO authenticated USING (public.has_perm('can_manage_promotions'));

DROP POLICY IF EXISTS "Staff can delete" ON public.purchase_order_items;

CREATE POLICY "Staff can delete" ON public.purchase_order_items FOR DELETE TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.purchase_orders po
  WHERE ((po.id = purchase_order_items.po_id) AND ((po.store_id IS NULL) OR public.is_app_supervisor() OR public.store_visible(po.store_id)))))));

DROP POLICY IF EXISTS "Staff can delete" ON public.purchase_orders;

CREATE POLICY "Staff can delete" ON public.purchase_orders FOR DELETE TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND ((store_id IS NULL) OR public.is_app_supervisor() OR public.store_visible(store_id))));

DROP POLICY IF EXISTS "Staff can delete stores" ON public.stores;

CREATE POLICY "Staff can delete stores" ON public.stores FOR DELETE TO authenticated USING (public.has_perm('can_manage_locations'));

DROP POLICY IF EXISTS "Staff can delete tokens" ON public.terminal_tokens;
DROP POLICY IF EXISTS "Terminals can stamp their heartbeat" ON public.terminal_tokens;

CREATE POLICY "Staff can delete tokens" ON public.terminal_tokens FOR DELETE TO authenticated USING (( SELECT public.is_app_supervisor() AS is_app_supervisor));

DROP POLICY IF EXISTS "Staff can insert" ON public.members;

CREATE POLICY "Staff can insert" ON public.members FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can insert" ON public.membership_tiers;

CREATE POLICY "Staff can insert" ON public.membership_tiers FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can insert" ON public.pos_settings;

CREATE POLICY "Staff can insert" ON public.pos_settings FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can insert" ON public.products;

CREATE POLICY "Staff can insert" ON public.products FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can insert" ON public.promotions;

CREATE POLICY "Staff can insert" ON public.promotions FOR INSERT TO authenticated WITH CHECK (public.has_perm('can_manage_promotions'));

DROP POLICY IF EXISTS "Staff can insert" ON public.purchase_order_items;

CREATE POLICY "Staff can insert" ON public.purchase_order_items FOR INSERT TO authenticated WITH CHECK ((public.is_staff(auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.purchase_orders po
  WHERE ((po.id = purchase_order_items.po_id) AND ((po.store_id IS NULL) OR public.is_app_supervisor() OR public.store_visible(po.store_id)))))));

DROP POLICY IF EXISTS "Staff can insert" ON public.purchase_orders;

CREATE POLICY "Staff can insert" ON public.purchase_orders FOR INSERT TO authenticated WITH CHECK ((public.is_staff(auth.uid()) AND ((store_id IS NULL) OR public.is_app_supervisor() OR public.store_visible(store_id))));

DROP POLICY IF EXISTS "Staff can insert stores" ON public.stores;

CREATE POLICY "Staff can insert stores" ON public.stores FOR INSERT TO authenticated WITH CHECK (public.has_perm('can_manage_locations'));

DROP POLICY IF EXISTS "Staff can issue tokens" ON public.terminal_tokens;

CREATE POLICY "Staff can issue tokens" ON public.terminal_tokens FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_app_supervisor() AS is_app_supervisor));

DROP POLICY IF EXISTS "Staff can manage product categories" ON public.product_categories;

CREATE POLICY "Staff can manage product categories" ON public.product_categories TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now)) WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can manage suppliers" ON public.suppliers;

CREATE POLICY "Staff can manage suppliers" ON public.suppliers TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now)) WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can manage tokens" ON public.terminal_tokens;

CREATE POLICY "Staff can manage tokens" ON public.terminal_tokens FOR UPDATE TO authenticated USING (( SELECT public.is_app_supervisor() AS is_app_supervisor)) WITH CHECK (( SELECT public.is_app_supervisor() AS is_app_supervisor));

DROP POLICY IF EXISTS "Staff can manage units" ON public.uom_units;

CREATE POLICY "Staff can manage units" ON public.uom_units TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now)) WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can read audit logs" ON public.audit_logs;

CREATE POLICY "Staff can read audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can read members" ON public.members;

CREATE POLICY "Staff can read members" ON public.members FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can read membership tiers" ON public.membership_tiers;

CREATE POLICY "Staff can read membership tiers" ON public.membership_tiers FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can read pos settings" ON public.pos_settings;

CREATE POLICY "Staff can read pos settings" ON public.pos_settings FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can read product categories" ON public.product_categories;

CREATE POLICY "Staff can read product categories" ON public.product_categories FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can read products" ON public.products;

CREATE POLICY "Staff can read products" ON public.products FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can read promotions" ON public.promotions;

CREATE POLICY "Staff can read promotions" ON public.promotions FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can read purchase order items" ON public.purchase_order_items;

CREATE POLICY "Staff can read purchase order items" ON public.purchase_order_items FOR SELECT TO authenticated USING ((public.is_staff(auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.purchase_orders po
  WHERE ((po.id = purchase_order_items.po_id) AND ((po.store_id IS NULL) OR public.is_app_supervisor() OR public.store_visible(po.store_id)))))));

DROP POLICY IF EXISTS "Staff can read purchase orders" ON public.purchase_orders;

CREATE POLICY "Staff can read purchase orders" ON public.purchase_orders FOR SELECT TO authenticated USING ((public.is_staff(auth.uid()) AND ((store_id IS NULL) OR public.is_app_supervisor() OR public.store_visible(store_id))));

DROP POLICY IF EXISTS "Staff can read sku audit" ON public.sku_audit;

CREATE POLICY "Staff can read sku audit" ON public.sku_audit FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can read stores" ON public.stores;

CREATE POLICY "Staff can read stores" ON public.stores FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can read suppliers" ON public.suppliers;

CREATE POLICY "Staff can read suppliers" ON public.suppliers FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can read tokens" ON public.terminal_tokens;

CREATE POLICY "Staff can read tokens" ON public.terminal_tokens FOR SELECT TO authenticated USING (( SELECT public.is_app_supervisor() AS is_app_supervisor));

DROP POLICY IF EXISTS "Staff can read units" ON public.uom_units;

CREATE POLICY "Staff can read units" ON public.uom_units FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can update" ON public.members;

CREATE POLICY "Staff can update" ON public.members FOR UPDATE TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now)) WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can update" ON public.membership_tiers;

CREATE POLICY "Staff can update" ON public.membership_tiers FOR UPDATE TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now)) WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can update" ON public.pos_settings;

CREATE POLICY "Staff can update" ON public.pos_settings FOR UPDATE TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now)) WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can update" ON public.products;

CREATE POLICY "Staff can update" ON public.products FOR UPDATE TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now)) WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff can update" ON public.promotions;

CREATE POLICY "Staff can update" ON public.promotions FOR UPDATE TO authenticated USING (public.has_perm('can_manage_promotions')) WITH CHECK (public.has_perm('can_manage_promotions'));

DROP POLICY IF EXISTS "Staff can update" ON public.purchase_order_items;

CREATE POLICY "Staff can update" ON public.purchase_order_items FOR UPDATE TO authenticated USING ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.purchase_orders po
  WHERE ((po.id = purchase_order_items.po_id) AND ((po.store_id IS NULL) OR public.is_app_supervisor() OR public.store_visible(po.store_id))))))) WITH CHECK ((( SELECT public.is_staff_now() AS is_staff_now) AND (EXISTS ( SELECT 1
   FROM public.purchase_orders po
  WHERE ((po.id = purchase_order_items.po_id) AND ((po.store_id IS NULL) OR public.is_app_supervisor() OR public.store_visible(po.store_id)))))));

DROP POLICY IF EXISTS "Staff can update" ON public.purchase_orders;

CREATE POLICY "Staff can update" ON public.purchase_orders FOR UPDATE TO authenticated USING ((public.is_staff(auth.uid()) AND ((store_id IS NULL) OR public.is_app_supervisor() OR public.store_visible(store_id)))) WITH CHECK ((public.is_staff(auth.uid()) AND ((store_id IS NULL) OR public.is_app_supervisor() OR public.store_visible(store_id))));

DROP POLICY IF EXISTS "Staff can update stores" ON public.stores;

CREATE POLICY "Staff can update stores" ON public.stores FOR UPDATE TO authenticated USING (public.has_perm('can_manage_locations')) WITH CHECK (public.has_perm('can_manage_locations'));

DROP POLICY IF EXISTS "Staff complete commands" ON public.terminal_commands;

CREATE POLICY "Staff complete commands" ON public.terminal_commands FOR UPDATE TO authenticated USING (public.is_staff_now()) WITH CHECK (public.is_staff_now());

DROP POLICY IF EXISTS "Staff raise transfers" ON public.stock_transfers;

CREATE POLICY "Staff raise transfers" ON public.stock_transfers FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff read commands" ON public.terminal_commands;

CREATE POLICY "Staff read commands" ON public.terminal_commands FOR SELECT TO authenticated USING (public.is_staff_now());

DROP POLICY IF EXISTS "Staff read roles" ON public.staff_roles;

CREATE POLICY "Staff read roles" ON public.staff_roles FOR SELECT TO authenticated USING (public.is_staff(( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Staff read telemetry" ON public.branch_telemetry;

CREATE POLICY "Staff read telemetry" ON public.branch_telemetry FOR SELECT TO authenticated USING (public.is_staff_now());

DROP POLICY IF EXISTS "Staff read transfer items" ON public.stock_transfer_items;

CREATE POLICY "Staff read transfer items" ON public.stock_transfer_items FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff read transfers" ON public.stock_transfers;

CREATE POLICY "Staff read transfers" ON public.stock_transfers FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff refresh telemetry" ON public.branch_telemetry;

CREATE POLICY "Staff refresh telemetry" ON public.branch_telemetry FOR UPDATE TO authenticated USING (public.is_staff_now()) WITH CHECK (public.is_staff_now());

DROP POLICY IF EXISTS "Staff report telemetry" ON public.branch_telemetry;

CREATE POLICY "Staff report telemetry" ON public.branch_telemetry FOR INSERT TO authenticated WITH CHECK (public.is_staff_now());

DROP POLICY IF EXISTS "Staff update transfers" ON public.stock_transfers;

CREATE POLICY "Staff update transfers" ON public.stock_transfers FOR UPDATE TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now)) WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Staff write transfer items" ON public.stock_transfer_items;

CREATE POLICY "Staff write transfer items" ON public.stock_transfer_items TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now)) WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "Supervisors delete sale items" ON public.sale_items;

CREATE POLICY "Supervisors delete sale items" ON public.sale_items FOR DELETE TO authenticated USING (( SELECT public.is_supervisor_now() AS is_supervisor_now));

DROP POLICY IF EXISTS "Supervisors delete sales" ON public.sales;

CREATE POLICY "Supervisors delete sales" ON public.sales FOR DELETE TO authenticated USING (( SELECT public.is_supervisor_now() AS is_supervisor_now));

DROP POLICY IF EXISTS "Supervisors delete transfers" ON public.stock_transfers;

CREATE POLICY "Supervisors delete transfers" ON public.stock_transfers FOR DELETE TO authenticated USING (( SELECT public.is_supervisor_now() AS is_supervisor_now));

DROP POLICY IF EXISTS "Supervisors issue commands" ON public.terminal_commands;

CREATE POLICY "Supervisors issue commands" ON public.terminal_commands FOR INSERT TO authenticated WITH CHECK (public.is_supervisor_now());

DROP POLICY IF EXISTS "Supervisors read activity events" ON public.activity_events;

CREATE POLICY "Supervisors read activity events" ON public.activity_events FOR SELECT TO authenticated USING (public.has_perm('can_view_audit_trail'));

DROP POLICY IF EXISTS "Supervisors read the audit trail" ON public.system_audit_logs;

CREATE POLICY "Supervisors read the audit trail" ON public.system_audit_logs FOR SELECT TO authenticated USING (public.has_perm('can_view_audit_trail'));

DROP POLICY IF EXISTS "Users can read their own roles" ON public.user_roles;

CREATE POLICY "Users can read their own roles" ON public.user_roles FOR SELECT TO authenticated USING ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can read their own staff record" ON public.app_users;

CREATE POLICY "Users can read their own staff record" ON public.app_users FOR SELECT TO authenticated USING ((auth_user_id = (SELECT auth.uid())));

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read security findings" ON public.security_findings;

CREATE POLICY "admins read security findings" ON public.security_findings FOR SELECT TO authenticated USING (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins update security findings" ON public.security_findings;

CREATE POLICY "admins update security findings" ON public.security_findings FOR UPDATE TO authenticated USING (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)) WITH CHECK (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_staff_insert ON public.audit_logs;

CREATE POLICY audit_logs_staff_insert ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS audit_logs_staff_read ON public.audit_logs;

CREATE POLICY audit_logs_staff_read ON public.audit_logs FOR SELECT TO authenticated USING (true);

ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.branch_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branch_telemetry_staff_read ON public.branch_telemetry;

CREATE POLICY branch_telemetry_staff_read ON public.branch_telemetry FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS branch_telemetry_staff_update ON public.branch_telemetry;

CREATE POLICY branch_telemetry_staff_update ON public.branch_telemetry FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS branch_telemetry_staff_write ON public.branch_telemetry;

CREATE POLICY branch_telemetry_staff_write ON public.branch_telemetry FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "campaigns managed by staff" ON public.coupon_campaigns;

CREATE POLICY "campaigns managed by staff" ON public.coupon_campaigns TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now)) WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "campaigns readable by staff" ON public.coupon_campaigns;

CREATE POLICY "campaigns readable by staff" ON public.coupon_campaigns FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

ALTER TABLE public.cashiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coupon events readable by staff" ON public.coupon_events;

CREATE POLICY "coupon events readable by staff" ON public.coupon_events FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

ALTER TABLE public.coupon_campaigns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.coupon_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.drawer_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.held_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_settings_supervisor ON public.integration_settings;

CREATE POLICY integration_settings_supervisor ON public.integration_settings TO authenticated USING (public.is_app_supervisor()) WITH CHECK (public.is_app_supervisor());

ALTER TABLE public.issued_vouchers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.item_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_activity_logs_insert ON public.item_activity_logs;

CREATE POLICY item_activity_logs_insert ON public.item_activity_logs FOR INSERT TO authenticated WITH CHECK (((store_id IS NULL) OR public.store_visible(store_id)));

DROP POLICY IF EXISTS item_activity_logs_read ON public.item_activity_logs;

CREATE POLICY item_activity_logs_read ON public.item_activity_logs FOR SELECT TO authenticated USING (((store_id IS NULL) OR public.store_visible(store_id)));

DROP POLICY IF EXISTS "live campaigns readable by public" ON public.coupon_campaigns;

CREATE POLICY "live campaigns readable by public" ON public.coupon_campaigns FOR SELECT TO anon USING (public.campaign_is_live(coupon_campaigns.*));

ALTER TABLE public.member_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_verifications_staff_read ON public.member_verifications;

CREATE POLICY member_verifications_staff_read ON public.member_verifications FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS member_verifications_staff_update ON public.member_verifications;

CREATE POLICY member_verifications_staff_update ON public.member_verifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS member_verifications_staff_write ON public.member_verifications;

CREATE POLICY member_verifications_staff_write ON public.member_verifications FOR INSERT TO authenticated WITH CHECK (true);

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.membership_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offline_sync_audit_insert ON public.offline_sync_audit_log;

CREATE POLICY offline_sync_audit_insert ON public.offline_sync_audit_log FOR INSERT TO authenticated WITH CHECK (((store_id IS NULL) OR public.store_visible(store_id)));

ALTER TABLE public.offline_sync_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offline_sync_audit_read ON public.offline_sync_audit_log;

CREATE POLICY offline_sync_audit_read ON public.offline_sync_audit_log FOR SELECT TO authenticated USING (((store_id IS NULL) OR public.store_visible(store_id)));

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_transactions_read ON public.payment_transactions;

CREATE POLICY payment_transactions_read ON public.payment_transactions FOR SELECT TO authenticated USING (((store_id IS NULL) OR public.store_visible(store_id)));

DROP POLICY IF EXISTS payment_transactions_update ON public.payment_transactions;

CREATE POLICY payment_transactions_update ON public.payment_transactions FOR UPDATE TO authenticated USING (((store_id IS NULL) OR public.store_visible(store_id))) WITH CHECK (((store_id IS NULL) OR public.store_visible(store_id)));

DROP POLICY IF EXISTS payment_transactions_write ON public.payment_transactions;

CREATE POLICY payment_transactions_write ON public.payment_transactions FOR INSERT TO authenticated WITH CHECK (((store_id IS NULL) OR public.store_visible(store_id)));

ALTER TABLE public.payment_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_types_read ON public.payment_types;

CREATE POLICY payment_types_read ON public.payment_types FOR SELECT USING (true);

DROP POLICY IF EXISTS payment_types_staff_read ON public.payment_types;

CREATE POLICY payment_types_staff_read ON public.payment_types FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS payment_types_staff_write ON public.payment_types;

CREATE POLICY payment_types_staff_write ON public.payment_types TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS payment_types_write ON public.payment_types;

CREATE POLICY payment_types_write ON public.payment_types TO authenticated USING (public.is_supervisor_now()) WITH CHECK (public.is_supervisor_now());

ALTER TABLE public.pin_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pos_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.product_barcodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_barcodes_read ON public.product_barcodes;

CREATE POLICY product_barcodes_read ON public.product_barcodes FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS product_barcodes_write ON public.product_barcodes;

CREATE POLICY product_barcodes_write ON public.product_barcodes TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.public_flags ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.secure_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.security_findings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.settings_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settings_locks_read ON public.settings_locks;

CREATE POLICY settings_locks_read ON public.settings_locks FOR SELECT USING (true);

DROP POLICY IF EXISTS settings_locks_write ON public.settings_locks;

CREATE POLICY settings_locks_write ON public.settings_locks TO authenticated USING (public.is_supervisor_now()) WITH CHECK (public.is_supervisor_now());

ALTER TABLE public.settings_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settings_overrides_private ON public.settings_overrides;

DROP POLICY IF EXISTS settings_overrides_read ON public.settings_overrides;

CREATE POLICY settings_overrides_read ON public.settings_overrides FOR SELECT USING (true);

DROP POLICY IF EXISTS settings_overrides_write ON public.settings_overrides;

CREATE POLICY settings_overrides_write ON public.settings_overrides TO authenticated
USING (public.has_perm('can_access_pos_settings') AND scope = ANY (ARRAY['CLUSTER'::text, 'BRANCH'::text, 'TERMINAL'::text]))
WITH CHECK (public.has_perm('can_access_pos_settings') AND scope = ANY (ARRAY['CLUSTER'::text, 'BRANCH'::text, 'TERMINAL'::text]));

ALTER TABLE public.shift_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sku_audit ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_delta_applied ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_delta_applied_select_own_branch ON public.stock_delta_applied;

CREATE POLICY stock_delta_applied_select_own_branch ON public.stock_delta_applied FOR SELECT TO authenticated USING (((store_id IS NULL) OR public.store_visible(store_id)));

ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sync_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_metadata_insert_own_branch ON public.sync_metadata;

CREATE POLICY sync_metadata_insert_own_branch ON public.sync_metadata FOR INSERT TO authenticated WITH CHECK (((store_id IS NULL) OR public.store_visible(store_id)));

DROP POLICY IF EXISTS sync_metadata_select_own_branch ON public.sync_metadata;

CREATE POLICY sync_metadata_select_own_branch ON public.sync_metadata FOR SELECT TO authenticated USING (((store_id IS NULL) OR public.store_visible(store_id)));

DROP POLICY IF EXISTS sync_metadata_update_own_branch ON public.sync_metadata;

CREATE POLICY sync_metadata_update_own_branch ON public.sync_metadata FOR UPDATE TO authenticated USING (((store_id IS NULL) OR public.store_visible(store_id))) WITH CHECK (((store_id IS NULL) OR public.store_visible(store_id)));

ALTER TABLE public.system_audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.terminal_commands ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.terminal_tokens ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.uom_units ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vouchers managed by staff" ON public.issued_vouchers;

CREATE POLICY "vouchers managed by staff" ON public.issued_vouchers TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now)) WITH CHECK (( SELECT public.is_staff_now() AS is_staff_now));

DROP POLICY IF EXISTS "vouchers readable by staff" ON public.issued_vouchers;

CREATE POLICY "vouchers readable by staff" ON public.issued_vouchers FOR SELECT TO authenticated USING (( SELECT public.is_staff_now() AS is_staff_now));

ALTER TABLE public.whatsapp_queue ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO postgres;

GRANT USAGE ON SCHEMA public TO anon;

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT USAGE ON SCHEMA public TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT USAGE ON SCHEMA public TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON FUNCTION public.activity_events_immutable() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_activity_event_cleared(uuid, boolean) TO authenticated;

GRANT ALL ON FUNCTION public.app_users_require_store() TO service_role;

GRANT ALL ON FUNCTION public.booking_payment_within_total() TO service_role;

GRANT ALL ON FUNCTION public.bump_row_version() TO service_role;

GRANT ALL ON TABLE public.coupon_campaigns TO anon;

GRANT ALL ON TABLE public.coupon_campaigns TO authenticated;

GRANT ALL ON TABLE public.coupon_campaigns TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.coupon_campaigns TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON FUNCTION public.campaign_is_live(_c public.coupon_campaigns) TO service_role;

GRANT ALL ON FUNCTION public.campaign_is_live(_c public.coupon_campaigns) TO anon;

GRANT ALL ON FUNCTION public.campaign_is_live(_c public.coupon_campaigns) TO authenticated;

GRANT ALL ON FUNCTION public.coupon_claim(_slug text, _phone text, _full_name text, _email text) TO service_role;

GRANT ALL ON FUNCTION public.coupon_claim(_slug text, _phone text, _full_name text, _email text) TO anon;

GRANT ALL ON FUNCTION public.coupon_claim(_slug text, _phone text, _full_name text, _email text) TO authenticated;

GRANT ALL ON FUNCTION public.coupon_events_readonly() TO service_role;

GRANT ALL ON FUNCTION public.coupon_issue_manual(_slug text, _phone text, _full_name text, _expires_at timestamp with time zone, _staff text, _role text, _store text, _ignore_limit boolean) TO service_role;

GRANT ALL ON FUNCTION public.coupon_issue_manual(_slug text, _phone text, _full_name text, _expires_at timestamp with time zone, _staff text, _role text, _store text, _ignore_limit boolean) TO authenticated;

GRANT ALL ON FUNCTION public.coupon_log(_type text, _campaign public.coupon_campaigns, _token text, _member uuid, _phone text, _store text, _terminal text, _staff text, _role text, _sale text, _note text) TO service_role;

GRANT ALL ON FUNCTION public.current_app_user() TO service_role;

GRANT ALL ON FUNCTION public.current_app_user() TO authenticated;

GRANT ALL ON FUNCTION public.delete_cashier(p_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.delete_cashier(p_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.delete_terminal_user(p_user_id text) TO service_role;

GRANT ALL ON FUNCTION public.delete_terminal_user(p_user_id text) TO authenticated;

GRANT ALL ON FUNCTION public.enforce_booking_permissions() TO service_role;

GRANT ALL ON FUNCTION public.enforce_member_points_permissions() TO service_role;

GRANT ALL ON FUNCTION public.enforce_product_price_permissions() TO service_role;

GRANT ALL ON FUNCTION public.enforce_sale_item_permissions() TO service_role;

GRANT ALL ON FUNCTION public.enforce_sale_permissions() TO service_role;

GRANT ALL ON FUNCTION public.has_perm(_flag text) TO service_role;

GRANT ALL ON FUNCTION public.has_perm(_flag text) TO authenticated;

GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO service_role;

GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO authenticated;

GRANT ALL ON FUNCTION public.is_app_supervisor() TO service_role;

GRANT ALL ON FUNCTION public.is_app_supervisor() TO authenticated;

GRANT ALL ON FUNCTION public.is_staff(_user_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.is_staff(_user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.is_staff_now() TO service_role;

GRANT ALL ON FUNCTION public.is_staff_now() TO authenticated;

GRANT ALL ON FUNCTION public.is_terminal_active() TO service_role;

GRANT ALL ON FUNCTION public.is_terminal_active() TO authenticated;

GRANT ALL ON FUNCTION public.is_supervisor_now() TO service_role;

GRANT ALL ON FUNCTION public.is_supervisor_now() TO authenticated;

GRANT ALL ON FUNCTION public.legacy_cashiers_for_migration() TO service_role;

GRANT ALL ON FUNCTION public.list_app_users() TO service_role;

GRANT ALL ON FUNCTION public.list_app_users() TO authenticated;

GRANT ALL ON FUNCTION public.list_cashiers() TO service_role;

GRANT ALL ON FUNCTION public.list_cashiers() TO authenticated;

GRANT ALL ON FUNCTION public.member_join(_phone text, _full_name text, _email text) TO service_role;

GRANT ALL ON FUNCTION public.member_welcome_claim(_phone text, _full_name text, _email text) TO service_role;

GRANT ALL ON FUNCTION public.member_welcome_claim(_phone text, _full_name text, _email text) TO anon;

GRANT ALL ON FUNCTION public.member_welcome_claim(_phone text, _full_name text, _email text) TO authenticated;

GRANT ALL ON FUNCTION public.normalize_phone(_phone text) TO service_role;

GRANT ALL ON FUNCTION public.operational_relational_health() TO service_role;

GRANT ALL ON FUNCTION public.operational_relational_health() TO authenticated;

GRANT ALL ON FUNCTION public.pin_throttle_fail(_key text, _limit integer, _window_secs integer, _lock_secs integer) TO service_role;

GRANT ALL ON FUNCTION public.pin_throttle_reset(_key text) TO service_role;

GRANT ALL ON FUNCTION public.pin_throttle_status(_key text) TO service_role;

GRANT ALL ON FUNCTION public.products_bump_row_version() TO service_role;

GRANT ALL ON FUNCTION public.schema_inventory() TO service_role;

GRANT ALL ON FUNCTION public.schema_inventory() TO authenticated;

GRANT ALL ON FUNCTION public.security_report_findings(_source text, _deployment_ref text, _findings jsonb) TO service_role;

GRANT ALL ON FUNCTION public.security_report_findings(_source text, _deployment_ref text, _findings jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.security_selfcheck() TO service_role;

GRANT ALL ON FUNCTION public.security_selfcheck() TO authenticated;

GRANT ALL ON FUNCTION public.security_set_finding_status(_id uuid, _status text, _by text) TO service_role;

GRANT ALL ON FUNCTION public.security_set_finding_status(_id uuid, _status text, _by text) TO authenticated;

GRANT ALL ON FUNCTION public.set_app_user_permissions(p_user_id text, p_permissions jsonb) TO service_role;

GRANT ALL ON FUNCTION public.set_app_user_permissions(p_user_id text, p_permissions jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.set_app_user_profile(p_user_id text, p_full_name text, p_role public.app_role, p_store_id text, p_is_active boolean) TO service_role;

GRANT ALL ON FUNCTION public.set_app_user_profile(p_user_id text, p_full_name text, p_role public.app_role, p_store_id text, p_is_active boolean) TO authenticated;

GRANT ALL ON FUNCTION public.set_cashier_permissions(p_id uuid, p_permissions jsonb) TO service_role;

GRANT ALL ON FUNCTION public.set_cashier_permissions(p_id uuid, p_permissions jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.set_terminal_active(p_user_id text, p_active boolean) TO service_role;

GRANT ALL ON FUNCTION public.set_terminal_active(p_user_id text, p_active boolean) TO authenticated;

GRANT ALL ON TABLE public.shifts TO anon;

GRANT ALL ON TABLE public.shifts TO authenticated;

GRANT ALL ON TABLE public.shifts TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.shifts TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON FUNCTION public.shift_active_for_branch(p_store_id text) TO service_role;

GRANT ALL ON FUNCTION public.shift_active_for_branch(p_store_id text) TO authenticated;

GRANT ALL ON FUNCTION public.shift_open(p_id uuid, p_store_id text, p_opened_by_name text, p_opening_float numeric, p_terminal_id text, p_terminal_name text, p_opened_by_staff_id text, p_opened_by_role text, p_user_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.shift_open(p_id uuid, p_store_id text, p_opened_by_name text, p_opening_float numeric, p_terminal_id text, p_terminal_name text, p_opened_by_staff_id text, p_opened_by_role text, p_user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.shifts_sync_status() TO service_role;

GRANT ALL ON FUNCTION public.skip_stale_update() TO service_role;

GRANT ALL ON FUNCTION public.staff_account_adopt_legacy(p_username text) TO service_role;

GRANT ALL ON FUNCTION public.staff_account_delete_profile(p_user_id text, p_auth_user_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.staff_account_set_active(p_user_id text, p_active boolean) TO service_role;

GRANT ALL ON FUNCTION public.staff_account_set_active(p_user_id text, p_active boolean) TO authenticated;

GRANT ALL ON FUNCTION public.staff_account_set_pin(p_user_id text, p_pin text, p_pin_length smallint) TO service_role;

GRANT ALL ON FUNCTION public.staff_account_upsert(p_user_id text, p_full_name text, p_email text, p_role public.app_role, p_role_slug text, p_store_id text, p_is_active boolean, p_pin text, p_pin_length smallint, p_auth_user_id uuid, p_permissions jsonb) TO service_role;

GRANT ALL ON FUNCTION public.staff_role_delete(_slug text) TO service_role;

GRANT ALL ON FUNCTION public.staff_role_delete(_slug text) TO authenticated;

GRANT ALL ON FUNCTION public.staff_role_save(_slug text, _name text, _base_level text, _permissions jsonb) TO service_role;

GRANT ALL ON FUNCTION public.staff_role_save(_slug text, _name text, _base_level text, _permissions jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.stock_apply_delta(_movement_id uuid, _product_id uuid, _store_id text, _delta integer) TO service_role;

GRANT ALL ON FUNCTION public.stock_apply_delta(_movement_id uuid, _product_id uuid, _store_id text, _delta integer) TO authenticated;

GRANT ALL ON FUNCTION public.stock_transfer_receive(p_transfer_id uuid, p_received_by text, p_deduct_source boolean) TO service_role;

GRANT ALL ON FUNCTION public.stock_transfer_receive(p_transfer_id uuid, p_received_by text, p_deduct_source boolean) TO authenticated;

GRANT ALL ON FUNCTION public.store_visible(_store_id text) TO service_role;

GRANT ALL ON FUNCTION public.store_visible(_store_id text) TO authenticated;

GRANT ALL ON FUNCTION public.stores_hierarchy_guard() TO service_role;

GRANT ALL ON FUNCTION public.sync_auth_user_to_public() TO service_role;

GRANT ALL ON FUNCTION public.system_audit_immutable() TO service_role;

GRANT ALL ON FUNCTION public.terminal_staff_list(p_store_id text) TO service_role;

GRANT ALL ON FUNCTION public.terminal_token_claim(p_token_id uuid, p_device text, p_proof_hash text, p_platform text, p_os text) TO service_role;

GRANT ALL ON FUNCTION public.terminal_token_claim(p_token_id uuid, p_device text, p_proof_hash text, p_platform text, p_os text) TO anon;

GRANT ALL ON FUNCTION public.terminal_token_claim(p_token_id uuid, p_device text, p_proof_hash text, p_platform text, p_os text) TO authenticated;

GRANT ALL ON FUNCTION public.terminal_token_heartbeat(p_token_id uuid, p_activate boolean, p_version text, p_synced boolean, p_proof_hash text) TO service_role;

GRANT ALL ON FUNCTION public.terminal_token_heartbeat(p_token_id uuid, p_activate boolean, p_version text, p_synced boolean, p_proof_hash text) TO anon;

GRANT ALL ON FUNCTION public.terminal_token_heartbeat(p_token_id uuid, p_activate boolean, p_version text, p_synced boolean, p_proof_hash text) TO authenticated;

GRANT ALL ON FUNCTION public.terminal_token_status(p_token_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.terminal_token_status(p_token_id uuid) TO anon;

GRANT ALL ON FUNCTION public.terminal_token_status(p_token_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.touch_updated_at() TO service_role;

GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;

GRANT ALL ON FUNCTION public.upsert_cashier(p_id uuid, p_username text, p_full_name text, p_pin text, p_store_id text, p_is_active boolean) TO service_role;

GRANT ALL ON FUNCTION public.upsert_cashier(p_id uuid, p_username text, p_full_name text, p_pin text, p_store_id text, p_is_active boolean) TO authenticated;

GRANT ALL ON FUNCTION public.upsert_terminal_user(p_user_id text, p_full_name text, p_role public.app_role, p_store_id text, p_email text, p_pin text, p_password text) TO service_role;

GRANT ALL ON FUNCTION public.upsert_terminal_user(p_user_id text, p_full_name text, p_role public.app_role, p_store_id text, p_email text, p_pin text, p_password text) TO authenticated;

GRANT ALL ON FUNCTION public.user_cluster_id() TO service_role;

GRANT ALL ON FUNCTION public.user_cluster_id() TO authenticated;

GRANT ALL ON FUNCTION public.user_has_store_access(_store_id text) TO service_role;

GRANT ALL ON FUNCTION public.user_has_store_access(_store_id text) TO authenticated;

GRANT ALL ON FUNCTION public.user_store_id() TO service_role;

GRANT ALL ON FUNCTION public.user_store_id() TO authenticated;

GRANT ALL ON FUNCTION public.verify_cashier_pin(p_username text, p_pin text) TO service_role;

GRANT ALL ON FUNCTION public.verify_terminal_pin(p_user_id text, p_pin text) TO service_role;

GRANT ALL ON FUNCTION public.verify_terminal_pin(p_user_id text, p_pin text) TO authenticated;

GRANT ALL ON FUNCTION public.voucher_by_token(_token text) TO service_role;

GRANT ALL ON FUNCTION public.voucher_by_token(_token text) TO anon;

GRANT ALL ON FUNCTION public.voucher_by_token(_token text) TO authenticated;

GRANT ALL ON TABLE public.issued_vouchers TO authenticated;

GRANT ALL ON TABLE public.issued_vouchers TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.issued_vouchers TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON FUNCTION public.voucher_redeem(_token text, _sale_id text, _store_id text, _staff text) TO service_role;

GRANT ALL ON FUNCTION public.voucher_redeem(_token text, _sale_id text, _store_id text, _staff text) TO authenticated;

GRANT ALL ON FUNCTION public.voucher_set_status(_token text, _status text, _reason text, _staff text, _role text, _store text) TO service_role;

GRANT ALL ON FUNCTION public.voucher_set_status(_token text, _status text, _reason text, _staff text, _role text, _store text) TO authenticated;

GRANT ALL ON FUNCTION public.voucher_token() TO service_role;

GRANT ALL ON TABLE public.activity_events TO anon;

GRANT ALL ON TABLE public.activity_events TO authenticated;

GRANT ALL ON TABLE public.activity_events TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.activity_events TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.app_users TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.app_users TO sandbox_exec';
END IF; END $sbx$;

GRANT SELECT ON TABLE public.app_users TO authenticated;

GRANT ALL ON TABLE public.audit_logs TO authenticated;

GRANT ALL ON TABLE public.audit_logs TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.audit_logs TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.booking_payments TO anon;

GRANT ALL ON TABLE public.booking_payments TO authenticated;

GRANT ALL ON TABLE public.booking_payments TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.booking_payments TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.bookings TO anon;

GRANT ALL ON TABLE public.bookings TO authenticated;

GRANT ALL ON TABLE public.bookings TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.bookings TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.branch_telemetry TO anon;

GRANT ALL ON TABLE public.branch_telemetry TO authenticated;

GRANT ALL ON TABLE public.branch_telemetry TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.branch_telemetry TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.cashiers TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.cashiers TO sandbox_exec';
END IF; END $sbx$;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.coupon_events TO authenticated;

GRANT ALL ON TABLE public.coupon_events TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.coupon_events TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.drawer_events TO anon;

GRANT ALL ON TABLE public.drawer_events TO authenticated;

GRANT ALL ON TABLE public.drawer_events TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.drawer_events TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.held_orders TO anon;

GRANT ALL ON TABLE public.held_orders TO authenticated;

GRANT ALL ON TABLE public.held_orders TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.held_orders TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.integration_settings TO anon;

GRANT ALL ON TABLE public.integration_settings TO authenticated;

GRANT ALL ON TABLE public.integration_settings TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.integration_settings TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.item_activity_logs TO anon;

GRANT ALL ON TABLE public.item_activity_logs TO authenticated;

GRANT ALL ON TABLE public.item_activity_logs TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.item_activity_logs TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.member_verifications TO anon;

GRANT ALL ON TABLE public.member_verifications TO authenticated;

GRANT ALL ON TABLE public.member_verifications TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.member_verifications TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.members TO authenticated;

GRANT ALL ON TABLE public.members TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.members TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.membership_tiers TO authenticated;

GRANT ALL ON TABLE public.membership_tiers TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.membership_tiers TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.offline_sync_audit_log TO anon;

GRANT ALL ON TABLE public.offline_sync_audit_log TO authenticated;

GRANT ALL ON TABLE public.offline_sync_audit_log TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.offline_sync_audit_log TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.payment_transactions TO anon;

GRANT ALL ON TABLE public.payment_transactions TO authenticated;

GRANT ALL ON TABLE public.payment_transactions TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.payment_transactions TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.payment_types TO anon;

GRANT ALL ON TABLE public.payment_types TO authenticated;

GRANT ALL ON TABLE public.payment_types TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.payment_types TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.pin_attempts TO anon;

GRANT ALL ON TABLE public.pin_attempts TO authenticated;

GRANT ALL ON TABLE public.pin_attempts TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.pin_attempts TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.pos_settings TO authenticated;

GRANT ALL ON TABLE public.pos_settings TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.pos_settings TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.product_barcodes TO anon;

GRANT ALL ON TABLE public.product_barcodes TO authenticated;

GRANT ALL ON TABLE public.product_barcodes TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.product_barcodes TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.product_categories TO anon;

GRANT ALL ON TABLE public.product_categories TO authenticated;

GRANT ALL ON TABLE public.product_categories TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.product_categories TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.products TO authenticated;

GRANT ALL ON TABLE public.products TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.products TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.promotions TO authenticated;

GRANT ALL ON TABLE public.promotions TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.promotions TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.public_flags TO anon;

GRANT ALL ON TABLE public.public_flags TO authenticated;

GRANT ALL ON TABLE public.public_flags TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.public_flags TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.purchase_order_items TO authenticated;

GRANT ALL ON TABLE public.purchase_order_items TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.purchase_order_items TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.purchase_orders TO authenticated;

GRANT ALL ON TABLE public.purchase_orders TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.purchase_orders TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.sale_items TO authenticated;

GRANT ALL ON TABLE public.sale_items TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.sale_items TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.sales TO authenticated;

GRANT ALL ON TABLE public.sales TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.sales TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.secure_settings TO anon;

GRANT ALL ON TABLE public.secure_settings TO authenticated;

GRANT ALL ON TABLE public.secure_settings TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.secure_settings TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.security_findings TO anon;

GRANT ALL ON TABLE public.security_findings TO authenticated;

GRANT ALL ON TABLE public.security_findings TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.security_findings TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.settings_locks TO anon;

GRANT ALL ON TABLE public.settings_locks TO authenticated;

GRANT ALL ON TABLE public.settings_locks TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.settings_locks TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.settings_overrides TO anon;

GRANT ALL ON TABLE public.settings_overrides TO authenticated;

GRANT ALL ON TABLE public.settings_overrides TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.settings_overrides TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.shift_sessions TO anon;

GRANT ALL ON TABLE public.shift_sessions TO authenticated;

GRANT ALL ON TABLE public.shift_sessions TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.shift_sessions TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.sku_audit TO anon;

GRANT ALL ON TABLE public.sku_audit TO authenticated;

GRANT ALL ON TABLE public.sku_audit TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.sku_audit TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.staff_roles TO anon;

GRANT ALL ON TABLE public.staff_roles TO authenticated;

GRANT ALL ON TABLE public.staff_roles TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.staff_roles TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.stock_adjustments TO anon;

GRANT ALL ON TABLE public.stock_adjustments TO authenticated;

GRANT ALL ON TABLE public.stock_adjustments TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.stock_adjustments TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.stock_delta_applied TO anon;

GRANT ALL ON TABLE public.stock_delta_applied TO authenticated;

GRANT ALL ON TABLE public.stock_delta_applied TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.stock_delta_applied TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.stock_transfer_items TO anon;

GRANT ALL ON TABLE public.stock_transfer_items TO authenticated;

GRANT ALL ON TABLE public.stock_transfer_items TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.stock_transfer_items TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.stock_transfers TO anon;

GRANT ALL ON TABLE public.stock_transfers TO authenticated;

GRANT ALL ON TABLE public.stock_transfers TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.stock_transfers TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.stores TO anon;

GRANT ALL ON TABLE public.stores TO authenticated;

GRANT ALL ON TABLE public.stores TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.stores TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.suppliers TO authenticated;

GRANT ALL ON TABLE public.suppliers TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.suppliers TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.sync_metadata TO anon;

GRANT ALL ON TABLE public.sync_metadata TO authenticated;

GRANT ALL ON TABLE public.sync_metadata TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.sync_metadata TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.system_audit_logs TO anon;

GRANT ALL ON TABLE public.system_audit_logs TO authenticated;

GRANT ALL ON TABLE public.system_audit_logs TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.system_audit_logs TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.terminal_commands TO anon;

GRANT ALL ON TABLE public.terminal_commands TO authenticated;

GRANT ALL ON TABLE public.terminal_commands TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.terminal_commands TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.terminal_tokens TO authenticated;

GRANT ALL ON TABLE public.terminal_tokens TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.terminal_tokens TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.uom_units TO anon;

GRANT ALL ON TABLE public.uom_units TO authenticated;

GRANT ALL ON TABLE public.uom_units TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.uom_units TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.user_roles TO anon;

GRANT ALL ON TABLE public.user_roles TO authenticated;

GRANT ALL ON TABLE public.user_roles TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.user_roles TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.v_sale_line_facts TO anon;

GRANT ALL ON TABLE public.v_sale_line_facts TO authenticated;

GRANT ALL ON TABLE public.v_sale_line_facts TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.v_sale_line_facts TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.v_daily_item_sales TO anon;

GRANT ALL ON TABLE public.v_daily_item_sales TO authenticated;

GRANT ALL ON TABLE public.v_daily_item_sales TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.v_daily_item_sales TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.v_daily_store_sales TO anon;

GRANT ALL ON TABLE public.v_daily_store_sales TO authenticated;

GRANT ALL ON TABLE public.v_daily_store_sales TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.v_daily_store_sales TO sandbox_exec';
END IF; END $sbx$;

GRANT ALL ON TABLE public.whatsapp_queue TO anon;

GRANT ALL ON TABLE public.whatsapp_queue TO authenticated;

GRANT ALL ON TABLE public.whatsapp_queue TO service_role;

DO $sbx$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
  EXECUTE 'GRANT SELECT,INSERT ON TABLE public.whatsapp_queue TO sandbox_exec';
END IF; END $sbx$;

-- ============================================================
-- Verification: anything listed below is still missing.
-- An empty result means the run was complete.
-- ============================================================
SELECT 'table without RLS' AS issue, c.relname AS object
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
UNION ALL
SELECT 'table without policies', c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   -- cashiers (legacy) and pin_attempts (login throttle) are deliberately
   -- policy-free: RLS is on, no role may read them, and the only access is
   -- through SECURITY DEFINER routines.
   AND c.relname NOT IN ('cashiers', 'pin_attempts')
   AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
UNION ALL
SELECT 'table without grants', c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relacl IS NULL
ORDER BY 1, 2;



-- ---------------------------------------------------------------------------
-- Emergency recovery secrets (v1.3.99)
-- Each till escrows its recovery secret here, encrypted with the server's
-- SETTINGS_ENCRYPTION_KEY. Service role only: no policy is granted on purpose,
-- so the row is unreachable through the data API.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.terminal_recovery_secrets (
    terminal_token_id uuid PRIMARY KEY,
    sealed_secret text NOT NULL,
    fingerprint text NOT NULL,
    platform text DEFAULT 'unknown'::text NOT NULL,
    device_name text,
    utc_offset_minutes integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.terminal_recovery_secrets ADD COLUMN IF NOT EXISTS utc_offset_minutes integer DEFAULT 0 NOT NULL;
ALTER TABLE public.terminal_recovery_secrets ADD COLUMN IF NOT EXISTS device_name text;

GRANT ALL ON public.terminal_recovery_secrets TO service_role;
ALTER TABLE public.terminal_recovery_secrets ENABLE ROW LEVEL SECURITY;


-- ===========================================================================
-- PART 2 - objects added after the first release
--
-- Everything below is guarded: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS, CREATE INDEX IF NOT EXISTS, DROP POLICY/TRIGGER IF EXISTS before
-- each CREATE, CREATE OR REPLACE for every view and routine. No table is
-- dropped, truncated or recreated and no row is touched.
-- ===========================================================================

-- ------------------------------------------------------------------
-- Daily sales reporting views
-- (source: 20260806052443_83af0584-4075-40e8-b0b1-b1439ce91436.sql)
-- ------------------------------------------------------------------
-- Line-level sales facts shared by every analytics surface.
CREATE OR REPLACE VIEW public.v_sale_line_facts
WITH (security_invoker = true) AS
SELECT
  si.id                                        AS line_id,
  si.sale_id,
  s.bill_number,
  s.store_id,
  s.cashier_name,
  s.created_at,
  (s.created_at)::date                         AS sale_day,
  to_char(s.created_at, 'YYYY-MM')             AS sale_month,
  s.payment_type,
  s.is_refunded,
  si.product_id,
  si.product_name,
  si.quantity,
  si.unit_price,
  si.unit_cost,
  si.is_foc,
  si.is_return,
  round((CASE WHEN si.discount_percent > 0
              THEN si.unit_price * si.discount_percent / 100.0
              ELSE si.discount_amount END)::numeric, 2)                    AS unit_discount,
  round((((CASE WHEN si.discount_percent > 0
                THEN si.unit_price * si.discount_percent / 100.0
                ELSE si.discount_amount END) * si.quantity)
         + coalesce(si.coupon_discount, 0))::numeric, 2)                   AS line_discount,
  round((greatest(si.unit_price - (CASE WHEN si.discount_percent > 0
                                        THEN si.unit_price * si.discount_percent / 100.0
                                        ELSE si.discount_amount END), 0) * si.quantity
         - coalesce(si.coupon_discount, 0))::numeric, 2)                   AS line_revenue,
  round((coalesce(si.unit_cost, 0) * si.quantity)::numeric, 2)             AS line_cost
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id;

GRANT SELECT ON public.v_sale_line_facts TO authenticated;
GRANT ALL ON public.v_sale_line_facts TO service_role;

-- Daily totals per shop.
CREATE OR REPLACE VIEW public.v_daily_store_sales
WITH (security_invoker = true) AS
SELECT
  f.sale_day,
  f.sale_month,
  f.store_id,
  count(DISTINCT f.sale_id)                       AS bills,
  round(sum(f.line_revenue), 2)                   AS revenue,
  round(sum(f.line_cost), 2)                      AS cost,
  round(sum(f.line_revenue - f.line_cost), 2)     AS profit,
  round(sum(f.line_discount), 2)                  AS discount,
  round(sum(CASE WHEN f.is_foc THEN f.unit_price * f.quantity ELSE 0 END), 2) AS foc_value,
  round(sum(f.quantity), 2)                       AS units
FROM public.v_sale_line_facts f
GROUP BY f.sale_day, f.sale_month, f.store_id;

GRANT SELECT ON public.v_daily_store_sales TO authenticated;
GRANT ALL ON public.v_daily_store_sales TO service_role;

-- Daily item mix per shop.
CREATE OR REPLACE VIEW public.v_daily_item_sales
WITH (security_invoker = true) AS
SELECT
  f.sale_day,
  f.sale_month,
  f.store_id,
  f.product_id,
  f.product_name,
  round(sum(f.quantity), 2)                       AS units,
  round(sum(f.line_revenue), 2)                   AS revenue,
  round(sum(f.line_cost), 2)                      AS cost,
  round(sum(f.line_revenue - f.line_cost), 2)     AS profit,
  COALESCE(NULLIF(btrim(p.category), ''), 'Uncategorized') AS product_category
FROM public.v_sale_line_facts f
LEFT JOIN public.products p ON p.id = f.product_id
GROUP BY f.sale_day, f.sale_month, f.store_id, f.product_id, f.product_name,
  COALESCE(NULLIF(btrim(p.category), ''), 'Uncategorized');

REVOKE ALL ON TABLE public.v_daily_item_sales FROM anon;
GRANT SELECT ON TABLE public.v_daily_item_sales TO authenticated;
GRANT ALL ON TABLE public.v_daily_item_sales TO service_role;

-- ------------------------------------------------------------------
-- Per-branch POS rules (pos_store_settings) + rules routines
-- (source: 20260820144433_dc87f136-8945-44fc-a734-b34f9443478c.sql)
-- ------------------------------------------------------------------
-- POS rules, manager override and held-order backend.
-- Reuses app_users (bcrypt PIN), audit_logs, held_orders and the existing
-- supervisor/visibility helpers. Only the per-branch rules store is new.

CREATE TABLE IF NOT EXISTS public.pos_store_settings (
  store_id text PRIMARY KEY,
  block_shift_close_on_hold boolean,
  require_daily_sales_for_shift_close boolean,
  require_counted_cash_on_close boolean,
  require_opening_float_count boolean,
  enable_blind_cash_count boolean,
  max_drawer_cash_limit numeric,
  require_reason_for_payout boolean,
  allow_multiple_shifts_per_terminal boolean,
  enable_cashier_x_report boolean,
  show_opening_float_at_close boolean,
  show_expected_totals_at_close boolean,
  show_live_variance_at_close boolean,
  show_itemized_tender_breakdown boolean,
  require_manager_pin_on_variance boolean,
  variance_pin_threshold numeric,
  max_cashier_discount_percent numeric,
  max_cart_discount_amount numeric,
  allow_discount_stacking boolean,
  require_reason_for_price_override boolean,
  prevent_below_cost_sale boolean,
  allow_tax_exemption boolean,
  prevent_negative_stock_sale boolean,
  require_receipt_for_refund boolean,
  require_manager_pin_for_refund boolean,
  max_refund_days_limit numeric,
  track_item_voids boolean,
  auto_lock_timeout_seconds numeric,
  require_manager_pin_for_cash_drawer_open boolean,
  enable_manager_pin_audit_log boolean,
  require_pin_void_cart boolean,
  require_pin_void_line boolean,
  require_pin_reduce_qty boolean,
  require_pin_manual_discount boolean,
  require_pin_price_override boolean,
  require_pin_stock_adjustment boolean,
  require_pin_shift_close boolean,
  require_pin_edit_tenders boolean,
  require_pin_terminal_reset boolean,
  row_version integer NOT NULL DEFAULT 1,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.pos_store_settings TO authenticated;
GRANT ALL ON public.pos_store_settings TO service_role;

ALTER TABLE public.pos_store_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read rules for visible branches" ON public.pos_store_settings;
CREATE POLICY "Staff read rules for visible branches"
  ON public.pos_store_settings FOR SELECT TO authenticated
  USING (public.store_visible(store_id));

DROP POLICY IF EXISTS "Supervisors write rules" ON public.pos_store_settings;
CREATE POLICY "Supervisors write rules"
  ON public.pos_store_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_supervisor_now());

DROP POLICY IF EXISTS "Supervisors update rules" ON public.pos_store_settings;
CREATE POLICY "Supervisors update rules"
  ON public.pos_store_settings FOR UPDATE TO authenticated
  USING (public.is_supervisor_now())
  WITH CHECK (public.is_supervisor_now());

-- The shipped defaults, kept in one place so every routine agrees.
CREATE OR REPLACE FUNCTION public.pos_rules_defaults()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "block_shift_close_on_hold": true,
    "require_daily_sales_for_shift_close": true,
    "require_counted_cash_on_close": true,
    "require_opening_float_count": true,
    "enable_blind_cash_count": true,
    "max_drawer_cash_limit": 1000,
    "require_reason_for_payout": true,
    "allow_multiple_shifts_per_terminal": false,
    "enable_cashier_x_report": false,
    "show_opening_float_at_close": true,
    "show_expected_totals_at_close": false,
    "show_live_variance_at_close": false,
    "show_itemized_tender_breakdown": true,
    "require_manager_pin_on_variance": true,
    "variance_pin_threshold": 10,
    "max_cashier_discount_percent": 10,
    "max_cart_discount_amount": 100,
    "allow_discount_stacking": false,
    "require_reason_for_price_override": true,
    "prevent_below_cost_sale": true,
    "allow_tax_exemption": false,
    "prevent_negative_stock_sale": false,
    "require_receipt_for_refund": true,
    "require_manager_pin_for_refund": true,
    "max_refund_days_limit": 30,
    "track_item_voids": true,
    "auto_lock_timeout_seconds": 90,
    "require_manager_pin_for_cash_drawer_open": true,
    "enable_manager_pin_audit_log": true,
    "require_pin_void_cart": true,
    "require_pin_void_line": false,
    "require_pin_reduce_qty": false,
    "require_pin_manual_discount": true,
    "require_pin_price_override": true,
    "require_pin_stock_adjustment": true,
    "require_pin_shift_close": false,
    "require_pin_edit_tenders": false,
    "require_pin_terminal_reset": true
  }'::jsonb;
$$;

-- One row's set rules, with the bookkeeping columns removed.
CREATE OR REPLACE FUNCTION public.pos_rules_row(_store_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT COALESCE(
    (SELECT jsonb_strip_nulls(to_jsonb(s))
            - 'store_id' - 'row_version' - 'updated_by' - 'updated_at'
       FROM public.pos_store_settings s
      WHERE s.store_id = COALESCE(btrim(_store_id), '')),
    '{}'::jsonb);
$$;

-- Effective rules: defaults, then the global row, then the branch row.
CREATE OR REPLACE FUNCTION public.pos_rules_get(_store_id text DEFAULT '')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT public.pos_rules_defaults()
         || public.pos_rules_row('')
         || CASE WHEN COALESCE(btrim(_store_id), '') = ''
                 THEN '{}'::jsonb ELSE public.pos_rules_row(_store_id) END;
$$;

-- Canonical effective rules plus the branch-row metadata used for optimistic
-- concurrency. The blank/global row follows the same contract.
CREATE OR REPLACE FUNCTION public.pos_rules_snapshot(_store_id text DEFAULT '')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  WITH requested AS (
    SELECT COALESCE(btrim(_store_id), '') AS store_id
  ), metadata AS (
    SELECT s.store_id, s.row_version, s.updated_at, s.updated_by
      FROM public.pos_store_settings s, requested r
     WHERE s.store_id = r.store_id
  )
  SELECT jsonb_build_object(
    'rules', public.pos_rules_get(r.store_id),
    'store_id', r.store_id,
    'row_version', COALESCE(m.row_version, 1),
    'updated_at', m.updated_at,
    'updated_by', m.updated_by
  )
    FROM requested r LEFT JOIN metadata m ON m.store_id = r.store_id
   WHERE auth.role() = 'service_role' OR r.store_id = '' OR public.store_visible(r.store_id);
$$;

REVOKE ALL ON FUNCTION public.pos_rules_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_rules_snapshot(text) TO authenticated, service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sales', 'sale_items', 'payment_transactions',
    'products', 'product_barcodes', 'members', 'promotions',
    'purchase_orders', 'purchase_order_items',
    'staff_roles', 'stores', 'app_users'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- POS-settings editors may write their visible branch. Unknown keys are ignored; a stale expected version
-- is refused so two supervisors cannot silently overwrite each other.
CREATE OR REPLACE FUNCTION public.pos_rules_save(
  _store_id text,
  _patch jsonb,
  _expected_version integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  sid text := COALESCE(btrim(_store_id), '');
  known jsonb := public.pos_rules_defaults();
  clean jsonb := '{}'::jsonb;
  k text;
  current_version integer;
  sets text;
BEGIN
  IF NOT (public.is_supervisor_now() OR public.has_perm('can_access_pos_settings')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED: POS settings permission required' USING ERRCODE = '42501';
  END IF;
  IF sid <> '' AND NOT public.store_visible(sid) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED: branch is not visible to this account' USING ERRCODE = '42501';
  END IF;

  FOR k IN SELECT jsonb_object_keys(COALESCE(_patch, '{}'::jsonb)) LOOP
    IF known ? k AND jsonb_typeof(_patch -> k) IN ('boolean', 'number') THEN
      clean := clean || jsonb_build_object(k, _patch -> k);
    END IF;
  END LOOP;

  IF clean = '{}'::jsonb THEN
    RAISE EXCEPTION 'NO_VALID_RULES: nothing recognised in the change' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.pos_store_settings(store_id) VALUES (sid)
    ON CONFLICT (store_id) DO NOTHING;

  SELECT row_version INTO current_version
    FROM public.pos_store_settings WHERE store_id = sid FOR UPDATE;

  IF _expected_version IS NOT NULL AND _expected_version <> current_version THEN
    -- 40001 is PostgreSQL's retryable serialization-failure code. PostgREST
    -- automatically retries it, so using it for an application-level stale
    -- edit can spin until the request times out. PT409 preserves the conflict
    -- response without asking the database gateway to retry the same payload.
    RAISE EXCEPTION 'STALE_RULES: these rules were changed elsewhere (version %, expected %)',
      current_version, _expected_version USING ERRCODE = 'PT409';
  END IF;

  SELECT string_agg(format('%I = ($1 ->> %L)::%s', key, key,
           CASE WHEN jsonb_typeof(known -> key) = 'boolean' THEN 'boolean' ELSE 'numeric' END), ', ')
    INTO sets
    FROM jsonb_object_keys(clean) AS key;

  EXECUTE format(
    'UPDATE public.pos_store_settings SET %s, row_version = row_version + 1,
        updated_by = $2, updated_at = now() WHERE store_id = $3', sets)
    USING clean, COALESCE(auth.uid()::text, 'service'), sid;

  RETURN public.pos_rules_snapshot(sid);
END $$;

-- Remove the retired signature first. Leaving both signatures makes PostgREST
-- select the older eight-argument routine and bypass the canonical audit path.
DROP FUNCTION IF EXISTS public.log_manager_override(text,text,text,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.log_manager_override(text,text,text,text,text,text,text,text,text);

-- Override audit. One transaction writes the operational audit, immutable
-- authorisation history and the Edit History report row.
CREATE OR REPLACE FUNCTION public.log_manager_override(
  _action text,
  _rule_key text DEFAULT NULL,
  _requested_by text DEFAULT NULL,
  _approved_by text DEFAULT NULL,
  _approved_role text DEFAULT NULL,
  _store_id text DEFAULT NULL,
  _terminal_id text DEFAULT NULL,
  _detail text DEFAULT NULL,
  _outcome text DEFAULT 'approved',
  _mode_used text DEFAULT 'admin_auto'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  new_id uuid := gen_random_uuid();
  clean_action text := btrim(COALESCE(_action, ''));
  clean_outcome text := COALESCE(NULLIF(btrim(_outcome), ''), 'approved');
  clean_mode text := COALESCE(NULLIF(btrim(_mode_used), ''), 'admin_auto');
  input_detail jsonb := '{}'::jsonb;
  audit_detail jsonb;
  request_uuid uuid;
  requested_name text;
  approved_name text;
  approval_purpose text;
BEGIN
  IF clean_action = '' THEN
    RAISE EXCEPTION 'ACTION_REQUIRED: an override needs an action' USING ERRCODE = '22023';
  END IF;
  IF clean_mode NOT IN ('pin', 'request', 'admin_auto', 'offline_pin') THEN
    RAISE EXCEPTION 'OVERRIDE_MODE_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    input_detail := COALESCE(NULLIF(_detail, '')::jsonb, '{}'::jsonb);
    IF jsonb_typeof(input_detail) <> 'object' THEN
      input_detail := jsonb_build_object('purpose', left(COALESCE(_detail, ''), 400));
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    input_detail := jsonb_build_object('purpose', left(COALESCE(_detail, ''), 400));
  END;
  IF COALESCE(input_detail ->> 'request_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    request_uuid := (input_detail ->> 'request_id')::uuid;
  END IF;
  requested_name := NULLIF(btrim(input_detail ->> 'requested_by_name'), '');
  approved_name := COALESCE(NULLIF(btrim(input_detail ->> 'approved_by_name'), ''), _approved_by);
  approval_purpose := COALESCE(
    NULLIF(btrim(input_detail ->> 'purpose'), ''),
    NULLIF(btrim(input_detail ->> 'reason'), ''),
    NULLIF(btrim(input_detail ->> 'note'), ''),
    NULLIF(btrim(input_detail ->> 'decision_note'), '')
  );
  audit_detail := jsonb_strip_nulls(input_detail || jsonb_build_object(
    'rule_key', _rule_key,
    'requested_by', _requested_by,
    'requested_by_name', requested_name,
    'approved_by', _approved_by,
    'approved_by_name', approved_name,
    'approved_role', _approved_role,
    'store_id', _store_id,
    'terminal_id', _terminal_id,
    'outcome', clean_outcome,
    'mode_used', clean_mode,
    'purpose', approval_purpose));

  INSERT INTO public.authorization_log(
    id, action_key, mode_used, request_id, requested_by, authorized_by, authorizer_role,
    store_id, terminal_id, outcome, detail)
  VALUES (
    new_id, clean_action, clean_mode, request_uuid, _requested_by, _approved_by, _approved_role,
    COALESCE(_store_id, ''), COALESCE(_terminal_id, ''), clean_outcome, audit_detail);

  INSERT INTO public.audit_logs(
    action_category, action_name, target_module, user_id, user_name, action,
    entity, details, store_id)
  VALUES (
    'override',
    clean_action,
    'pos',
    _approved_by,
    approved_name,
    clean_action,
    COALESCE(_rule_key, clean_action),
    audit_detail,
    NULLIF(btrim(COALESCE(_store_id, '')), ''));

  INSERT INTO public.system_audit_logs(
    actor_id, actor_name, actor_role, action_type, entity_affected, entity_id,
    new_value, terminal_id, store_id, note)
  VALUES (
    _approved_by, approved_name, _approved_role,
    'authorization.override.' || clean_outcome,
    'authorization_log', new_id::text, audit_detail,
    NULLIF(btrim(COALESCE(_terminal_id, '')), ''),
    NULLIF(btrim(COALESCE(_store_id, '')), ''),
    left(COALESCE(approval_purpose, input_detail ->> 'decision_note', ''), 400));
  RETURN new_id;
END $$;

-- Manager PIN check. Comparison stays in the database; the PIN is never
-- returned, logged or stored. Nothing comes back on any failure.
CREATE OR REPLACE FUNCTION public.verify_manager_pin(
  p_user_id text,
  p_pin text,
  p_action text DEFAULT NULL,
  p_rule_key text DEFAULT NULL,
  p_requested_by text DEFAULT NULL,
  p_store_id text DEFAULT NULL,
  p_terminal_id text DEFAULT NULL,
  p_detail text DEFAULT NULL
)
RETURNS TABLE(user_id text, full_name text, role app_role)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp', 'extensions' AS $$
DECLARE u public.app_users%rowtype;
BEGIN
  SELECT * INTO u FROM public.app_users a
   WHERE lower(a.user_id) = lower(btrim(p_user_id)) AND a.is_active;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT (u.role IN ('admin', 'manager')
          OR COALESCE((u.permissions ->> 'can_access_pos_settings')::boolean, false)
          OR COALESCE((u.permissions ->> 'can_manage_staff')::boolean, false)) THEN
    RETURN;
  END IF;

  IF u.pin_hash = '' OR u.pin_hash <> extensions.crypt(p_pin::text, u.pin_hash::text) THEN
    RETURN;
  END IF;

  IF COALESCE(btrim(p_action), '') <> '' THEN
    PERFORM public.log_manager_override(
      p_action, p_rule_key, p_requested_by, u.user_id::text, u.role::text,
      p_store_id, p_terminal_id,
      jsonb_build_object('purpose', p_detail, 'approved_by_name', u.full_name)::text,
      'approved', 'pin');
  END IF;

  RETURN QUERY SELECT u.user_id::text, u.full_name::text, u.role;
END $$;

-- Open held tickets for a branch, within the caller's visible scope.
CREATE OR REPLACE FUNCTION public.held_orders_open_count(_store_id text DEFAULT '')
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE sid text := COALESCE(btrim(_store_id), '');
BEGIN
  IF sid <> '' AND NOT public.store_visible(sid) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED: this branch is not visible to you' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT count(*)::integer FROM public.held_orders h
     WHERE h.cancelled_from IS NULL
       AND (sid = '' OR COALESCE(h.store_id, '') = sid)
       AND (sid <> '' OR public.store_visible(COALESCE(h.store_id, '')))
  );
END $$;

-- Elevated routines are never reachable by a visitor.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('pos_rules_get', 'pos_rules_save', 'pos_rules_row',
                         'pos_rules_defaults', 'verify_manager_pin',
                         'held_orders_open_count')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.log_manager_override(text,text,text,text,text,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_manager_override(text,text,text,text,text,text,text,text,text,text)
  TO service_role;

-- The global row must exist so branch rules always have a base to layer over.
INSERT INTO public.pos_store_settings(store_id) VALUES ('')
  ON CONFLICT (store_id) DO NOTHING;

-- ------------------------------------------------------------------
-- Product deletion guard
-- (source: 20260820150733_cb7c5870-e413-4308-a3dc-d2bb119b1f06.sql)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_delete_guard(_product_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'exists', EXISTS (SELECT 1 FROM public.products p WHERE p.id = _product_id),
    'archived', COALESCE((SELECT p.is_archived FROM public.products p WHERE p.id = _product_id), false),
    'sales', EXISTS (SELECT 1 FROM public.sale_items si WHERE si.product_id = _product_id),
    'purchases', EXISTS (SELECT 1 FROM public.purchase_order_items poi WHERE poi.product_id = _product_id),
    'transfers', EXISTS (SELECT 1 FROM public.stock_transfer_items sti WHERE sti.product_id = _product_id),
    'adjustments', EXISTS (SELECT 1 FROM public.stock_adjustments sa WHERE sa.product_id = _product_id),
    'promotions', EXISTS (SELECT 1 FROM public.promotions pr WHERE pr.foc_product_id = _product_id)
  );
$$;

REVOKE ALL ON FUNCTION public.product_delete_guard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_delete_guard(uuid) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS stock_transfer_items_product_id_idx ON public.stock_transfer_items (product_id);
CREATE INDEX IF NOT EXISTS promotions_foc_product_id_idx ON public.promotions (foc_product_id);

-- ------------------------------------------------------------------
-- Atomic stock deltas and reconciliation
-- (source: 20260820162215_24601ef9-b24d-4ae3-9e9e-0655aee6b183.sql)
-- ------------------------------------------------------------------
-- Batch relative stock application. Each element reuses the single-movement
-- routine, so the replay guard and branch check are unchanged.
CREATE OR REPLACE FUNCTION public.stock_apply_deltas(_movements jsonb)
RETURNS TABLE(movement_id uuid, status text, balance integer, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _m jsonb;
  _seen uuid[] := ARRAY[]::uuid[];
  _id uuid;
  _pid uuid;
  _store text;
  _delta integer;
  _bal integer;
  _existed boolean;
BEGIN
  FOR _m IN SELECT * FROM jsonb_array_elements(COALESCE(_movements, '[]'::jsonb)) LOOP
    BEGIN
      _id := NULLIF(_m ->> 'movement_id', '')::uuid;
      _pid := NULLIF(_m ->> 'product_id', '')::uuid;
      _store := NULLIF(_m ->> 'store_id', '');
      _delta := COALESCE((_m ->> 'delta')::int, 0);
    EXCEPTION WHEN others THEN
      movement_id := NULL; status := 'refused'; balance := NULL; reason := 'invalid';
      RETURN NEXT; CONTINUE;
    END;

    IF _id IS NULL OR _pid IS NULL THEN
      movement_id := _id; status := 'refused'; balance := NULL; reason := 'invalid';
      RETURN NEXT; CONTINUE;
    END IF;

    -- A movement id repeated inside one batch is answered once.
    IF _id = ANY(_seen) THEN
      movement_id := _id; status := 'duplicate'; balance := NULL; reason := NULL;
      RETURN NEXT; CONTINUE;
    END IF;
    _seen := _seen || _id;

    SELECT EXISTS(SELECT 1 FROM public.stock_delta_applied s WHERE s.movement_id = _id)
      INTO _existed;

    BEGIN
      _bal := public.stock_apply_delta(_id, _pid, _store, _delta);
      movement_id := _id;
      status := CASE WHEN _existed THEN 'duplicate' ELSE 'applied' END;
      balance := _bal;
      reason := NULL;
      RETURN NEXT;
    EXCEPTION WHEN others THEN
      movement_id := _id;
      status := 'refused';
      balance := NULL;
      reason := CASE
        WHEN SQLERRM ILIKE '%own branch%' THEN 'not_permitted'
        WHEN SQLERRM ILIKE '%unknown product%' THEN 'unknown_product'
        WHEN SQLERRM ILIKE '%required%' THEN 'invalid'
        ELSE 'failed'
      END;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.stock_apply_deltas(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_apply_deltas(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_apply_deltas(jsonb) TO service_role;

-- Read-only drift report for one branch.
CREATE OR REPLACE FUNCTION public.stock_reconcile(_store_id text, _since timestamptz DEFAULT (now() - interval '30 days'))
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _missing jsonb;
  _mismatched jsonb;
  _products jsonb;
BEGIN
  IF _store_id IS NULL OR NOT public.store_visible(_store_id) THEN
    RAISE EXCEPTION 'You can only reconcile your own branch';
  END IF;

  -- Movement exists in the ledger but no central application was recorded.
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _missing FROM (
    SELECT l.id AS movement_id, l.product_id, l.quantity_delta AS delta, l.created_at
      FROM public.item_activity_logs l
      LEFT JOIN public.stock_delta_applied s ON s.movement_id = l.id
     WHERE l.store_id = _store_id
       AND COALESCE(l.quantity_delta, 0) <> 0
       AND l.created_at >= _since
       AND s.movement_id IS NULL
     ORDER BY l.created_at DESC
     LIMIT 200
  ) x;

  -- Applied, but for a different amount than the ledger row says: the sign of
  -- a movement that reached the centre more than once, or was edited after.
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _mismatched FROM (
    SELECT l.id AS movement_id, l.product_id, l.quantity_delta AS ledger_delta, s.delta AS applied_delta
      FROM public.item_activity_logs l
      JOIN public.stock_delta_applied s ON s.movement_id = l.id
     WHERE l.store_id = _store_id
       AND l.created_at >= _since
       AND COALESCE(s.delta, 0) <> COALESCE(l.quantity_delta, 0)
     ORDER BY l.created_at DESC
     LIMIT 200
  ) x;

  -- Central figure against the sum of everything applied for this branch.
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _products FROM (
    SELECT p.id AS product_id,
           COALESCE((p.stock_by_store ->> _store_id)::int, 0) AS central,
           a.applied_sum
      FROM (
        SELECT product_id, SUM(delta)::int AS applied_sum
          FROM public.stock_delta_applied
         WHERE store_id = _store_id
         GROUP BY product_id
      ) a
      JOIN public.products p ON p.id = a.product_id
     WHERE COALESCE((p.stock_by_store ->> _store_id)::int, 0) <> a.applied_sum
     LIMIT 200
  ) x;

  RETURN jsonb_build_object(
    'store_id', _store_id,
    'checked_at', now(),
    'not_applied', _missing,
    'amount_mismatch', _mismatched,
    'stock_mismatch', _products
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stock_reconcile(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_reconcile(text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_reconcile(text, timestamptz) TO service_role;

-- ------------------------------------------------------------------
-- Scoped settings (settings_scoped) and inheritance
-- (source: 20260820231635_ca1885c0-6e56-4ad4-b3cd-27a11acb3b7a.sql)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings_scoped (
  scope text NOT NULL DEFAULT 'GLOBAL',
  scope_id text NOT NULL DEFAULT '',
  key text NOT NULL,
  value jsonb,
  is_overridden boolean NOT NULL DEFAULT true,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (scope, scope_id, key)
);

ALTER TABLE public.settings_overrides ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.settings_scoped ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.preserve_or_bump_row_version() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  NEW.row_version := GREATEST(COALESCE(NEW.row_version, 0), COALESCE(OLD.row_version, 0) + 1);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settings_overrides_bump_row_version ON public.settings_overrides;
CREATE TRIGGER settings_overrides_bump_row_version BEFORE UPDATE ON public.settings_overrides
  FOR EACH ROW EXECUTE FUNCTION public.preserve_or_bump_row_version();

DROP TRIGGER IF EXISTS settings_scoped_bump_row_version ON public.settings_scoped;
CREATE TRIGGER settings_scoped_bump_row_version BEFORE UPDATE ON public.settings_scoped
  FOR EACH ROW EXECUTE FUNCTION public.preserve_or_bump_row_version();

GRANT SELECT ON public.settings_scoped TO authenticated;
GRANT ALL ON public.settings_scoped TO service_role;

ALTER TABLE public.settings_scoped ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settings_scoped_read ON public.settings_scoped;
CREATE POLICY settings_scoped_read ON public.settings_scoped
  FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS settings_scoped_touch ON public.settings_scoped;
CREATE TRIGGER settings_scoped_touch BEFORE UPDATE ON public.settings_scoped
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.settings_cluster_of(_scope text, _scope_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _scope = 'CLUSTER' THEN _scope_id
    WHEN _scope = 'BRANCH' THEN COALESCE(NULLIF((SELECT group_id FROM public.stores WHERE id = _scope_id), ''), 'default')
    ELSE ''
  END
$$;

CREATE OR REPLACE FUNCTION public.settings_effective(_scope text, _scope_id text)
RETURNS TABLE(setting_key text, effective_value jsonb, source text, is_overridden boolean, parent_inherited_value jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cluster text := public.settings_cluster_of(_scope, _scope_id);
BEGIN
  RETURN QUERY
  WITH keys AS (
    SELECT DISTINCT s.key FROM public.settings_scoped s
    WHERE s.is_overridden
      AND (
        (s.scope = 'GLOBAL')
        OR (_scope <> 'GLOBAL' AND s.scope = 'CLUSTER' AND s.scope_id = v_cluster)
        OR (_scope = 'BRANCH' AND s.scope = 'BRANCH' AND s.scope_id = _scope_id)
      )
  ), vals AS (
    SELECT k.key,
      (SELECT s.value FROM public.settings_scoped s
        WHERE s.scope = 'GLOBAL' AND s.scope_id = '' AND s.key = k.key AND s.is_overridden) AS g,
      (SELECT s.value FROM public.settings_scoped s
        WHERE s.scope = 'CLUSTER' AND s.scope_id = v_cluster AND s.key = k.key AND s.is_overridden) AS c,
      (SELECT s.value FROM public.settings_scoped s
        WHERE s.scope = 'BRANCH' AND s.scope_id = _scope_id AND s.key = k.key AND s.is_overridden) AS b
    FROM keys k
  )
  SELECT
    v.key,
    CASE _scope WHEN 'GLOBAL' THEN v.g WHEN 'CLUSTER' THEN COALESCE(v.c, v.g) ELSE COALESCE(v.b, v.c, v.g) END,
    CASE
      WHEN _scope = 'BRANCH' AND v.b IS NOT NULL THEN 'BRANCH'
      WHEN _scope <> 'GLOBAL' AND v.c IS NOT NULL THEN 'CLUSTER'
      ELSE 'GLOBAL'
    END,
    CASE _scope WHEN 'GLOBAL' THEN v.g IS NOT NULL WHEN 'CLUSTER' THEN v.c IS NOT NULL ELSE v.b IS NOT NULL END,
    CASE _scope WHEN 'GLOBAL' THEN NULL::jsonb WHEN 'CLUSTER' THEN v.g ELSE COALESCE(v.c, v.g) END
  FROM vals v;
END;
$$;

CREATE OR REPLACE FUNCTION public.settings_upsert(_scope text, _scope_id text, _patch jsonb)
RETURNS TABLE(setting_key text, effective_value jsonb, source text, is_overridden boolean, parent_inherited_value jsonb)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_actor text := COALESCE(auth.uid()::text, 'system');
BEGIN
  IF NOT public.is_supervisor_now() THEN
    RAISE EXCEPTION 'Not allowed to change settings';
  END IF;
  IF _scope NOT IN ('GLOBAL','CLUSTER','BRANCH') THEN
    RAISE EXCEPTION 'Unknown settings scope %', _scope;
  END IF;

  FOR rec IN SELECT * FROM jsonb_each(COALESCE(_patch, '{}'::jsonb)) LOOP
    IF COALESCE((rec.value->>'is_overridden')::boolean, false) OR _scope = 'GLOBAL' THEN
      INSERT INTO public.settings_scoped(scope, scope_id, key, value, is_overridden, updated_by)
      VALUES (_scope, COALESCE(_scope_id, ''), rec.key, rec.value->'value', true, v_actor)
      ON CONFLICT (scope, scope_id, key)
      DO UPDATE SET value = EXCLUDED.value, is_overridden = true,
                    updated_by = EXCLUDED.updated_by, updated_at = now();
    ELSE
      DELETE FROM public.settings_scoped s
      WHERE s.scope = _scope AND s.scope_id = COALESCE(_scope_id, '') AND s.key = rec.key;
    END IF;
  END LOOP;

  RETURN QUERY SELECT * FROM public.settings_effective(_scope, _scope_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.settings_sync_batch(_scope text, _scope_id text, _keys text[])
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_targets int := 0;
  v_written int := 0;
  v_detail jsonb := '[]'::jsonb;
  v_actor text := COALESCE(auth.uid()::text, 'system');
  store record;
  n int;
BEGIN
  IF NOT public.is_supervisor_now() THEN
    RAISE EXCEPTION 'Not allowed to push settings';
  END IF;

  FOR store IN
    SELECT st.id, st.name FROM public.stores st
    WHERE st.archived_at IS NULL
      AND (_scope = 'GLOBAL' OR COALESCE(NULLIF(st.group_id, ''), 'default') = _scope_id)
  LOOP
    v_targets := v_targets + 1;
    n := 0;
    INSERT INTO public.settings_scoped(scope, scope_id, key, value, is_overridden, updated_by)
    SELECT 'BRANCH', store.id, e.setting_key, e.effective_value, true, v_actor
    FROM public.settings_effective(_scope, _scope_id) e
    WHERE (_keys IS NULL OR e.setting_key = ANY(_keys))
      AND e.effective_value IS NOT NULL
    ON CONFLICT (scope, scope_id, key)
    DO UPDATE SET value = EXCLUDED.value, is_overridden = true,
                  updated_by = EXCLUDED.updated_by, updated_at = now();
    GET DIAGNOSTICS n = ROW_COUNT;
    v_written := v_written + n;
    v_detail := v_detail || jsonb_build_object('store_id', store.id, 'store_name', store.name, 'written', n);
  END LOOP;

  RETURN jsonb_build_object('targets', v_targets, 'written', v_written, 'detail', v_detail);
END;
$$;

REVOKE ALL ON FUNCTION public.settings_effective(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settings_upsert(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settings_sync_batch(text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settings_cluster_of(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settings_effective(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settings_upsert(text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settings_sync_batch(text, text, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settings_cluster_of(text, text) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- Stock count drafts
-- (source: 20260828090357_89f057c3-3a2b-45f7-9518-e005aa688bdb.sql)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_count_drafts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id TEXT,
  terminal_id TEXT,
  staff_id TEXT,
  staff_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  reason TEXT,
  note TEXT NOT NULL DEFAULT '',
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  line_count INTEGER NOT NULL DEFAULT 0,
  total_impact NUMERIC(18,4) NOT NULL DEFAULT 0,
  posted_at TIMESTAMPTZ,
  posted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_count_drafts TO authenticated;
GRANT ALL ON public.stock_count_drafts TO service_role;

ALTER TABLE public.stock_count_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Branch staff read stock count drafts" ON public.stock_count_drafts;
CREATE POLICY "Branch staff read stock count drafts"
  ON public.stock_count_drafts FOR SELECT TO authenticated
  USING ((SELECT public.is_staff_now()) AND public.store_visible(store_id));

DROP POLICY IF EXISTS "Branch staff create stock count drafts" ON public.stock_count_drafts;
CREATE POLICY "Branch staff create stock count drafts"
  ON public.stock_count_drafts FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_staff_now()) AND public.store_visible(store_id));

DROP POLICY IF EXISTS "Branch staff update stock count drafts" ON public.stock_count_drafts;
CREATE POLICY "Branch staff update stock count drafts"
  ON public.stock_count_drafts FOR UPDATE TO authenticated
  USING ((SELECT public.is_staff_now()) AND public.store_visible(store_id))
  WITH CHECK ((SELECT public.is_staff_now()) AND public.store_visible(store_id));

DROP POLICY IF EXISTS "Branch staff delete stock count drafts" ON public.stock_count_drafts;
CREATE POLICY "Branch staff delete stock count drafts"
  ON public.stock_count_drafts FOR DELETE TO authenticated
  USING ((SELECT public.is_staff_now()) AND public.store_visible(store_id));

CREATE INDEX IF NOT EXISTS stock_count_drafts_store_idx
  ON public.stock_count_drafts (store_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS update_stock_count_drafts_updated_at ON public.stock_count_drafts;
CREATE TRIGGER update_stock_count_drafts_updated_at
  BEFORE UPDATE ON public.stock_count_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS draft_id UUID;

-- ------------------------------------------------------------------
-- Stock count drafts - grants
-- (source: 20260828090501_1e424b90-075f-4afc-909a-418d7f7263fb.sql)
-- ------------------------------------------------------------------
ALTER TABLE public.stock_count_drafts
  ALTER COLUMN lines TYPE TEXT USING lines::text;

ALTER TABLE public.stock_count_drafts
  ALTER COLUMN lines SET DEFAULT '[]';

-- ------------------------------------------------------------------
-- Stock count drafts - extra columns
-- (source: 20260828093906_fcd4c105-7f29-4b40-bd7e-094c5efb3b8d.sql)
-- ------------------------------------------------------------------
ALTER TABLE public.stock_count_drafts ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE public.stock_count_drafts ADD COLUMN IF NOT EXISTS store_code text;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.stock_count_drafts
  WHERE reference IS NULL
)
UPDATE public.stock_count_drafts d
SET reference = 'SO-LEGACY-' || lpad(n.rn::text, 4, '0')
FROM numbered n
WHERE d.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS stock_count_drafts_reference_uidx
  ON public.stock_count_drafts (reference) WHERE reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS stock_count_drafts_store_status_idx
  ON public.stock_count_drafts (store_id, status, created_at DESC);

-- ------------------------------------------------------------------
-- Authorisation framework (actions, requests, log, PIN)
-- (source: 20260828111638_4419bb54-6603-4392-a576-79ebd3335799.sql)
-- ------------------------------------------------------------------
-- ===========================================================================
-- Authorisation framework: per-user PINs, configurable sensitive actions,
-- approval requests and one consistent authorisation log.
-- ===========================================================================

-- --------------------------------------------------------------- PIN audit
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS pin_set_at timestamptz;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS pin_updated_by text;

-- ------------------------------------------------------- authorization_actions
CREATE TABLE IF NOT EXISTS public.authorization_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action_key text NOT NULL,
  scope_type text NOT NULL DEFAULT 'global',
  scope_id text NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT 'none',
  allowed_roles text[] NOT NULL DEFAULT ARRAY['admin','manager']::text[],
  allowed_user_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  requester_roles text[] NOT NULL DEFAULT ARRAY['cashier','staff','manager','admin']::text[],
  requester_user_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  authority_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  extra_authority jsonb NOT NULL DEFAULT '{}'::jsonb,
  absolute_ceilings jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_timeout_minutes integer NOT NULL DEFAULT 15,
  escalation_after_minutes integer,
  escalation_roles text[] NOT NULL DEFAULT ARRAY[]::text[],
  require_reason boolean NOT NULL DEFAULT false,
  threshold numeric,
  is_enabled boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.authorization_actions ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.authorization_actions ADD COLUMN IF NOT EXISTS updated_by text;

CREATE UNIQUE INDEX IF NOT EXISTS authorization_actions_scope_uidx
  ON public.authorization_actions (action_key, scope_type, scope_id);

REVOKE ALL ON public.authorization_actions FROM anon, authenticated;
GRANT SELECT ON public.authorization_actions TO authenticated;
GRANT ALL ON public.authorization_actions TO service_role;
ALTER TABLE public.authorization_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read authorisation rules" ON public.authorization_actions;
CREATE POLICY "Staff read authorisation rules"
  ON public.authorization_actions FOR SELECT TO authenticated
  USING (scope_id = '' OR public.store_visible(scope_id));

-- Every rule revision is immutable evidence. Electron writes this in the
-- same local SQL transaction as the rule and Change Tracking uploads both.
CREATE TABLE IF NOT EXISTS public.authorization_action_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action_id uuid NOT NULL,
  action_key text NOT NULL,
  scope_type text NOT NULL,
  scope_id text NOT NULL DEFAULT '',
  row_version integer NOT NULL,
  changed_by text NOT NULL,
  change_source text NOT NULL,
  change_kind text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS authorization_action_history_action_idx
  ON public.authorization_action_history(action_id, row_version DESC);
REVOKE ALL ON public.authorization_action_history FROM anon, authenticated;
GRANT SELECT ON public.authorization_action_history TO authenticated;
GRANT ALL ON public.authorization_action_history TO service_role;
ALTER TABLE public.authorization_action_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read authorisation rule history" ON public.authorization_action_history;
CREATE POLICY "Staff read authorisation rule history"
  ON public.authorization_action_history FOR SELECT TO authenticated
  USING (scope_id = '' OR public.store_visible(scope_id));

CREATE OR REPLACE FUNCTION public.authorization_action_history_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  RAISE EXCEPTION 'authorization_action_history is insert-only';
END $$;
DROP TRIGGER IF EXISTS authorization_action_history_no_change ON public.authorization_action_history;
CREATE TRIGGER authorization_action_history_no_change
  BEFORE UPDATE OR DELETE ON public.authorization_action_history
  FOR EACH ROW EXECUTE FUNCTION public.authorization_action_history_immutable();

CREATE OR REPLACE FUNCTION public.authorization_rule_save(
  p_rule jsonb,
  p_expected_version integer,
  p_changed_by text,
  p_change_source text DEFAULT 'web'
) RETURNS SETOF public.authorization_actions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  current_row public.authorization_actions%rowtype;
  saved_row public.authorization_actions%rowtype;
  next_version integer;
BEGIN
  SELECT * INTO current_row
  FROM public.authorization_actions
  WHERE action_key=p_rule->>'action_key'
    AND scope_type=p_rule->>'scope_type'
    AND scope_id=COALESCE(p_rule->>'scope_id','')
  FOR UPDATE;

  IF FOUND AND current_row.row_version <> COALESCE(p_expected_version,0) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='This authorization rule changed on another device. Reload it before saving.';
  ELSIF NOT FOUND AND COALESCE(p_expected_version,0) <> 0 THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='This authorization rule changed on another device. Reload it before saving.';
  END IF;
  next_version := COALESCE(current_row.row_version,0)+1;

  INSERT INTO public.authorization_actions AS target
    (action_key,scope_type,scope_id,mode,allowed_roles,allowed_user_ids,requester_roles,requester_user_ids,authority_limits,extra_authority,absolute_ceilings,approval_timeout_minutes,escalation_after_minutes,escalation_roles,require_reason,threshold,is_enabled,row_version,updated_by,updated_at)
  VALUES
    (p_rule->>'action_key',p_rule->>'scope_type',COALESCE(p_rule->>'scope_id',''),p_rule->>'mode',
     ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_rule->'allowed_roles','[]'::jsonb))),
     ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_rule->'allowed_user_ids','[]'::jsonb))),
     ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_rule->'requester_roles','[]'::jsonb))),
     ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_rule->'requester_user_ids','[]'::jsonb))),
     COALESCE(p_rule->'authority_limits','{}'::jsonb),COALESCE(p_rule->'extra_authority','{}'::jsonb),COALESCE(p_rule->'absolute_ceilings','{}'::jsonb),
     COALESCE((p_rule->>'approval_timeout_minutes')::integer,15),(p_rule->>'escalation_after_minutes')::integer,
     ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_rule->'escalation_roles','[]'::jsonb))),
     COALESCE((p_rule->>'require_reason')::boolean,false),(p_rule->>'threshold')::numeric,
     COALESCE((p_rule->>'is_enabled')::boolean,true),next_version,p_changed_by,now())
  ON CONFLICT (action_key,scope_type,scope_id) DO UPDATE SET
    mode=EXCLUDED.mode,allowed_roles=EXCLUDED.allowed_roles,allowed_user_ids=EXCLUDED.allowed_user_ids,
    requester_roles=EXCLUDED.requester_roles,requester_user_ids=EXCLUDED.requester_user_ids,
    authority_limits=EXCLUDED.authority_limits,extra_authority=EXCLUDED.extra_authority,absolute_ceilings=EXCLUDED.absolute_ceilings,
    approval_timeout_minutes=EXCLUDED.approval_timeout_minutes,escalation_after_minutes=EXCLUDED.escalation_after_minutes,
    escalation_roles=EXCLUDED.escalation_roles,require_reason=EXCLUDED.require_reason,threshold=EXCLUDED.threshold,
    is_enabled=EXCLUDED.is_enabled,row_version=EXCLUDED.row_version,updated_by=EXCLUDED.updated_by,updated_at=now()
  RETURNING * INTO saved_row;

  INSERT INTO public.authorization_action_history(action_id,action_key,scope_type,scope_id,row_version,changed_by,change_source,change_kind,snapshot)
  VALUES(saved_row.id,saved_row.action_key,saved_row.scope_type,saved_row.scope_id,saved_row.row_version,p_changed_by,p_change_source,
    CASE WHEN current_row.id IS NULL THEN 'created' ELSE 'updated' END,to_jsonb(saved_row));
  RETURN NEXT saved_row;
END $$;
REVOKE ALL ON FUNCTION public.authorization_rule_save(jsonb,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorization_rule_save(jsonb,integer,text,text) TO service_role;

-- ------------------------------------------------------ authorization_requests
CREATE TABLE IF NOT EXISTS public.authorization_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action_key text NOT NULL,
  requested_by text NOT NULL,
  requested_by_name text NOT NULL DEFAULT '',
  store_id text NOT NULL DEFAULT '',
  terminal_id text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  decided_by text,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  consumed_at timestamptz,
  requester_direct_limit numeric,
  value_unit text NOT NULL DEFAULT 'number',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.authorization_requests
  ADD COLUMN IF NOT EXISTS approval_route jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.authorization_requests.approval_route IS
  'Immutable-at-creation snapshot of primary/escalation approvers and rule routing settings.';

CREATE INDEX IF NOT EXISTS authorization_requests_status_idx
  ON public.authorization_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS authorization_requests_store_idx
  ON public.authorization_requests (store_id, created_at DESC);

REVOKE ALL ON public.authorization_requests FROM anon, authenticated;
GRANT SELECT ON public.authorization_requests TO authenticated;
GRANT ALL ON public.authorization_requests TO service_role;
ALTER TABLE public.authorization_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read authorisation requests" ON public.authorization_requests;
CREATE POLICY "Staff read authorisation requests"
  ON public.authorization_requests FOR SELECT TO authenticated
  USING (store_id = '' OR public.store_visible(store_id));

-- ---------------------------------------------------------- authorization_log
CREATE TABLE IF NOT EXISTS public.authorization_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action_key text NOT NULL,
  mode_used text NOT NULL,
  request_id uuid,
  requested_by text,
  authorized_by text,
  authorizer_role text,
  store_id text NOT NULL DEFAULT '',
  terminal_id text NOT NULL DEFAULT '',
  outcome text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS authorization_log_created_idx
  ON public.authorization_log (created_at DESC);
CREATE INDEX IF NOT EXISTS authorization_log_action_idx
  ON public.authorization_log (action_key, created_at DESC);

REVOKE ALL ON public.authorization_log FROM anon, authenticated;
GRANT SELECT ON public.authorization_log TO authenticated;
GRANT ALL ON public.authorization_log TO service_role;
ALTER TABLE public.authorization_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read authorisation log" ON public.authorization_log;
CREATE POLICY "Staff read authorisation log"
  ON public.authorization_log FOR SELECT TO authenticated
  USING (store_id = '' OR public.store_visible(store_id));

-- The log is evidence: it may never be edited or erased from the app.
CREATE OR REPLACE FUNCTION public.authorization_log_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  RAISE EXCEPTION 'authorization_log is insert-only';
END $$;

DROP TRIGGER IF EXISTS authorization_log_no_change ON public.authorization_log;
CREATE TRIGGER authorization_log_no_change
  BEFORE UPDATE OR DELETE ON public.authorization_log
  FOR EACH ROW EXECUTE FUNCTION public.authorization_log_immutable();

-- --------------------------------------------------------------- timestamps
DROP TRIGGER IF EXISTS authorization_actions_touch ON public.authorization_actions;
CREATE TRIGGER authorization_actions_touch
  BEFORE UPDATE ON public.authorization_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS authorization_requests_touch ON public.authorization_requests;
CREATE TRIGGER authorization_requests_touch
  BEFORE UPDATE ON public.authorization_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------- PIN checking
-- Verifies a PIN against the people a rule allows. The PIN is compared inside
-- the database and never returned; nothing comes back on any failure.
CREATE OR REPLACE FUNCTION public.authorization_verify_pin(
  p_user_id text,
  p_pin text,
  p_allowed_roles text[] DEFAULT ARRAY['admin','manager']::text[],
  p_allowed_users text[] DEFAULT ARRAY[]::text[]
)
RETURNS TABLE(user_id text, full_name text, role app_role)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions' AS $$
DECLARE u public.app_users%rowtype;
BEGIN
  SELECT * INTO u FROM public.app_users a
   WHERE lower(a.user_id) = lower(btrim(p_user_id)) AND a.is_active;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT (
      u.role::text = ANY (COALESCE(p_allowed_roles, ARRAY[]::text[]))
      OR lower(u.user_id) = ANY (
           SELECT lower(x) FROM unnest(COALESCE(p_allowed_users, ARRAY[]::text[])) AS x)
  ) THEN
    RETURN;
  END IF;

  IF COALESCE(u.pin_hash, '') = ''
     OR u.pin_hash <> extensions.crypt(p_pin::text, u.pin_hash::text) THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT u.user_id::text, u.full_name::text, u.role;
END $$;

-- Lets an administrator's own PIN be set for authorisation use.
CREATE OR REPLACE FUNCTION public.set_authorization_pin(
  p_user_id text,
  p_pin text,
  p_updated_by text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions' AS $$
BEGIN
  PERFORM public.assert_supervisor_caller();
  IF p_pin !~ '^[0-9]{4,8}$' THEN
    RAISE EXCEPTION 'A PIN must be 4 to 8 digits';
  END IF;
  UPDATE public.app_users
     SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
         pin_length = length(p_pin),
         pin_set_at = now(),
         pin_updated_by = p_updated_by,
         updated_at = now()
   WHERE lower(user_id) = lower(btrim(p_user_id));
  RETURN FOUND;
END $$;

-- Elevated routines are never reachable by a visitor.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'set_authorization_pin'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.authorization_verify_pin(text, text, text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorization_verify_pin(text, text, text[], text[])
  TO service_role;
REVOKE ALL ON FUNCTION public.verify_manager_pin(text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_manager_pin(text, text, text, text, text, text, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.set_authorization_pin(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_authorization_pin(text, text, text)
  TO service_role;

-- ------------------------------------------- starting rules from the old switches
INSERT INTO public.authorization_actions (action_key, scope_type, scope_id, mode, require_reason)
VALUES
  ('refund',                'global', '', 'pin',  true),
  ('void_cart',             'global', '', 'pin',  false),
  ('void_line',             'global', '', 'none', false),
  ('reduce_qty',            'global', '', 'none', false),
  ('manual_discount',       'global', '', 'pin',  false),
  ('discount_over_limit',   'global', '', 'pin',  true),
  ('price_override',        'global', '', 'pin',  true),
  ('below_cost_sale',       'global', '', 'pin',  true),
  ('tax_exemption',         'global', '', 'pin',  true),
  ('no_sale_drawer',        'global', '', 'pin',  true),
  ('stock_adjustment',      'global', '', 'pin',  false),
  ('stock_transfer',        'global', '', 'request', true),
  ('shift_close',           'global', '', 'none', false),
  ('shift_close_variance',  'global', '', 'pin',  true),
  ('edit_tenders',          'global', '', 'none', false),
  ('terminal_unpair',       'global', '', 'pin',  true),
  ('edit_posted_stock',     'global', '', 'either', true),
  ('edit_posted_purchase',  'global', '', 'either', true),
  ('discard_draft',         'global', '', 'none', true),
  ('delete_product',        'global', '', 'pin',  true),
  ('member_points_adjust',  'global', '', 'pin',  true)
ON CONFLICT (action_key, scope_type, scope_id) DO NOTHING;

-- ------------------------------------------------------------------
-- Record edits (post-approval edit trail)
-- (source: 20260828113801_613be733-0854-4b88-8678-0c27051632b5.sql)
-- ------------------------------------------------------------------
ALTER TABLE public.stock_count_drafts
  ADD COLUMN IF NOT EXISTS pending_edit_request_id uuid,
  ADD COLUMN IF NOT EXISTS pending_edit_by text,
  ADD COLUMN IF NOT EXISTS pending_edit_at timestamptz;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS pending_edit_request_id uuid,
  ADD COLUMN IF NOT EXISTS pending_edit_by text,
  ADD COLUMN IF NOT EXISTS pending_edit_at timestamptz;

CREATE TABLE IF NOT EXISTS public.record_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type text NOT NULL,
  record_id text NOT NULL,
  reference text,
  store_id text,
  terminal_id text,
  action_key text NOT NULL,
  request_id uuid,
  edited_by text,
  edited_by_name text,
  authorized_by text,
  authorized_by_name text,
  mode_used text,
  before_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  stock_deltas jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.record_edits TO authenticated;
GRANT ALL ON public.record_edits TO service_role;

ALTER TABLE public.record_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read record edits" ON public.record_edits;
CREATE POLICY "Staff read record edits" ON public.record_edits
  FOR SELECT TO authenticated USING (public.is_staff_now());

DROP POLICY IF EXISTS "Staff write record edits" ON public.record_edits;
CREATE POLICY "Staff write record edits" ON public.record_edits
  FOR INSERT TO authenticated WITH CHECK (public.is_staff_now());

CREATE INDEX IF NOT EXISTS record_edits_record_idx
  ON public.record_edits (record_type, record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS record_edits_store_idx
  ON public.record_edits (store_id, created_at DESC);

-- ------------------------------------------------------------------
-- Secure shift closing: cash counts, close events, reconciliations, alerts
-- (source: 20260901103118_1ec67acd-e0ee-400d-8e64-ce1f81b57169.sql)
-- ------------------------------------------------------------------
-- ============================================================
-- Secure shift closing — Stage 1: authoritative state & audit
-- ============================================================

/* ---------- 1. shifts: closing state ---------- */
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS close_reason text,
  ADD COLUMN IF NOT EXISTS closing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS closing_started_by text,
  ADD COLUMN IF NOT EXISTS final_counted_cash numeric,
  ADD COLUMN IF NOT EXISTS variance_status text;

DO $$ BEGIN
  ALTER TABLE public.shifts ADD CONSTRAINT shifts_state_chk CHECK (state IN
    ('ACTIVE','CLOSING_STARTED','CASH_COUNT_REQUIRED','CASH_COUNT_SUBMITTED',
     'RECONCILIATION','VARIANCE_REVIEW_REQUIRED','CLOSED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.shifts SET state = CASE WHEN status = 'CLOSED' THEN 'CLOSED' ELSE 'ACTIVE' END
 WHERE state IS DISTINCT FROM (CASE WHEN status = 'CLOSED' THEN 'CLOSED' ELSE 'ACTIVE' END);

/* ---------- 2. immutable cash counts ---------- */
CREATE TABLE IF NOT EXISTS public.shift_cash_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  store_id text NOT NULL,
  terminal_id text,
  kind text NOT NULL DEFAULT 'ORIGINAL',
  counted_cash numeric NOT NULL,
  counted_card numeric,
  counted_digital numeric,
  reason text,
  counted_by_name text,
  counted_by_staff_id text,
  counted_by_user_id uuid,
  client_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_cash_counts_kind_chk CHECK (kind IN ('ORIGINAL','RECOUNT'))
);
CREATE UNIQUE INDEX IF NOT EXISTS shift_cash_counts_original_uidx
  ON public.shift_cash_counts (shift_id) WHERE kind = 'ORIGINAL';
CREATE UNIQUE INDEX IF NOT EXISTS shift_cash_counts_client_key_uidx
  ON public.shift_cash_counts (client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS shift_cash_counts_shift_idx ON public.shift_cash_counts (shift_id, created_at);

GRANT SELECT ON public.shift_cash_counts TO authenticated;
GRANT ALL ON public.shift_cash_counts TO service_role;
ALTER TABLE public.shift_cash_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read shift cash counts" ON public.shift_cash_counts;
CREATE POLICY "Staff read shift cash counts" ON public.shift_cash_counts
  FOR SELECT TO authenticated
  USING (public.is_staff_now() AND public.store_visible(store_id));

/* ---------- 3. append-only closing audit ---------- */
CREATE TABLE IF NOT EXISTS public.shift_close_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  store_id text NOT NULL,
  terminal_id text,
  event text NOT NULL,
  from_state text,
  to_state text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_name text,
  actor_staff_id text,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_close_events_shift_idx ON public.shift_close_events (shift_id, created_at);

GRANT SELECT ON public.shift_close_events TO authenticated;
GRANT ALL ON public.shift_close_events TO service_role;
ALTER TABLE public.shift_close_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read shift close events" ON public.shift_close_events;
CREATE POLICY "Staff read shift close events" ON public.shift_close_events
  FOR SELECT TO authenticated
  USING (public.is_staff_now() AND public.store_visible(store_id));

/* ---------- 4. private reconciliation (expected cash / variance) ---------- */
CREATE TABLE IF NOT EXISTS public.shift_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  store_id text NOT NULL,
  count_id uuid REFERENCES public.shift_cash_counts(id) ON DELETE SET NULL,
  expected_cash numeric NOT NULL DEFAULT 0,
  expected_card numeric NOT NULL DEFAULT 0,
  expected_digital numeric NOT NULL DEFAULT 0,
  counted_cash numeric,
  counted_card numeric,
  counted_digital numeric,
  variance_cash numeric,
  variance_card numeric,
  variance_digital numeric,
  variance_total numeric,
  variance_status text NOT NULL DEFAULT 'NO_VARIANCE',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_reconciliations_shift_idx ON public.shift_reconciliations (shift_id, created_at);

GRANT SELECT ON public.shift_reconciliations TO authenticated;
GRANT ALL ON public.shift_reconciliations TO service_role;
ALTER TABLE public.shift_reconciliations ENABLE ROW LEVEL SECURITY;

-- Only staff explicitly granted the variance permission may read expected cash.
DROP POLICY IF EXISTS "Variance viewers read reconciliations" ON public.shift_reconciliations;
CREATE POLICY "Variance viewers read reconciliations" ON public.shift_reconciliations
  FOR SELECT TO authenticated
  USING (public.has_perm('can_shift_variance_view') AND public.store_visible(store_id));

/* ---------- 5. variance alerts ---------- */
CREATE TABLE IF NOT EXISTS public.shift_variance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  store_id text NOT NULL,
  reconciliation_id uuid REFERENCES public.shift_reconciliations(id) ON DELETE SET NULL,
  variance_total numeric NOT NULL,
  variance_status text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  delivery_status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  last_attempt_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DO $do$ BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_index ix
      JOIN pg_class idx ON idx.oid = ix.indexrelid
      JOIN pg_namespace ns ON ns.oid = idx.relnamespace
     WHERE ns.nspname = 'public'
       AND idx.relname = 'shift_variance_alerts_recon_uidx'
       AND ix.indpred IS NOT NULL
  ) THEN
    DROP INDEX public.shift_variance_alerts_recon_uidx;
  END IF;
END $do$;
CREATE UNIQUE INDEX IF NOT EXISTS shift_variance_alerts_recon_uidx
  ON public.shift_variance_alerts (reconciliation_id);

GRANT SELECT, UPDATE ON public.shift_variance_alerts TO authenticated;
GRANT ALL ON public.shift_variance_alerts TO service_role;
ALTER TABLE public.shift_variance_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Variance viewers read alerts" ON public.shift_variance_alerts;
CREATE POLICY "Variance viewers read alerts" ON public.shift_variance_alerts
  FOR SELECT TO authenticated
  USING (public.has_perm('can_shift_variance_view') AND public.store_visible(store_id));

DROP POLICY IF EXISTS "Variance viewers update alert delivery" ON public.shift_variance_alerts;
CREATE POLICY "Variance viewers update alert delivery" ON public.shift_variance_alerts
  FOR UPDATE TO authenticated
  USING (public.has_perm('can_shift_variance_view') AND public.store_visible(store_id))
  WITH CHECK (public.has_perm('can_shift_variance_view') AND public.store_visible(store_id));

/* ---------- 5b. day-end shift summaries ---------- */
CREATE TABLE IF NOT EXISTS public.shift_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  store_id text NOT NULL,
  store_name text NOT NULL DEFAULT '',
  terminal_name text NOT NULL DEFAULT '',
  closed_by text NOT NULL DEFAULT '',
  opened_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL,
  total_sales numeric NOT NULL DEFAULT 0,
  transactions integer NOT NULL DEFAULT 0,
  discounts numeric NOT NULL DEFAULT 0,
  refunds numeric NOT NULL DEFAULT 0,
  expected_cash numeric NOT NULL DEFAULT 0,
  counted_cash numeric NOT NULL DEFAULT 0,
  payment_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL DEFAULT '',
  channels text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_notifications_shift_key UNIQUE (shift_id)
);

CREATE INDEX IF NOT EXISTS shift_notifications_store_closed_idx
  ON public.shift_notifications (store_id, closed_at DESC);

ALTER TABLE public.shift_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_notifications FROM anon;
GRANT SELECT, INSERT ON public.shift_notifications TO authenticated;
GRANT ALL ON public.shift_notifications TO service_role;

-- Close anonymous table access. Public coupon/member/terminal flows use the
-- narrow SECURITY DEFINER routines granted above; visitors only need the
-- feature flags and live campaign rows themselves.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
GRANT SELECT ON TABLE public.public_flags TO anon;
GRANT SELECT ON TABLE public.coupon_campaigns TO anon;

-- Remove legacy allow-all policies that bypass the staff and branch policies
-- installed earlier in this canonical schema.
DROP POLICY IF EXISTS "Public access" ON public.audit_logs;
DROP POLICY IF EXISTS "Public access" ON public.members;
DROP POLICY IF EXISTS "Public access" ON public.membership_tiers;
DROP POLICY IF EXISTS "Public access" ON public.pos_settings;
DROP POLICY IF EXISTS "Public access" ON public.products;
DROP POLICY IF EXISTS "Public access" ON public.promotions;
DROP POLICY IF EXISTS "Public access" ON public.purchase_order_items;
DROP POLICY IF EXISTS "Public access" ON public.purchase_orders;

-- Public voucher pages resolve one opaque token through voucher_by_token().
-- They must never be able to enumerate the voucher table.
DROP POLICY IF EXISTS "vouchers readable" ON public.issued_vouchers;
DROP POLICY IF EXISTS "campaigns readable" ON public.coupon_campaigns;
DROP POLICY IF EXISTS "payment_types_read" ON public.payment_types;
DROP POLICY IF EXISTS "product_barcodes_read" ON public.product_barcodes;
DROP POLICY IF EXISTS "settings_locks_read" ON public.settings_locks;
DROP POLICY IF EXISTS "settings_overrides_read" ON public.settings_overrides;

-- Signed-in staff still need read access to effective settings. Writes remain
-- governed by the supervisor/private-scope policies above.
CREATE POLICY "settings_locks_read" ON public.settings_locks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_overrides_read" ON public.settings_overrides
  FOR SELECT TO authenticated USING (true);


DROP POLICY IF EXISTS "Branch staff publish shift summaries" ON public.shift_notifications;
CREATE POLICY "Branch staff publish shift summaries" ON public.shift_notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff_now() AND public.store_visible(store_id));

DROP POLICY IF EXISTS "Variance viewers read shift summaries" ON public.shift_notifications;
CREATE POLICY "Variance viewers read shift summaries" ON public.shift_notifications
  FOR SELECT TO authenticated
  USING (public.has_perm('can_shift_variance_view') AND public.store_visible(store_id));

/* ---------- 6. immutability ---------- */
CREATE OR REPLACE FUNCTION public.shift_records_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('pos.shift_fn', true), '') = 'on' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'Shift closing records are permanent and cannot be % .', lower(TG_OP);
END $$;

DROP TRIGGER IF EXISTS shift_cash_counts_immutable ON public.shift_cash_counts;
CREATE TRIGGER shift_cash_counts_immutable
  BEFORE UPDATE OR DELETE ON public.shift_cash_counts
  FOR EACH ROW EXECUTE FUNCTION public.shift_records_immutable();

DROP TRIGGER IF EXISTS shift_close_events_immutable ON public.shift_close_events;
CREATE TRIGGER shift_close_events_immutable
  BEFORE UPDATE OR DELETE ON public.shift_close_events
  FOR EACH ROW EXECUTE FUNCTION public.shift_records_immutable();

DROP TRIGGER IF EXISTS shift_reconciliations_immutable ON public.shift_reconciliations;
CREATE TRIGGER shift_reconciliations_immutable
  BEFORE UPDATE OR DELETE ON public.shift_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.shift_records_immutable();

/* ---------- 7. clients may not touch financial shift columns ---------- */
CREATE OR REPLACE FUNCTION public.shifts_guard_client_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('pos.shift_fn', true), '') = 'on' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.state              := 'ACTIVE';
    NEW.status             := 'OPEN';
    NEW.closed_at          := NULL;
    NEW.counted_cash       := NULL;
    NEW.counted_card       := NULL;
    NEW.counted_digital    := NULL;
    NEW.final_counted_cash := NULL;
    NEW.expected_cash      := NULL;
    NEW.expected_card      := NULL;
    NEW.expected_digital   := NULL;
    NEW.variance_cash      := NULL;
    NEW.variance_card      := NULL;
    NEW.variance_digital   := NULL;
    NEW.variance_total     := NULL;
    NEW.variance_status    := NULL;
    NEW.close_reason       := NULL;
    NEW.closing_started_at := NULL;
    RETURN NEW;
  END IF;

  -- Updates from a client can only ever touch the housekeeping fields.
  NEW.state              := OLD.state;
  NEW.status             := OLD.status;
  NEW.closed_at          := OLD.closed_at;
  NEW.closed_by_name     := OLD.closed_by_name;
  NEW.closed_by_staff_id := OLD.closed_by_staff_id;
  NEW.closed_by_role     := OLD.closed_by_role;
  NEW.opening_float      := OLD.opening_float;
  NEW.counted_cash       := OLD.counted_cash;
  NEW.counted_card       := OLD.counted_card;
  NEW.counted_digital    := OLD.counted_digital;
  NEW.closing_float      := OLD.closing_float;
  NEW.final_counted_cash := OLD.final_counted_cash;
  NEW.expected_cash      := OLD.expected_cash;
  NEW.expected_card      := OLD.expected_card;
  NEW.expected_digital   := OLD.expected_digital;
  NEW.variance_cash      := OLD.variance_cash;
  NEW.variance_card      := OLD.variance_card;
  NEW.variance_digital   := OLD.variance_digital;
  NEW.variance_total     := OLD.variance_total;
  NEW.variance_status    := OLD.variance_status;
  NEW.close_reason       := OLD.close_reason;
  NEW.closing_started_at := OLD.closing_started_at;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS shifts_guard_client_writes ON public.shifts;
CREATE TRIGGER shifts_guard_client_writes
  BEFORE INSERT OR UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_guard_client_writes();

/* ---------- 8. no trading once closing has started ---------- */
CREATE OR REPLACE FUNCTION public.sales_block_closing_shift()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s_state text;
BEGIN
  IF NEW.shift_id IS NULL OR NEW.shift_id = '' THEN RETURN NEW; END IF;
  BEGIN
    SELECT state INTO s_state FROM public.shifts WHERE id = NEW.shift_id::uuid;
  EXCEPTION WHEN others THEN RETURN NEW; END;
  IF s_state IS NOT NULL AND s_state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'This shift is being closed — no further transactions can be recorded against it.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sales_block_closing_shift ON public.sales;
CREATE TRIGGER sales_block_closing_shift
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.sales_block_closing_shift();

/* ---------- 9. server-side expected cash ---------- */
CREATE OR REPLACE FUNCTION public.shift_expected_totals(p_shift uuid)
RETURNS TABLE (expected_cash numeric, expected_card numeric, expected_digital numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_float numeric := 0;
BEGIN
  SELECT coalesce(opening_float, 0) INTO v_float FROM public.shifts WHERE id = p_shift;
  RETURN QUERY
  WITH paid AS (
    SELECT
      CASE WHEN jsonb_typeof(s.payments) = 'array'
        THEN coalesce((SELECT sum((p ->> 'amount')::numeric) FROM jsonb_array_elements(s.payments) p
                        WHERE lower(coalesce(p ->> 'method','')) = 'cash'), 0)
        WHEN lower(coalesce(s.payment_type,'')) = 'cash' THEN coalesce(s.total_amount, 0) ELSE 0 END AS cash,
      CASE WHEN jsonb_typeof(s.payments) = 'array'
        THEN coalesce((SELECT sum((p ->> 'amount')::numeric) FROM jsonb_array_elements(s.payments) p
                        WHERE lower(coalesce(p ->> 'method','')) = 'card'), 0)
        WHEN lower(coalesce(s.payment_type,'')) = 'card' THEN coalesce(s.total_amount, 0) ELSE 0 END AS card,
      CASE WHEN jsonb_typeof(s.payments) = 'array'
        THEN coalesce((SELECT sum((p ->> 'amount')::numeric) FROM jsonb_array_elements(s.payments) p
                        WHERE lower(coalesce(p ->> 'method','')) IN ('wallet','transfer','qr','online','ewallet')), 0)
        WHEN lower(coalesce(s.payment_type,'')) IN ('wallet','transfer','qr','online','ewallet')
          THEN coalesce(s.total_amount, 0) ELSE 0 END AS digital
    FROM public.sales s
    WHERE s.shift_id = p_shift::text AND coalesce(s.is_refunded, false) = false
  )
  SELECT v_float + coalesce(sum(cash), 0), coalesce(sum(card), 0), coalesce(sum(digital), 0) FROM paid;
END $$;

REVOKE ALL ON FUNCTION public.shift_expected_totals(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_expected_totals(uuid) TO service_role;

-- Permission-gated read for managers.
CREATE OR REPLACE FUNCTION public.shift_expected_view(p_shift uuid)
RETURNS TABLE (expected_cash numeric, expected_card numeric, expected_digital numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_perm('can_shift_expected_cash_view') THEN
    RAISE EXCEPTION 'You do not have permission to view expected cash.';
  END IF;
  RETURN QUERY SELECT * FROM public.shift_expected_totals(p_shift);
END $$;
GRANT EXECUTE ON FUNCTION public.shift_expected_view(uuid) TO authenticated, service_role;

/* ---------- 10. workflow routines ---------- */
CREATE OR REPLACE FUNCTION public.shift_log_event(
  p_shift uuid, p_event text, p_from text, p_to text, p_detail jsonb, p_terminal text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store text; v_me record;
BEGIN
  SELECT store_id INTO v_store FROM public.shifts WHERE id = p_shift;
  SELECT * INTO v_me FROM public.current_app_user();
  PERFORM set_config('pos.shift_fn', 'on', true);
  INSERT INTO public.shift_close_events
    (shift_id, store_id, terminal_id, event, from_state, to_state, detail,
     actor_name, actor_staff_id, actor_user_id)
  VALUES (p_shift, coalesce(v_store,''), p_terminal, p_event, p_from, p_to,
          coalesce(p_detail,'{}'::jsonb), v_me.full_name, v_me.user_id, auth.uid());
  PERFORM set_config('pos.shift_fn', '', true);
END $$;
GRANT EXECUTE ON FUNCTION public.shift_log_event(uuid, text, text, text, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shift_close_start(p_shift uuid, p_reason text, p_terminal text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.shifts%ROWTYPE; v_me record; v_reason text := btrim(coalesce(p_reason,''));
BEGIN
  IF NOT public.has_perm('can_close_shift') THEN
    RAISE EXCEPTION 'You do not have permission to close a shift.';
  END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'A reason for closing this shift is required.'; END IF;

  SELECT * INTO v FROM public.shifts WHERE id = p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That shift no longer exists.'; END IF;
  IF NOT public.store_visible(v.store_id) THEN RAISE EXCEPTION 'That shift belongs to another branch.'; END IF;

  SELECT * INTO v_me FROM public.current_app_user();
  IF (
    (v.opened_by_staff_id IS NOT NULL AND v.opened_by_staff_id::text IS DISTINCT FROM v_me.user_id::text)
    OR (v.terminal_id IS NOT NULL AND v.terminal_id IS DISTINCT FROM p_terminal)
  ) AND NOT public.has_perm('can_manage_other_shifts') THEN
    RAISE EXCEPTION 'You do not have permission to close another employee or terminal shift.';
  END IF;

  IF v.state <> 'ACTIVE' THEN
    -- Already closing: never go backwards, just report where it is.
    RETURN v.state;
  END IF;

  PERFORM set_config('pos.shift_fn', 'on', true);
  UPDATE public.shifts
     SET state = 'CASH_COUNT_REQUIRED',
         close_reason = v_reason,
         closing_started_at = now(),
         closing_started_by = coalesce(v_me.full_name, v.opened_by_name),
         updated_at = now()
   WHERE id = p_shift;
  PERFORM set_config('pos.shift_fn', '', true);

  PERFORM public.shift_log_event(
    p_shift, 'closing_started', 'ACTIVE', 'CASH_COUNT_REQUIRED',
    jsonb_build_object(
      'reason', v_reason,
      'forced', (v.opened_by_staff_id IS NOT NULL AND v.opened_by_staff_id::text IS DISTINCT FROM v_me.user_id::text)
                OR (v.terminal_id IS NOT NULL AND v.terminal_id IS DISTINCT FROM p_terminal),
      'opened_by_staff_id', v.opened_by_staff_id,
      'opened_terminal_id', v.terminal_id
    ),
    p_terminal
  );
  RETURN 'CASH_COUNT_REQUIRED';
END $$;
GRANT EXECUTE ON FUNCTION public.shift_close_start(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shift_reconcile_now(
  p_shift uuid, p_count_id uuid, p_cash numeric, p_card numeric, p_digital numeric)
RETURNS TABLE (state text, variance_status text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v public.shifts%ROWTYPE; e record; v_rec uuid;
  v_var_cash numeric; v_var_card numeric; v_var_digital numeric; v_total numeric;
  v_status text; v_threshold numeric := 0; v_state text;
  v_store_name text; v_cashier text; v_terminal text; v_msg text;
  v_total_sales numeric := 0; v_net_cash_sales numeric := 0;
BEGIN
  SELECT * INTO v FROM public.shifts WHERE id = p_shift;
  SELECT * INTO e FROM public.shift_expected_totals(p_shift);

  v_var_cash    := round(p_cash - e.expected_cash, 2);
  v_var_card    := CASE WHEN p_card IS NULL THEN NULL ELSE round(p_card - e.expected_card, 2) END;
  v_var_digital := CASE WHEN p_digital IS NULL THEN NULL ELSE round(p_digital - e.expected_digital, 2) END;
  v_total       := round(v_var_cash + coalesce(v_var_card,0) + coalesce(v_var_digital,0), 2);

  SELECT coalesce(abs((r ->> 'variance_pin_threshold')::numeric), 0) INTO v_threshold
    FROM public.pos_rules_get() AS r;
  IF v_threshold IS NULL THEN v_threshold := 0; END IF;

  v_status := CASE WHEN abs(v_total) <= 0.005 THEN 'NO_VARIANCE'
                   WHEN v_total > 0 THEN 'OVER' ELSE 'SHORT' END;

  -- The counted amount is final. A difference is recorded and reported, never
  -- a reason to keep the shift open.
  v_state := 'CLOSED';

  PERFORM set_config('pos.shift_fn', 'on', true);
  INSERT INTO public.shift_reconciliations
    (shift_id, store_id, count_id, expected_cash, expected_card, expected_digital,
     counted_cash, counted_card, counted_digital,
     variance_cash, variance_card, variance_digital, variance_total, variance_status)
  VALUES (p_shift, v.store_id, p_count_id, e.expected_cash, e.expected_card, e.expected_digital,
          p_cash, p_card, p_digital, v_var_cash, v_var_card, v_var_digital, v_total, v_status)
  RETURNING id INTO v_rec;

  UPDATE public.shifts
     SET state = v_state,
         status = 'CLOSED',
         closed_at = coalesce(closed_at, now()),
         final_counted_cash = p_cash,
         counted_cash = p_cash,
         closing_float = p_cash,
         counted_card = p_card,
         counted_digital = p_digital,
         variance_status = v_status,
         updated_at = now()
   WHERE id = p_shift;

  IF v_status <> 'NO_VARIANCE' THEN
    SELECT coalesce(nullif(btrim(name), ''), v.store_id) INTO v_store_name
      FROM public.stores WHERE id = v.store_id;
    v_store_name := coalesce(v_store_name, v.store_id, '');
    SELECT coalesce(nullif(btrim(counted_by_name), ''), v.opened_by_name, '')
      INTO v_cashier
      FROM public.shift_cash_counts WHERE id = p_count_id;
    v_cashier := coalesce(v_cashier, v.opened_by_name, '');
    v_terminal := coalesce(nullif(btrim(v.terminal_name), ''), v.terminal_id, '');
    SELECT coalesce(sum(s.total_amount), 0) INTO v_total_sales
      FROM public.sales s
     WHERE s.shift_id = p_shift::text AND coalesce(s.is_refunded, false) = false;
    v_net_cash_sales := round(e.expected_cash - coalesce(v.opening_float, 0), 2);

    INSERT INTO public.shift_variance_alerts
      (shift_id, store_id, reconciliation_id, variance_total, variance_status, severity, message)
    VALUES (p_shift, v.store_id, v_rec, v_total, v_status,
            CASE WHEN abs(v_total) > v_threshold THEN 'critical' ELSE 'warning' END,
            format('Shift at %s closed %s by %s. Cashier %s, terminal %s. Opening %s, sales %s, net cash sales %s, expected cash %s, counted cash %s.',
                   v_store_name, lower(v_status), abs(v_total), v_cashier, v_terminal,
                   to_char(coalesce(v.opening_float, 0), 'FM999999990.00'),
                   to_char(v_total_sales, 'FM999999990.00'),
                   to_char(v_net_cash_sales, 'FM999999990.00'),
                   to_char(e.expected_cash, 'FM999999990.00'), to_char(p_cash, 'FM999999990.00')))
    ON CONFLICT (reconciliation_id) DO NOTHING;

    v_msg := format(
      E'Cashier: %s\nBranch: %s\nTerminal: %s\nShift: %s\nClosed: %s\n\nOpening float: %s\nTotal sales: %s\nNet cash sales: %s\nExpected cash: %s\nCounted cash: %s\nCard expected / counted: %s / %s\nDigital expected / counted: %s / %s\nVariance: %s\n\nType: Cash %s',
      v_cashier, v_store_name, v_terminal,
      p_shift::text, to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ'),
      to_char(coalesce(v.opening_float, 0), 'FM999999990.00'),
      to_char(v_total_sales, 'FM999999990.00'),
      to_char(v_net_cash_sales, 'FM999999990.00'),
      to_char(e.expected_cash, 'FM999999990.00'),
      to_char(p_cash, 'FM999999990.00'),
      to_char(e.expected_card, 'FM999999990.00'), coalesce(to_char(p_card, 'FM999999990.00'), 'not counted'),
      to_char(e.expected_digital, 'FM999999990.00'), coalesce(to_char(p_digital, 'FM999999990.00'), 'not counted'),
      CASE WHEN v_total > 0 THEN '+' ELSE '-' END || to_char(abs(v_total), 'FM999999990.00'),
      CASE WHEN v_total > 0 THEN 'Overage' ELSE 'Shortage' END);

    -- The shared notification feed: one row per shift, so a replay of the
    -- close after an outage can never raise a second alert.
    INSERT INTO public.activity_events
      (event_type, severity, title, message, actor_name, terminal_id, store_id,
       branch_id, entity_type, entity_id, amount, meta, client_event_id, created_at)
    VALUES ('shift_cash_variance',
            CASE WHEN abs(v_total) > v_threshold THEN 'critical' ELSE 'warning' END,
            'Shift cash variance detected', v_msg, nullif(v_cashier, ''),
            nullif(v_terminal, ''), v.store_id, v.store_id, 'shift', p_shift::text, v_total,
            jsonb_build_object('branch_name', v_store_name, 'terminal_name', v_terminal,
                               'opened_at', v.opened_at, 'closed_at', now(),
                               'opening_float', coalesce(v.opening_float, 0),
                               'total_sales', v_total_sales, 'net_cash_sales', v_net_cash_sales,
                               'expected_cash', e.expected_cash, 'counted_cash', p_cash,
                               'expected_card', e.expected_card, 'counted_card', p_card,
                               'expected_digital', e.expected_digital, 'counted_digital', p_digital,
                               'variance_total', v_total, 'variance_status', v_status,
                               'reconciliation_id', v_rec),
            'shift:' || p_shift::text || ':cash_variance', now())
    ON CONFLICT (client_event_id) DO NOTHING;
  END IF;
  PERFORM set_config('pos.shift_fn', '', true);

  PERFORM public.shift_log_event(p_shift, 'reconciled', 'CASH_COUNT_SUBMITTED', v_state,
    jsonb_build_object('variance_status', v_status, 'variance_total', v_total), v.terminal_id);


  RETURN QUERY SELECT v_state, v_status;
END $$;
REVOKE ALL ON FUNCTION public.shift_reconcile_now(uuid, uuid, numeric, numeric, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_reconcile_now(uuid, uuid, numeric, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.shift_cash_count_submit(
  p_shift uuid, p_cash numeric, p_card numeric DEFAULT NULL,
  p_digital numeric DEFAULT NULL, p_client_key text DEFAULT NULL, p_terminal text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.shifts%ROWTYPE; v_me record; v_count uuid; v_res record;
BEGIN
  IF NOT (public.has_perm('can_shift_cash_count') OR public.has_perm('can_close_shift')) THEN
    RAISE EXCEPTION 'You do not have permission to submit a cash count.';
  END IF;
  IF p_cash IS NULL OR p_cash < 0 THEN RAISE EXCEPTION 'Enter the cash counted in the drawer.'; END IF;
  IF p_card IS NOT NULL AND p_card < 0 THEN RAISE EXCEPTION 'The card total counted cannot be negative.'; END IF;
  IF p_digital IS NOT NULL AND p_digital < 0 THEN RAISE EXCEPTION 'The digital total counted cannot be negative.'; END IF;

  SELECT * INTO v FROM public.shifts WHERE id = p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That shift no longer exists.'; END IF;
  IF NOT public.store_visible(v.store_id) THEN RAISE EXCEPTION 'That shift belongs to another branch.'; END IF;
  IF v.state = 'ACTIVE' THEN RAISE EXCEPTION 'Start the closing process before counting the drawer.'; END IF;
  IF v.state NOT IN ('CLOSING_STARTED','CASH_COUNT_REQUIRED') THEN
    RETURN v.state;  -- already counted: never accept a second original count
  END IF;

  SELECT * INTO v_me FROM public.current_app_user();
  PERFORM set_config('pos.shift_fn', 'on', true);
  INSERT INTO public.shift_cash_counts
    (shift_id, store_id, terminal_id, kind, counted_cash, counted_card, counted_digital,
     reason, counted_by_name, counted_by_staff_id, counted_by_user_id, client_key)
  VALUES (p_shift, v.store_id, coalesce(p_terminal, v.terminal_id), 'ORIGINAL',
          round(p_cash, 2), round(p_card, 2), round(p_digital, 2), v.close_reason,
          coalesce(v_me.full_name, v.opened_by_name), v_me.user_id, auth.uid(), p_client_key)
  ON CONFLICT (shift_id) WHERE kind = 'ORIGINAL' DO NOTHING
  RETURNING id INTO v_count;

  UPDATE public.shifts SET state = 'CASH_COUNT_SUBMITTED', updated_at = now() WHERE id = p_shift;
  PERFORM set_config('pos.shift_fn', '', true);

  IF v_count IS NULL THEN
    SELECT id INTO v_count FROM public.shift_cash_counts
      WHERE shift_id = p_shift AND kind = 'ORIGINAL' LIMIT 1;
  END IF;

  PERFORM public.shift_log_event(p_shift, 'cash_count_submitted', 'CASH_COUNT_REQUIRED',
    'CASH_COUNT_SUBMITTED', jsonb_build_object('count_id', v_count), p_terminal);

  SELECT * INTO v_res FROM public.shift_reconcile_now(p_shift, v_count, round(p_cash,2), round(p_card,2), round(p_digital,2));
  RETURN v_res.state;  -- state only: never the variance
END $$;
GRANT EXECUTE ON FUNCTION public.shift_cash_count_submit(uuid, numeric, numeric, numeric, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shift_recount_submit(
  p_shift uuid, p_cash numeric, p_reason text,
  p_card numeric DEFAULT NULL, p_digital numeric DEFAULT NULL, p_terminal text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.shifts%ROWTYPE; v_me record; v_count uuid; v_res record; v_reason text := btrim(coalesce(p_reason,''));
BEGIN
  IF NOT public.has_perm('can_shift_cash_recount') THEN
    RAISE EXCEPTION 'You do not have permission to recount a drawer.';
  END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'A reason for the recount is required.'; END IF;
  IF p_cash IS NULL OR p_cash < 0 THEN RAISE EXCEPTION 'Enter the recounted cash amount.'; END IF;
  IF p_card IS NOT NULL AND p_card < 0 THEN RAISE EXCEPTION 'The card total counted cannot be negative.'; END IF;
  IF p_digital IS NOT NULL AND p_digital < 0 THEN RAISE EXCEPTION 'The digital total counted cannot be negative.'; END IF;

  SELECT * INTO v FROM public.shifts WHERE id = p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That shift no longer exists.'; END IF;
  IF NOT public.store_visible(v.store_id) THEN RAISE EXCEPTION 'That shift belongs to another branch.'; END IF;
  IF v.state NOT IN ('VARIANCE_REVIEW_REQUIRED','RECONCILIATION','CLOSED') THEN
    RAISE EXCEPTION 'This shift has not been counted yet.';
  END IF;

  SELECT * INTO v_me FROM public.current_app_user();
  PERFORM set_config('pos.shift_fn', 'on', true);
  INSERT INTO public.shift_cash_counts
    (shift_id, store_id, terminal_id, kind, counted_cash, counted_card, counted_digital,
     reason, counted_by_name, counted_by_staff_id, counted_by_user_id)
  VALUES (p_shift, v.store_id, coalesce(p_terminal, v.terminal_id), 'RECOUNT',
          round(p_cash,2), round(p_card,2), round(p_digital,2), v_reason,
          v_me.full_name, v_me.user_id, auth.uid())
  RETURNING id INTO v_count;
  PERFORM set_config('pos.shift_fn', '', true);

  PERFORM public.shift_log_event(p_shift, 'recount_submitted', v.state, v.state,
    jsonb_build_object('reason', v_reason, 'count_id', v_count), p_terminal);

  SELECT * INTO v_res FROM public.shift_reconcile_now(p_shift, v_count, round(p_cash,2), round(p_card,2), round(p_digital,2));
  RETURN v_res.state;
END $$;
GRANT EXECUTE ON FUNCTION public.shift_recount_submit(uuid, numeric, text, numeric, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shift_variance_approve(p_shift uuid, p_note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.shifts%ROWTYPE;
BEGIN
  IF NOT public.has_perm('can_shift_variance_approve') THEN
    RAISE EXCEPTION 'You do not have permission to approve a shift variance.';
  END IF;
  SELECT * INTO v FROM public.shifts WHERE id = p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That shift no longer exists.'; END IF;
  IF v.state = 'CLOSED' THEN RETURN 'CLOSED'; END IF;

  PERFORM set_config('pos.shift_fn', 'on', true);
  UPDATE public.shifts
     SET state = 'CLOSED', status = 'CLOSED', closed_at = coalesce(closed_at, now()), updated_at = now()
   WHERE id = p_shift;
  UPDATE public.shift_variance_alerts
     SET acknowledged_at = now(), acknowledged_by = (SELECT full_name FROM public.current_app_user()),
         updated_at = now()
   WHERE shift_id = p_shift AND acknowledged_at IS NULL;
  PERFORM set_config('pos.shift_fn', '', true);

  PERFORM public.shift_log_event(p_shift, 'variance_approved', v.state, 'CLOSED',
    jsonb_build_object('note', p_note), v.terminal_id);
  RETURN 'CLOSED';
END $$;
GRANT EXECUTE ON FUNCTION public.shift_variance_approve(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shift_state(p_shift uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT state FROM public.shifts WHERE id = p_shift AND public.store_visible(store_id)
$$;
GRANT EXECUTE ON FUNCTION public.shift_state(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- Shift state helper
-- (source: 20260901103154_08cfbb6c-2ff4-4ce9-b261-4ebd32f02734.sql)
-- ------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.shift_log_event(uuid, text, text, text, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_log_event(uuid, text, text, text, jsonb, text) TO service_role;

REVOKE ALL ON FUNCTION public.shift_expected_view(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.shift_expected_view(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.shift_close_start(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.shift_close_start(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.shift_cash_count_submit(uuid, numeric, numeric, numeric, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.shift_cash_count_submit(uuid, numeric, numeric, numeric, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.shift_recount_submit(uuid, numeric, text, numeric, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.shift_recount_submit(uuid, numeric, text, numeric, numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.shift_variance_approve(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.shift_variance_approve(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.shift_state(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.shift_state(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.shift_records_immutable() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.shifts_guard_client_writes() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_block_closing_shift() FROM public, anon, authenticated;

-- ------------------------------------------------------------------
-- Booking payment routines (collect, cancel, balance)
-- (source: 20260901110406_08d970bc-b939-4aca-a62c-0f247228deee.sql)
-- ------------------------------------------------------------------
-- 1. Payment settlement status ------------------------------------------------
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'settled',
  ADD COLUMN IF NOT EXISTS client_payment_id text,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by text;

DO $$ BEGIN
  ALTER TABLE public.booking_payments
    ADD CONSTRAINT booking_payments_status_chk CHECK (status IN ('settled','reversed','void'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS booking_payments_client_id_uidx
  ON public.booking_payments (booking_id, client_payment_id)
  WHERE client_payment_id IS NOT NULL;

-- 2. Cancellation record --------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_terminal text;

-- 3. Authoritative balance ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_balance_state(_booking_id uuid)
RETURNS TABLE (
  booking_id uuid,
  total numeric,
  settled_paid numeric,
  outstanding numeric,
  fully_paid boolean,
  status text,
  job_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id,
         round(coalesce(b.total, 0), 2),
         round(coalesce((SELECT sum(p.amount) FROM public.booking_payments p
                          WHERE p.booking_id = b.id AND p.status = 'settled'), 0), 2),
         round(greatest(0, coalesce(b.total, 0)
               - coalesce((SELECT sum(p.amount) FROM public.booking_payments p
                            WHERE p.booking_id = b.id AND p.status = 'settled'), 0)), 2),
         (coalesce(b.total, 0)
           - coalesce((SELECT sum(p.amount) FROM public.booking_payments p
                        WHERE p.booking_id = b.id AND p.status = 'settled'), 0)) <= 0.005,
         b.status,
         b.job_status
  FROM public.bookings b
  WHERE b.id = _booking_id;
$$;

REVOKE ALL ON FUNCTION public.booking_balance_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_balance_state(uuid) TO authenticated, service_role;

-- 4. Guard: never collected while money is owed ---------------------------------
CREATE OR REPLACE FUNCTION public.bookings_block_unpaid_collection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  owed numeric;
BEGIN
  IF current_setting('pos.booking_collect', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'collected'
     AND coalesce(NEW.job_status, '') IS DISTINCT FROM 'collected' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND coalesce(OLD.job_status, '') IS NOT DISTINCT FROM coalesce(NEW.job_status, '') THEN
    RETURN NEW;
  END IF;

  SELECT round(coalesce(NEW.total, 0)
         - coalesce((SELECT sum(p.amount) FROM public.booking_payments p
                      WHERE p.booking_id = NEW.id AND p.status = 'settled'), 0), 2)
    INTO owed;

  IF owed > 0.005 THEN
    RAISE EXCEPTION 'BOOKING_BALANCE_DUE: % still outstanding on this booking', owed;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_block_unpaid_collection ON public.bookings;
CREATE TRIGGER bookings_block_unpaid_collection
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_block_unpaid_collection();

-- 5. Collect payment ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_collect(
  _booking_id uuid,
  _amount numeric,
  _method text,
  _cashier text DEFAULT NULL,
  _reference text DEFAULT NULL,
  _client_payment_id text DEFAULT NULL,
  _complete boolean DEFAULT true
)
RETURNS TABLE (
  total numeric,
  settled_paid numeric,
  outstanding numeric,
  fully_paid boolean,
  status text,
  job_status text,
  duplicate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  owed numeric;
  paid_now numeric;
  dup boolean := false;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.has_perm('can_collect_booking') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_COLLECT_BOOKING';
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF b.status = 'cancelled' THEN RAISE EXCEPTION 'BOOKING_CANCELLED'; END IF;

  SELECT coalesce(sum(p.amount), 0) INTO paid_now
    FROM public.booking_payments p
   WHERE p.booking_id = b.id AND p.status = 'settled';
  owed := round(coalesce(b.total, 0) - paid_now, 2);

  IF _client_payment_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.booking_payments
     WHERE booking_id = b.id AND client_payment_id = _client_payment_id
  ) THEN
    dup := true;
  ELSIF coalesce(_amount, 0) > 0 THEN
    IF round(_amount, 2) > owed + 0.005 THEN
      RAISE EXCEPTION 'BOOKING_OVERPAYMENT: only % is outstanding', greatest(owed, 0);
    END IF;
    INSERT INTO public.booking_payments
      (id, booking_id, amount, method, cashier, paid_at, status, reference, client_payment_id)
    VALUES
      (gen_random_uuid(), b.id, round(_amount, 2), coalesce(_method, 'cash'),
       coalesce(_cashier, b.cashier), now(), 'settled', _reference, _client_payment_id);
  END IF;

  SELECT coalesce(sum(p.amount), 0) INTO paid_now
    FROM public.booking_payments p
   WHERE p.booking_id = b.id AND p.status = 'settled';
  owed := round(coalesce(b.total, 0) - paid_now, 2);

  PERFORM set_config('pos.booking_collect', 'on', true);
  UPDATE public.bookings
     SET paid = round(paid_now, 2),
         status = CASE WHEN _complete AND owed <= 0.005 THEN 'collected' ELSE status END,
         job_status = CASE
           WHEN _complete AND owed <= 0.005 AND job_status IS NOT NULL THEN 'collected'
           ELSE job_status END,
         job_status_at = CASE
           WHEN _complete AND owed <= 0.005 AND job_status IS NOT NULL THEN now()
           ELSE job_status_at END,
         job_status_by = CASE
           WHEN _complete AND owed <= 0.005 AND job_status IS NOT NULL
             THEN coalesce(_cashier, job_status_by) ELSE job_status_by END,
         closed_at = CASE WHEN _complete AND owed <= 0.005 THEN now() ELSE closed_at END
   WHERE id = b.id
   RETURNING * INTO b;
  PERFORM set_config('pos.booking_collect', 'off', true);

  RETURN QUERY SELECT round(coalesce(b.total, 0), 2), round(paid_now, 2),
                      round(greatest(owed, 0), 2), owed <= 0.005,
                      b.status, b.job_status, dup;
END $$;

REVOKE ALL ON FUNCTION public.booking_collect(uuid, numeric, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_collect(uuid, numeric, text, text, text, text, boolean) TO authenticated, service_role;

-- 6. Cancel with a mandatory reason ---------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_cancel(
  _booking_id uuid,
  _reason text,
  _cancelled_by text DEFAULT NULL,
  _terminal text DEFAULT NULL
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  clean text := btrim(coalesce(_reason, ''));
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.has_perm('can_cancel_booking') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_CANCEL_BOOKING';
  END IF;
  IF length(clean) < 3 THEN
    RAISE EXCEPTION 'CANCEL_REASON_REQUIRED';
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF b.status = 'collected' THEN RAISE EXCEPTION 'BOOKING_ALREADY_COLLECTED'; END IF;

  UPDATE public.bookings
     SET status = 'cancelled',
         closed_at = coalesce(closed_at, now()),
         -- the first reason recorded is never overwritten
         cancel_reason = coalesce(cancel_reason, clean),
         cancelled_by = coalesce(cancelled_by, _cancelled_by),
         cancelled_at = coalesce(cancelled_at, now()),
         cancelled_terminal = coalesce(cancelled_terminal, _terminal)
   WHERE id = b.id
   RETURNING * INTO b;

  RETURN b;
END $$;

REVOKE ALL ON FUNCTION public.booking_cancel(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_cancel(uuid, text, text, text) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- Booking payment routines - refunds and guards
-- (source: 20260901111823_3090a950-3763-4b25-81c0-bcfcc1b972a4.sql)
-- ------------------------------------------------------------------
-- 1. Refund metadata on booking payments ---------------------------------------
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'payment',
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refunds_payment_id uuid,
  ADD COLUMN IF NOT EXISTS change_given numeric NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.booking_payments
    ADD CONSTRAINT booking_payments_kind_chk CHECK (kind IN ('payment','refund'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancel_money_action text;

DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_cancel_money_action_chk
    CHECK (cancel_money_action IS NULL OR cancel_money_action IN ('refunded','retained','none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Balance is net of refunds --------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_net_paid(_booking_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT round(coalesce(sum(p.amount), 0), 2)
    FROM public.booking_payments p
   WHERE p.booking_id = _booking_id AND p.status = 'settled';
$$;

REVOKE ALL ON FUNCTION public.booking_net_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_net_paid(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.booking_balance_state(_booking_id uuid)
RETURNS TABLE (
  booking_id uuid,
  total numeric,
  settled_paid numeric,
  outstanding numeric,
  fully_paid boolean,
  status text,
  job_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id,
         round(coalesce(b.total, 0), 2),
         public.booking_net_paid(b.id),
         round(greatest(0, coalesce(b.total, 0) - public.booking_net_paid(b.id)), 2),
         (coalesce(b.total, 0) - public.booking_net_paid(b.id)) <= 0.005,
         b.status,
         b.job_status
  FROM public.bookings b
  WHERE b.id = _booking_id;
$$;

REVOKE ALL ON FUNCTION public.booking_balance_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_balance_state(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bookings_block_unpaid_collection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  owed numeric;
BEGIN
  IF current_setting('pos.booking_collect', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'collected'
     AND coalesce(NEW.job_status, '') IS DISTINCT FROM 'collected' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND coalesce(OLD.job_status, '') IS NOT DISTINCT FROM coalesce(NEW.job_status, '') THEN
    RETURN NEW;
  END IF;

  owed := round(coalesce(NEW.total, 0) - public.booking_net_paid(NEW.id), 2);

  IF owed > 0.005 THEN
    RAISE EXCEPTION 'BOOKING_BALANCE_DUE: % still outstanding on this booking', owed;
  END IF;
  RETURN NEW;
END $$;

-- 3. Collect: ambiguity fix, net balance, cash change ----------------------------
DROP FUNCTION IF EXISTS public.booking_collect(uuid, numeric, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.booking_collect(
  _booking_id uuid,
  _amount numeric,
  _method text,
  _cashier text DEFAULT NULL,
  _reference text DEFAULT NULL,
  _client_payment_id text DEFAULT NULL,
  _complete boolean DEFAULT true
)
RETURNS TABLE (
  total numeric,
  settled_paid numeric,
  outstanding numeric,
  fully_paid boolean,
  status text,
  job_status text,
  duplicate boolean,
  change_due numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  owed numeric;
  paid_now numeric;
  dup boolean := false;
  taken numeric := 0;
  change_out numeric := 0;
  method_in text := lower(coalesce(_method, 'cash'));
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.has_perm('can_collect_booking') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_COLLECT_BOOKING';
  END IF;

  SELECT * INTO b FROM public.bookings bk WHERE bk.id = _booking_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF b.status = 'cancelled' THEN RAISE EXCEPTION 'BOOKING_CANCELLED'; END IF;

  paid_now := public.booking_net_paid(b.id);
  owed := round(coalesce(b.total, 0) - paid_now, 2);

  IF _client_payment_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.booking_payments p
     WHERE p.booking_id = b.id AND p.client_payment_id = _client_payment_id
  ) THEN
    dup := true;
  ELSIF coalesce(_amount, 0) > 0 THEN
    taken := round(_amount, 2);
    IF taken > owed + 0.005 THEN
      IF method_in = 'cash' THEN
        -- cash over the counter: keep what is owed, hand the rest back
        change_out := round(taken - greatest(owed, 0), 2);
        taken := round(greatest(owed, 0), 2);
      ELSE
        RAISE EXCEPTION 'BOOKING_OVERPAYMENT: only % is outstanding', greatest(owed, 0);
      END IF;
    END IF;

    IF taken > 0 THEN
      INSERT INTO public.booking_payments
        (id, booking_id, amount, method, cashier, paid_at, status, reference,
         client_payment_id, kind, change_given)
      VALUES
        (gen_random_uuid(), b.id, taken, coalesce(_method, 'cash'),
         coalesce(_cashier, b.cashier), now(), 'settled', _reference,
         _client_payment_id, 'payment', change_out);
    END IF;
  END IF;

  paid_now := public.booking_net_paid(b.id);
  owed := round(coalesce(b.total, 0) - paid_now, 2);

  PERFORM set_config('pos.booking_collect', 'on', true);
  UPDATE public.bookings bk
     SET paid = round(paid_now, 2),
         status = CASE WHEN _complete AND owed <= 0.005 THEN 'collected' ELSE bk.status END,
         job_status = CASE
           WHEN _complete AND owed <= 0.005 AND bk.job_status IS NOT NULL THEN 'collected'
           ELSE bk.job_status END,
         job_status_at = CASE
           WHEN _complete AND owed <= 0.005 AND bk.job_status IS NOT NULL THEN now()
           ELSE bk.job_status_at END,
         job_status_by = CASE
           WHEN _complete AND owed <= 0.005 AND bk.job_status IS NOT NULL
             THEN coalesce(_cashier, bk.job_status_by) ELSE bk.job_status_by END,
         closed_at = CASE WHEN _complete AND owed <= 0.005 THEN now() ELSE bk.closed_at END
   WHERE bk.id = b.id
   RETURNING * INTO b;
  PERFORM set_config('pos.booking_collect', 'off', true);

  RETURN QUERY SELECT round(coalesce(b.total, 0), 2), round(paid_now, 2),
                      round(greatest(owed, 0), 2), owed <= 0.005,
                      b.status, b.job_status, dup, change_out;
END $$;

REVOKE ALL ON FUNCTION public.booking_collect(uuid, numeric, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_collect(uuid, numeric, text, text, text, text, boolean) TO authenticated, service_role;

-- 4. Refunds --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_refund(
  _booking_id uuid,
  _amount numeric,
  _method text DEFAULT 'cash',
  _reason text DEFAULT NULL,
  _cashier text DEFAULT NULL,
  _client_payment_id text DEFAULT NULL
)
RETURNS TABLE (
  total numeric,
  settled_paid numeric,
  outstanding numeric,
  fully_paid boolean,
  status text,
  job_status text,
  duplicate boolean,
  change_due numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  paid_now numeric;
  owed numeric;
  dup boolean := false;
  clean text := btrim(coalesce(_reason, ''));
  give numeric;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.has_perm('can_process_refund') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_REFUND_BOOKING';
  END IF;
  IF length(clean) < 3 THEN
    RAISE EXCEPTION 'REFUND_REASON_REQUIRED';
  END IF;

  SELECT * INTO b FROM public.bookings bk WHERE bk.id = _booking_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;

  paid_now := public.booking_net_paid(b.id);

  IF _client_payment_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.booking_payments p
     WHERE p.booking_id = b.id AND p.client_payment_id = _client_payment_id
  ) THEN
    dup := true;
  ELSE
    give := round(coalesce(_amount, 0), 2);
    IF give <= 0 THEN RAISE EXCEPTION 'REFUND_AMOUNT_INVALID'; END IF;
    IF give > paid_now + 0.005 THEN
      RAISE EXCEPTION 'REFUND_EXCEEDS_PAID: only % has been taken', greatest(paid_now, 0);
    END IF;

    INSERT INTO public.booking_payments
      (id, booking_id, amount, method, cashier, paid_at, status, client_payment_id,
       kind, refund_reason)
    VALUES
      (gen_random_uuid(), b.id, -give, coalesce(_method, 'cash'),
       coalesce(_cashier, b.cashier), now(), 'settled', _client_payment_id,
       'refund', clean);
  END IF;

  paid_now := public.booking_net_paid(b.id);
  owed := round(coalesce(b.total, 0) - paid_now, 2);

  PERFORM set_config('pos.booking_collect', 'on', true);
  UPDATE public.bookings bk SET paid = round(paid_now, 2)
   WHERE bk.id = b.id RETURNING * INTO b;
  PERFORM set_config('pos.booking_collect', 'off', true);

  RETURN QUERY SELECT round(coalesce(b.total, 0), 2), round(paid_now, 2),
                      round(greatest(owed, 0), 2), owed <= 0.005,
                      b.status, b.job_status, dup, 0::numeric;
END $$;

REVOKE ALL ON FUNCTION public.booking_refund(uuid, numeric, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_refund(uuid, numeric, text, text, text, text) TO authenticated, service_role;

-- 5. Cancel: record what happened to the money -----------------------------------
DROP FUNCTION IF EXISTS public.booking_cancel(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.booking_cancel(
  _booking_id uuid,
  _reason text,
  _cancelled_by text DEFAULT NULL,
  _terminal text DEFAULT NULL,
  _money_action text DEFAULT NULL,
  _client_payment_id text DEFAULT NULL
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  clean text := btrim(coalesce(_reason, ''));
  held numeric;
  action text := lower(coalesce(_money_action, ''));
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.has_perm('can_cancel_booking') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_CANCEL_BOOKING';
  END IF;
  IF length(clean) < 3 THEN
    RAISE EXCEPTION 'CANCEL_REASON_REQUIRED';
  END IF;

  SELECT * INTO b FROM public.bookings bk WHERE bk.id = _booking_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF b.status = 'collected' THEN RAISE EXCEPTION 'BOOKING_ALREADY_COLLECTED'; END IF;

  held := public.booking_net_paid(b.id);

  IF held > 0.005 THEN
    IF action NOT IN ('refunded', 'retained') THEN
      RAISE EXCEPTION 'CANCEL_MONEY_DECISION_REQUIRED: % is held on this booking', held;
    END IF;
    IF action = 'refunded' THEN
      PERFORM public.booking_refund(
        b.id, held, 'cash', 'Refunded on cancellation: ' || clean,
        _cancelled_by, _client_payment_id);
    END IF;
  ELSE
    action := 'none';
  END IF;

  PERFORM set_config('pos.booking_collect', 'on', true);
  UPDATE public.bookings bk
     SET status = 'cancelled',
         paid = public.booking_net_paid(bk.id),
         closed_at = coalesce(bk.closed_at, now()),
         cancel_reason = coalesce(bk.cancel_reason, clean),
         cancelled_by = coalesce(bk.cancelled_by, _cancelled_by),
         cancelled_at = coalesce(bk.cancelled_at, now()),
         cancelled_terminal = coalesce(bk.cancelled_terminal, _terminal),
         cancel_money_action = coalesce(bk.cancel_money_action, action)
   WHERE bk.id = b.id
   RETURNING * INTO b;
  PERFORM set_config('pos.booking_collect', 'off', true);

  RETURN b;
END $$;

REVOKE ALL ON FUNCTION public.booking_cancel(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_cancel(uuid, text, text, text, text, text) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- Entity status history
-- (source: 20260901123217_97f713b1-1c00-4d8e-89bd-8d0b7e345e83.sql)
-- ------------------------------------------------------------------
-- 1. Immutable status-transition history -------------------------------

CREATE TABLE IF NOT EXISTS public.entity_status_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  status_kind         TEXT NOT NULL DEFAULT 'status',
  previous_status     TEXT,
  new_status          TEXT NOT NULL,
  reason              TEXT,
  actor_id            TEXT,
  actor_name          TEXT,
  actor_role          TEXT,
  store_id            TEXT,
  branch_id           TEXT,
  terminal_id         TEXT,
  related_entity_type TEXT,
  related_entity_id   TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_event_id     TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_version         BIGINT NOT NULL DEFAULT 1
);

GRANT SELECT, INSERT ON public.entity_status_history TO authenticated;
GRANT ALL ON public.entity_status_history TO service_role;

ALTER TABLE public.entity_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read status history for visible stores" ON public.entity_status_history;
CREATE POLICY "Staff read status history for visible stores"
  ON public.entity_status_history FOR SELECT TO authenticated
  USING (store_id IS NULL OR public.store_visible(store_id));

DROP POLICY IF EXISTS "Staff append status history" ON public.entity_status_history;
CREATE POLICY "Staff append status history"
  ON public.entity_status_history FOR INSERT TO authenticated
  WITH CHECK (public.is_staff_now());

-- Retries after a dropped connection must not duplicate a transition.
CREATE UNIQUE INDEX IF NOT EXISTS entity_status_history_client_event_uidx
  ON public.entity_status_history (client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS entity_status_history_entity_idx
  ON public.entity_status_history (entity_type, entity_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS entity_status_history_store_idx
  ON public.entity_status_history (store_id, created_at DESC);

-- History is written once and never rewritten.
CREATE OR REPLACE FUNCTION public.entity_status_history_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'entity_status_history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS entity_status_history_no_update ON public.entity_status_history;
CREATE TRIGGER entity_status_history_no_update
  BEFORE UPDATE OR DELETE ON public.entity_status_history
  FOR EACH ROW EXECUTE FUNCTION public.entity_status_history_immutable();

-- 2. Make business events say what actually changed ---------------------

ALTER TABLE public.activity_events
  ADD COLUMN IF NOT EXISTS entity_type    TEXT,
  ADD COLUMN IF NOT EXISTS entity_id      TEXT,
  ADD COLUMN IF NOT EXISTS previous_state TEXT,
  ADD COLUMN IF NOT EXISTS new_state      TEXT;

CREATE INDEX IF NOT EXISTS activity_events_entity_idx
  ON public.activity_events (entity_type, entity_id, created_at DESC);

-- 3. Let a rebuilt terminal recover its own branch's audit trail --------

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS store_id TEXT;

CREATE INDEX IF NOT EXISTS audit_logs_store_idx
  ON public.audit_logs (store_id, created_at DESC);

-- ------------------------------------------------------------------
-- Stock transfer approval
-- (source: 20260901134453_1063c342-9d1d-4bee-b6cf-6c848cdb7590.sql)
-- ------------------------------------------------------------------
-- Approve: record the allowed quantity per line, then move the note on.
CREATE OR REPLACE FUNCTION public.stock_transfer_approve(
  p_transfer_id uuid,
  p_approved_by text DEFAULT NULL,
  p_lines jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t public.stock_transfers;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can approve a transfer';
  END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF t.status <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'Transfer % is % and is not waiting for approval', t.ref, t.status;
  END IF;

  -- No list means "everything as asked for".
  UPDATE public.stock_transfer_items i
     SET quantity_approved = COALESCE(
           (SELECT (l ->> 'qty')::int FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l
             WHERE l ->> 'product_id' = i.product_id::text LIMIT 1),
           i.quantity)
   WHERE i.transfer_id = t.id;

  UPDATE public.stock_transfers
     SET status = 'approved', approved_by = COALESCE(p_approved_by, approved_by), approved_at = now()
   WHERE id = t.id;
END $$;

-- Dispatch: the stock physically leaves here, so this is where the sending
-- branch's count drops and the request closes against reality.
CREATE OR REPLACE FUNCTION public.stock_transfer_dispatch(
  p_transfer_id uuid,
  p_dispatched_by text DEFAULT NULL,
  p_lines jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t public.stock_transfers;
  it record;
  v_qty integer;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can dispatch a transfer';
  END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF t.status <> 'approved' THEN
    RAISE EXCEPTION 'Transfer % is % and cannot be dispatched', t.ref, t.status;
  END IF;

  FOR it IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = t.id LOOP
    v_qty := COALESCE(
      (SELECT (l ->> 'qty')::int FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l
        WHERE l ->> 'product_id' = it.product_id::text LIMIT 1),
      it.quantity_approved, it.quantity);
    v_qty := GREATEST(LEAST(v_qty, COALESCE(it.quantity_approved, it.quantity)), 0);

    UPDATE public.stock_transfer_items SET quantity_dispatched = v_qty WHERE id = it.id;

    CONTINUE WHEN v_qty <= 0;

    UPDATE public.products
       SET stock_by_store = jsonb_set(
             COALESCE(stock_by_store, '{}'::jsonb), ARRAY[t.from_store_id],
             to_jsonb(GREATEST(
               COALESCE((stock_by_store ->> t.from_store_id)::int, 0) - v_qty, 0)), true),
           stock_quantity = GREATEST(stock_quantity - v_qty, 0)
     WHERE id = it.product_id;
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'dispatched',
         dispatched_by = COALESCE(p_dispatched_by, dispatched_by),
         dispatched_at = now()
   WHERE id = t.id;
END $$;

-- Receiving books in what was actually sent.
CREATE OR REPLACE FUNCTION public.stock_transfer_receive(
  p_transfer_id uuid,
  p_received_by text DEFAULT NULL,
  p_deduct_source boolean DEFAULT false,
  p_lines jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t public.stock_transfers;
  it record;
  v_target uuid;
  v_qty integer;
  v_src public.products;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can receive a transfer';
  END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF t.status = 'received' THEN RAISE EXCEPTION 'TRANSFER_ALREADY_RECEIVED'; END IF;
  IF t.status IN ('rejected', 'cancelled', 'completed') THEN RAISE EXCEPTION 'TRANSFER_CLOSED'; END IF;
  IF t.status <> 'dispatched' THEN
    RAISE EXCEPTION 'Transfer % has not been dispatched yet', t.ref;
  END IF;

  FOR it IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = t.id LOOP
    v_qty := COALESCE(
      (SELECT (l ->> 'qty')::int FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l
        WHERE l ->> 'product_id' = it.product_id::text LIMIT 1),
      NULLIF(it.quantity_received, 0),
      it.quantity_dispatched, it.quantity);
    v_qty := GREATEST(LEAST(v_qty, COALESCE(it.quantity_dispatched, it.quantity)), 0);

    UPDATE public.stock_transfer_items SET quantity_received = v_qty WHERE id = it.id;
    CONTINUE WHEN v_qty <= 0;

    SELECT * INTO v_src FROM public.products WHERE id = it.product_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_target := it.product_id;

    -- Across clusters the receiving group keeps its own catalogue entry.
    IF t.transfer_scope = 'INTER_GROUP' AND COALESCE(v_src.barcode, '') <> '' THEN
      SELECT p.id INTO v_target
        FROM public.products p
       WHERE p.barcode = v_src.barcode
         AND COALESCE(p.stock_by_store ? t.to_store_id, false)
       LIMIT 1;
      IF v_target IS NULL THEN v_target := it.product_id; END IF;
    END IF;

    IF p_deduct_source THEN
      UPDATE public.products
         SET stock_by_store = jsonb_set(
               COALESCE(stock_by_store, '{}'::jsonb), ARRAY[t.from_store_id],
               to_jsonb(GREATEST(
                 COALESCE((stock_by_store ->> t.from_store_id)::int, 0) - v_qty, 0)), true),
             stock_quantity = GREATEST(stock_quantity - v_qty, 0)
       WHERE id = it.product_id;
    END IF;

    UPDATE public.products
       SET stock_by_store = jsonb_set(
             COALESCE(stock_by_store, '{}'::jsonb), ARRAY[t.to_store_id],
             to_jsonb(COALESCE((stock_by_store ->> t.to_store_id)::int, 0) + v_qty), true),
           stock_quantity = stock_quantity + v_qty
     WHERE id = v_target;
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'received', received_at = now(),
         received_by = COALESCE(p_received_by, received_by)
   WHERE id = t.id;
END $$;

REVOKE ALL ON FUNCTION public.stock_transfer_approve(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_transfer_dispatch(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_transfer_receive(uuid, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_transfer_approve(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_transfer_dispatch(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_transfer_receive(uuid, text, boolean, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- Stock transfer dispatch
-- (source: 20260901151601_c8fcb3e2-615c-4b35-be01-1a2fbc038ee0.sql)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_transfer_dispatch(p_transfer_id uuid, p_dispatched_by text DEFAULT NULL::text, p_lines jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.stock_transfers;
  it record;
  v_qty integer;
  v_before integer;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can dispatch a transfer';
  END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF t.status <> 'approved' THEN
    RAISE EXCEPTION 'Transfer % is % and cannot be dispatched', t.ref, t.status;
  END IF;

  FOR it IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = t.id LOOP
    v_qty := COALESCE(
      (SELECT (l ->> 'qty')::int FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l
        WHERE l ->> 'product_id' = it.product_id::text LIMIT 1),
      it.quantity_approved, it.quantity);
    v_qty := GREATEST(LEAST(v_qty, COALESCE(it.quantity_approved, it.quantity)), 0);

    UPDATE public.stock_transfer_items SET quantity_dispatched = v_qty WHERE id = it.id;

    CONTINUE WHEN v_qty <= 0;

    SELECT COALESCE((stock_by_store ->> t.from_store_id)::int, 0) INTO v_before
      FROM public.products WHERE id = it.product_id;

    UPDATE public.products
       SET stock_by_store = jsonb_set(
             COALESCE(stock_by_store, '{}'::jsonb), ARRAY[t.from_store_id],
             to_jsonb(GREATEST(
               COALESCE((stock_by_store ->> t.from_store_id)::int, 0) - v_qty, 0)), true),
           stock_quantity = GREATEST(stock_quantity - v_qty, 0)
     WHERE id = it.product_id;

    INSERT INTO public.item_activity_logs
      (product_id, product_name, store_id, activity_type, reference,
       quantity_delta, stock_before, stock_after, unit_cost, staff_name, note)
    SELECT it.product_id, p.name, t.from_store_id, 'transfer_out', t.ref,
           -v_qty, COALESCE(v_before, 0), GREATEST(COALESCE(v_before, 0) - v_qty, 0),
           COALESCE(p.cost_price, 0), COALESCE(p_dispatched_by, ''), ''
      FROM public.products p WHERE p.id = it.product_id;
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'dispatched',
         dispatched_by = COALESCE(p_dispatched_by, dispatched_by),
         dispatched_at = now()
   WHERE id = t.id;
END $function$;

CREATE OR REPLACE FUNCTION public.stock_transfer_receive(p_transfer_id uuid, p_received_by text DEFAULT NULL::text, p_deduct_source boolean DEFAULT false, p_lines jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.stock_transfers;
  it record;
  v_target uuid;
  v_qty integer;
  v_src public.products;
  v_before integer;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can receive a transfer';
  END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF t.status = 'received' THEN RAISE EXCEPTION 'TRANSFER_ALREADY_RECEIVED'; END IF;
  IF t.status IN ('rejected', 'cancelled', 'completed') THEN RAISE EXCEPTION 'TRANSFER_CLOSED'; END IF;
  IF t.status <> 'dispatched' THEN
    RAISE EXCEPTION 'Transfer % has not been dispatched yet', t.ref;
  END IF;

  FOR it IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = t.id LOOP
    v_qty := COALESCE(
      (SELECT (l ->> 'qty')::int FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l
        WHERE l ->> 'product_id' = it.product_id::text LIMIT 1),
      NULLIF(it.quantity_received, 0),
      it.quantity_dispatched, it.quantity);
    v_qty := GREATEST(LEAST(v_qty, COALESCE(it.quantity_dispatched, it.quantity)), 0);

    UPDATE public.stock_transfer_items SET quantity_received = v_qty WHERE id = it.id;
    CONTINUE WHEN v_qty <= 0;

    SELECT * INTO v_src FROM public.products WHERE id = it.product_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_target := it.product_id;

    -- Across clusters the receiving group keeps its own catalogue entry.
    IF t.transfer_scope = 'INTER_GROUP' AND COALESCE(v_src.barcode, '') <> '' THEN
      SELECT p.id INTO v_target
        FROM public.products p
       WHERE p.barcode = v_src.barcode
         AND COALESCE(p.stock_by_store ? t.to_store_id, false)
       LIMIT 1;
      IF v_target IS NULL THEN v_target := it.product_id; END IF;
    END IF;

    IF p_deduct_source THEN
      SELECT COALESCE((stock_by_store ->> t.from_store_id)::int, 0) INTO v_before
        FROM public.products WHERE id = it.product_id;

      UPDATE public.products
         SET stock_by_store = jsonb_set(
               COALESCE(stock_by_store, '{}'::jsonb), ARRAY[t.from_store_id],
               to_jsonb(GREATEST(
                 COALESCE((stock_by_store ->> t.from_store_id)::int, 0) - v_qty, 0)), true),
             stock_quantity = GREATEST(stock_quantity - v_qty, 0)
       WHERE id = it.product_id;

      INSERT INTO public.item_activity_logs
        (product_id, product_name, store_id, activity_type, reference,
         quantity_delta, stock_before, stock_after, unit_cost, staff_name, note)
      VALUES (it.product_id, v_src.name, t.from_store_id, 'transfer_out', t.ref,
              -v_qty, COALESCE(v_before, 0), GREATEST(COALESCE(v_before, 0) - v_qty, 0),
              COALESCE(v_src.cost_price, 0), COALESCE(p_received_by, ''), '');
    END IF;

    SELECT COALESCE((stock_by_store ->> t.to_store_id)::int, 0) INTO v_before
      FROM public.products WHERE id = v_target;

    UPDATE public.products
       SET stock_by_store = jsonb_set(
             COALESCE(stock_by_store, '{}'::jsonb), ARRAY[t.to_store_id],
             to_jsonb(COALESCE((stock_by_store ->> t.to_store_id)::int, 0) + v_qty), true),
           stock_quantity = stock_quantity + v_qty
     WHERE id = v_target;

    INSERT INTO public.item_activity_logs
      (product_id, product_name, store_id, activity_type, reference,
       quantity_delta, stock_before, stock_after, unit_cost, staff_name, note)
    SELECT v_target, p.name, t.to_store_id, 'transfer_in', t.ref,
           v_qty, COALESCE(v_before, 0), COALESCE(v_before, 0) + v_qty,
           COALESCE(p.cost_price, 0), COALESCE(p_received_by, ''), ''
      FROM public.products p WHERE p.id = v_target;
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'received', received_at = now(),
         received_by = COALESCE(p_received_by, received_by)
   WHERE id = t.id;
END $function$;

-- ------------------------------------------------------------------
-- Stock transfer receive/verify
-- (source: 20260902034155_62cac758-4a22-408d-b91d-dffb4086c6d4.sql)
-- ------------------------------------------------------------------
ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS verified_by text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS discrepancy_reason text;

ALTER TABLE public.stock_transfer_items
  ADD COLUMN IF NOT EXISTS quantity_verified integer;

-- Line quantity ceilings: verified can never exceed what arrived.
CREATE OR REPLACE FUNCTION public.stock_transfer_items_enforce_quantities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.quantity < 0
     OR COALESCE(NEW.quantity_approved, 0) < 0
     OR COALESCE(NEW.quantity_dispatched, 0) < 0
     OR COALESCE(NEW.quantity_received, 0) < 0
     OR COALESCE(NEW.quantity_verified, 0) < 0 THEN
    RAISE EXCEPTION 'Transfer quantities cannot be negative' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.quantity_approved IS NOT NULL AND NEW.quantity_approved > NEW.quantity THEN
    RAISE EXCEPTION 'Cannot approve % of % requested', NEW.quantity_approved, NEW.quantity
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.quantity_dispatched IS NOT NULL
     AND NEW.quantity_dispatched > COALESCE(NEW.quantity_approved, NEW.quantity) THEN
    RAISE EXCEPTION 'Cannot send % when only % were approved',
      NEW.quantity_dispatched, COALESCE(NEW.quantity_approved, NEW.quantity)
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(NEW.quantity_received, 0) > COALESCE(NEW.quantity_dispatched, NEW.quantity) THEN
    RAISE EXCEPTION 'Cannot receive % when only % were sent',
      NEW.quantity_received, COALESCE(NEW.quantity_dispatched, NEW.quantity)
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(NEW.quantity_verified, 0) > COALESCE(NEW.quantity_dispatched, NEW.quantity) THEN
    RAISE EXCEPTION 'Cannot verify % when only % were sent',
      NEW.quantity_verified, COALESCE(NEW.quantity_dispatched, NEW.quantity)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- Lifecycle: arrival and posting are now two different things.
CREATE OR REPLACE FUNCTION public.stock_transfers_enforce_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_needs_approval boolean;
  v_may_approve boolean := public.is_supervisor_now()
    OR public.has_perm('can_approve_transfer')
    OR public.has_perm('can_receive_transfer');
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_needs_approval := public.stock_transfer_approval_required(NEW.from_store_id);

    IF v_needs_approval THEN
      NEW.status := 'awaiting_approval';
    ELSIF NEW.status IS NULL OR NEW.status NOT IN ('awaiting_approval', 'approved') THEN
      NEW.status := 'approved';
    END IF;

    IF NEW.status = 'approved' AND NOT v_needs_approval THEN
      NEW.approved_by := COALESCE(NEW.approved_by, NEW.created_by);
      NEW.approved_at := COALESCE(NEW.approved_at, now());
    ELSE
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
    END IF;

    NEW.dispatched_by := NULL;
    NEW.dispatched_at := NULL;
    NEW.received_by := NULL;
    NEW.received_at := NULL;
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
    NEW.posted_at := NULL;
    NEW.closed_at := NULL;
    NEW.fulfilment := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('rejected', 'cancelled', 'completed', 'completed_with_discrepancy') THEN
    RAISE EXCEPTION 'Transfer % is closed (%) and cannot change', OLD.ref, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (
    (OLD.status = 'awaiting_approval' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
    OR (OLD.status = 'approved' AND NEW.status IN ('dispatched', 'rejected', 'cancelled'))
    OR (OLD.status = 'dispatched' AND NEW.status = 'received')
    OR (OLD.status = 'received' AND NEW.status IN ('verified', 'completed', 'completed_with_discrepancy'))
    OR (OLD.status = 'verified' AND NEW.status IN ('completed', 'completed_with_discrepancy'))
  ) THEN
    RAISE EXCEPTION 'Transfer % cannot go from % to %', OLD.ref, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IN ('approved', 'rejected') AND NOT v_may_approve THEN
    RAISE EXCEPTION 'You are not allowed to approve or reject transfers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = 'approved' THEN
    NEW.approved_at := COALESCE(NEW.approved_at, now());
  END IF;

  IF NEW.status = 'rejected' AND COALESCE(btrim(NEW.rejected_reason), '') = '' THEN
    RAISE EXCEPTION 'A rejection needs a reason' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'cancelled' AND COALESCE(btrim(NEW.cancelled_reason), '') = '' THEN
    RAISE EXCEPTION 'A cancellation needs a reason' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'completed_with_discrepancy'
     AND COALESCE(btrim(NEW.discrepancy_reason), '') = '' THEN
    RAISE EXCEPTION 'A discrepancy needs a reason' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'dispatched' THEN
    NEW.dispatched_at := COALESCE(NEW.dispatched_at, now());
    NEW.closed_at := COALESCE(NEW.closed_at, now());
    NEW.fulfilment := (
      SELECT CASE
        WHEN COALESCE(SUM(COALESCE(i.quantity_dispatched, 0)), 0) = 0 THEN 'none'
        WHEN COALESCE(SUM(COALESCE(i.quantity_dispatched, 0)), 0)
             >= COALESCE(SUM(i.quantity), 0) THEN 'full'
        ELSE 'partial'
      END
      FROM public.stock_transfer_items i WHERE i.transfer_id = NEW.id
    );
  END IF;

  IF NEW.status = 'received' THEN
    NEW.received_at := COALESCE(NEW.received_at, now());
  END IF;

  IF NEW.status IN ('verified', 'completed', 'completed_with_discrepancy') THEN
    NEW.received_at := COALESCE(NEW.received_at, now());
    NEW.verified_at := COALESCE(NEW.verified_at, now());
  END IF;

  RETURN NEW;
END;
$function$;

-- Receiving now only records arrival; no stock moves here.
CREATE OR REPLACE FUNCTION public.stock_transfer_receive(
  p_transfer_id uuid,
  p_received_by text DEFAULT NULL::text,
  p_deduct_source boolean DEFAULT false,
  p_lines jsonb DEFAULT NULL::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.stock_transfers;
  it record;
  v_qty integer;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can receive a transfer';
  END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF t.status = 'received' THEN RAISE EXCEPTION 'TRANSFER_ALREADY_RECEIVED'; END IF;
  IF t.status IN ('rejected', 'cancelled', 'verified', 'completed', 'completed_with_discrepancy') THEN
    RAISE EXCEPTION 'TRANSFER_CLOSED';
  END IF;
  IF t.status <> 'dispatched' THEN
    RAISE EXCEPTION 'Transfer % has not been dispatched yet', t.ref;
  END IF;

  FOR it IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = t.id LOOP
    v_qty := COALESCE(
      (SELECT (l ->> 'qty')::int FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l
        WHERE l ->> 'product_id' = it.product_id::text LIMIT 1),
      it.quantity_dispatched, it.quantity);
    v_qty := GREATEST(LEAST(v_qty, COALESCE(it.quantity_dispatched, it.quantity)), 0);
    UPDATE public.stock_transfer_items SET quantity_received = v_qty WHERE id = it.id;
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'received', received_at = now(),
         received_by = COALESCE(p_received_by, received_by)
   WHERE id = t.id;
END $function$;

-- Verification posts the physically counted quantity, exactly once.
CREATE OR REPLACE FUNCTION public.stock_transfer_verify(
  p_transfer_id uuid,
  p_verified_by text DEFAULT NULL::text,
  p_lines jsonb DEFAULT NULL::jsonb,
  p_reason text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.stock_transfers;
  it record;
  v_target uuid;
  v_qty integer;
  v_src public.products;
  v_before integer;
  v_short boolean := false;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can verify a transfer';
  END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF t.posted_at IS NOT NULL
     OR t.status IN ('verified', 'completed', 'completed_with_discrepancy') THEN
    RAISE EXCEPTION 'TRANSFER_ALREADY_POSTED';
  END IF;
  IF t.status IN ('rejected', 'cancelled') THEN RAISE EXCEPTION 'TRANSFER_CLOSED'; END IF;
  IF t.status <> 'received' THEN
    RAISE EXCEPTION 'Transfer % has not arrived yet', t.ref;
  END IF;

  FOR it IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = t.id LOOP
    v_qty := COALESCE(
      (SELECT (l ->> 'qty')::int FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l
        WHERE l ->> 'product_id' = it.product_id::text LIMIT 1),
      it.quantity_received, it.quantity_dispatched, it.quantity);
    v_qty := GREATEST(LEAST(v_qty, COALESCE(it.quantity_dispatched, it.quantity)), 0);

    IF v_qty < COALESCE(it.quantity_dispatched, it.quantity) THEN v_short := true; END IF;

    UPDATE public.stock_transfer_items
       SET quantity_verified = v_qty, quantity_received = v_qty
     WHERE id = it.id;

    CONTINUE WHEN v_qty <= 0;

    SELECT * INTO v_src FROM public.products WHERE id = it.product_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_target := it.product_id;

    IF t.transfer_scope = 'INTER_GROUP' AND COALESCE(v_src.barcode, '') <> '' THEN
      SELECT p.id INTO v_target
        FROM public.products p
       WHERE p.barcode = v_src.barcode
         AND COALESCE(p.stock_by_store ? t.to_store_id, false)
       LIMIT 1;
      IF v_target IS NULL THEN v_target := it.product_id; END IF;
    END IF;

    SELECT COALESCE((stock_by_store ->> t.to_store_id)::int, 0) INTO v_before
      FROM public.products WHERE id = v_target FOR UPDATE;

    UPDATE public.products
       SET stock_by_store = jsonb_set(
             COALESCE(stock_by_store, '{}'::jsonb), ARRAY[t.to_store_id],
             to_jsonb(COALESCE((stock_by_store ->> t.to_store_id)::int, 0) + v_qty), true),
           stock_quantity = stock_quantity + v_qty
     WHERE id = v_target;

    INSERT INTO public.item_activity_logs
      (product_id, product_name, store_id, activity_type, reference,
       quantity_delta, stock_before, stock_after, unit_cost, staff_name, note)
    SELECT v_target, p.name, t.to_store_id, 'transfer_in', t.ref,
           v_qty, COALESCE(v_before, 0), COALESCE(v_before, 0) + v_qty,
           COALESCE(p.cost_price, 0), COALESCE(p_verified_by, ''), ''
      FROM public.products p WHERE p.id = v_target;
  END LOOP;

  IF v_short AND COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A discrepancy needs a reason' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.stock_transfers
     SET status = CASE WHEN v_short THEN 'completed_with_discrepancy' ELSE 'completed' END,
         verified_by = COALESCE(p_verified_by, verified_by),
         verified_at = now(),
         posted_at = now(),
         discrepancy_reason = CASE WHEN v_short THEN p_reason ELSE discrepancy_reason END
   WHERE id = t.id;
END $function$;

GRANT EXECUTE ON FUNCTION public.stock_transfer_verify(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_transfer_verify(uuid, text, jsonb, text) TO service_role;

-- Dispatch refuses to move stock the sending branch does not have.
CREATE OR REPLACE FUNCTION public.stock_transfer_dispatch(
  p_transfer_id uuid,
  p_dispatched_by text DEFAULT NULL::text,
  p_lines jsonb DEFAULT NULL::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.stock_transfers;
  it record;
  v_qty integer;
  v_before integer;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can dispatch a transfer';
  END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF t.status <> 'approved' THEN
    RAISE EXCEPTION 'Transfer % is % and cannot be dispatched', t.ref, t.status;
  END IF;

  FOR it IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = t.id LOOP
    v_qty := COALESCE(
      (SELECT (l ->> 'qty')::int FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l
        WHERE l ->> 'product_id' = it.product_id::text LIMIT 1),
      it.quantity_approved, it.quantity);
    v_qty := GREATEST(LEAST(v_qty, COALESCE(it.quantity_approved, it.quantity)), 0);

    UPDATE public.stock_transfer_items SET quantity_dispatched = v_qty WHERE id = it.id;

    CONTINUE WHEN v_qty <= 0;

    SELECT COALESCE((stock_by_store ->> t.from_store_id)::int, 0) INTO v_before
      FROM public.products WHERE id = it.product_id FOR UPDATE;

    IF COALESCE(v_before, 0) < v_qty THEN
      RAISE EXCEPTION 'Short by % of % at the sending branch',
        v_qty - COALESCE(v_before, 0),
        COALESCE((SELECT name FROM public.products WHERE id = it.product_id), 'item')
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.products
       SET stock_by_store = jsonb_set(
             COALESCE(stock_by_store, '{}'::jsonb), ARRAY[t.from_store_id],
             to_jsonb(COALESCE((stock_by_store ->> t.from_store_id)::int, 0) - v_qty), true),
           stock_quantity = GREATEST(stock_quantity - v_qty, 0)
     WHERE id = it.product_id;

    INSERT INTO public.item_activity_logs
      (product_id, product_name, store_id, activity_type, reference,
       quantity_delta, stock_before, stock_after, unit_cost, staff_name, note)
    SELECT it.product_id, p.name, t.from_store_id, 'transfer_out', t.ref,
           -v_qty, COALESCE(v_before, 0), COALESCE(v_before, 0) - v_qty,
           COALESCE(p.cost_price, 0), COALESCE(p_dispatched_by, ''), ''
      FROM public.products p WHERE p.id = it.product_id;
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'dispatched',
         dispatched_by = COALESCE(p_dispatched_by, dispatched_by),
         dispatched_at = now()
   WHERE id = t.id;
END $function$;

-- Historical rows: already received means already posted.
UPDATE public.stock_transfer_items i
   SET quantity_verified = COALESCE(i.quantity_received, i.quantity_dispatched, i.quantity)
  FROM public.stock_transfers t
 WHERE t.id = i.transfer_id
   AND t.status = 'received'
   AND i.quantity_verified IS NULL;

UPDATE public.stock_transfers
   SET status = 'completed',
       verified_by = COALESCE(verified_by, received_by),
       verified_at = COALESCE(verified_at, received_at),
       posted_at = COALESCE(posted_at, received_at, now())
 WHERE status = 'received';

-- ------------------------------------------------------------------
-- Stock transfer verify - grant
-- (source: 20260902034240_c0e1ac50-4e17-4215-85d7-7834619526a2.sql)
-- ------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.stock_transfer_verify(uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stock_transfer_verify(uuid, text, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.stock_transfer_verify(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_transfer_verify(uuid, text, jsonb, text) TO service_role;

-- ------------------------------------------------------------------
-- Authorisation requests: amounts and bill snapshot
-- (source: 20260904111958_84467a29-26bd-47b6-b5b0-412ec9798f34.sql)
-- ------------------------------------------------------------------
ALTER TABLE public.authorization_requests
  ADD COLUMN IF NOT EXISTS requested_amount numeric,
  ADD COLUMN IF NOT EXISTS approved_amount numeric,
  ADD COLUMN IF NOT EXISTS approved_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS bill_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_hash text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS held_order_id text,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

CREATE INDEX IF NOT EXISTS authorization_requests_requester_idx
  ON public.authorization_requests (requested_by, created_at DESC);

ALTER TABLE public.held_orders
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'held',
  ADD COLUMN IF NOT EXISTS pending_request_id uuid;

CREATE INDEX IF NOT EXISTS held_orders_status_idx ON public.held_orders (status);

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS authorization_request_id uuid,
  ADD COLUMN IF NOT EXISTS authorized_by text,
  ADD COLUMN IF NOT EXISTS authorized_at timestamptz;

ALTER TABLE public.activity_events
  ADD COLUMN IF NOT EXISTS cleared_by text[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'activity_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_events;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'authorization_requests'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.authorization_requests';
  END IF;
END $$;

-- ------------------------------------------------------------------
-- Navigation pins
-- (source: 20260904152046_c8d143c4-f160-46f0-92b9-9802677b7d38.sql)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nav_pins (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NULL,
  item_kind text NOT NULL CHECK (item_kind IN ('nav', 'settings')),
  item_key text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS nav_pins_owner_item_uk
  ON public.nav_pins (COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), item_kind, item_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nav_pins TO authenticated;
GRANT ALL ON public.nav_pins TO service_role;

ALTER TABLE public.nav_pins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nav_pins_read_own_and_company" ON public.nav_pins;
CREATE POLICY "nav_pins_read_own_and_company" ON public.nav_pins
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR owner_id IS NULL);

DROP POLICY IF EXISTS "nav_pins_insert_own" ON public.nav_pins;
CREATE POLICY "nav_pins_insert_own" ON public.nav_pins
  FOR INSERT TO authenticated
  WITH CHECK (
    (owner_id = auth.uid())
    OR (owner_id IS NULL AND public.has_role(auth.uid(), 'admin'))
  );

DROP POLICY IF EXISTS "nav_pins_update_own" ON public.nav_pins;
CREATE POLICY "nav_pins_update_own" ON public.nav_pins
  FOR UPDATE TO authenticated
  USING (
    (owner_id = auth.uid())
    OR (owner_id IS NULL AND public.has_role(auth.uid(), 'admin'))
  )
  WITH CHECK (
    (owner_id = auth.uid())
    OR (owner_id IS NULL AND public.has_role(auth.uid(), 'admin'))
  );

DROP POLICY IF EXISTS "nav_pins_delete_own" ON public.nav_pins;
CREATE POLICY "nav_pins_delete_own" ON public.nav_pins
  FOR DELETE TO authenticated
  USING (
    (owner_id = auth.uid())
    OR (owner_id IS NULL AND public.has_role(auth.uid(), 'admin'))
  );

DROP TRIGGER IF EXISTS nav_pins_set_updated_at ON public.nav_pins;
CREATE TRIGGER nav_pins_set_updated_at
  BEFORE UPDATE ON public.nav_pins
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Full read-only inventory used by Settings -> Database health.
CREATE OR REPLACE FUNCTION public.schema_inventory_deep()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    jsonb_object_agg(t.relname, jsonb_build_object(
      'rls', t.relrowsecurity,
      'columns', COALESCE((
        SELECT jsonb_object_agg(a.attname, jsonb_build_object(
          'type', format_type(a.atttypid, a.atttypmod),
          'nullable', NOT a.attnotnull,
          'default', pg_get_expr(d.adbin, d.adrelid)
        ))
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
      ), '{}'::jsonb),
      'constraints', COALESCE((
        SELECT jsonb_object_agg(c.conname, jsonb_build_object(
          'kind', c.contype::text,
          'definition', pg_get_constraintdef(c.oid)
        ))
        FROM pg_constraint c WHERE c.conrelid = t.oid
      ), '{}'::jsonb),
      'indexes', COALESCE((
        SELECT jsonb_agg(i.indexname ORDER BY i.indexname)
        FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename = t.relname
      ), '[]'::jsonb),
      'triggers', COALESCE((
        SELECT jsonb_agg(g.tgname ORDER BY g.tgname)
        FROM pg_trigger g WHERE g.tgrelid = t.oid AND NOT g.tgisinternal
      ), '[]'::jsonb),
      'policies', COALESCE((
        SELECT jsonb_agg(p.policyname ORDER BY p.policyname)
        FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.relname
      ), '[]'::jsonb)
    )),
    '{}'::jsonb
  )
  FROM pg_class t
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND t.relkind = 'r';
$$;

REVOKE ALL ON FUNCTION public.schema_inventory_deep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schema_inventory_deep() TO service_role;

-- ===========================================================================
-- Verification - lists anything still missing after this run.
-- An empty result means the database matches this file.
-- ===========================================================================
DO $verify$
DECLARE
  missing text[] := ARRAY[]::text[];
  t text;
  f text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_users','audit_logs','authorization_actions','authorization_log',
    'authorization_requests','bookings','booking_payments','cashiers',
    'coupon_campaigns','coupon_events','drawer_events','entity_status_history',
    'held_orders','issued_vouchers','item_activity_logs','members',
    'member_verifications','membership_tiers','nav_pins','payment_transactions',
    'payment_types','pos_settings','pos_store_settings','product_barcodes',
    'product_categories','products','promotions','public_flags',
    'purchase_orders','purchase_order_items','record_edits','sale_items','sales',
    'secure_settings','security_findings','settings_locks','settings_overrides',
    'settings_scoped','shift_cash_counts','shift_close_events',
    'shift_reconciliations','shift_sessions','shift_variance_alerts','shifts',
    'sku_audit','staff_roles','stock_adjustments','stock_count_drafts',
    'stock_delta_applied','stock_transfers','stock_transfer_items','stores',
    'suppliers','sync_metadata','terminal_commands','terminal_tokens',
    'uom_units','user_roles','whatsapp_queue'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      missing := missing || ('table ' || t);
    END IF;
  END LOOP;

  FOREACH f IN ARRAY ARRAY[
    'booking_balance_state','booking_cancel','booking_collect','booking_refund',
    'has_role','product_delete_guard','shift_state','stock_apply_deltas',
    'schema_inventory_deep','stock_reconcile','stock_transfer_approve',
    'stock_transfer_dispatch','stock_transfer_receive','stock_transfer_verify'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = f
    ) THEN
      missing := missing || ('function ' || f);
    END IF;
  END LOOP;

  IF array_length(missing, 1) IS NULL THEN
    RAISE NOTICE 'Schema check: everything present.';
  ELSE
    RAISE WARNING 'Schema check: still missing -> %', array_to_string(missing, ', ');
  END IF;
END
$verify$;

-- Branch-owned catalogue (Phase 6 branch isolation)
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS private_catalogue boolean DEFAULT false NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS owner_store_id text REFERENCES public.stores(id) ON DELETE SET NULL;

-- Atomically accept one immutable POS sale graph.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS rounding_adjustment numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rounding_label text;

CREATE OR REPLACE FUNCTION public.pos_sale_commit(
  _sale jsonb,
  _items jsonb DEFAULT '[]'::jsonb,
  _payments jsonb DEFAULT '[]'::jsonb,
  _movements jsonb DEFAULT '[]'::jsonb,
  _member jsonb DEFAULT NULL,
  _exchange_bill text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  s jsonb := COALESCE(_sale, '{}'::jsonb);
  entry jsonb;
  existing_id uuid;
  movement_result record;
BEGIN
  IF NULLIF(s->>'id', '') IS NULL OR NULLIF(s->>'bill_number', '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_SALE: id and bill number are required' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO existing_id FROM public.sales
   WHERE id = (s->>'id')::uuid
      OR (NULLIF(s->>'client_transaction_id','') IS NOT NULL
          AND client_transaction_id = s->>'client_transaction_id')
   LIMIT 1;
  IF existing_id IS NOT NULL AND existing_id <> (s->>'id')::uuid THEN
    RAISE EXCEPTION 'DUPLICATE_TRANSACTION: attempt already belongs to sale %', existing_id
      USING ERRCODE = '23505';
  END IF;

  -- A sale and its tender rows both reference the attached member. Upsert the
  -- parent first so a member created on this device can be used immediately.
  IF _member IS NOT NULL AND NULLIF(_member->>'id','') IS NOT NULL THEN
    INSERT INTO public.members (
      id, member_code, full_name, phone, email, address, date_of_birth,
      tier_id, loyalty_points, total_spent, updated_at
    ) VALUES (
      (_member->>'id')::uuid, _member->>'member_code', _member->>'full_name',
      COALESCE(_member->>'phone',''), NULLIF(_member->>'email',''),
      NULLIF(_member->>'address',''), NULLIF(_member->>'date_of_birth','')::date,
      NULLIF(_member->>'tier_id','')::uuid, COALESCE((_member->>'loyalty_points')::numeric,0),
      COALESCE((_member->>'total_spent')::numeric,0), now()
    ) ON CONFLICT (id) DO UPDATE SET
      member_code = EXCLUDED.member_code, full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone, email = EXCLUDED.email, address = EXCLUDED.address,
      date_of_birth = EXCLUDED.date_of_birth, tier_id = EXCLUDED.tier_id,
      loyalty_points = EXCLUDED.loyalty_points, total_spent = EXCLUDED.total_spent,
      row_version = members.row_version,
      updated_at = now();
  END IF;

  IF existing_id IS NULL THEN
    INSERT INTO public.sales (
    id, bill_number, member_id, store_id, shift_id, cashier_name,
    subtotal_amount, total_amount, discount_amount, tax_amount, payment_type,
    payments, points_earned, points_redeemed, is_exchange, original_bill_number,
    exchange_credit, paid_amount, change_amount, is_refunded, coupon_code,
    coupon_promo_id, coupon_scope, coupon_discount, client_transaction_id,
    store_name_snapshot, store_address_snapshot, rounding_adjustment,
    rounding_label, authorization_request_id, authorized_by, authorized_at,
    created_at
  ) VALUES (
    (s->>'id')::uuid, s->>'bill_number', NULLIF(s->>'member_id','')::uuid,
    NULLIF(s->>'store_id',''), NULLIF(s->>'shift_id',''), NULLIF(s->>'cashier_name',''),
    COALESCE((s->>'subtotal_amount')::numeric,0), COALESCE((s->>'total_amount')::numeric,0),
    COALESCE((s->>'discount_amount')::numeric,0), COALESCE((s->>'tax_amount')::numeric,0),
    COALESCE(NULLIF(s->>'payment_type',''),'cash'), COALESCE(s->'payments','[]'::jsonb),
    COALESCE((s->>'points_earned')::numeric,0), COALESCE((s->>'points_redeemed')::numeric,0),
    COALESCE((s->>'is_exchange')::boolean,false), NULLIF(s->>'original_bill_number',''),
    COALESCE((s->>'exchange_credit')::numeric,0), COALESCE((s->>'paid_amount')::numeric,0),
    COALESCE((s->>'change_amount')::numeric,0), COALESCE((s->>'is_refunded')::boolean,false),
    NULLIF(s->>'coupon_code',''), NULLIF(s->>'coupon_promo_id',''), NULLIF(s->>'coupon_scope',''),
    COALESCE((s->>'coupon_discount')::numeric,0), NULLIF(s->>'client_transaction_id',''),
    NULLIF(s->>'store_name_snapshot',''), NULLIF(s->>'store_address_snapshot',''),
    COALESCE((s->>'rounding_adjustment')::numeric,0), NULLIF(s->>'rounding_label',''),
    NULLIF(s->>'authorization_request_id','')::uuid, NULLIF(s->>'authorized_by',''),
    NULLIF(s->>'authorized_at','')::timestamptz, COALESCE(NULLIF(s->>'created_at','')::timestamptz,now())
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(_items,'[]'::jsonb)) LOOP
    INSERT INTO public.sale_items (
      id, sale_id, product_id, product_name, unit_price, unit_cost, quantity,
      discount_percent, discount_amount, tax_rate, is_return, is_foc,
      promo_id, coupon_code, coupon_discount, created_at
    ) VALUES (
      (entry->>'id')::uuid, (s->>'id')::uuid, NULLIF(entry->>'product_id','')::uuid,
      entry->>'product_name', COALESCE((entry->>'unit_price')::numeric,0),
      COALESCE((entry->>'unit_cost')::numeric,0), COALESCE((entry->>'quantity')::integer,1),
      COALESCE((entry->>'discount_percent')::numeric,0), COALESCE((entry->>'discount_amount')::numeric,0),
      COALESCE((entry->>'tax_rate')::numeric,0), COALESCE((entry->>'is_return')::boolean,false),
      COALESCE((entry->>'is_foc')::boolean,false), NULLIF(entry->>'promo_id',''),
      NULLIF(entry->>'coupon_code',''), COALESCE((entry->>'coupon_discount')::numeric,0), now()
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(_payments,'[]'::jsonb)) LOOP
    INSERT INTO public.payment_transactions (
      id, client_transaction_id, source_type, sale_id, booking_id, member_id, store_id, shift_id,
      terminal_id, amount, method, kind, reference, cashier_id, cashier_name,
      note, paid_at, created_at, status, metadata
    ) VALUES (
      (entry->>'id')::uuid, NULLIF(entry->>'client_transaction_id',''),
      COALESCE(NULLIF(entry->>'source_type',''),'sale'),
      (s->>'id')::uuid, NULL, NULLIF(entry->>'member_id','')::uuid,
      NULLIF(s->>'store_id',''), NULLIF(entry->>'shift_id',''),
      NULLIF(entry->>'terminal_id',''), COALESCE((entry->>'amount')::numeric,0),
      COALESCE(NULLIF(entry->>'method',''),'cash'), COALESCE(NULLIF(entry->>'kind',''),'payment'),
      NULLIF(entry->>'reference',''), NULLIF(entry->>'cashier_id',''), NULLIF(entry->>'cashier_name',''),
      COALESCE(entry->>'note',''), COALESCE(NULLIF(entry->>'paid_at','')::timestamptz,now()),
      COALESCE(NULLIF(entry->>'created_at','')::timestamptz,now()),
      COALESCE(NULLIF(entry->>'status',''),'completed'), COALESCE(entry->'metadata','{}'::jsonb)
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(_movements,'[]'::jsonb)) LOOP
    INSERT INTO public.item_activity_logs (
      id, product_id, product_name, sku, barcode, store_id, terminal_id,
      activity_type, reference, quantity_delta, stock_before, stock_after,
      unit_cost, staff_id, staff_name, role, note, created_at
    ) VALUES (
      (entry->>'id')::uuid, NULLIF(entry->>'product_id','')::uuid, NULLIF(entry->>'product_name',''),
      NULLIF(entry->>'sku',''), NULLIF(entry->>'barcode',''), NULLIF(s->>'store_id',''),
      NULLIF(entry->>'terminal_id',''), entry->>'activity_type', NULLIF(entry->>'reference',''),
      COALESCE((entry->>'quantity_delta')::integer,0), NULLIF(entry->>'stock_before','')::integer,
      NULLIF(entry->>'stock_after','')::integer, COALESCE((entry->>'unit_cost')::numeric,0),
      NULLIF(entry->>'staff_id',''), NULLIF(entry->>'staff_name',''), NULLIF(entry->>'role',''),
      COALESCE(entry->>'note',''), COALESCE(NULLIF(entry->>'created_at','')::timestamptz,now())
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR movement_result IN
    SELECT * FROM public.stock_apply_deltas(
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'movement_id', movement_entry.value->>'id',
        'product_id', movement_entry.value->>'product_id',
        'store_id', s->>'store_id',
        'delta', movement_entry.value->>'quantity_delta'
      )), '[]'::jsonb)
       FROM jsonb_array_elements(COALESCE(_movements,'[]'::jsonb)) AS movement_entry(value))
    )
  LOOP
    IF movement_result.status = 'refused' THEN
      RAISE EXCEPTION 'STOCK_REFUSED: %', COALESCE(movement_result.reason,'failed')
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF NULLIF(_exchange_bill,'') IS NOT NULL THEN
    UPDATE public.sales SET exchanged_to_bill_number = s->>'bill_number'
     WHERE bill_number = _exchange_bill AND COALESCE(store_id,'') = COALESCE(s->>'store_id','');
  END IF;

  RETURN jsonb_build_object('id', s->>'id', 'client_transaction_id', s->>'client_transaction_id');
END;
$$;

REVOKE ALL ON FUNCTION public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text) TO authenticated, service_role;


-- Consolidated online security/schema change: 20260904070156_26e6d957-510b-454c-82ee-69ba378abe1a.sql
-- Branch isolation for stock transfers and their items.

DROP POLICY IF EXISTS "Staff read transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Staff write transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Branch staff write transfer items" ON public.stock_transfer_items;

DROP POLICY IF EXISTS "Staff read transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Staff raise transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Staff update transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Supervisors delete transfers" ON public.stock_transfers;

CREATE OR REPLACE FUNCTION public.transfer_in_my_branch(_transfer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.stock_transfers t
     WHERE t.id = _transfer_id
       AND (public.user_has_store_access(t.from_store_id)
            OR public.user_has_store_access(t.to_store_id))
  )
$$;

REVOKE ALL ON FUNCTION public.transfer_in_my_branch(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.transfer_in_my_branch(uuid) TO authenticated, service_role;

CREATE POLICY "Branch staff read transfers"
ON public.stock_transfers FOR SELECT TO authenticated
USING (
  public.is_staff_now()
  AND (public.user_has_store_access(from_store_id) OR public.user_has_store_access(to_store_id))
);

CREATE POLICY "Branch staff raise transfers"
ON public.stock_transfers FOR INSERT TO authenticated
WITH CHECK (public.is_staff_now() AND public.user_has_store_access(from_store_id));

CREATE POLICY "Branch staff update transfers"
ON public.stock_transfers FOR UPDATE TO authenticated
USING (
  public.is_staff_now()
  AND (public.user_has_store_access(from_store_id) OR public.user_has_store_access(to_store_id))
)
WITH CHECK (
  public.is_staff_now()
  AND (public.user_has_store_access(from_store_id) OR public.user_has_store_access(to_store_id))
);

CREATE POLICY "Branch supervisors delete transfers"
ON public.stock_transfers FOR DELETE TO authenticated
USING (
  public.is_supervisor_now()
  AND (public.user_has_store_access(from_store_id) OR public.user_has_store_access(to_store_id))
);

CREATE POLICY "Branch staff read transfer items"
ON public.stock_transfer_items FOR SELECT TO authenticated
USING (public.is_staff_now() AND public.transfer_in_my_branch(transfer_id));

CREATE POLICY "Branch staff add transfer items"
ON public.stock_transfer_items FOR INSERT TO authenticated
WITH CHECK (public.is_staff_now() AND public.transfer_in_my_branch(transfer_id));

CREATE POLICY "Branch staff update transfer items"
ON public.stock_transfer_items FOR UPDATE TO authenticated
USING (public.is_staff_now() AND public.transfer_in_my_branch(transfer_id))
WITH CHECK (public.is_staff_now() AND public.transfer_in_my_branch(transfer_id));

CREATE POLICY "Branch staff delete transfer items"
ON public.stock_transfer_items FOR DELETE TO authenticated
USING (public.is_staff_now() AND public.transfer_in_my_branch(transfer_id));

-- A row may never be re-pointed at a transfer the caller cannot reach.
CREATE OR REPLACE FUNCTION public.stock_transfer_items_guard_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- server-side/service-role paths re-check the caller themselves
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.transfer_id IS DISTINCT FROM OLD.transfer_id THEN
    IF NOT public.transfer_in_my_branch(NEW.transfer_id) THEN
      RAISE EXCEPTION 'You cannot move this item onto another branch''s transfer';
    END IF;
  END IF;
  IF NOT public.transfer_in_my_branch(NEW.transfer_id) THEN
    RAISE EXCEPTION 'You can only change transfer items for your own branch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_transfer_items_guard_parent ON public.stock_transfer_items;
CREATE TRIGGER stock_transfer_items_guard_parent
BEFORE INSERT OR UPDATE ON public.stock_transfer_items
FOR EACH ROW EXECUTE FUNCTION public.stock_transfer_items_guard_parent();

-- Consolidated online security/schema change: 20260904070308_14eef988-b966-4fd0-b0a8-36d5183033c0.sql
-- 1. Per-line refunded quantity ------------------------------------------
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS refunded_qty integer NOT NULL DEFAULT 0;

ALTER TABLE public.sale_items
  DROP CONSTRAINT IF EXISTS sale_items_refunded_qty_bounds;
ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_refunded_qty_bounds
  CHECK (refunded_qty >= 0 AND refunded_qty <= GREATEST(quantity, 0));

-- 2. Only the refund routine may move those figures ------------------------
CREATE OR REPLACE FUNCTION public.guard_refund_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF coalesce(current_setting('pos.refunding', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- trusted server paths (service role) do their own checks
  END IF;
  IF TG_TABLE_NAME = 'sale_items'
     AND NEW.refunded_qty IS DISTINCT FROM OLD.refunded_qty THEN
    RAISE EXCEPTION 'Refunded quantity can only be changed by processing a refund';
  END IF;
  IF TG_TABLE_NAME = 'sales'
     AND coalesce(NEW.is_refunded, false) IS DISTINCT FROM coalesce(OLD.is_refunded, false) THEN
    RAISE EXCEPTION 'A bill can only be marked refunded by processing a refund';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_sale_items_refunded_qty ON public.sale_items;
CREATE TRIGGER guard_sale_items_refunded_qty
BEFORE UPDATE ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION public.guard_refund_fields();

DROP TRIGGER IF EXISTS guard_sales_refunded ON public.sales;
CREATE TRIGGER guard_sales_refunded
BEFORE UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.guard_refund_fields();

-- 3. The refund routine ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.sale_refund(
  _sale_id uuid,
  _lines jsonb DEFAULT NULL,
  _client_refund_id text DEFAULT NULL,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  _sale public.sales%ROWTYPE;
  _key text := coalesce(nullif(btrim(coalesce(_client_refund_id, '')), ''), _sale_id::text);
  _item record;
  _want integer;
  _remaining integer;
  _movement uuid;
  _stock integer;
  _results jsonb := '[]'::jsonb;
  _outstanding integer;
BEGIN
  IF NOT public.is_staff_now() THEN
    RAISE EXCEPTION 'Sign in with a staff account to process a refund';
  END IF;
  IF NOT public.has_perm('can_process_refund') THEN
    RAISE EXCEPTION 'You are not allowed to process refunds';
  END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown bill';
  END IF;
  IF NOT public.user_has_store_access(_sale.store_id) THEN
    RAISE EXCEPTION 'You can only refund bills from your own branch';
  END IF;

  PERFORM set_config('pos.refunding', 'on', true);

  FOR _item IN
    SELECT si.id, si.product_id, si.quantity, si.refunded_qty
      FROM public.sale_items si
     WHERE si.sale_id = _sale_id
     ORDER BY si.id
     FOR UPDATE
  LOOP
    IF _lines IS NULL OR jsonb_array_length(_lines) = 0 THEN
      _want := GREATEST(_item.quantity, 0) - _item.refunded_qty;
    ELSE
      SELECT COALESCE(SUM(GREATEST((l ->> 'qty')::int, 0)), 0) INTO _want
        FROM jsonb_array_elements(_lines) l
       WHERE (l ->> 'item_id') = _item.id::text
          OR ((l ->> 'item_id') IS NULL AND (l ->> 'product_id') = _item.product_id::text);
    END IF;

    CONTINUE WHEN coalesce(_want, 0) <= 0;

    _remaining := GREATEST(_item.quantity, 0) - _item.refunded_qty;
    IF _want > _remaining THEN
      RAISE EXCEPTION 'Cannot return % of "%": only % left to return',
        _want, _item.product_id, _remaining;
    END IF;

    UPDATE public.sale_items
       SET refunded_qty = refunded_qty + _want
     WHERE id = _item.id;

    -- Deterministic movement id: replaying the same refund moves no stock.
    _movement := md5(_key || ':' || _item.id::text)::uuid;
    _stock := public.stock_apply_delta(_movement, _item.product_id, _sale.store_id, _want);
    _results := _results || jsonb_build_object(
      'item_id', _item.id,
      'product_id', _item.product_id,
      'qty', _want,
      'stock', _stock
    );
  END LOOP;

  SELECT COALESCE(SUM(GREATEST(si.quantity, 0) - si.refunded_qty), 0) INTO _outstanding
    FROM public.sale_items si WHERE si.sale_id = _sale_id;

  IF _outstanding = 0 THEN
    UPDATE public.sales
       SET is_refunded = true, updated_by = coalesce(auth.uid()::text, updated_by)
     WHERE id = _sale_id AND coalesce(is_refunded, false) = false;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (action, entity_type, entity_id, user_id, details)
    VALUES ('sale_refund', 'sale', _sale_id::text, auth.uid(),
            jsonb_build_object('reason', _reason, 'lines', _results, 'refund_id', _key));
  EXCEPTION WHEN others THEN
    NULL; -- the audit shape varies by deployment; never block the refund
  END;

  PERFORM set_config('pos.refunding', 'off', true);

  RETURN jsonb_build_object(
    'sale_id', _sale_id,
    'fully_refunded', _outstanding = 0,
    'lines', _results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sale_refund(uuid, jsonb, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.sale_refund(uuid, jsonb, text, text) TO authenticated, service_role;

-- 4. Narrow a couple of over-broad read policies ---------------------------
DROP POLICY IF EXISTS payment_types_read ON public.payment_types;
CREATE POLICY payment_types_read ON public.payment_types
FOR SELECT TO authenticated USING (public.is_staff_now());

DROP POLICY IF EXISTS "Staff read authorisation rules" ON public.authorization_actions;
CREATE POLICY "Staff read authorisation rules" ON public.authorization_actions
FOR SELECT TO authenticated
USING (public.is_staff_now() AND (scope_id = '' OR public.store_visible(scope_id)));

DROP POLICY IF EXISTS "Staff read authorisation log" ON public.authorization_log;
CREATE POLICY "Staff read authorisation log" ON public.authorization_log
FOR SELECT TO authenticated
USING (public.is_staff_now() AND (store_id = '' OR public.store_visible(store_id)));

DROP POLICY IF EXISTS "Staff read authorisation requests" ON public.authorization_requests;
CREATE POLICY "Staff read authorisation requests" ON public.authorization_requests
FOR SELECT TO authenticated
USING (public.is_staff_now() AND (store_id = '' OR public.store_visible(store_id)));

-- Consolidated online security/schema change: 20260904070344_c60837bc-e193-4eff-abe5-6590ef45f400.sql
REVOKE ALL ON FUNCTION public.guard_refund_fields() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.stock_transfer_items_guard_parent() FROM public, anon, authenticated;

-- Consolidated online security/schema change: 20260904070825_10fd6b13-5f44-402d-8c41-c80dc5989e87.sql
CREATE OR REPLACE FUNCTION public.sale_refund(
  _sale_id uuid,
  _lines jsonb DEFAULT NULL,
  _client_refund_id text DEFAULT NULL,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  _sale public.sales%ROWTYPE;
  _key text := coalesce(nullif(btrim(coalesce(_client_refund_id, '')), ''), _sale_id::text);
  _item record;
  _want integer;
  _remaining integer;
  _movement uuid;
  _stock integer;
  _results jsonb := '[]'::jsonb;
  _outstanding integer;
  _direct boolean := auth.uid() IS NOT NULL;
BEGIN
  -- A direct caller must be staff with the refund permission. A call with no
  -- signed-in user can only come from the trusted server relay, which has
  -- already proved the caller, their branch and their permission.
  IF _direct THEN
    IF NOT public.is_staff_now() THEN
      RAISE EXCEPTION 'Sign in with a staff account to process a refund';
    END IF;
    IF NOT public.has_perm('can_process_refund') THEN
      RAISE EXCEPTION 'You are not allowed to process refunds';
    END IF;
  END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown bill';
  END IF;
  IF _direct AND NOT public.user_has_store_access(_sale.store_id) THEN
    RAISE EXCEPTION 'You can only refund bills from your own branch';
  END IF;

  PERFORM set_config('pos.refunding', 'on', true);

  FOR _item IN
    SELECT si.id, si.product_id, si.quantity, si.refunded_qty
      FROM public.sale_items si
     WHERE si.sale_id = _sale_id
     ORDER BY si.id
     FOR UPDATE
  LOOP
    IF _lines IS NULL OR jsonb_array_length(_lines) = 0 THEN
      _want := GREATEST(_item.quantity, 0) - _item.refunded_qty;
    ELSE
      SELECT COALESCE(SUM(GREATEST((l ->> 'qty')::int, 0)), 0) INTO _want
        FROM jsonb_array_elements(_lines) l
       WHERE (l ->> 'item_id') = _item.id::text
          OR ((l ->> 'item_id') IS NULL AND (l ->> 'product_id') = _item.product_id::text);
    END IF;

    CONTINUE WHEN coalesce(_want, 0) <= 0;

    _remaining := GREATEST(_item.quantity, 0) - _item.refunded_qty;
    IF _want > _remaining THEN
      RAISE EXCEPTION 'Cannot return % of "%": only % left to return',
        _want, _item.product_id, _remaining;
    END IF;

    UPDATE public.sale_items
       SET refunded_qty = refunded_qty + _want
     WHERE id = _item.id;

    _movement := md5(_key || ':' || _item.id::text)::uuid;
    _stock := public.stock_apply_delta(_movement, _item.product_id, _sale.store_id, _want);
    _results := _results || jsonb_build_object(
      'item_id', _item.id,
      'product_id', _item.product_id,
      'qty', _want,
      'stock', _stock
    );
  END LOOP;

  SELECT COALESCE(SUM(GREATEST(si.quantity, 0) - si.refunded_qty), 0) INTO _outstanding
    FROM public.sale_items si WHERE si.sale_id = _sale_id;

  IF _outstanding = 0 THEN
    UPDATE public.sales
       SET is_refunded = true, updated_by = coalesce(auth.uid()::text, updated_by)
     WHERE id = _sale_id AND coalesce(is_refunded, false) = false;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (action, entity_type, entity_id, user_id, details)
    VALUES ('sale_refund', 'sale', _sale_id::text, auth.uid(),
            jsonb_build_object('reason', _reason, 'lines', _results, 'refund_id', _key));
  EXCEPTION WHEN others THEN
    NULL;
  END;

  PERFORM set_config('pos.refunding', 'off', true);

  RETURN jsonb_build_object(
    'sale_id', _sale_id,
    'fully_refunded', _outstanding = 0,
    'lines', _results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sale_refund(uuid, jsonb, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sale_refund(uuid, jsonb, text, text) TO authenticated, service_role;

-- Consolidated online security/schema change: 20260904071927_886b38d0-c8be-4ba0-a75e-0a96fba0b61a.sql
-- Defence in depth: even with a permissive access rule, a signed-in staff
-- member may never lift their own role, permissions, branch or active flag.
CREATE OR REPLACE FUNCTION public.app_users_block_self_privilege_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Server-side maintenance (service role) and administrators are unaffected.
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.auth_user_id IS NOT DISTINCT FROM auth.uid() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.permissions IS DISTINCT FROM OLD.permissions
       OR NEW.store_id IS DISTINCT FROM OLD.store_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'You cannot change your own role, permissions, branch or access.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_users_block_self_privilege_change ON public.app_users;
CREATE TRIGGER app_users_block_self_privilege_change
BEFORE UPDATE ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.app_users_block_self_privilege_change();

-- Nobody grants themselves a role, whatever the access rules say.
CREATE OR REPLACE FUNCTION public.user_roles_block_self_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  subject uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF auth.uid() IS NOT NULL AND subject IS NOT DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS user_roles_block_self_grant ON public.user_roles;
CREATE TRIGGER user_roles_block_self_grant
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.user_roles_block_self_grant();

-- These three tables carry protection with no access rules on purpose: they
-- are reachable only by the server. The note keeps that decision visible.
COMMENT ON TABLE public.cashiers IS
  'Server-only. Row protection is on with no access rules by design: reached solely through security-definer routines. Do not add a client-facing rule.';
COMMENT ON TABLE public.pin_attempts IS
  'Server-only. Row protection is on with no access rules by design: throttling state is written only by security-definer routines. Do not add a client-facing rule.';
COMMENT ON TABLE public.terminal_recovery_secrets IS
  'Server-only. Row protection is on with no access rules by design: device recovery material must never be readable by a signed-in client.';

-- Consolidated online security/schema change: 20260904071954_b53cc509-55cb-475c-a374-717470113dbf.sql
REVOKE EXECUTE ON FUNCTION public.app_users_block_self_privilege_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_roles_block_self_grant() FROM PUBLIC, anon, authenticated;

-- Consolidated online security/schema change: 20260904072036_a1008e23-f180-495c-a8df-328f2819de8b.sql
REVOKE EXECUTE ON FUNCTION public.bookings_block_unpaid_collection() FROM PUBLIC, anon, authenticated;

-- Consolidated online security/schema change: 20260905054633_a41d6738-b9ad-4597-aecb-6eddb7ece87f.sql
-- ---------------------------------------------------------------- groups ---
CREATE TABLE IF NOT EXISTS public.store_groups (
  id text NOT NULL PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.store_groups TO authenticated;
GRANT ALL ON public.store_groups TO service_role;

ALTER TABLE public.store_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read store groups" ON public.store_groups;
CREATE POLICY "Staff can read store groups" ON public.store_groups
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Supervisors manage store groups" ON public.store_groups;
CREATE POLICY "Supervisors manage store groups" ON public.store_groups
  FOR INSERT TO authenticated WITH CHECK (public.is_app_supervisor());

DROP POLICY IF EXISTS "Supervisors update store groups" ON public.store_groups;
CREATE POLICY "Supervisors update store groups" ON public.store_groups
  FOR UPDATE TO authenticated USING (public.is_app_supervisor())
  WITH CHECK (public.is_app_supervisor());

DROP TRIGGER IF EXISTS store_groups_touch ON public.store_groups;
CREATE TRIGGER store_groups_touch BEFORE UPDATE ON public.store_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE UNIQUE INDEX IF NOT EXISTS store_groups_code_uidx
  ON public.store_groups (upper(code));

-- Keep the group ids the branches already carry, so nothing changes meaning.
INSERT INTO public.store_groups (id, code, name)
SELECT DISTINCT btrim(s.group_id),
       upper(left(regexp_replace(btrim(s.group_id), '[^a-zA-Z0-9]', '', 'g'), 12)),
       btrim(s.group_id)
  FROM public.stores s
 WHERE COALESCE(btrim(s.group_id), '') <> ''
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.store_groups (id, code, name)
VALUES ('default', 'DEFAULT', 'Default group')
ON CONFLICT (id) DO NOTHING;

UPDATE public.stores SET group_id = NULL WHERE COALESCE(btrim(group_id), '') = '';

ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_group_id_fkey;
ALTER TABLE public.stores
  ADD CONSTRAINT stores_group_id_fkey FOREIGN KEY (group_id)
  REFERENCES public.store_groups(id) ON UPDATE CASCADE ON DELETE SET NULL;


-- --------------------------------------------------- cross-group approval ---
CREATE OR REPLACE FUNCTION public.store_group_of(_store_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(NULLIF(btrim(s.group_id), ''), 'default')
    FROM public.stores s WHERE s.id = _store_id
$$;

REVOKE ALL ON FUNCTION public.store_group_of(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_group_of(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_cross_group_transfer(_from text, _to text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.store_group_of(_from) IS DISTINCT FROM public.store_group_of(_to)
$$;

REVOKE ALL ON FUNCTION public.is_cross_group_transfer(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_cross_group_transfer(text, text) TO authenticated, service_role;

-- Cross-group always wins; otherwise the branch/cluster/global setting decides.
CREATE OR REPLACE FUNCTION public.stock_transfer_approval_required(_store_id text, _to_store_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT false
        FROM public.authorization_actions a
       WHERE a.action_key = 'stock_transfer'
         AND a.is_enabled
         AND (
           (a.scope_type = 'branch' AND a.scope_id = _store_id)
           OR (a.scope_type = 'global' AND a.scope_id = '')
         )
       ORDER BY CASE WHEN a.scope_type = 'branch' THEN 0 ELSE 1 END
       LIMIT 1
    ),
    public.stock_transfer_approval_required(_store_id)
  )
$$;

REVOKE ALL ON FUNCTION public.stock_transfer_approval_required(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_transfer_approval_required(text, text)
  TO authenticated, service_role;

-- Who may approve a cross-group transfer: roles plus named people.
INSERT INTO public.authorization_actions
  (action_key, scope_type, scope_id, mode, allowed_roles, allowed_user_ids, is_enabled)
VALUES
  ('cross_group_transfer_approval', 'global', '', 'request',
   ARRAY['admin','manager']::text[], ARRAY[]::text[], true)
ON CONFLICT (action_key, scope_type, scope_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.may_approve_cross_group_transfer()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  u record;
  rule public.authorization_actions;
BEGIN
  IF public.is_app_supervisor() THEN RETURN true; END IF;
  SELECT * INTO u FROM public.current_app_user();
  IF u.id IS NULL OR NOT COALESCE(u.is_active, false) THEN RETURN false; END IF;

  SELECT * INTO rule FROM public.authorization_actions
   WHERE action_key = 'cross_group_transfer_approval'
     AND scope_type = 'global' AND scope_id = '' LIMIT 1;

  IF rule.id IS NULL OR NOT rule.is_enabled THEN
    RETURN public.has_perm('can_approve_transfer');
  END IF;

  RETURN (u.role::text = ANY (rule.allowed_roles))
      OR (COALESCE(u.user_id, '') <> '' AND u.user_id = ANY (rule.allowed_user_ids))
      OR (u.id::text = ANY (rule.allowed_user_ids));
END $$;

REVOKE ALL ON FUNCTION public.may_approve_cross_group_transfer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.may_approve_cross_group_transfer() TO authenticated, service_role;

-- Lifecycle trigger: use the two-branch rule and guard cross-group approval.
CREATE OR REPLACE FUNCTION public.stock_transfers_enforce_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_needs_approval boolean;
  v_cross boolean;
  v_may_approve boolean := public.is_supervisor_now()
    OR public.has_perm('can_approve_transfer')
    OR public.has_perm('can_receive_transfer');
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_needs_approval := public.stock_transfer_approval_required(NEW.from_store_id, NEW.to_store_id);

    IF v_needs_approval THEN
      NEW.status := 'awaiting_approval';
    ELSIF NEW.status IS NULL OR NEW.status NOT IN ('awaiting_approval', 'approved') THEN
      NEW.status := 'approved';
    END IF;

    IF NEW.status = 'approved' AND NOT v_needs_approval THEN
      NEW.approved_by := COALESCE(NEW.approved_by, NEW.created_by);
      NEW.approved_at := COALESCE(NEW.approved_at, now());
    ELSE
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
    END IF;

    NEW.dispatched_by := NULL;
    NEW.dispatched_at := NULL;
    NEW.received_by := NULL;
    NEW.received_at := NULL;
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
    NEW.posted_at := NULL;
    NEW.closed_at := NULL;
    NEW.fulfilment := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('rejected', 'cancelled', 'completed', 'completed_with_discrepancy') THEN
    RAISE EXCEPTION 'Transfer % is closed (%) and cannot change', OLD.ref, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (
    (OLD.status = 'awaiting_approval' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
    OR (OLD.status = 'approved' AND NEW.status IN ('dispatched', 'rejected', 'cancelled'))
    OR (OLD.status = 'dispatched' AND NEW.status = 'received')
    OR (OLD.status = 'received' AND NEW.status IN ('verified', 'completed', 'completed_with_discrepancy'))
    OR (OLD.status = 'verified' AND NEW.status IN ('completed', 'completed_with_discrepancy'))
  ) THEN
    RAISE EXCEPTION 'Transfer % cannot go from % to %', OLD.ref, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  v_cross := public.is_cross_group_transfer(NEW.from_store_id, NEW.to_store_id);

  IF NEW.status IN ('approved', 'rejected') AND NOT v_may_approve THEN
    RAISE EXCEPTION 'You are not allowed to approve or reject transfers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_cross AND NEW.status = 'approved' THEN
    IF NOT public.may_approve_cross_group_transfer() THEN
      RAISE EXCEPTION 'Only an authorised approver can approve a transfer between groups'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF COALESCE(btrim(NEW.approved_by), '') = ''
       OR btrim(lower(NEW.approved_by)) = btrim(lower(COALESCE(NEW.created_by, ''))) THEN
      RAISE EXCEPTION 'A transfer between groups must be approved by someone other than the requester'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.status = 'approved' THEN
    NEW.approved_at := COALESCE(NEW.approved_at, now());
  END IF;

  IF NEW.status = 'rejected' AND COALESCE(btrim(NEW.rejected_reason), '') = '' THEN
    RAISE EXCEPTION 'A rejection needs a reason' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'cancelled' AND COALESCE(btrim(NEW.cancelled_reason), '') = '' THEN
    RAISE EXCEPTION 'A cancellation needs a reason' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'completed_with_discrepancy'
     AND COALESCE(btrim(NEW.discrepancy_reason), '') = '' THEN
    RAISE EXCEPTION 'A discrepancy needs a reason' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'dispatched' THEN
    IF v_cross AND (
         COALESCE(btrim(NEW.approved_by), '') = ''
         OR NEW.approved_at IS NULL
         OR btrim(lower(NEW.approved_by)) = btrim(lower(COALESCE(NEW.created_by, '')))
       ) THEN
      RAISE EXCEPTION 'This transfer crosses groups and has no valid approval'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.dispatched_at := COALESCE(NEW.dispatched_at, now());
    NEW.closed_at := COALESCE(NEW.closed_at, now());
    NEW.fulfilment := (
      SELECT CASE
        WHEN COALESCE(SUM(COALESCE(i.quantity_dispatched, 0)), 0) = 0 THEN 'none'
        WHEN COALESCE(SUM(COALESCE(i.quantity_dispatched, 0)), 0)
             >= COALESCE(SUM(i.quantity), 0) THEN 'full'
        ELSE 'partial'
      END
      FROM public.stock_transfer_items i WHERE i.transfer_id = NEW.id
    );
  END IF;

  IF NEW.status = 'received' THEN
    NEW.received_at := COALESCE(NEW.received_at, now());
  END IF;

  IF NEW.status IN ('verified', 'completed', 'completed_with_discrepancy') THEN
    NEW.received_at := COALESCE(NEW.received_at, now());
    NEW.verified_at := COALESCE(NEW.verified_at, now());
  END IF;

  RETURN NEW;
END;
$function$;

-- Approve routine: enforce the same cross-group rules server-side.
CREATE OR REPLACE FUNCTION public.stock_transfer_approve(
  p_transfer_id uuid,
  p_approved_by text DEFAULT NULL,
  p_lines jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t public.stock_transfers;
  v_cross boolean;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can approve a transfer';
  END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF t.status <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'Transfer % is % and is not waiting for approval', t.ref, t.status;
  END IF;

  v_cross := public.is_cross_group_transfer(t.from_store_id, t.to_store_id);
  IF v_cross THEN
    IF NOT public.may_approve_cross_group_transfer() THEN
      RAISE EXCEPTION 'Only an authorised approver can approve a transfer between groups'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF COALESCE(btrim(p_approved_by), '') = ''
       OR btrim(lower(p_approved_by)) = btrim(lower(COALESCE(t.created_by, ''))) THEN
      RAISE EXCEPTION 'A transfer between groups must be approved by someone other than the requester'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- No list means "everything as asked for".
  UPDATE public.stock_transfer_items i
     SET quantity_approved = COALESCE(
           (SELECT (l ->> 'qty')::int FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l
             WHERE l ->> 'product_id' = i.product_id::text LIMIT 1),
           i.quantity)
   WHERE i.transfer_id = t.id;

  UPDATE public.stock_transfers
     SET status = 'approved', approved_by = COALESCE(p_approved_by, approved_by), approved_at = now()
   WHERE id = t.id;
END $$;

REVOKE ALL ON FUNCTION public.stock_transfer_approve(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_transfer_approve(uuid, text, jsonb) TO authenticated, service_role;

-- Consolidated online security/schema change: 20260905071437_8b5f5d70-3890-4e70-8ae6-e1b5740cb3c0.sql
ALTER TABLE public.uom_units ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Consolidated online security/schema change: 20260905072647_7ecc74a0-edad-450e-b93d-18bed25d0420.sql
-- 1) Branches carry the private-catalogue switch centrally.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS private_catalogue boolean NOT NULL DEFAULT false;

-- 2) Products carry the branch that owns them (null = shared with everyone).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS owner_store_id text REFERENCES public.stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_owner_store_id_idx
  ON public.products (owner_store_id) WHERE owner_store_id IS NOT NULL;

-- Is this product on offer to the caller's branch?
CREATE OR REPLACE FUNCTION public.product_visible_to_me(_owner_store_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN _owner_store_id IS NULL THEN true
    WHEN public.user_has_store_access(_owner_store_id) THEN true
    ELSE NOT EXISTS (
      SELECT 1 FROM public.stores s
       WHERE s.id = _owner_store_id AND s.private_catalogue
    )
  END
$$;

DROP POLICY IF EXISTS "Staff can read products" ON public.products;
CREATE POLICY "Staff can read products"
  ON public.products FOR SELECT TO authenticated
  USING (public.is_staff_now() AND public.product_visible_to_me(owner_store_id));

DROP POLICY IF EXISTS "Staff can update" ON public.products;
CREATE POLICY "Staff can update"
  ON public.products FOR UPDATE TO authenticated
  USING (public.is_staff_now() AND public.product_visible_to_me(owner_store_id))
  WITH CHECK (public.is_staff_now() AND public.product_visible_to_me(owner_store_id));

-- 3) Activation tokens belong to a branch, and only supervisors may issue them.
DROP POLICY IF EXISTS "Anyone can check a token status" ON public.terminal_tokens;
DROP POLICY IF EXISTS "Staff can read tokens" ON public.terminal_tokens;
DROP POLICY IF EXISTS "Supervisors can read tokens" ON public.terminal_tokens;
CREATE POLICY "Supervisors can read tokens"
  ON public.terminal_tokens FOR SELECT TO authenticated
  USING ((SELECT public.is_app_supervisor()));

DROP POLICY IF EXISTS "Staff can issue tokens" ON public.terminal_tokens;
DROP POLICY IF EXISTS "Supervisors can issue tokens" ON public.terminal_tokens;
CREATE POLICY "Supervisors can issue tokens"
  ON public.terminal_tokens FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_app_supervisor()));

DROP POLICY IF EXISTS "Staff can manage tokens" ON public.terminal_tokens;
DROP POLICY IF EXISTS "Supervisors can manage tokens" ON public.terminal_tokens;
CREATE POLICY "Supervisors can manage tokens"
  ON public.terminal_tokens FOR UPDATE TO authenticated
  USING ((SELECT public.is_app_supervisor()))
  WITH CHECK ((SELECT public.is_app_supervisor()));

DROP POLICY IF EXISTS "Staff can delete tokens" ON public.terminal_tokens;
DROP POLICY IF EXISTS "Supervisors can delete tokens" ON public.terminal_tokens;
CREATE POLICY "Supervisors can delete tokens"
  ON public.terminal_tokens FOR DELETE TO authenticated
  USING ((SELECT public.is_app_supervisor()));

-- Consolidated online security/schema change: 20260905072726_c2d95046-07c2-4f23-9fa1-6789dcb3cec6.sql
REVOKE ALL ON FUNCTION public.product_visible_to_me(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_visible_to_me(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.product_visible_to_me(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_visible_to_me(text) TO service_role;

-- Consolidated online security/schema change: 20260906040020_e50df23d-3265-4b60-9889-2f5ac298a464.sql
ALTER TABLE public.pos_store_settings
  ADD COLUMN IF NOT EXISTS allow_offline_approvals boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offline_approval_requires_pin boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS online_only_void_cart boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS online_only_void_line boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS online_only_reduce_qty boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS online_only_manual_discount boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS online_only_price_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS online_only_stock_adjustment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS online_only_shift_close boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS online_only_edit_tenders boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS online_only_terminal_reset boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS online_only_refund boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.pos_rules_defaults()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT '{
    "block_shift_close_on_hold": true,
    "require_daily_sales_for_shift_close": true,
    "require_counted_cash_on_close": true,
    "require_opening_float_count": true,
    "enable_blind_cash_count": true,
    "max_drawer_cash_limit": 1000,
    "require_reason_for_payout": true,
    "allow_multiple_shifts_per_terminal": false,
    "enable_cashier_x_report": false,
    "show_opening_float_at_close": true,
    "show_expected_totals_at_close": false,
    "show_live_variance_at_close": false,
    "show_itemized_tender_breakdown": true,
    "require_manager_pin_on_variance": true,
    "variance_pin_threshold": 10,
    "max_cashier_discount_percent": 10,
    "max_cart_discount_amount": 100,
    "allow_discount_stacking": false,
    "require_reason_for_price_override": true,
    "prevent_below_cost_sale": true,
    "allow_tax_exemption": false,
    "prevent_negative_stock_sale": false,
    "require_receipt_for_refund": true,
    "require_manager_pin_for_refund": true,
    "max_refund_days_limit": 30,
    "track_item_voids": true,
    "auto_lock_timeout_seconds": 90,
    "require_manager_pin_for_cash_drawer_open": true,
    "enable_manager_pin_audit_log": true,
    "require_pin_void_cart": true,
    "require_pin_void_line": false,
    "require_pin_reduce_qty": false,
    "require_pin_manual_discount": true,
    "require_pin_price_override": true,
    "require_pin_stock_adjustment": true,
    "require_pin_shift_close": false,
    "require_pin_edit_tenders": false,
    "require_pin_terminal_reset": true,
    "allow_offline_approvals": true,
    "offline_approval_requires_pin": true,
    "online_only_void_cart": false,
    "online_only_void_line": false,
    "online_only_reduce_qty": false,
    "online_only_manual_discount": false,
    "online_only_price_override": false,
    "online_only_stock_adjustment": false,
    "online_only_shift_close": false,
    "online_only_edit_tenders": false,
    "online_only_terminal_reset": false,
    "online_only_refund": false
  }'::jsonb;
$function$;


-- Consolidated final RLS hardening: 20260820155255_12675704-07b6-4797-96df-1c956af681d9.sql
-- 1. audit_logs: drop the wide-open duplicates, keep staff-gated rules
DROP POLICY IF EXISTS "audit_logs_staff_read" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_staff_insert" ON public.audit_logs;

-- 2. branch_telemetry: drop wide-open duplicates and scope to the caller's branch
DROP POLICY IF EXISTS "branch_telemetry_staff_read" ON public.branch_telemetry;
DROP POLICY IF EXISTS "branch_telemetry_staff_write" ON public.branch_telemetry;
DROP POLICY IF EXISTS "branch_telemetry_staff_update" ON public.branch_telemetry;
DROP POLICY IF EXISTS "Staff read telemetry" ON public.branch_telemetry;
DROP POLICY IF EXISTS "Staff refresh telemetry" ON public.branch_telemetry;
DROP POLICY IF EXISTS "Staff report telemetry" ON public.branch_telemetry;

CREATE POLICY "Telemetry visible in own branch" ON public.branch_telemetry
  FOR SELECT TO authenticated
  USING (public.user_has_store_access(store_id));

CREATE POLICY "Telemetry reported for own branch" ON public.branch_telemetry
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_store_access(store_id));

CREATE POLICY "Telemetry refreshed for own branch" ON public.branch_telemetry
  FOR UPDATE TO authenticated
  USING (public.user_has_store_access(store_id))
  WITH CHECK (public.user_has_store_access(store_id));

REVOKE ALL ON public.branch_telemetry FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.branch_telemetry TO authenticated;
GRANT ALL ON public.branch_telemetry TO service_role;

-- 3. payment_types: remove the permissive staff duplicates; keep supervisor-only writes
DROP POLICY IF EXISTS "payment_types_staff_read" ON public.payment_types;
DROP POLICY IF EXISTS "payment_types_staff_write" ON public.payment_types;

-- 4. login-support tables stay unreachable through the data API
REVOKE ALL ON public.pin_attempts FROM anon, authenticated;
REVOKE ALL ON public.cashiers FROM anon, authenticated;
GRANT ALL ON public.pin_attempts TO service_role;
GRANT ALL ON public.cashiers TO service_role;

GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

-- ---------------------------------------------------------------------------
-- Live-schema compatibility columns
-- ---------------------------------------------------------------------------
-- Preserve columns that exist in the production Supabase project, including
-- legacy aliases still needed while stores upgrade. These statements are
-- additive so the canonical installer remains safe to rerun.
ALTER TABLE public.activity_events
  ADD COLUMN IF NOT EXISTS branch_id text;

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS auth_secret text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS idle_timeout_minutes integer;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_ref text;

ALTER TABLE public.branch_telemetry
  ADD COLUMN IF NOT EXISTS device_name text,
  ADD COLUMN IF NOT EXISTS device_type text,
  ADD COLUMN IF NOT EXISTS location_name text,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamp with time zone;

ALTER TABLE public.held_orders
  ADD COLUMN IF NOT EXISTS bill_no text;

ALTER TABLE public.item_activity_logs
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS sale_id uuid,
  ADD COLUMN IF NOT EXISTS transfer_id uuid,
  ADD COLUMN IF NOT EXISTS quantity integer,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS deleted_at text;

ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS deleted_at text;

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS order_id uuid,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS transaction_reference text;

ALTER TABLE public.pos_settings
  ADD COLUMN IF NOT EXISTS payment_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS whatsapp_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS receipt_css text NOT NULL DEFAULT '';

ALTER TABLE public.pos_store_settings
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS idle_timeout_minutes integer NOT NULL DEFAULT 30;

ALTER TABLE public.product_barcodes
  ADD COLUMN IF NOT EXISTS unit_label text,
  ADD COLUMN IF NOT EXISTS deleted_at text;

ALTER TABLE public.product_categories
  ADD COLUMN IF NOT EXISTS deleted_at text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS deleted_at text;

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS deleted_at text;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS reference text;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS branch_id text;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS branch_id text;

ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS rejected_by text,
  ADD COLUMN IF NOT EXISTS cancelled_reason text,
  ADD COLUMN IF NOT EXISTS dispatched_by text,
  ADD COLUMN IF NOT EXISTS dispatched_at text,
  ADD COLUMN IF NOT EXISTS closed_at text,
  ADD COLUMN IF NOT EXISTS fulfilment text,
  ADD COLUMN IF NOT EXISTS source_request_id uuid;

DO $stock_transfers_source_request_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_transfers_source_request_id_fkey'
      AND conrelid = 'public.stock_transfers'::regclass
  ) THEN
    ALTER TABLE public.stock_transfers
      ADD CONSTRAINT stock_transfers_source_request_id_fkey
      FOREIGN KEY (source_request_id)
      REFERENCES public.stock_transfers(id)
      ON DELETE SET NULL;
  END IF;
END;
$stock_transfers_source_request_fk$;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS receipt_prefix text,
  ADD COLUMN IF NOT EXISTS deleted_at text;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS deleted_at text;

ALTER TABLE public.terminal_tokens
  ADD COLUMN IF NOT EXISTS claim_secret_hash text,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS credentials_issued_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS device_platform text,
  ADD COLUMN IF NOT EXISTS device_os text,
  ADD COLUMN IF NOT EXISTS claimed_proof_hash text,
  ADD COLUMN IF NOT EXISTS claimed_platform text,
  ADD COLUMN IF NOT EXISTS claimed_os text,
  ADD COLUMN IF NOT EXISTS is_claimed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS claim_proof text;

-- New token rows must use the same two-value contract as the POS, Electron,
-- Android and the atomic claim helper. Keep the constraint unvalidated only
-- on an older tenant that still has a legacy value; the claim helper above
-- fails closed for those rows until they are deliberately reissued.
ALTER TABLE public.terminal_tokens
  ALTER COLUMN platform SET DEFAULT 'pc';

DO $terminal_platform_contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.terminal_tokens'::regclass
      AND conname = 'terminal_tokens_platform_check'
  ) THEN
    ALTER TABLE public.terminal_tokens
      ADD CONSTRAINT terminal_tokens_platform_check
      CHECK (platform IN ('pc', 'mobile')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.terminal_tokens
    WHERE platform IS NULL OR platform NOT IN ('pc', 'mobile')
  ) THEN
    ALTER TABLE public.terminal_tokens
      VALIDATE CONSTRAINT terminal_tokens_platform_check;
  END IF;
END;
$terminal_platform_contract$;

ALTER TABLE public.uom_units
  ADD COLUMN IF NOT EXISTS deleted_at text;

-- ---------------------------------------------------------------------------
-- Final security invariant
-- ---------------------------------------------------------------------------
-- Every application table is protected by row-level security. A table may
-- intentionally have no client policy (for example a service-role-only secret
-- table); with RLS enabled that means authenticated and anonymous clients are
-- denied by default. Abort the installer rather than leave a new table open.
DO $retail_verify_rls$
DECLARE unprotected text;
BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
  INTO unprotected
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity;

  IF unprotected IS NOT NULL THEN
    RAISE EXCEPTION 'Retail schema refused: RLS is disabled for %', unprotected;
  END IF;
END;
$retail_verify_rls$;

RESET check_function_bodies;
RESET client_min_messages;

-- Append-only master/configuration history and automatic stock lifecycle
-- history. The migration source is
-- 20260929080000_change_history_stock_request_lifecycle.sql.
CREATE TABLE IF NOT EXISTS public.change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL DEFAULT 'default',
  entity_type text NOT NULL, entity_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('insert','update','delete')),
  old_value jsonb, new_value jsonb, revision bigint NOT NULL,
  scope_type text NOT NULL DEFAULT 'GLOBAL', scope_id text, changed_by text,
  source_application text NOT NULL DEFAULT 'web', device_id text, terminal_id text,
  server_timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS change_history_entity_idx ON public.change_history(entity_type,entity_id,revision DESC);
CREATE INDEX IF NOT EXISTS change_history_scope_idx ON public.change_history(organization_id,scope_type,scope_id,server_timestamp DESC);
ALTER TABLE public.change_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.change_history FROM anon,authenticated;
GRANT SELECT ON public.change_history TO authenticated;
GRANT ALL ON public.change_history TO service_role;
DROP POLICY IF EXISTS "Auditors read applicable change history" ON public.change_history;
CREATE POLICY "Auditors read applicable change history" ON public.change_history FOR SELECT TO authenticated
USING (public.has_perm('can_view_audit_trail') AND (upper(scope_type)='GLOBAL' OR (upper(scope_type)='BRANCH' AND public.store_visible(scope_id)) OR (upper(scope_type)='TERMINAL' AND EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.id::text=scope_id AND public.store_visible(t.location_id)))));
CREATE OR REPLACE FUNCTION public.change_history_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$ BEGIN RAISE EXCEPTION 'change_history is append-only'; END $fn$;
DROP TRIGGER IF EXISTS change_history_no_change ON public.change_history;
CREATE TRIGGER change_history_no_change BEFORE UPDATE OR DELETE ON public.change_history FOR EACH ROW EXECUTE FUNCTION public.change_history_immutable();

CREATE OR REPLACE FUNCTION public.record_product_master_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_old jsonb; v_new jsonb; v_owner text; v_revision bigint;
BEGIN v_old:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD)-'stock_quantity'-'stock_by_store' END; v_new:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW)-'stock_quantity'-'stock_by_store' END;
IF TG_OP='UPDATE' AND v_old IS NOT DISTINCT FROM v_new THEN RETURN NEW; END IF; v_owner:=COALESCE(NEW.owner_store_id,OLD.owner_store_id); v_revision:=COALESCE(NEW.row_version,OLD.row_version,1);
INSERT INTO public.change_history(entity_type,entity_id,action,old_value,new_value,revision,scope_type,scope_id,changed_by,source_application,device_id,terminal_id)
VALUES('products',COALESCE(NEW.id,OLD.id)::text,lower(TG_OP),v_old,v_new,v_revision,CASE WHEN NULLIF(v_owner,'') IS NULL THEN 'GLOBAL' ELSE 'BRANCH' END,NULLIF(v_owner,''),NULLIF(current_setting('pos.updated_by',true),''),COALESCE(NULLIF(current_setting('pos.source_application',true),''),'web'),NULLIF(current_setting('pos.device_id',true),''),NULLIF(current_setting('pos.sync_terminal',true),'')); RETURN COALESCE(NEW,OLD); END $fn$;
DROP TRIGGER IF EXISTS products_change_history ON public.products;
CREATE TRIGGER products_change_history AFTER INSERT OR UPDATE OR DELETE ON public.products FOR EACH ROW EXECUTE FUNCTION public.record_product_master_history();

CREATE OR REPLACE FUNCTION public.record_scoped_setting_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_old jsonb; v_new jsonb; v_row jsonb; v_scope text; v_scope_id text; v_revision bigint; v_entity_id text;
BEGIN v_old:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END; v_new:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END; IF TG_OP='UPDATE' AND v_old IS NOT DISTINCT FROM v_new THEN RETURN NEW; END IF; v_row:=COALESCE(v_new,v_old); v_scope:=upper(COALESCE(v_row->>'scope','GLOBAL')); v_scope_id:=NULLIF(v_row->>'scope_id',''); v_revision:=COALESCE((v_row->>'row_version')::bigint,1); v_entity_id:=concat_ws(':',v_scope,COALESCE(v_scope_id,''),COALESCE(v_row->>'section',v_row->>'key',''));
INSERT INTO public.change_history(entity_type,entity_id,action,old_value,new_value,revision,scope_type,scope_id,changed_by,source_application,device_id,terminal_id)
VALUES(TG_TABLE_NAME,v_entity_id,lower(TG_OP),v_old,v_new,v_revision,v_scope,v_scope_id,COALESCE(v_row->>'updated_by',NULLIF(current_setting('pos.updated_by',true),'')),COALESCE(NULLIF(current_setting('pos.source_application',true),''),'web'),NULLIF(current_setting('pos.device_id',true),''),NULLIF(current_setting('pos.sync_terminal',true),'')); RETURN COALESCE(NEW,OLD); END $fn$;
DROP TRIGGER IF EXISTS settings_overrides_change_history ON public.settings_overrides;
CREATE TRIGGER settings_overrides_change_history AFTER INSERT OR UPDATE OR DELETE ON public.settings_overrides FOR EACH ROW EXECUTE FUNCTION public.record_scoped_setting_history();
DROP TRIGGER IF EXISTS settings_scoped_change_history ON public.settings_scoped;
CREATE TRIGGER settings_scoped_change_history AFTER INSERT OR UPDATE OR DELETE ON public.settings_scoped FOR EACH ROW EXECUTE FUNCTION public.record_scoped_setting_history();

CREATE OR REPLACE FUNCTION public.record_stock_transfer_status_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor text; v_reason text; v_branch text;
BEGIN IF TG_OP='UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF; v_actor:=CASE NEW.status WHEN 'approved' THEN NEW.approved_by WHEN 'rejected' THEN NEW.rejected_by WHEN 'dispatched' THEN NEW.dispatched_by WHEN 'received' THEN NEW.received_by WHEN 'verified' THEN NEW.verified_by WHEN 'completed' THEN NEW.verified_by WHEN 'completed_with_discrepancy' THEN NEW.verified_by ELSE NEW.created_by END; v_reason:=COALESCE(NEW.rejected_reason,NEW.cancelled_reason,NEW.discrepancy_reason);
FOREACH v_branch IN ARRAY ARRAY[NEW.from_store_id,NEW.to_store_id] LOOP INSERT INTO public.entity_status_history(entity_type,entity_id,status_kind,previous_status,new_status,reason,actor_name,store_id,branch_id,related_entity_type,related_entity_id,metadata,client_event_id,row_version)
VALUES('stock_transfer',NEW.id::text,CASE WHEN NEW.kind='request' THEN 'request_status' ELSE 'transfer_status' END,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,NEW.status,v_reason,v_actor,v_branch,v_branch,'branch',CASE WHEN v_branch=NEW.from_store_id THEN NEW.to_store_id ELSE NEW.from_store_id END,jsonb_build_object('ref',NEW.ref,'kind',NEW.kind,'from_store_id',NEW.from_store_id,'to_store_id',NEW.to_store_id),concat('stock_transfer:',NEW.id,':',NEW.status,':',v_branch,':',NEW.row_version),NEW.row_version) ON CONFLICT (client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING; END LOOP; RETURN NEW; END $fn$;
DROP TRIGGER IF EXISTS stock_transfers_status_history ON public.stock_transfers;
CREATE TRIGGER stock_transfers_status_history AFTER INSERT OR UPDATE OF status ON public.stock_transfers FOR EACH ROW EXECUTE FUNCTION public.record_stock_transfer_status_history();
REVOKE ALL ON FUNCTION public.record_product_master_history() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_scoped_setting_history() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_stock_transfer_status_history() FROM PUBLIC,anon,authenticated;

-- Scoped synchronization and RLS hardening. Keep this immediately before the
-- generated sync contract so canonical regeneration cannot weaken it.
CREATE OR REPLACE FUNCTION public.settings_scope_visible(p_scope text, p_scope_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT CASE lower(COALESCE(p_scope,''))
    WHEN 'global' THEN auth.uid() IS NOT NULL
    WHEN 'branch' THEN public.store_visible(p_scope_id)
    WHEN 'cluster' THEN EXISTS (
      SELECT 1 FROM public.stores s
      WHERE COALESCE(NULLIF(s.group_id,''),'default')=p_scope_id AND public.store_visible(s.id)
    )
    WHEN 'terminal' THEN EXISTS (
      SELECT 1 FROM public.terminal_tokens t
      WHERE t.id::text=p_scope_id AND public.store_visible(t.location_id)
    )
    WHEN 'private' THEN p_scope_id=public.settings_private_key()
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.settings_scope_manageable(p_scope text, p_scope_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT CASE lower(COALESCE(p_scope,''))
    WHEN 'global' THEN EXISTS (
      SELECT 1 FROM public.app_users u WHERE u.auth_user_id=auth.uid() AND u.is_active=true AND u.role='admin'
    )
    WHEN 'private' THEN p_scope_id=public.settings_private_key()
    ELSE public.is_supervisor_now() AND public.settings_scope_visible(p_scope,p_scope_id)
  END
$$;

REVOKE ALL ON FUNCTION public.settings_scope_visible(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.settings_scope_manageable(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.settings_scope_visible(text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.settings_scope_manageable(text,text) TO authenticated,service_role;

REVOKE ALL ON TABLE public.settings_overrides FROM anon;
REVOKE ALL ON TABLE public.settings_scoped FROM anon;
GRANT SELECT ON TABLE public.settings_overrides,public.settings_scoped TO authenticated;

DROP POLICY IF EXISTS settings_overrides_private ON public.settings_overrides;
DROP POLICY IF EXISTS settings_overrides_read ON public.settings_overrides;
DROP POLICY IF EXISTS settings_overrides_write ON public.settings_overrides;
CREATE POLICY settings_overrides_read ON public.settings_overrides FOR SELECT TO authenticated
  USING (public.settings_scope_visible(scope,scope_id));
CREATE POLICY settings_overrides_write ON public.settings_overrides FOR ALL TO authenticated
  USING (public.settings_scope_manageable(scope,scope_id))
  WITH CHECK (public.settings_scope_manageable(scope,scope_id));

DROP POLICY IF EXISTS settings_scoped_read ON public.settings_scoped;
DROP POLICY IF EXISTS "Staff read scoped settings" ON public.settings_scoped;
CREATE POLICY settings_scoped_read ON public.settings_scoped FOR SELECT TO authenticated
  USING (public.settings_scope_visible(scope,scope_id));

DROP POLICY IF EXISTS "Staff read pos rules" ON public.pos_store_settings;
DROP POLICY IF EXISTS "Supervisors update rules" ON public.pos_store_settings;
DROP POLICY IF EXISTS "Supervisors write rules" ON public.pos_store_settings;
CREATE POLICY "Supervisors update visible rules" ON public.pos_store_settings FOR UPDATE TO authenticated
  USING (public.is_supervisor_now() AND public.store_visible(store_id))
  WITH CHECK (public.is_supervisor_now() AND public.store_visible(store_id));
CREATE POLICY "Supervisors insert visible rules" ON public.pos_store_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_supervisor_now() AND public.store_visible(store_id));

DROP POLICY IF EXISTS "Staff read authorisation rules" ON public.authorization_actions;
CREATE POLICY "Staff read authorisation rules" ON public.authorization_actions FOR SELECT TO authenticated
  USING (public.is_staff_now() AND public.settings_scope_visible(scope_type,scope_id));
DROP POLICY IF EXISTS "Staff read authorisation rule history" ON public.authorization_action_history;
CREATE POLICY "Staff read authorisation rule history" ON public.authorization_action_history FOR SELECT TO authenticated
  USING (public.is_staff_now() AND public.settings_scope_visible(scope_type,scope_id));

DROP POLICY IF EXISTS terminal_commands_staff_read ON public.terminal_commands;
DROP POLICY IF EXISTS terminal_commands_staff_update ON public.terminal_commands;
DROP POLICY IF EXISTS terminal_commands_staff_write ON public.terminal_commands;
DROP POLICY IF EXISTS "Staff read commands" ON public.terminal_commands;
DROP POLICY IF EXISTS "Staff complete commands" ON public.terminal_commands;
DROP POLICY IF EXISTS "Supervisors issue commands" ON public.terminal_commands;
CREATE POLICY terminal_commands_branch_read ON public.terminal_commands FOR SELECT TO authenticated
  USING (public.store_visible(store_id));
CREATE POLICY terminal_commands_branch_update ON public.terminal_commands FOR UPDATE TO authenticated
  USING (public.store_visible(store_id)) WITH CHECK (public.store_visible(store_id));
CREATE POLICY terminal_commands_branch_insert ON public.terminal_commands FOR INSERT TO authenticated
  WITH CHECK (public.is_supervisor_now() AND public.store_visible(store_id));

-- SQLSERVER_SYNC_CONTRACT_BEGIN

CREATE TABLE IF NOT EXISTS public.sync_idempotency_receipts (
 batch_id uuid PRIMARY KEY, organization_id text NOT NULL, branch_id text NOT NULL, table_name text NOT NULL,
 payload_hash text NOT NULL DEFAULT '', applied_count integer NOT NULL DEFAULT 0, applied_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE public.sync_idempotency_receipts ADD COLUMN IF NOT EXISTS payload_hash text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.sync_change_feed (
 cursor bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id text NOT NULL, branch_id text NOT NULL,
 terminal_id text,
 table_name text NOT NULL, entity_id text NOT NULL, operation text NOT NULL CHECK(operation IN ('insert','update','delete')),
 row_version bigint NOT NULL DEFAULT 1, tombstone boolean NOT NULL DEFAULT false, changed_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX IF NOT EXISTS sync_change_feed_branch_cursor_idx ON public.sync_change_feed(organization_id,branch_id,cursor);

ALTER TABLE public.sync_change_feed ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.sync_idempotency_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sync_change_feed ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.pos_sync_validate_scope(p_organization_id text,p_branch_id text,p_terminal_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 IF p_organization_id IS DISTINCT FROM 'default' THEN RAISE EXCEPTION 'SYNC_ORGANIZATION_FORBIDDEN'; END IF;
 IF NULLIF(btrim(p_branch_id),'') IS NULL OR NULLIF(btrim(p_terminal_id),'') IS NULL THEN RAISE EXCEPTION 'SYNC_TERMINAL_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.id::text=p_terminal_id AND t.location_id=p_branch_id AND t.status IN ('active','used') AND t.revoked_at IS NULL) THEN RAISE EXCEPTION 'SYNC_TERMINAL_SCOPE_FORBIDDEN'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_validate_scope(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_validate_scope(text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_apply_coupon_campaigns(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."coupon_campaigns" ("id","name","slug","discount_type","discount_value","scope","scope_value","max_claims","max_per_member","claims_count","starts_at","expires_at","is_active","is_welcome","created_at","updated_at","row_version")
  SELECT "id","name","slug","discount_type","discount_value","scope","scope_value","max_claims","max_per_member","claims_count","starts_at","expires_at","is_active","is_welcome","created_at","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."coupon_campaigns", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","slug"=EXCLUDED."slug","discount_type"=EXCLUDED."discount_type","discount_value"=EXCLUDED."discount_value","scope"=EXCLUDED."scope","scope_value"=EXCLUDED."scope_value","max_claims"=EXCLUDED."max_claims","max_per_member"=EXCLUDED."max_per_member","claims_count"=EXCLUDED."claims_count","starts_at"=EXCLUDED."starts_at","expires_at"=EXCLUDED."expires_at","is_active"=EXCLUDED."is_active","is_welcome"=EXCLUDED."is_welcome","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."coupon_campaigns"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_coupon_campaigns(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."coupon_campaigns" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_coupon_campaigns(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_coupon_campaigns(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_coupon_campaigns() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'coupon_campaigns',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."coupon_campaigns";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."coupon_campaigns" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_coupon_campaigns();

REVOKE ALL ON FUNCTION public.sync_feed_coupon_campaigns() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shifts(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN

  PERFORM set_config('pos.shift_fn','on',true);
  INSERT INTO public."shifts" ("id","store_id","terminal_id","terminal_name","opened_by_name","opened_by_staff_id","opened_by_role","closed_by_name","closed_by_staff_id","closed_by_role","opened_at","closed_at","opening_float","counted_cash","expected_cash","note","overdue","created_at","updated_at","status","closing_float","user_id","row_version","counted_card","counted_digital","expected_card","expected_digital","variance_cash","variance_card","variance_digital","variance_total","state","close_reason","closing_started_at","closing_started_by","final_counted_cash","variance_status")
  SELECT "id","store_id","terminal_id","terminal_name","opened_by_name","opened_by_staff_id","opened_by_role","closed_by_name","closed_by_staff_id","closed_by_role","opened_at","closed_at","opening_float","counted_cash","expected_cash","note","overdue","created_at","updated_at","status","closing_float","user_id","row_version","counted_card","counted_digital","expected_card","expected_digital","variance_cash","variance_card","variance_digital","variance_total","state","close_reason","closing_started_at","closing_started_by","final_counted_cash","variance_status" FROM jsonb_populate_recordset(NULL::public."shifts", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","terminal_name"=EXCLUDED."terminal_name","opened_by_name"=EXCLUDED."opened_by_name","opened_by_staff_id"=EXCLUDED."opened_by_staff_id","opened_by_role"=EXCLUDED."opened_by_role","closed_by_name"=EXCLUDED."closed_by_name","closed_by_staff_id"=EXCLUDED."closed_by_staff_id","closed_by_role"=EXCLUDED."closed_by_role","opened_at"=EXCLUDED."opened_at","closed_at"=EXCLUDED."closed_at","opening_float"=EXCLUDED."opening_float","counted_cash"=EXCLUDED."counted_cash","expected_cash"=EXCLUDED."expected_cash","note"=EXCLUDED."note","overdue"=EXCLUDED."overdue","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","status"=EXCLUDED."status","closing_float"=EXCLUDED."closing_float","user_id"=EXCLUDED."user_id","row_version"=EXCLUDED."row_version","counted_card"=EXCLUDED."counted_card","counted_digital"=EXCLUDED."counted_digital","expected_card"=EXCLUDED."expected_card","expected_digital"=EXCLUDED."expected_digital","variance_cash"=EXCLUDED."variance_cash","variance_card"=EXCLUDED."variance_card","variance_digital"=EXCLUDED."variance_digital","variance_total"=EXCLUDED."variance_total","state"=EXCLUDED."state","close_reason"=EXCLUDED."close_reason","closing_started_at"=EXCLUDED."closing_started_at","closing_started_by"=EXCLUDED."closing_started_by","final_counted_cash"=EXCLUDED."final_counted_cash","variance_status"=EXCLUDED."variance_status" WHERE EXCLUDED."row_version">public."shifts"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;

  PERFORM set_config('pos.shift_fn','',true);

  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shifts(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."shifts" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shifts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shifts(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shifts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shifts',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shifts";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shifts" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shifts();

REVOKE ALL ON FUNCTION public.sync_feed_shifts() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_issued_vouchers(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."issued_vouchers" ("id","token_slug","campaign_id","member_id","status","issued_at","expires_at","issued_by","issued_source","redeemed_at","redeemed_by","redeemed_sale_id","disabled_at","disabled_by","disable_reason","store_id","row_version")
  SELECT "id","token_slug","campaign_id","member_id","status","issued_at","expires_at","issued_by","issued_source","redeemed_at","redeemed_by","redeemed_sale_id","disabled_at","disabled_by","disable_reason","store_id","row_version" FROM jsonb_populate_recordset(NULL::public."issued_vouchers", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "token_slug"=EXCLUDED."token_slug","campaign_id"=EXCLUDED."campaign_id","member_id"=EXCLUDED."member_id","status"=EXCLUDED."status","issued_at"=EXCLUDED."issued_at","expires_at"=EXCLUDED."expires_at","issued_by"=EXCLUDED."issued_by","issued_source"=EXCLUDED."issued_source","redeemed_at"=EXCLUDED."redeemed_at","redeemed_by"=EXCLUDED."redeemed_by","redeemed_sale_id"=EXCLUDED."redeemed_sale_id","disabled_at"=EXCLUDED."disabled_at","disabled_by"=EXCLUDED."disabled_by","disable_reason"=EXCLUDED."disable_reason","store_id"=EXCLUDED."store_id","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."issued_vouchers"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_issued_vouchers(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."issued_vouchers" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_issued_vouchers(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_issued_vouchers(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_issued_vouchers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'issued_vouchers',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."issued_vouchers";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."issued_vouchers" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_issued_vouchers();

REVOKE ALL ON FUNCTION public.sync_feed_issued_vouchers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_activity_events(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."activity_events" ("id","event_type","severity","title","message","actor_id","actor_name","actor_role","terminal_id","terminal_name","store_id","entity_type","entity_id","amount","meta","whatsapp_status","whatsapp_error","client_event_id","created_at","previous_state","new_state","cleared_by","branch_id")
  SELECT "id","event_type","severity","title","message","actor_id","actor_name","actor_role","terminal_id","terminal_name","store_id","entity_type","entity_id","amount","meta","whatsapp_status","whatsapp_error","client_event_id","created_at","previous_state","new_state","cleared_by","branch_id" FROM jsonb_populate_recordset(NULL::public."activity_events", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "cleared_by"=EXCLUDED."cleared_by";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_activity_events(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."activity_events" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_activity_events(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_activity_events(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_activity_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'activity_events',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."activity_events";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."activity_events" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_activity_events();

REVOKE ALL ON FUNCTION public.sync_feed_activity_events() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_app_users(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."app_users" ("id","user_id","full_name","email","role","store_id","is_active","permissions","pin_hash","auth_user_id","last_login_at","created_at","updated_at","role_slug","pin_length","row_version","pin_set_at","pin_updated_by","auth_secret","idle_timeout_minutes")
  SELECT "id","user_id","full_name","email","role","store_id","is_active","permissions","pin_hash","auth_user_id","last_login_at","created_at","updated_at","role_slug","pin_length","row_version","pin_set_at","pin_updated_by","auth_secret","idle_timeout_minutes" FROM jsonb_populate_recordset(NULL::public."app_users", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "user_id"=EXCLUDED."user_id","full_name"=EXCLUDED."full_name","email"=EXCLUDED."email","role"=EXCLUDED."role","store_id"=EXCLUDED."store_id","is_active"=EXCLUDED."is_active","permissions"=EXCLUDED."permissions","pin_hash"=EXCLUDED."pin_hash","auth_user_id"=EXCLUDED."auth_user_id","last_login_at"=EXCLUDED."last_login_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","role_slug"=EXCLUDED."role_slug","pin_length"=EXCLUDED."pin_length","row_version"=EXCLUDED."row_version","pin_set_at"=EXCLUDED."pin_set_at","pin_updated_by"=EXCLUDED."pin_updated_by","auth_secret"=EXCLUDED."auth_secret","idle_timeout_minutes"=EXCLUDED."idle_timeout_minutes" WHERE EXCLUDED."row_version">public."app_users"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_app_users(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."app_users" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_app_users(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_app_users(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_app_users() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'app_users',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."app_users";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."app_users" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_app_users();

REVOKE ALL ON FUNCTION public.sync_feed_app_users() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_audit_logs(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."audit_logs" ("id","user_name","action_category","action_name","target_module","details","created_at","user_id","action","entity","before_state","after_state","store_id")
  SELECT "id","user_name","action_category","action_name","target_module","details","created_at","user_id","action","entity","before_state","after_state","store_id" FROM jsonb_populate_recordset(NULL::public."audit_logs", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "user_name"=EXCLUDED."user_name","action_category"=EXCLUDED."action_category","action_name"=EXCLUDED."action_name","target_module"=EXCLUDED."target_module","details"=EXCLUDED."details","created_at"=EXCLUDED."created_at","user_id"=EXCLUDED."user_id","action"=EXCLUDED."action","entity"=EXCLUDED."entity","before_state"=EXCLUDED."before_state","after_state"=EXCLUDED."after_state","store_id"=EXCLUDED."store_id";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_audit_logs(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."audit_logs" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_audit_logs(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_audit_logs(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_audit_logs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'audit_logs',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."audit_logs";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."audit_logs" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_audit_logs();

REVOKE ALL ON FUNCTION public.sync_feed_audit_logs() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_booking_payments(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."booking_payments" ("id","booking_id","amount","method","cashier","paid_at","created_at","row_version","status","client_payment_id","reference","reversed_at","reversed_by","kind","refund_reason","refunds_payment_id","change_given")
  SELECT "id","booking_id","amount","method","cashier","paid_at","created_at","row_version","status","client_payment_id","reference","reversed_at","reversed_by","kind","refund_reason","refunds_payment_id","change_given" FROM jsonb_populate_recordset(NULL::public."booking_payments", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "booking_id"=EXCLUDED."booking_id","amount"=EXCLUDED."amount","method"=EXCLUDED."method","cashier"=EXCLUDED."cashier","paid_at"=EXCLUDED."paid_at","created_at"=EXCLUDED."created_at","row_version"=EXCLUDED."row_version","status"=EXCLUDED."status","client_payment_id"=EXCLUDED."client_payment_id","reference"=EXCLUDED."reference","reversed_at"=EXCLUDED."reversed_at","reversed_by"=EXCLUDED."reversed_by","kind"=EXCLUDED."kind","refund_reason"=EXCLUDED."refund_reason","refunds_payment_id"=EXCLUDED."refunds_payment_id","change_given"=EXCLUDED."change_given" WHERE EXCLUDED."row_version">public."booking_payments"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_booking_payments(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."booking_payments" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (EXISTS(SELECT 1 FROM public."bookings" p WHERE p."id"::text=x."booking_id"::text AND p.store_id::text=p_branch_id)) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_booking_payments(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_booking_payments(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_booking_payments() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'booking_payments',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT p.store_id::text branch_id,NULL::text terminal_id FROM public."bookings" p WHERE p."id"::text=COALESCE(NEW."booking_id",OLD."booking_id")::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."booking_payments";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."booking_payments" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_booking_payments();

REVOKE ALL ON FUNCTION public.sync_feed_booking_payments() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_bookings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."bookings" ("id","ref","store_id","shift_id","customer_name","customer_phone","member_id","service_type_id","service_name","service_fee","payment_timing","lines","subtotal","discount","tax","total","paid","due_date","note","cashier","status","sale_receipt_no","closed_at","racket_model","string_type","tension_main","tension_cross","tension_unit","grommet_notes","job_notes","dropped_off_at","promised_at","job_status","job_status_by","job_status_at","notify_whatsapp","created_at","updated_at","tag_id","intake_note","string_origin","string_source_product_id","grip_product_id","charges","technician","liability_accepted","incident_note","row_version","cancel_reason","cancelled_by","cancelled_at","cancelled_terminal","cancel_money_action","booking_ref")
  SELECT "id","ref","store_id","shift_id","customer_name","customer_phone","member_id","service_type_id","service_name","service_fee","payment_timing","lines","subtotal","discount","tax","total","paid","due_date","note","cashier","status","sale_receipt_no","closed_at","racket_model","string_type","tension_main","tension_cross","tension_unit","grommet_notes","job_notes","dropped_off_at","promised_at","job_status","job_status_by","job_status_at","notify_whatsapp","created_at","updated_at","tag_id","intake_note","string_origin","string_source_product_id","grip_product_id","charges","technician","liability_accepted","incident_note","row_version","cancel_reason","cancelled_by","cancelled_at","cancelled_terminal","cancel_money_action","booking_ref" FROM jsonb_populate_recordset(NULL::public."bookings", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "ref"=EXCLUDED."ref","store_id"=EXCLUDED."store_id","shift_id"=EXCLUDED."shift_id","customer_name"=EXCLUDED."customer_name","customer_phone"=EXCLUDED."customer_phone","member_id"=EXCLUDED."member_id","service_type_id"=EXCLUDED."service_type_id","service_name"=EXCLUDED."service_name","service_fee"=EXCLUDED."service_fee","payment_timing"=EXCLUDED."payment_timing","lines"=EXCLUDED."lines","subtotal"=EXCLUDED."subtotal","discount"=EXCLUDED."discount","tax"=EXCLUDED."tax","total"=EXCLUDED."total","paid"=EXCLUDED."paid","due_date"=EXCLUDED."due_date","note"=EXCLUDED."note","cashier"=EXCLUDED."cashier","status"=EXCLUDED."status","sale_receipt_no"=EXCLUDED."sale_receipt_no","closed_at"=EXCLUDED."closed_at","racket_model"=EXCLUDED."racket_model","string_type"=EXCLUDED."string_type","tension_main"=EXCLUDED."tension_main","tension_cross"=EXCLUDED."tension_cross","tension_unit"=EXCLUDED."tension_unit","grommet_notes"=EXCLUDED."grommet_notes","job_notes"=EXCLUDED."job_notes","dropped_off_at"=EXCLUDED."dropped_off_at","promised_at"=EXCLUDED."promised_at","job_status"=EXCLUDED."job_status","job_status_by"=EXCLUDED."job_status_by","job_status_at"=EXCLUDED."job_status_at","notify_whatsapp"=EXCLUDED."notify_whatsapp","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","tag_id"=EXCLUDED."tag_id","intake_note"=EXCLUDED."intake_note","string_origin"=EXCLUDED."string_origin","string_source_product_id"=EXCLUDED."string_source_product_id","grip_product_id"=EXCLUDED."grip_product_id","charges"=EXCLUDED."charges","technician"=EXCLUDED."technician","liability_accepted"=EXCLUDED."liability_accepted","incident_note"=EXCLUDED."incident_note","row_version"=EXCLUDED."row_version","cancel_reason"=EXCLUDED."cancel_reason","cancelled_by"=EXCLUDED."cancelled_by","cancelled_at"=EXCLUDED."cancelled_at","cancelled_terminal"=EXCLUDED."cancelled_terminal","cancel_money_action"=EXCLUDED."cancel_money_action","booking_ref"=EXCLUDED."booking_ref" WHERE EXCLUDED."row_version">public."bookings"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_bookings(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."bookings" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_bookings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_bookings(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_bookings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'bookings',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."bookings";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."bookings" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_bookings();

REVOKE ALL ON FUNCTION public.sync_feed_bookings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_branch_telemetry(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."branch_telemetry" ("terminal_id","store_id","terminal_name","staff_name","staff_role","db_mode","connection_status","storage_engine","pending_count","conflict_count","last_synced_at","app_version","platform","last_seen_at","created_at","updated_at","branch_id","pending_queue_count","last_ping","status","branch_code","session_status","sql_server_state","database_name","schema_version","failed_count","sync_phase","current_table","last_push_at","last_pull_at","device_name","device_type","location_name","last_heartbeat_at")
  SELECT "terminal_id","store_id","terminal_name","staff_name","staff_role","db_mode","connection_status","storage_engine","pending_count","conflict_count","last_synced_at","app_version","platform","last_seen_at","created_at","updated_at","branch_id","pending_queue_count","last_ping","status","branch_code","session_status","sql_server_state","database_name","schema_version","failed_count","sync_phase","current_table","last_push_at","last_pull_at","device_name","device_type","location_name","last_heartbeat_at" FROM jsonb_populate_recordset(NULL::public."branch_telemetry", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("terminal_id") DO UPDATE SET "store_id"=EXCLUDED."store_id","terminal_name"=EXCLUDED."terminal_name","staff_name"=EXCLUDED."staff_name","staff_role"=EXCLUDED."staff_role","db_mode"=EXCLUDED."db_mode","connection_status"=EXCLUDED."connection_status","storage_engine"=EXCLUDED."storage_engine","pending_count"=EXCLUDED."pending_count","conflict_count"=EXCLUDED."conflict_count","last_synced_at"=EXCLUDED."last_synced_at","app_version"=EXCLUDED."app_version","platform"=EXCLUDED."platform","last_seen_at"=EXCLUDED."last_seen_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","branch_id"=EXCLUDED."branch_id","pending_queue_count"=EXCLUDED."pending_queue_count","last_ping"=EXCLUDED."last_ping","status"=EXCLUDED."status","branch_code"=EXCLUDED."branch_code","session_status"=EXCLUDED."session_status","sql_server_state"=EXCLUDED."sql_server_state","database_name"=EXCLUDED."database_name","schema_version"=EXCLUDED."schema_version","failed_count"=EXCLUDED."failed_count","sync_phase"=EXCLUDED."sync_phase","current_table"=EXCLUDED."current_table","last_push_at"=EXCLUDED."last_push_at","last_pull_at"=EXCLUDED."last_pull_at","device_name"=EXCLUDED."device_name","device_type"=EXCLUDED."device_type","location_name"=EXCLUDED."location_name","last_heartbeat_at"=EXCLUDED."last_heartbeat_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_branch_telemetry(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."branch_telemetry" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."terminal_id"::text=COALESCE(c->'key'->>'terminal_id',(c->>'entityId')::jsonb->>'terminal_id',(c->>'entity_id')::jsonb->>'terminal_id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_branch_telemetry(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_branch_telemetry(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_branch_telemetry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'branch_telemetry',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('terminal_id',OLD."terminal_id")::text ELSE jsonb_build_object('terminal_id',NEW."terminal_id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."branch_telemetry";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."branch_telemetry" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_branch_telemetry();

REVOKE ALL ON FUNCTION public.sync_feed_branch_telemetry() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_cashiers(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."cashiers" ("id","username","full_name","pin_hash","store_id","permissions","is_active","last_login_at","created_at","updated_at","role_slug","idle_timeout_minutes")
  SELECT "id","username","full_name","pin_hash","store_id","permissions","is_active","last_login_at","created_at","updated_at","role_slug","idle_timeout_minutes" FROM jsonb_populate_recordset(NULL::public."cashiers", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "username"=EXCLUDED."username","full_name"=EXCLUDED."full_name","pin_hash"=EXCLUDED."pin_hash","store_id"=EXCLUDED."store_id","permissions"=EXCLUDED."permissions","is_active"=EXCLUDED."is_active","last_login_at"=EXCLUDED."last_login_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","role_slug"=EXCLUDED."role_slug","idle_timeout_minutes"=EXCLUDED."idle_timeout_minutes";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_cashiers(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."cashiers" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_cashiers(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_cashiers(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_cashiers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'cashiers',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."cashiers";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."cashiers" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_cashiers();

REVOKE ALL ON FUNCTION public.sync_feed_cashiers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_coupon_events(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."coupon_events" ("id","event_type","campaign_id","campaign_name","voucher_token","member_id","member_phone","store_id","terminal_id","staff_name","staff_role","sale_id","note","created_at")
  SELECT "id","event_type","campaign_id","campaign_name","voucher_token","member_id","member_phone","store_id","terminal_id","staff_name","staff_role","sale_id","note","created_at" FROM jsonb_populate_recordset(NULL::public."coupon_events", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "event_type"=EXCLUDED."event_type","campaign_id"=EXCLUDED."campaign_id","campaign_name"=EXCLUDED."campaign_name","voucher_token"=EXCLUDED."voucher_token","member_id"=EXCLUDED."member_id","member_phone"=EXCLUDED."member_phone","store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","staff_name"=EXCLUDED."staff_name","staff_role"=EXCLUDED."staff_role","sale_id"=EXCLUDED."sale_id","note"=EXCLUDED."note","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_coupon_events(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."coupon_events" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_coupon_events(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_coupon_events(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_coupon_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'coupon_events',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."coupon_events";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."coupon_events" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_coupon_events();

REVOKE ALL ON FUNCTION public.sync_feed_coupon_events() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_drawer_events(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."drawer_events" ("id","store_id","terminal_id","shift_id","staff_id","staff_name","role","reason","note","approved_by","created_at")
  SELECT "id","store_id","terminal_id","shift_id","staff_id","staff_name","role","reason","note","approved_by","created_at" FROM jsonb_populate_recordset(NULL::public."drawer_events", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","shift_id"=EXCLUDED."shift_id","staff_id"=EXCLUDED."staff_id","staff_name"=EXCLUDED."staff_name","role"=EXCLUDED."role","reason"=EXCLUDED."reason","note"=EXCLUDED."note","approved_by"=EXCLUDED."approved_by","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_drawer_events(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."drawer_events" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_drawer_events(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_drawer_events(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_drawer_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'drawer_events',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."drawer_events";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."drawer_events" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_drawer_events();

REVOKE ALL ON FUNCTION public.sync_feed_drawer_events() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_held_orders(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."held_orders" ("id","label","store_id","shift_id","held_by","total","lines","cart_discount","cart_discount_type","exchange_ref","member_id","member_name","coupon","note","cancelled_from","held_at","created_at","updated_at","row_version","status","pending_request_id","bill_no")
  SELECT "id","label","store_id","shift_id","held_by","total","lines","cart_discount","cart_discount_type","exchange_ref","member_id","member_name","coupon","note","cancelled_from","held_at","created_at","updated_at","row_version","status","pending_request_id","bill_no" FROM jsonb_populate_recordset(NULL::public."held_orders", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "label"=EXCLUDED."label","store_id"=EXCLUDED."store_id","shift_id"=EXCLUDED."shift_id","held_by"=EXCLUDED."held_by","total"=EXCLUDED."total","lines"=EXCLUDED."lines","cart_discount"=EXCLUDED."cart_discount","cart_discount_type"=EXCLUDED."cart_discount_type","exchange_ref"=EXCLUDED."exchange_ref","member_id"=EXCLUDED."member_id","member_name"=EXCLUDED."member_name","coupon"=EXCLUDED."coupon","note"=EXCLUDED."note","cancelled_from"=EXCLUDED."cancelled_from","held_at"=EXCLUDED."held_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","status"=EXCLUDED."status","pending_request_id"=EXCLUDED."pending_request_id","bill_no"=EXCLUDED."bill_no" WHERE EXCLUDED."row_version">public."held_orders"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_held_orders(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."held_orders" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_held_orders(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_held_orders(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_held_orders() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'held_orders',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."held_orders";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."held_orders" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_held_orders();

REVOKE ALL ON FUNCTION public.sync_feed_held_orders() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_integration_settings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."integration_settings" ("id","provider_name","api_keys_encrypted","verification_channel","strict_verification","is_active","updated_by","created_at","updated_at")
  SELECT "id","provider_name","api_keys_encrypted","verification_channel","strict_verification","is_active","updated_by","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."integration_settings", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "provider_name"=EXCLUDED."provider_name","api_keys_encrypted"=EXCLUDED."api_keys_encrypted","verification_channel"=EXCLUDED."verification_channel","strict_verification"=EXCLUDED."strict_verification","is_active"=EXCLUDED."is_active","updated_by"=EXCLUDED."updated_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_integration_settings(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."integration_settings" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_integration_settings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_integration_settings(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_integration_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'integration_settings',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."integration_settings";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."integration_settings" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_integration_settings();

REVOKE ALL ON FUNCTION public.sync_feed_integration_settings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_item_activity_logs(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."item_activity_logs" ("id","product_id","product_name","sku","barcode","store_id","terminal_id","activity_type","reference","quantity_delta","stock_before","stock_after","unit_cost","staff_id","staff_name","role","note","created_at","row_version","item_id","sale_id","transfer_id","quantity","created_by","notes")
  SELECT "id","product_id","product_name","sku","barcode","store_id","terminal_id","activity_type","reference","quantity_delta","stock_before","stock_after","unit_cost","staff_id","staff_name","role","note","created_at","row_version","item_id","sale_id","transfer_id","quantity","created_by","notes" FROM jsonb_populate_recordset(NULL::public."item_activity_logs", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) LOOP
    IF NULLIF(v_row->>'id','') IS NOT NULL AND NULLIF(v_row->>'product_id','') IS NOT NULL AND NULLIF(v_row->>'store_id','') IS NOT NULL AND COALESCE((v_row->>'quantity_delta')::integer,0)<>0 THEN
      PERFORM public.stock_apply_delta((v_row->>'id')::uuid,(v_row->>'product_id')::uuid,v_row->>'store_id',COALESCE((v_row->>'quantity_delta')::integer,0));
    END IF;
  END LOOP;


  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_item_activity_logs(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."item_activity_logs" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_item_activity_logs(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_item_activity_logs(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_item_activity_logs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'item_activity_logs',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."item_activity_logs";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."item_activity_logs" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_item_activity_logs();

REVOKE ALL ON FUNCTION public.sync_feed_item_activity_logs() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_member_verifications(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."member_verifications" ("id","member_id","phone","email","channel","otp_code","attempts","status","sent_by","store_id","expires_at","verified_at","created_at")
  SELECT "id","member_id","phone","email","channel","otp_code","attempts","status","sent_by","store_id","expires_at","verified_at","created_at" FROM jsonb_populate_recordset(NULL::public."member_verifications", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "member_id"=EXCLUDED."member_id","phone"=EXCLUDED."phone","email"=EXCLUDED."email","channel"=EXCLUDED."channel","otp_code"=EXCLUDED."otp_code","attempts"=EXCLUDED."attempts","status"=EXCLUDED."status","sent_by"=EXCLUDED."sent_by","store_id"=EXCLUDED."store_id","expires_at"=EXCLUDED."expires_at","verified_at"=EXCLUDED."verified_at","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_member_verifications(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."member_verifications" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_member_verifications(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_member_verifications(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_member_verifications() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'member_verifications',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."member_verifications";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."member_verifications" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_member_verifications();

REVOKE ALL ON FUNCTION public.sync_feed_member_verifications() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_members(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."members" ("id","member_code","full_name","phone","email","address","date_of_birth","tier_id","loyalty_points","total_spent","created_at","updated_at","row_version","is_verified","verified_at","verified_channel","deleted_at")
  SELECT "id","member_code","full_name","phone","email","address","date_of_birth","tier_id","loyalty_points","total_spent","created_at","updated_at","row_version","is_verified","verified_at","verified_channel","deleted_at" FROM jsonb_populate_recordset(NULL::public."members", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "member_code"=EXCLUDED."member_code","full_name"=EXCLUDED."full_name","phone"=EXCLUDED."phone","email"=EXCLUDED."email","address"=EXCLUDED."address","date_of_birth"=EXCLUDED."date_of_birth","tier_id"=EXCLUDED."tier_id","loyalty_points"=EXCLUDED."loyalty_points","total_spent"=EXCLUDED."total_spent","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","is_verified"=EXCLUDED."is_verified","verified_at"=EXCLUDED."verified_at","verified_channel"=EXCLUDED."verified_channel","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."members"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_members(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."members" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_members(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_members(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_members() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'members',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."members";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."members" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_members();

REVOKE ALL ON FUNCTION public.sync_feed_members() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_membership_tiers(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."membership_tiers" ("id","name","discount_percentage","points_multiplier","created_at","updated_at","row_version","deleted_at")
  SELECT "id","name","discount_percentage","points_multiplier","created_at","updated_at","row_version","deleted_at" FROM jsonb_populate_recordset(NULL::public."membership_tiers", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","discount_percentage"=EXCLUDED."discount_percentage","points_multiplier"=EXCLUDED."points_multiplier","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."membership_tiers"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_membership_tiers(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."membership_tiers" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_membership_tiers(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_membership_tiers(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_membership_tiers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'membership_tiers',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."membership_tiers";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."membership_tiers" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_membership_tiers();

REVOKE ALL ON FUNCTION public.sync_feed_membership_tiers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_offline_sync_audit_log(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."offline_sync_audit_log" ("id","terminal_id","store_id","direction","table_name","record_id","records","status","error_message","started_at","finished_at","created_at")
  SELECT "id","terminal_id","store_id","direction","table_name","record_id","records","status","error_message","started_at","finished_at","created_at" FROM jsonb_populate_recordset(NULL::public."offline_sync_audit_log", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "terminal_id"=EXCLUDED."terminal_id","store_id"=EXCLUDED."store_id","direction"=EXCLUDED."direction","table_name"=EXCLUDED."table_name","record_id"=EXCLUDED."record_id","records"=EXCLUDED."records","status"=EXCLUDED."status","error_message"=EXCLUDED."error_message","started_at"=EXCLUDED."started_at","finished_at"=EXCLUDED."finished_at","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_offline_sync_audit_log(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."offline_sync_audit_log" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_offline_sync_audit_log(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_offline_sync_audit_log(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_offline_sync_audit_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'offline_sync_audit_log',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."offline_sync_audit_log";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."offline_sync_audit_log" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_offline_sync_audit_log();

REVOKE ALL ON FUNCTION public.sync_feed_offline_sync_audit_log() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_payment_transactions(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."payment_transactions" ("id","source_type","sale_id","booking_id","member_id","store_id","shift_id","terminal_id","amount","method","kind","reference","cashier_id","cashier_name","note","paid_at","created_at","updated_at","row_version","status","metadata","client_transaction_id","order_id","payment_method","transaction_reference")
  SELECT "id","source_type","sale_id","booking_id","member_id","store_id","shift_id","terminal_id","amount","method","kind","reference","cashier_id","cashier_name","note","paid_at","created_at","updated_at","row_version","status","metadata","client_transaction_id","order_id","payment_method","transaction_reference" FROM jsonb_populate_recordset(NULL::public."payment_transactions", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_payment_transactions(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."payment_transactions" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_payment_transactions(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_payment_transactions(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_payment_transactions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'payment_transactions',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."payment_transactions";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."payment_transactions" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_payment_transactions();

REVOKE ALL ON FUNCTION public.sync_feed_payment_transactions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_payment_types(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."payment_types" ("id","name","type_code","requires_reference","is_active","icon","sort_order","is_system","created_at","updated_at","row_version")
  SELECT "id","name","type_code","requires_reference","is_active","icon","sort_order","is_system","created_at","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."payment_types", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","type_code"=EXCLUDED."type_code","requires_reference"=EXCLUDED."requires_reference","is_active"=EXCLUDED."is_active","icon"=EXCLUDED."icon","sort_order"=EXCLUDED."sort_order","is_system"=EXCLUDED."is_system","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."payment_types"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_payment_types(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."payment_types" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_payment_types(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_payment_types(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_payment_types() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'payment_types',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."payment_types";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."payment_types" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_payment_types();

REVOKE ALL ON FUNCTION public.sync_feed_payment_types() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_pin_attempts(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."pin_attempts" ("key","attempts","window_started_at","locked_until","created_at","updated_at")
  SELECT "key","attempts","window_started_at","locked_until","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."pin_attempts", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("key") DO UPDATE SET "attempts"=EXCLUDED."attempts","window_started_at"=EXCLUDED."window_started_at","locked_until"=EXCLUDED."locked_until","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_pin_attempts(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."pin_attempts" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."key"::text=COALESCE(c->'key'->>'key',(c->>'entityId')::jsonb->>'key',(c->>'entity_id')::jsonb->>'key');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_pin_attempts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_pin_attempts(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_pin_attempts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'pin_attempts',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('key',OLD."key")::text ELSE jsonb_build_object('key',NEW."key")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."pin_attempts";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."pin_attempts" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_pin_attempts();

REVOKE ALL ON FUNCTION public.sync_feed_pin_attempts() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_pos_settings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."pos_settings" ("id","tax_percentage","enable_tax","tax_mode","paper_size","header_text","footer_text","show_logo","show_points","show_barcode","show_tax_details","updated_at","company_name","tax_number","reg_number","phone","website","fonts","custom_lines","qr","ui_visibility","integration_settings","region_country","time_zone","date_format","time_format","booking_slip","notification_settings","row_version","logo_data_url","receipt_design","payment_details","whatsapp_settings","receipt_css")
  SELECT "id","tax_percentage","enable_tax","tax_mode","paper_size","header_text","footer_text","show_logo","show_points","show_barcode","show_tax_details","updated_at","company_name","tax_number","reg_number","phone","website","fonts","custom_lines","qr","ui_visibility","integration_settings","region_country","time_zone","date_format","time_format","booking_slip","notification_settings","row_version","logo_data_url","receipt_design","payment_details","whatsapp_settings","receipt_css" FROM jsonb_populate_recordset(NULL::public."pos_settings", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "tax_percentage"=EXCLUDED."tax_percentage","enable_tax"=EXCLUDED."enable_tax","tax_mode"=EXCLUDED."tax_mode","paper_size"=EXCLUDED."paper_size","header_text"=EXCLUDED."header_text","footer_text"=EXCLUDED."footer_text","show_logo"=EXCLUDED."show_logo","show_points"=EXCLUDED."show_points","show_barcode"=EXCLUDED."show_barcode","show_tax_details"=EXCLUDED."show_tax_details","updated_at"=EXCLUDED."updated_at","company_name"=EXCLUDED."company_name","tax_number"=EXCLUDED."tax_number","reg_number"=EXCLUDED."reg_number","phone"=EXCLUDED."phone","website"=EXCLUDED."website","fonts"=EXCLUDED."fonts","custom_lines"=EXCLUDED."custom_lines","qr"=EXCLUDED."qr","ui_visibility"=EXCLUDED."ui_visibility","integration_settings"=EXCLUDED."integration_settings","region_country"=EXCLUDED."region_country","time_zone"=EXCLUDED."time_zone","date_format"=EXCLUDED."date_format","time_format"=EXCLUDED."time_format","booking_slip"=EXCLUDED."booking_slip","notification_settings"=EXCLUDED."notification_settings","row_version"=EXCLUDED."row_version","logo_data_url"=EXCLUDED."logo_data_url","receipt_design"=EXCLUDED."receipt_design","payment_details"=EXCLUDED."payment_details","whatsapp_settings"=EXCLUDED."whatsapp_settings","receipt_css"=EXCLUDED."receipt_css" WHERE EXCLUDED."row_version">public."pos_settings"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_pos_settings(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."pos_settings" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_pos_settings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_pos_settings(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_pos_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'pos_settings',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."pos_settings";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."pos_settings" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_pos_settings();

REVOKE ALL ON FUNCTION public.sync_feed_pos_settings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_product_barcodes(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."product_barcodes" ("id","product_id","barcode","label","pack_size","is_primary","created_at","updated_at","row_version","unit_label","deleted_at")
  SELECT "id","product_id","barcode","label","pack_size","is_primary","created_at","updated_at","row_version","unit_label","deleted_at" FROM jsonb_populate_recordset(NULL::public."product_barcodes", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "product_id"=EXCLUDED."product_id","barcode"=EXCLUDED."barcode","label"=EXCLUDED."label","pack_size"=EXCLUDED."pack_size","is_primary"=EXCLUDED."is_primary","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","unit_label"=EXCLUDED."unit_label","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."product_barcodes"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_product_barcodes(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."product_barcodes" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id))) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_product_barcodes(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_product_barcodes(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_product_barcodes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'product_barcodes',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NULLIF(p.owner_store_id::text,''),'global') branch_id,NULL::text terminal_id FROM public."products" p WHERE p."id"::text=COALESCE(NEW."product_id",OLD."product_id")::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."product_barcodes";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."product_barcodes" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_product_barcodes();

REVOKE ALL ON FUNCTION public.sync_feed_product_barcodes() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_product_categories(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."product_categories" ("id","name","parent_id","sort","created_at","updated_at","kind","row_version","is_active","deleted_at")
  SELECT "id","name","parent_id","sort","created_at","updated_at","kind","row_version","is_active","deleted_at" FROM jsonb_populate_recordset(NULL::public."product_categories", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","parent_id"=EXCLUDED."parent_id","sort"=EXCLUDED."sort","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","kind"=EXCLUDED."kind","row_version"=EXCLUDED."row_version","is_active"=EXCLUDED."is_active","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."product_categories"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_product_categories(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."product_categories" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_product_categories(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_product_categories(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_product_categories() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'product_categories',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."product_categories";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."product_categories" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_product_categories();

REVOKE ALL ON FUNCTION public.sync_feed_product_categories() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_products(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."products" ("id","barcode","name","category","cost_price","selling_price","ecom_price","stock_quantity","custom_points","point_multiplier","created_at","sku","reorder_level","tax_rate","ecom_visible","stock_by_store","updated_at","landing_pct","sub_category","unit","packs","barcode_aliases","is_archived","archived_at","brand","product_group","barcode_variants","row_version","owner_store_id","deleted_at")
  SELECT "id","barcode","name","category","cost_price","selling_price","ecom_price","stock_quantity","custom_points","point_multiplier","created_at","sku","reorder_level","tax_rate","ecom_visible","stock_by_store","updated_at","landing_pct","sub_category","unit","packs","barcode_aliases","is_archived","archived_at","brand","product_group","barcode_variants","row_version","owner_store_id","deleted_at" FROM jsonb_populate_recordset(NULL::public."products", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "barcode"=EXCLUDED."barcode","name"=EXCLUDED."name","category"=EXCLUDED."category","cost_price"=EXCLUDED."cost_price","selling_price"=EXCLUDED."selling_price","ecom_price"=EXCLUDED."ecom_price","custom_points"=EXCLUDED."custom_points","point_multiplier"=EXCLUDED."point_multiplier","created_at"=EXCLUDED."created_at","sku"=EXCLUDED."sku","reorder_level"=EXCLUDED."reorder_level","tax_rate"=EXCLUDED."tax_rate","ecom_visible"=EXCLUDED."ecom_visible","updated_at"=EXCLUDED."updated_at","landing_pct"=EXCLUDED."landing_pct","sub_category"=EXCLUDED."sub_category","unit"=EXCLUDED."unit","packs"=EXCLUDED."packs","barcode_aliases"=EXCLUDED."barcode_aliases","is_archived"=EXCLUDED."is_archived","archived_at"=EXCLUDED."archived_at","brand"=EXCLUDED."brand","product_group"=EXCLUDED."product_group","barcode_variants"=EXCLUDED."barcode_variants","row_version"=EXCLUDED."row_version","owner_store_id"=EXCLUDED."owner_store_id","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."products"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_products(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."products" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND ((NULLIF(x.owner_store_id::text,'') IS NULL OR x.owner_store_id::text=p_branch_id)) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_products(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_products(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_products() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'products',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NULLIF(COALESCE(NEW.owner_store_id,OLD.owner_store_id)::text,''),'global') branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."products";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."products" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_products();

REVOKE ALL ON FUNCTION public.sync_feed_products() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_promotions(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."promotions" ("id","title","promo_type","min_spend","discount_percent","discount_amount","foc_product_id","points_per_dollar","tier_rates","is_active","start_date","end_date","created_at","updated_at","row_version","deleted_at")
  SELECT "id","title","promo_type","min_spend","discount_percent","discount_amount","foc_product_id","points_per_dollar","tier_rates","is_active","start_date","end_date","created_at","updated_at","row_version","deleted_at" FROM jsonb_populate_recordset(NULL::public."promotions", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "title"=EXCLUDED."title","promo_type"=EXCLUDED."promo_type","min_spend"=EXCLUDED."min_spend","discount_percent"=EXCLUDED."discount_percent","discount_amount"=EXCLUDED."discount_amount","foc_product_id"=EXCLUDED."foc_product_id","points_per_dollar"=EXCLUDED."points_per_dollar","tier_rates"=EXCLUDED."tier_rates","is_active"=EXCLUDED."is_active","start_date"=EXCLUDED."start_date","end_date"=EXCLUDED."end_date","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."promotions"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_promotions(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."promotions" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."foc_product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id))) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_promotions(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_promotions(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_promotions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'promotions',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NULLIF(p.owner_store_id::text,''),'global') branch_id,NULL::text terminal_id FROM public."products" p WHERE p."id"::text=COALESCE(NEW."foc_product_id",OLD."foc_product_id")::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."promotions";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."promotions" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_promotions();

REVOKE ALL ON FUNCTION public.sync_feed_promotions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_public_flags(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."public_flags" ("key","enabled","updated_at")
  SELECT "key","enabled","updated_at" FROM jsonb_populate_recordset(NULL::public."public_flags", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("key") DO UPDATE SET "enabled"=EXCLUDED."enabled","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_public_flags(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."public_flags" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."key"::text=COALESCE(c->'key'->>'key',(c->>'entityId')::jsonb->>'key',(c->>'entity_id')::jsonb->>'key');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_public_flags(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_public_flags(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_public_flags() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'public_flags',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('key',OLD."key")::text ELSE jsonb_build_object('key',NEW."key")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."public_flags";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."public_flags" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_public_flags();

REVOKE ALL ON FUNCTION public.sync_feed_public_flags() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_purchase_order_items(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."purchase_order_items" ("id","po_id","product_id","barcode","product_name","cost_price","selling_price","quantity_received","subtotal_cost","created_at","sku","updated_at","row_version")
  SELECT "id","po_id","product_id","barcode","product_name","cost_price","selling_price","quantity_received","subtotal_cost","created_at","sku","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."purchase_order_items", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "po_id"=EXCLUDED."po_id","product_id"=EXCLUDED."product_id","barcode"=EXCLUDED."barcode","product_name"=EXCLUDED."product_name","cost_price"=EXCLUDED."cost_price","selling_price"=EXCLUDED."selling_price","quantity_received"=EXCLUDED."quantity_received","subtotal_cost"=EXCLUDED."subtotal_cost","created_at"=EXCLUDED."created_at","sku"=EXCLUDED."sku","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."purchase_order_items"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_purchase_order_items(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."purchase_order_items" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (EXISTS(SELECT 1 FROM public."purchase_orders" p WHERE p."id"::text=x."po_id"::text AND p.store_id::text=p_branch_id)) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_purchase_order_items(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_purchase_order_items(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_purchase_order_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'purchase_order_items',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT p.store_id::text branch_id,NULL::text terminal_id FROM public."purchase_orders" p WHERE p."id"::text=COALESCE(NEW."po_id",OLD."po_id")::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."purchase_order_items";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."purchase_order_items" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_purchase_order_items();

REVOKE ALL ON FUNCTION public.sync_feed_purchase_order_items() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_purchase_orders(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."purchase_orders" ("id","po_number","supplier_name","operator_name","total_cost","total_items_count","created_at","supplier_id","store_id","store_code","invoice_date","invoice_entry_date","updated_at","row_version","pending_edit_request_id","pending_edit_by","pending_edit_at","status","reference")
  SELECT "id","po_number","supplier_name","operator_name","total_cost","total_items_count","created_at","supplier_id","store_id","store_code","invoice_date","invoice_entry_date","updated_at","row_version","pending_edit_request_id","pending_edit_by","pending_edit_at","status","reference" FROM jsonb_populate_recordset(NULL::public."purchase_orders", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "po_number"=EXCLUDED."po_number","supplier_name"=EXCLUDED."supplier_name","operator_name"=EXCLUDED."operator_name","total_cost"=EXCLUDED."total_cost","total_items_count"=EXCLUDED."total_items_count","created_at"=EXCLUDED."created_at","supplier_id"=EXCLUDED."supplier_id","store_id"=EXCLUDED."store_id","store_code"=EXCLUDED."store_code","invoice_date"=EXCLUDED."invoice_date","invoice_entry_date"=EXCLUDED."invoice_entry_date","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","pending_edit_request_id"=EXCLUDED."pending_edit_request_id","pending_edit_by"=EXCLUDED."pending_edit_by","pending_edit_at"=EXCLUDED."pending_edit_at","status"=EXCLUDED."status","reference"=EXCLUDED."reference" WHERE EXCLUDED."row_version">public."purchase_orders"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_purchase_orders(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."purchase_orders" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_purchase_orders(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_purchase_orders(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_purchase_orders() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'purchase_orders',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."purchase_orders";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."purchase_orders" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_purchase_orders();

REVOKE ALL ON FUNCTION public.sync_feed_purchase_orders() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_sale_items(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN
  PERFORM set_config('pos.refunding','on',true);

  INSERT INTO public."sale_items" ("id","sale_id","product_id","product_name","unit_price","quantity","discount_percent","discount_amount","is_return","created_at","tax_rate","is_foc","promo_id","coupon_code","coupon_discount","unit_cost","row_version","refunded_qty","branch_id")
  SELECT "id","sale_id","product_id","product_name","unit_price","quantity","discount_percent","discount_amount","is_return","created_at","tax_rate","is_foc","promo_id","coupon_code","coupon_discount","unit_cost","row_version","refunded_qty","branch_id" FROM jsonb_populate_recordset(NULL::public."sale_items", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "refunded_qty"=GREATEST(public."sale_items"."refunded_qty",EXCLUDED."refunded_qty"),"row_version"=GREATEST(public."sale_items"."row_version",EXCLUDED."row_version");
  GET DIAGNOSTICS v_count=ROW_COUNT;


  PERFORM set_config('pos.refunding','off',true);
  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_sale_items(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."sale_items" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.branch_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_sale_items(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_sale_items(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_sale_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'sale_items',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.branch_id,OLD.branch_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."sale_items";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."sale_items" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_sale_items();

REVOKE ALL ON FUNCTION public.sync_feed_sale_items() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_sales(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN
  PERFORM set_config('pos.refunding','on',true);

  INSERT INTO public."sales" ("id","bill_number","member_id","store_id","cashier_name","subtotal_amount","total_amount","discount_amount","tax_amount","payment_type","points_earned","points_redeemed","is_exchange","original_bill_number","is_refunded","created_at","shift_id","paid_amount","change_amount","exchange_credit","exchanged_to_bill_number","coupon_code","coupon_promo_id","coupon_scope","coupon_discount","payments","client_transaction_id","cashier_id","created_by","updated_by","row_version","store_name_snapshot","store_address_snapshot","authorization_request_id","authorized_by","authorized_at","rounding_adjustment","rounding_label","branch_id")
  SELECT "id","bill_number","member_id","store_id","cashier_name","subtotal_amount","total_amount","discount_amount","tax_amount","payment_type","points_earned","points_redeemed","is_exchange","original_bill_number","is_refunded","created_at","shift_id","paid_amount","change_amount","exchange_credit","exchanged_to_bill_number","coupon_code","coupon_promo_id","coupon_scope","coupon_discount","payments","client_transaction_id","cashier_id","created_by","updated_by","row_version","store_name_snapshot","store_address_snapshot","authorization_request_id","authorized_by","authorized_at","rounding_adjustment","rounding_label","branch_id" FROM jsonb_populate_recordset(NULL::public."sales", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "is_refunded"=(public."sales"."is_refunded" OR EXCLUDED."is_refunded"),"row_version"=GREATEST(public."sales"."row_version",EXCLUDED."row_version");
  GET DIAGNOSTICS v_count=ROW_COUNT;


  PERFORM set_config('pos.refunding','off',true);
  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_sales(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."sales" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_sales(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_sales(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_sales() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'sales',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."sales";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."sales" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_sales();

REVOKE ALL ON FUNCTION public.sync_feed_sales() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_secure_settings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."secure_settings" ("key","ciphertext","hint","updated_by","created_at","updated_at")
  SELECT "key","ciphertext","hint","updated_by","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."secure_settings", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("key") DO UPDATE SET "ciphertext"=EXCLUDED."ciphertext","hint"=EXCLUDED."hint","updated_by"=EXCLUDED."updated_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_secure_settings(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."secure_settings" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."key"::text=COALESCE(c->'key'->>'key',(c->>'entityId')::jsonb->>'key',(c->>'entity_id')::jsonb->>'key');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_secure_settings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_secure_settings(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_secure_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'secure_settings',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('key',OLD."key")::text ELSE jsonb_build_object('key',NEW."key")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."secure_settings";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."secure_settings" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_secure_settings();

REVOKE ALL ON FUNCTION public.sync_feed_secure_settings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_security_findings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."security_findings" ("id","fingerprint","source","severity","title","detail","deployment_ref","status","first_seen_at","last_seen_at","acknowledged_by","acknowledged_at","resolved_at","created_at","updated_at")
  SELECT "id","fingerprint","source","severity","title","detail","deployment_ref","status","first_seen_at","last_seen_at","acknowledged_by","acknowledged_at","resolved_at","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."security_findings", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "fingerprint"=EXCLUDED."fingerprint","source"=EXCLUDED."source","severity"=EXCLUDED."severity","title"=EXCLUDED."title","detail"=EXCLUDED."detail","deployment_ref"=EXCLUDED."deployment_ref","status"=EXCLUDED."status","first_seen_at"=EXCLUDED."first_seen_at","last_seen_at"=EXCLUDED."last_seen_at","acknowledged_by"=EXCLUDED."acknowledged_by","acknowledged_at"=EXCLUDED."acknowledged_at","resolved_at"=EXCLUDED."resolved_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_security_findings(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."security_findings" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_security_findings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_security_findings(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_security_findings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'security_findings',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."security_findings";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."security_findings" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_security_findings();

REVOKE ALL ON FUNCTION public.sync_feed_security_findings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_settings_locks(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."settings_locks" ("section","locked","updated_by","created_at","updated_at")
  SELECT "section","locked","updated_by","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."settings_locks", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("section") DO UPDATE SET "locked"=EXCLUDED."locked","updated_by"=EXCLUDED."updated_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_settings_locks(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."settings_locks" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."section"::text=COALESCE(c->'key'->>'section',(c->>'entityId')::jsonb->>'section',(c->>'entity_id')::jsonb->>'section');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_settings_locks(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_settings_locks(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_settings_locks() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'settings_locks',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('section',OLD."section")::text ELSE jsonb_build_object('section',NEW."section")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."settings_locks";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."settings_locks" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_settings_locks();

REVOKE ALL ON FUNCTION public.sync_feed_settings_locks() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_settings_overrides(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."settings_overrides" ("scope","scope_id","section","patch","updated_by","created_at","updated_at","row_version")
  SELECT "scope","scope_id","section","patch","updated_by","created_at","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."settings_overrides", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("scope","scope_id","section") DO UPDATE SET "patch"=EXCLUDED."patch","updated_by"=EXCLUDED."updated_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."settings_overrides"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_settings_overrides(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."settings_overrides" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (((lower(x.scope)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id))) AND x."scope"::text=COALESCE(c->'key'->>'scope',(c->>'entityId')::jsonb->>'scope',(c->>'entity_id')::jsonb->>'scope') AND x."scope_id"::text=COALESCE(c->'key'->>'scope_id',(c->>'entityId')::jsonb->>'scope_id',(c->>'entity_id')::jsonb->>'scope_id') AND x."section"::text=COALESCE(c->'key'->>'section',(c->>'entityId')::jsonb->>'section',(c->>'entity_id')::jsonb->>'section');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_settings_overrides(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_settings_overrides(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_settings_overrides() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'settings_overrides',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('scope',OLD."scope",'scope_id',OLD."scope_id",'section',OLD."section")::text ELSE jsonb_build_object('scope',NEW."scope",'scope_id',NEW."scope_id",'section',NEW."section")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id WHERE lower(COALESCE(NEW.scope,OLD.scope))='global' UNION ALL SELECT COALESCE(NEW.scope_id,OLD.scope_id)::text,NULL::text WHERE lower(COALESCE(NEW.scope,OLD.scope))='branch' UNION ALL SELECT store.id::text,NULL::text FROM public.stores store WHERE lower(COALESCE(NEW.scope,OLD.scope))='cluster' AND COALESCE(NULLIF(store.group_id,''),'default')=COALESCE(NEW.scope_id,OLD.scope_id)::text UNION ALL SELECT token.location_id::text,COALESCE(NEW.scope_id,OLD.scope_id)::text FROM public.terminal_tokens token WHERE lower(COALESCE(NEW.scope,OLD.scope))='terminal' AND token.id::text=COALESCE(NEW.scope_id,OLD.scope_id)::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."settings_overrides";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."settings_overrides" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_settings_overrides();

REVOKE ALL ON FUNCTION public.sync_feed_settings_overrides() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shift_sessions(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."shift_sessions" ("id","shift_id","store_id","terminal_id","terminal_name","staff_id","staff_name","role","signed_in_at","signed_out_at","created_at","updated_at","row_version")
  SELECT "id","shift_id","store_id","terminal_id","terminal_name","staff_id","staff_name","role","signed_in_at","signed_out_at","created_at","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."shift_sessions", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "shift_id"=EXCLUDED."shift_id","store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","terminal_name"=EXCLUDED."terminal_name","staff_id"=EXCLUDED."staff_id","staff_name"=EXCLUDED."staff_name","role"=EXCLUDED."role","signed_in_at"=EXCLUDED."signed_in_at","signed_out_at"=EXCLUDED."signed_out_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."shift_sessions"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shift_sessions(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."shift_sessions" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shift_sessions(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shift_sessions(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shift_sessions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shift_sessions',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shift_sessions";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_sessions" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shift_sessions();

REVOKE ALL ON FUNCTION public.sync_feed_shift_sessions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_sku_audit(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."sku_audit" ("id","sku","product_id","product_name","source","previous_sku","store_id","store_name","terminal_id","staff_id","staff_name","role","created_at")
  SELECT "id","sku","product_id","product_name","source","previous_sku","store_id","store_name","terminal_id","staff_id","staff_name","role","created_at" FROM jsonb_populate_recordset(NULL::public."sku_audit", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "sku"=EXCLUDED."sku","product_id"=EXCLUDED."product_id","product_name"=EXCLUDED."product_name","source"=EXCLUDED."source","previous_sku"=EXCLUDED."previous_sku","store_id"=EXCLUDED."store_id","store_name"=EXCLUDED."store_name","terminal_id"=EXCLUDED."terminal_id","staff_id"=EXCLUDED."staff_id","staff_name"=EXCLUDED."staff_name","role"=EXCLUDED."role","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_sku_audit(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."sku_audit" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_sku_audit(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_sku_audit(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_sku_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'sku_audit',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."sku_audit";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."sku_audit" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_sku_audit();

REVOKE ALL ON FUNCTION public.sync_feed_sku_audit() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_staff_roles(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."staff_roles" ("slug","name","base_level","permissions","is_core","created_at","updated_at")
  SELECT "slug","name","base_level","permissions","is_core","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."staff_roles", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("slug") DO UPDATE SET "name"=EXCLUDED."name","base_level"=EXCLUDED."base_level","permissions"=EXCLUDED."permissions","is_core"=EXCLUDED."is_core","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_staff_roles(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."staff_roles" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."slug"::text=COALESCE(c->'key'->>'slug',(c->>'entityId')::jsonb->>'slug',(c->>'entity_id')::jsonb->>'slug');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_staff_roles(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_staff_roles(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_staff_roles() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'staff_roles',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('slug',OLD."slug")::text ELSE jsonb_build_object('slug',NEW."slug")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."staff_roles";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."staff_roles" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_staff_roles();

REVOKE ALL ON FUNCTION public.sync_feed_staff_roles() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_stock_adjustments(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."stock_adjustments" ("id","product_id","product_name","sku","barcode","store_id","terminal_id","reason","note","previous_stock","updated_stock","delta","cost_impact","staff_id","staff_name","role","created_at","row_version","draft_id")
  SELECT "id","product_id","product_name","sku","barcode","store_id","terminal_id","reason","note","previous_stock","updated_stock","delta","cost_impact","staff_id","staff_name","role","created_at","row_version","draft_id" FROM jsonb_populate_recordset(NULL::public."stock_adjustments", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_stock_adjustments(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."stock_adjustments" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_stock_adjustments(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_stock_adjustments(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_stock_adjustments() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'stock_adjustments',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."stock_adjustments";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."stock_adjustments" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_stock_adjustments();

REVOKE ALL ON FUNCTION public.sync_feed_stock_adjustments() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_stock_delta_applied(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer:=0; v_row jsonb;
BEGIN FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) LOOP
  PERFORM public.stock_apply_delta((v_row->>'movement_id')::uuid,(v_row->>'product_id')::uuid,v_row->>'store_id',COALESCE((v_row->>'delta')::integer,0)); v_count:=v_count+1;
 END LOOP; RETURN v_count; END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_stock_delta_applied(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."stock_delta_applied" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."movement_id"::text=COALESCE(c->'key'->>'movement_id',(c->>'entityId')::jsonb->>'movement_id',(c->>'entity_id')::jsonb->>'movement_id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_stock_delta_applied(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_stock_delta_applied(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_stock_delta_applied() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'stock_delta_applied',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('movement_id',OLD."movement_id")::text ELSE jsonb_build_object('movement_id',NEW."movement_id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."stock_delta_applied";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."stock_delta_applied" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_stock_delta_applied();

REVOKE ALL ON FUNCTION public.sync_feed_stock_delta_applied() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_stock_transfer_items(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."stock_transfer_items" ("id","transfer_id","product_id","barcode","sku","product_name","quantity","quantity_received","unit_cost","created_at","row_version","quantity_approved","quantity_dispatched","quantity_verified")
  SELECT "id","transfer_id","product_id","barcode","sku","product_name","quantity","quantity_received","unit_cost","created_at","row_version","quantity_approved","quantity_dispatched","quantity_verified" FROM jsonb_populate_recordset(NULL::public."stock_transfer_items", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "transfer_id"=EXCLUDED."transfer_id","product_id"=EXCLUDED."product_id","barcode"=EXCLUDED."barcode","sku"=EXCLUDED."sku","product_name"=EXCLUDED."product_name","quantity"=EXCLUDED."quantity","quantity_received"=EXCLUDED."quantity_received","unit_cost"=EXCLUDED."unit_cost","created_at"=EXCLUDED."created_at","row_version"=EXCLUDED."row_version","quantity_approved"=EXCLUDED."quantity_approved","quantity_dispatched"=EXCLUDED."quantity_dispatched","quantity_verified"=EXCLUDED."quantity_verified" WHERE EXCLUDED."row_version">public."stock_transfer_items"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_stock_transfer_items(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."stock_transfer_items" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (EXISTS(SELECT 1 FROM public."stock_transfers" p WHERE p."id"::text=x."transfer_id"::text AND p_branch_id IN (p.from_store_id::text,p.to_store_id::text))) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_stock_transfer_items(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_stock_transfer_items(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_stock_transfer_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'stock_transfer_items',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT DISTINCT branch_id,NULL::text terminal_id FROM public."stock_transfers" p CROSS JOIN LATERAL (VALUES(p.from_store_id::text),(p.to_store_id::text)) b(branch_id) WHERE p."id"::text=COALESCE(NEW."transfer_id",OLD."transfer_id")::text AND branch_id IS NOT NULL) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."stock_transfer_items";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."stock_transfer_items" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_stock_transfer_items();

REVOKE ALL ON FUNCTION public.sync_feed_stock_transfer_items() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_stock_transfers(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."stock_transfers" ("id","ref","kind","transfer_scope","from_store_id","from_store_name","from_group_id","to_store_id","to_store_name","to_group_id","status","note","created_by","approved_by","approved_at","received_by","received_at","rejected_reason","created_at","updated_at","row_version","verified_by","verified_at","posted_at","discrepancy_reason","rejected_by","cancelled_reason","dispatched_by","dispatched_at","closed_at","fulfilment","source_request_id")
  SELECT "id","ref","kind","transfer_scope","from_store_id","from_store_name","from_group_id","to_store_id","to_store_name","to_group_id","status","note","created_by","approved_by","approved_at","received_by","received_at","rejected_reason","created_at","updated_at","row_version","verified_by","verified_at","posted_at","discrepancy_reason","rejected_by","cancelled_reason","dispatched_by","dispatched_at","closed_at","fulfilment","source_request_id" FROM jsonb_populate_recordset(NULL::public."stock_transfers", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "ref"=EXCLUDED."ref","kind"=EXCLUDED."kind","transfer_scope"=EXCLUDED."transfer_scope","from_store_id"=EXCLUDED."from_store_id","from_store_name"=EXCLUDED."from_store_name","from_group_id"=EXCLUDED."from_group_id","to_store_id"=EXCLUDED."to_store_id","to_store_name"=EXCLUDED."to_store_name","to_group_id"=EXCLUDED."to_group_id","status"=EXCLUDED."status","note"=EXCLUDED."note","created_by"=EXCLUDED."created_by","approved_by"=EXCLUDED."approved_by","approved_at"=EXCLUDED."approved_at","received_by"=EXCLUDED."received_by","received_at"=EXCLUDED."received_at","rejected_reason"=EXCLUDED."rejected_reason","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","verified_by"=EXCLUDED."verified_by","verified_at"=EXCLUDED."verified_at","posted_at"=EXCLUDED."posted_at","discrepancy_reason"=EXCLUDED."discrepancy_reason","rejected_by"=EXCLUDED."rejected_by","cancelled_reason"=EXCLUDED."cancelled_reason","dispatched_by"=EXCLUDED."dispatched_by","dispatched_at"=EXCLUDED."dispatched_at","closed_at"=EXCLUDED."closed_at","fulfilment"=EXCLUDED."fulfilment","source_request_id"=EXCLUDED."source_request_id" WHERE EXCLUDED."row_version">public."stock_transfers"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_stock_transfers(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."stock_transfers" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (p_branch_id IN (x.from_store_id::text,x.to_store_id::text)) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_stock_transfers(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_stock_transfers(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_stock_transfers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'stock_transfers',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT DISTINCT branch_id,NULL::text terminal_id FROM (VALUES(COALESCE(NEW.from_store_id,OLD.from_store_id)::text),(COALESCE(NEW.to_store_id,OLD.to_store_id)::text)) b(branch_id) WHERE branch_id IS NOT NULL) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."stock_transfers";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."stock_transfers" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_stock_transfers();

REVOKE ALL ON FUNCTION public.sync_feed_stock_transfers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_stores(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."stores" ("id","code","name","address","phone","created_at","updated_at","group_id","row_version","location_type","parent_id","is_central","building_name","floor_label","is_active","archived_at","is_primary_sub","private_catalogue","receipt_prefix","deleted_at")
  SELECT "id","code","name","address","phone","created_at","updated_at","group_id","row_version","location_type","parent_id","is_central","building_name","floor_label","is_active","archived_at","is_primary_sub","private_catalogue","receipt_prefix","deleted_at" FROM jsonb_populate_recordset(NULL::public."stores", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "code"=EXCLUDED."code","name"=EXCLUDED."name","address"=EXCLUDED."address","phone"=EXCLUDED."phone","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","group_id"=EXCLUDED."group_id","row_version"=EXCLUDED."row_version","location_type"=EXCLUDED."location_type","parent_id"=EXCLUDED."parent_id","is_central"=EXCLUDED."is_central","building_name"=EXCLUDED."building_name","floor_label"=EXCLUDED."floor_label","is_active"=EXCLUDED."is_active","archived_at"=EXCLUDED."archived_at","is_primary_sub"=EXCLUDED."is_primary_sub","private_catalogue"=EXCLUDED."private_catalogue","receipt_prefix"=EXCLUDED."receipt_prefix","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."stores"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_stores(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."stores" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_stores(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_stores(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_stores() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'stores',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."stores";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."stores" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_stores();

REVOKE ALL ON FUNCTION public.sync_feed_stores() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_suppliers(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."suppliers" ("id","name","contact_name","phone","email","address","tax_number","notes","is_active","created_at","updated_at","row_version","deleted_at")
  SELECT "id","name","contact_name","phone","email","address","tax_number","notes","is_active","created_at","updated_at","row_version","deleted_at" FROM jsonb_populate_recordset(NULL::public."suppliers", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","contact_name"=EXCLUDED."contact_name","phone"=EXCLUDED."phone","email"=EXCLUDED."email","address"=EXCLUDED."address","tax_number"=EXCLUDED."tax_number","notes"=EXCLUDED."notes","is_active"=EXCLUDED."is_active","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."suppliers"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_suppliers(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."suppliers" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_suppliers(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_suppliers(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_suppliers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'suppliers',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."suppliers";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."suppliers" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_suppliers();

REVOKE ALL ON FUNCTION public.sync_feed_suppliers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_sync_metadata(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."sync_metadata" ("id","store_id","terminal_id","table_name","last_synced_at","last_pushed_at","rows_pushed","last_error","created_at","updated_at")
  SELECT "id","store_id","terminal_id","table_name","last_synced_at","last_pushed_at","rows_pushed","last_error","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."sync_metadata", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","table_name"=EXCLUDED."table_name","last_synced_at"=EXCLUDED."last_synced_at","last_pushed_at"=EXCLUDED."last_pushed_at","rows_pushed"=EXCLUDED."rows_pushed","last_error"=EXCLUDED."last_error","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_sync_metadata(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."sync_metadata" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_sync_metadata(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_sync_metadata(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_sync_metadata() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'sync_metadata',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."sync_metadata";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."sync_metadata" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_sync_metadata();

REVOKE ALL ON FUNCTION public.sync_feed_sync_metadata() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_system_audit_logs(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."system_audit_logs" ("id","actor_id","actor_name","actor_role","action_type","entity_affected","entity_id","old_value","new_value","terminal_id","ip_address","store_id","note","created_at")
  SELECT "id","actor_id","actor_name","actor_role","action_type","entity_affected","entity_id","old_value","new_value","terminal_id","ip_address","store_id","note","created_at" FROM jsonb_populate_recordset(NULL::public."system_audit_logs", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "actor_id"=EXCLUDED."actor_id","actor_name"=EXCLUDED."actor_name","actor_role"=EXCLUDED."actor_role","action_type"=EXCLUDED."action_type","entity_affected"=EXCLUDED."entity_affected","entity_id"=EXCLUDED."entity_id","old_value"=EXCLUDED."old_value","new_value"=EXCLUDED."new_value","terminal_id"=EXCLUDED."terminal_id","ip_address"=EXCLUDED."ip_address","store_id"=EXCLUDED."store_id","note"=EXCLUDED."note","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_system_audit_logs(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."system_audit_logs" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_system_audit_logs(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_system_audit_logs(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_system_audit_logs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'system_audit_logs',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."system_audit_logs";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."system_audit_logs" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_system_audit_logs();

REVOKE ALL ON FUNCTION public.sync_feed_system_audit_logs() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_terminal_commands(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."terminal_commands" ("id","terminal_id","store_id","command","status","note","result","issued_by","issued_role","picked_up_at","finished_at","created_at","updated_at")
  SELECT "id","terminal_id","store_id","command","status","note","result","issued_by","issued_role","picked_up_at","finished_at","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."terminal_commands", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "terminal_id"=EXCLUDED."terminal_id","store_id"=EXCLUDED."store_id","command"=EXCLUDED."command","status"=EXCLUDED."status","note"=EXCLUDED."note","result"=EXCLUDED."result","issued_by"=EXCLUDED."issued_by","issued_role"=EXCLUDED."issued_role","picked_up_at"=EXCLUDED."picked_up_at","finished_at"=EXCLUDED."finished_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_terminal_commands(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."terminal_commands" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_terminal_commands(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_terminal_commands(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_terminal_commands() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'terminal_commands',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."terminal_commands";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."terminal_commands" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_terminal_commands();

REVOKE ALL ON FUNCTION public.sync_feed_terminal_commands() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_terminal_tokens(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."terminal_tokens" ("id","location_id","location_name","device_name","status","created_at","activated_at","revoked_at","last_seen_at","app_version","last_sync_at","reissued_at","replaced_by","claimed_by_device","claimed_at","platform","row_version","claim_secret_hash","claim_expires_at","credentials_issued_at","device_platform","device_os","claimed_proof_hash","claimed_platform","claimed_os","is_claimed","expires_at","claim_proof")
  SELECT "id","location_id","location_name","device_name","status","created_at","activated_at","revoked_at","last_seen_at","app_version","last_sync_at","reissued_at","replaced_by","claimed_by_device","claimed_at","platform","row_version","claim_secret_hash","claim_expires_at","credentials_issued_at","device_platform","device_os","claimed_proof_hash","claimed_platform","claimed_os","is_claimed","expires_at","claim_proof" FROM jsonb_populate_recordset(NULL::public."terminal_tokens", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "location_id"=EXCLUDED."location_id","location_name"=EXCLUDED."location_name","device_name"=EXCLUDED."device_name","status"=EXCLUDED."status","created_at"=EXCLUDED."created_at","activated_at"=EXCLUDED."activated_at","revoked_at"=EXCLUDED."revoked_at","last_seen_at"=EXCLUDED."last_seen_at","app_version"=EXCLUDED."app_version","last_sync_at"=EXCLUDED."last_sync_at","reissued_at"=EXCLUDED."reissued_at","replaced_by"=EXCLUDED."replaced_by","claimed_by_device"=EXCLUDED."claimed_by_device","claimed_at"=EXCLUDED."claimed_at","platform"=EXCLUDED."platform","row_version"=EXCLUDED."row_version","claim_secret_hash"=EXCLUDED."claim_secret_hash","claim_expires_at"=EXCLUDED."claim_expires_at","credentials_issued_at"=EXCLUDED."credentials_issued_at","device_platform"=EXCLUDED."device_platform","device_os"=EXCLUDED."device_os","claimed_proof_hash"=EXCLUDED."claimed_proof_hash","claimed_platform"=EXCLUDED."claimed_platform","claimed_os"=EXCLUDED."claimed_os","is_claimed"=EXCLUDED."is_claimed","expires_at"=EXCLUDED."expires_at","claim_proof"=EXCLUDED."claim_proof" WHERE EXCLUDED."row_version">public."terminal_tokens"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_terminal_tokens(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."terminal_tokens" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_terminal_tokens(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_terminal_tokens(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_terminal_tokens() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'terminal_tokens',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."terminal_tokens";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."terminal_tokens" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_terminal_tokens();

REVOKE ALL ON FUNCTION public.sync_feed_terminal_tokens() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_uom_units(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."uom_units" ("id","code","name","allow_decimal","sort","created_at","updated_at","row_version","is_active","deleted_at")
  SELECT "id","code","name","allow_decimal","sort","created_at","updated_at","row_version","is_active","deleted_at" FROM jsonb_populate_recordset(NULL::public."uom_units", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "code"=EXCLUDED."code","name"=EXCLUDED."name","allow_decimal"=EXCLUDED."allow_decimal","sort"=EXCLUDED."sort","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","is_active"=EXCLUDED."is_active","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."uom_units"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_uom_units(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."uom_units" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_uom_units(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_uom_units(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_uom_units() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'uom_units',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."uom_units";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."uom_units" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_uom_units();

REVOKE ALL ON FUNCTION public.sync_feed_uom_units() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_user_roles(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."user_roles" ("id","user_id","role","created_at")
  SELECT "id","user_id","role","created_at" FROM jsonb_populate_recordset(NULL::public."user_roles", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "user_id"=EXCLUDED."user_id","role"=EXCLUDED."role","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_user_roles(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."user_roles" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_user_roles(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_user_roles(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_user_roles() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'user_roles',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."user_roles";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."user_roles" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_user_roles();

REVOKE ALL ON FUNCTION public.sync_feed_user_roles() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_whatsapp_queue(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."whatsapp_queue" ("id","phone_number_id","recipient","body","reference","store_id","status","error","queued_at","sent_at","created_at","updated_at")
  SELECT "id","phone_number_id","recipient","body","reference","store_id","status","error","queued_at","sent_at","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."whatsapp_queue", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "phone_number_id"=EXCLUDED."phone_number_id","recipient"=EXCLUDED."recipient","body"=EXCLUDED."body","reference"=EXCLUDED."reference","store_id"=EXCLUDED."store_id","status"=EXCLUDED."status","error"=EXCLUDED."error","queued_at"=EXCLUDED."queued_at","sent_at"=EXCLUDED."sent_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_whatsapp_queue(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."whatsapp_queue" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_whatsapp_queue(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_whatsapp_queue(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_whatsapp_queue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'whatsapp_queue',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."whatsapp_queue";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."whatsapp_queue" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_whatsapp_queue();

REVOKE ALL ON FUNCTION public.sync_feed_whatsapp_queue() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_terminal_recovery_secrets(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."terminal_recovery_secrets" ("terminal_token_id","sealed_secret","fingerprint","platform","device_name","utc_offset_minutes","created_at","updated_at")
  SELECT "terminal_token_id","sealed_secret","fingerprint","platform","device_name","utc_offset_minutes","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."terminal_recovery_secrets", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("terminal_token_id") DO UPDATE SET "sealed_secret"=EXCLUDED."sealed_secret","fingerprint"=EXCLUDED."fingerprint","platform"=EXCLUDED."platform","device_name"=EXCLUDED."device_name","utc_offset_minutes"=EXCLUDED."utc_offset_minutes","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_terminal_recovery_secrets(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."terminal_recovery_secrets" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."terminal_token_id"::text=COALESCE(c->'key'->>'terminal_token_id',(c->>'entityId')::jsonb->>'terminal_token_id',(c->>'entity_id')::jsonb->>'terminal_token_id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_terminal_recovery_secrets(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_terminal_recovery_secrets(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_terminal_recovery_secrets() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'terminal_recovery_secrets',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('terminal_token_id',OLD."terminal_token_id")::text ELSE jsonb_build_object('terminal_token_id',NEW."terminal_token_id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."terminal_recovery_secrets";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."terminal_recovery_secrets" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_terminal_recovery_secrets();

REVOKE ALL ON FUNCTION public.sync_feed_terminal_recovery_secrets() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_pos_store_settings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."pos_store_settings" ("store_id","block_shift_close_on_hold","require_daily_sales_for_shift_close","require_counted_cash_on_close","require_opening_float_count","enable_blind_cash_count","max_drawer_cash_limit","require_reason_for_payout","allow_multiple_shifts_per_terminal","enable_cashier_x_report","show_opening_float_at_close","show_expected_totals_at_close","show_live_variance_at_close","show_itemized_tender_breakdown","require_manager_pin_on_variance","variance_pin_threshold","max_cashier_discount_percent","max_cart_discount_amount","allow_discount_stacking","require_reason_for_price_override","prevent_below_cost_sale","allow_tax_exemption","prevent_negative_stock_sale","require_receipt_for_refund","require_manager_pin_for_refund","max_refund_days_limit","track_item_voids","auto_lock_timeout_seconds","require_manager_pin_for_cash_drawer_open","enable_manager_pin_audit_log","require_pin_void_cart","require_pin_void_line","require_pin_reduce_qty","require_pin_manual_discount","require_pin_price_override","require_pin_stock_adjustment","require_pin_shift_close","require_pin_edit_tenders","require_pin_terminal_reset","row_version","updated_by","updated_at","allow_offline_approvals","offline_approval_requires_pin","online_only_void_cart","online_only_void_line","online_only_reduce_qty","online_only_manual_discount","online_only_price_override","online_only_stock_adjustment","online_only_shift_close","online_only_edit_tenders","online_only_terminal_reset","online_only_refund","created_at","idle_timeout_minutes")
  SELECT "store_id","block_shift_close_on_hold","require_daily_sales_for_shift_close","require_counted_cash_on_close","require_opening_float_count","enable_blind_cash_count","max_drawer_cash_limit","require_reason_for_payout","allow_multiple_shifts_per_terminal","enable_cashier_x_report","show_opening_float_at_close","show_expected_totals_at_close","show_live_variance_at_close","show_itemized_tender_breakdown","require_manager_pin_on_variance","variance_pin_threshold","max_cashier_discount_percent","max_cart_discount_amount","allow_discount_stacking","require_reason_for_price_override","prevent_below_cost_sale","allow_tax_exemption","prevent_negative_stock_sale","require_receipt_for_refund","require_manager_pin_for_refund","max_refund_days_limit","track_item_voids","auto_lock_timeout_seconds","require_manager_pin_for_cash_drawer_open","enable_manager_pin_audit_log","require_pin_void_cart","require_pin_void_line","require_pin_reduce_qty","require_pin_manual_discount","require_pin_price_override","require_pin_stock_adjustment","require_pin_shift_close","require_pin_edit_tenders","require_pin_terminal_reset","row_version","updated_by","updated_at","allow_offline_approvals","offline_approval_requires_pin","online_only_void_cart","online_only_void_line","online_only_reduce_qty","online_only_manual_discount","online_only_price_override","online_only_stock_adjustment","online_only_shift_close","online_only_edit_tenders","online_only_terminal_reset","online_only_refund","created_at","idle_timeout_minutes" FROM jsonb_populate_recordset(NULL::public."pos_store_settings", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("store_id") DO UPDATE SET "block_shift_close_on_hold"=EXCLUDED."block_shift_close_on_hold","require_daily_sales_for_shift_close"=EXCLUDED."require_daily_sales_for_shift_close","require_counted_cash_on_close"=EXCLUDED."require_counted_cash_on_close","require_opening_float_count"=EXCLUDED."require_opening_float_count","enable_blind_cash_count"=EXCLUDED."enable_blind_cash_count","max_drawer_cash_limit"=EXCLUDED."max_drawer_cash_limit","require_reason_for_payout"=EXCLUDED."require_reason_for_payout","allow_multiple_shifts_per_terminal"=EXCLUDED."allow_multiple_shifts_per_terminal","enable_cashier_x_report"=EXCLUDED."enable_cashier_x_report","show_opening_float_at_close"=EXCLUDED."show_opening_float_at_close","show_expected_totals_at_close"=EXCLUDED."show_expected_totals_at_close","show_live_variance_at_close"=EXCLUDED."show_live_variance_at_close","show_itemized_tender_breakdown"=EXCLUDED."show_itemized_tender_breakdown","require_manager_pin_on_variance"=EXCLUDED."require_manager_pin_on_variance","variance_pin_threshold"=EXCLUDED."variance_pin_threshold","max_cashier_discount_percent"=EXCLUDED."max_cashier_discount_percent","max_cart_discount_amount"=EXCLUDED."max_cart_discount_amount","allow_discount_stacking"=EXCLUDED."allow_discount_stacking","require_reason_for_price_override"=EXCLUDED."require_reason_for_price_override","prevent_below_cost_sale"=EXCLUDED."prevent_below_cost_sale","allow_tax_exemption"=EXCLUDED."allow_tax_exemption","prevent_negative_stock_sale"=EXCLUDED."prevent_negative_stock_sale","require_receipt_for_refund"=EXCLUDED."require_receipt_for_refund","require_manager_pin_for_refund"=EXCLUDED."require_manager_pin_for_refund","max_refund_days_limit"=EXCLUDED."max_refund_days_limit","track_item_voids"=EXCLUDED."track_item_voids","auto_lock_timeout_seconds"=EXCLUDED."auto_lock_timeout_seconds","require_manager_pin_for_cash_drawer_open"=EXCLUDED."require_manager_pin_for_cash_drawer_open","enable_manager_pin_audit_log"=EXCLUDED."enable_manager_pin_audit_log","require_pin_void_cart"=EXCLUDED."require_pin_void_cart","require_pin_void_line"=EXCLUDED."require_pin_void_line","require_pin_reduce_qty"=EXCLUDED."require_pin_reduce_qty","require_pin_manual_discount"=EXCLUDED."require_pin_manual_discount","require_pin_price_override"=EXCLUDED."require_pin_price_override","require_pin_stock_adjustment"=EXCLUDED."require_pin_stock_adjustment","require_pin_shift_close"=EXCLUDED."require_pin_shift_close","require_pin_edit_tenders"=EXCLUDED."require_pin_edit_tenders","require_pin_terminal_reset"=EXCLUDED."require_pin_terminal_reset","row_version"=EXCLUDED."row_version","updated_by"=EXCLUDED."updated_by","updated_at"=EXCLUDED."updated_at","allow_offline_approvals"=EXCLUDED."allow_offline_approvals","offline_approval_requires_pin"=EXCLUDED."offline_approval_requires_pin","online_only_void_cart"=EXCLUDED."online_only_void_cart","online_only_void_line"=EXCLUDED."online_only_void_line","online_only_reduce_qty"=EXCLUDED."online_only_reduce_qty","online_only_manual_discount"=EXCLUDED."online_only_manual_discount","online_only_price_override"=EXCLUDED."online_only_price_override","online_only_stock_adjustment"=EXCLUDED."online_only_stock_adjustment","online_only_shift_close"=EXCLUDED."online_only_shift_close","online_only_edit_tenders"=EXCLUDED."online_only_edit_tenders","online_only_terminal_reset"=EXCLUDED."online_only_terminal_reset","online_only_refund"=EXCLUDED."online_only_refund","created_at"=EXCLUDED."created_at","idle_timeout_minutes"=EXCLUDED."idle_timeout_minutes" WHERE EXCLUDED."row_version">public."pos_store_settings"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_pos_store_settings(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."pos_store_settings" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."store_id"::text=COALESCE(c->'key'->>'store_id',(c->>'entityId')::jsonb->>'store_id',(c->>'entity_id')::jsonb->>'store_id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_pos_store_settings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_pos_store_settings(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_pos_store_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'pos_store_settings',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('store_id',OLD."store_id")::text ELSE jsonb_build_object('store_id',NEW."store_id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."pos_store_settings";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."pos_store_settings" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_pos_store_settings();

REVOKE ALL ON FUNCTION public.sync_feed_pos_store_settings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_settings_scoped(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."settings_scoped" ("scope","scope_id","key","value","is_overridden","updated_by","created_at","updated_at","row_version")
  SELECT "scope","scope_id","key","value","is_overridden","updated_by","created_at","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."settings_scoped", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("scope","scope_id","key") DO UPDATE SET "value"=EXCLUDED."value","is_overridden"=EXCLUDED."is_overridden","updated_by"=EXCLUDED."updated_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."settings_scoped"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_settings_scoped(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."settings_scoped" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (((lower(x.scope)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id))) AND x."scope"::text=COALESCE(c->'key'->>'scope',(c->>'entityId')::jsonb->>'scope',(c->>'entity_id')::jsonb->>'scope') AND x."scope_id"::text=COALESCE(c->'key'->>'scope_id',(c->>'entityId')::jsonb->>'scope_id',(c->>'entity_id')::jsonb->>'scope_id') AND x."key"::text=COALESCE(c->'key'->>'key',(c->>'entityId')::jsonb->>'key',(c->>'entity_id')::jsonb->>'key');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_settings_scoped(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_settings_scoped(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_settings_scoped() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'settings_scoped',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('scope',OLD."scope",'scope_id',OLD."scope_id",'key',OLD."key")::text ELSE jsonb_build_object('scope',NEW."scope",'scope_id',NEW."scope_id",'key',NEW."key")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id WHERE lower(COALESCE(NEW.scope,OLD.scope))='global' UNION ALL SELECT COALESCE(NEW.scope_id,OLD.scope_id)::text,NULL::text WHERE lower(COALESCE(NEW.scope,OLD.scope))='branch' UNION ALL SELECT store.id::text,NULL::text FROM public.stores store WHERE lower(COALESCE(NEW.scope,OLD.scope))='cluster' AND COALESCE(NULLIF(store.group_id,''),'default')=COALESCE(NEW.scope_id,OLD.scope_id)::text UNION ALL SELECT token.location_id::text,COALESCE(NEW.scope_id,OLD.scope_id)::text FROM public.terminal_tokens token WHERE lower(COALESCE(NEW.scope,OLD.scope))='terminal' AND token.id::text=COALESCE(NEW.scope_id,OLD.scope_id)::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."settings_scoped";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."settings_scoped" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_settings_scoped();

REVOKE ALL ON FUNCTION public.sync_feed_settings_scoped() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_stock_count_drafts(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."stock_count_drafts" ("id","store_id","terminal_id","staff_id","staff_name","status","reason","note","lines","line_count","total_impact","posted_at","posted_by","created_at","updated_at","reference","store_code","pending_edit_request_id","pending_edit_by","pending_edit_at")
  SELECT "id","store_id","terminal_id","staff_id","staff_name","status","reason","note","lines","line_count","total_impact","posted_at","posted_by","created_at","updated_at","reference","store_code","pending_edit_request_id","pending_edit_by","pending_edit_at" FROM jsonb_populate_recordset(NULL::public."stock_count_drafts", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","staff_id"=EXCLUDED."staff_id","staff_name"=EXCLUDED."staff_name","status"=EXCLUDED."status","reason"=EXCLUDED."reason","note"=EXCLUDED."note","lines"=EXCLUDED."lines","line_count"=EXCLUDED."line_count","total_impact"=EXCLUDED."total_impact","posted_at"=EXCLUDED."posted_at","posted_by"=EXCLUDED."posted_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","reference"=EXCLUDED."reference","store_code"=EXCLUDED."store_code","pending_edit_request_id"=EXCLUDED."pending_edit_request_id","pending_edit_by"=EXCLUDED."pending_edit_by","pending_edit_at"=EXCLUDED."pending_edit_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_stock_count_drafts(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."stock_count_drafts" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_stock_count_drafts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_stock_count_drafts(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_stock_count_drafts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'stock_count_drafts',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."stock_count_drafts";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."stock_count_drafts" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_stock_count_drafts();

REVOKE ALL ON FUNCTION public.sync_feed_stock_count_drafts() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_authorization_actions(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."authorization_actions" ("id","action_key","scope_type","scope_id","mode","allowed_roles","allowed_user_ids","requester_roles","requester_user_ids","authority_limits","extra_authority","absolute_ceilings","approval_timeout_minutes","escalation_after_minutes","escalation_roles","require_reason","threshold","is_enabled","row_version","updated_by","created_at","updated_at")
  SELECT "id","action_key","scope_type","scope_id","mode","allowed_roles","allowed_user_ids","requester_roles","requester_user_ids","authority_limits","extra_authority","absolute_ceilings","approval_timeout_minutes","escalation_after_minutes","escalation_roles","require_reason","threshold","is_enabled","row_version","updated_by","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."authorization_actions", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "action_key"=EXCLUDED."action_key","scope_type"=EXCLUDED."scope_type","scope_id"=EXCLUDED."scope_id","mode"=EXCLUDED."mode","allowed_roles"=EXCLUDED."allowed_roles","allowed_user_ids"=EXCLUDED."allowed_user_ids","requester_roles"=EXCLUDED."requester_roles","requester_user_ids"=EXCLUDED."requester_user_ids","authority_limits"=EXCLUDED."authority_limits","extra_authority"=EXCLUDED."extra_authority","absolute_ceilings"=EXCLUDED."absolute_ceilings","approval_timeout_minutes"=EXCLUDED."approval_timeout_minutes","escalation_after_minutes"=EXCLUDED."escalation_after_minutes","escalation_roles"=EXCLUDED."escalation_roles","require_reason"=EXCLUDED."require_reason","threshold"=EXCLUDED."threshold","is_enabled"=EXCLUDED."is_enabled","row_version"=EXCLUDED."row_version","updated_by"=EXCLUDED."updated_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at" WHERE EXCLUDED."row_version">public."authorization_actions"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_authorization_actions(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."authorization_actions" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND ((lower(x.scope_type)='global' OR (lower(x.scope_type)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope_type)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text)))) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_authorization_actions(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_authorization_actions(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_authorization_actions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'authorization_actions',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id WHERE lower(COALESCE(NEW.scope_type,OLD.scope_type))='global' UNION ALL SELECT COALESCE(NEW.scope_id,OLD.scope_id)::text,NULL::text WHERE lower(COALESCE(NEW.scope_type,OLD.scope_type))='branch' UNION ALL SELECT store.id::text,NULL::text FROM public.stores store WHERE lower(COALESCE(NEW.scope_type,OLD.scope_type))='cluster' AND COALESCE(NULLIF(store.group_id,''),'default')=COALESCE(NEW.scope_id,OLD.scope_id)::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."authorization_actions";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."authorization_actions" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_authorization_actions();

REVOKE ALL ON FUNCTION public.sync_feed_authorization_actions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_authorization_action_history(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."authorization_action_history" ("id","action_id","action_key","scope_type","scope_id","row_version","changed_by","change_source","change_kind","snapshot","created_at")
  SELECT "id","action_id","action_key","scope_type","scope_id","row_version","changed_by","change_source","change_kind","snapshot","created_at" FROM jsonb_populate_recordset(NULL::public."authorization_action_history", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_authorization_action_history(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN RETURN 0; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_authorization_action_history(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_authorization_action_history(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_authorization_action_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'authorization_action_history',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id WHERE lower(COALESCE(NEW.scope_type,OLD.scope_type))='global' UNION ALL SELECT COALESCE(NEW.scope_id,OLD.scope_id)::text,NULL::text WHERE lower(COALESCE(NEW.scope_type,OLD.scope_type))='branch' UNION ALL SELECT store.id::text,NULL::text FROM public.stores store WHERE lower(COALESCE(NEW.scope_type,OLD.scope_type))='cluster' AND COALESCE(NULLIF(store.group_id,''),'default')=COALESCE(NEW.scope_id,OLD.scope_id)::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."authorization_action_history";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."authorization_action_history" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_authorization_action_history();

REVOKE ALL ON FUNCTION public.sync_feed_authorization_action_history() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_authorization_requests(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."authorization_requests" ("id","action_key","requested_by","requested_by_name","store_id","terminal_id","reason","payload","status","decided_by","decided_by_name","decided_at","decision_note","expires_at","consumed_at","requester_direct_limit","value_unit","created_at","updated_at","approval_route","requested_amount","approved_amount","approved_payload","bill_snapshot","snapshot_hash","held_order_id","notified_at")
  SELECT "id","action_key","requested_by","requested_by_name","store_id","terminal_id","reason","payload","status","decided_by","decided_by_name","decided_at","decision_note","expires_at","consumed_at","requester_direct_limit","value_unit","created_at","updated_at","approval_route","requested_amount","approved_amount","approved_payload","bill_snapshot","snapshot_hash","held_order_id","notified_at" FROM jsonb_populate_recordset(NULL::public."authorization_requests", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_authorization_requests(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."authorization_requests" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_authorization_requests(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_authorization_requests(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_authorization_requests() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'authorization_requests',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."authorization_requests";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."authorization_requests" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_authorization_requests();

REVOKE ALL ON FUNCTION public.sync_feed_authorization_requests() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_authorization_log(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."authorization_log" ("id","action_key","mode_used","request_id","requested_by","authorized_by","authorizer_role","store_id","terminal_id","outcome","detail","created_at")
  SELECT "id","action_key","mode_used","request_id","requested_by","authorized_by","authorizer_role","store_id","terminal_id","outcome","detail","created_at" FROM jsonb_populate_recordset(NULL::public."authorization_log", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_authorization_log(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."authorization_log" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_authorization_log(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_authorization_log(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_authorization_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'authorization_log',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."authorization_log";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."authorization_log" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_authorization_log();

REVOKE ALL ON FUNCTION public.sync_feed_authorization_log() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_record_edits(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."record_edits" ("id","record_type","record_id","reference","store_id","terminal_id","action_key","request_id","edited_by","edited_by_name","authorized_by","authorized_by_name","mode_used","before_value","after_value","stock_deltas","note","created_at")
  SELECT "id","record_type","record_id","reference","store_id","terminal_id","action_key","request_id","edited_by","edited_by_name","authorized_by","authorized_by_name","mode_used","before_value","after_value","stock_deltas","note","created_at" FROM jsonb_populate_recordset(NULL::public."record_edits", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "record_type"=EXCLUDED."record_type","record_id"=EXCLUDED."record_id","reference"=EXCLUDED."reference","store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","action_key"=EXCLUDED."action_key","request_id"=EXCLUDED."request_id","edited_by"=EXCLUDED."edited_by","edited_by_name"=EXCLUDED."edited_by_name","authorized_by"=EXCLUDED."authorized_by","authorized_by_name"=EXCLUDED."authorized_by_name","mode_used"=EXCLUDED."mode_used","before_value"=EXCLUDED."before_value","after_value"=EXCLUDED."after_value","stock_deltas"=EXCLUDED."stock_deltas","note"=EXCLUDED."note","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_record_edits(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."record_edits" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_record_edits(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_record_edits(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_record_edits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'record_edits',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."record_edits";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."record_edits" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_record_edits();

REVOKE ALL ON FUNCTION public.sync_feed_record_edits() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shift_cash_counts(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN

  PERFORM set_config('pos.shift_fn','on',true);
  INSERT INTO public."shift_cash_counts" ("id","shift_id","store_id","terminal_id","kind","counted_cash","counted_card","counted_digital","reason","counted_by_name","counted_by_staff_id","counted_by_user_id","client_key","created_at")
  SELECT "id","shift_id","store_id","terminal_id","kind","counted_cash","counted_card","counted_digital","reason","counted_by_name","counted_by_staff_id","counted_by_user_id","client_key","created_at" FROM jsonb_populate_recordset(NULL::public."shift_cash_counts", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;

  PERFORM set_config('pos.shift_fn','',true);

  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shift_cash_counts(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN RETURN 0; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shift_cash_counts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shift_cash_counts(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shift_cash_counts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shift_cash_counts',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shift_cash_counts";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_cash_counts" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shift_cash_counts();

REVOKE ALL ON FUNCTION public.sync_feed_shift_cash_counts() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shift_close_events(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN

  PERFORM set_config('pos.shift_fn','on',true);
  INSERT INTO public."shift_close_events" ("id","shift_id","store_id","terminal_id","event","from_state","to_state","detail","actor_name","actor_staff_id","actor_user_id","created_at")
  SELECT "id","shift_id","store_id","terminal_id","event","from_state","to_state","detail","actor_name","actor_staff_id","actor_user_id","created_at" FROM jsonb_populate_recordset(NULL::public."shift_close_events", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;

  PERFORM set_config('pos.shift_fn','',true);

  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shift_close_events(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN RETURN 0; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shift_close_events(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shift_close_events(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shift_close_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shift_close_events',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shift_close_events";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_close_events" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shift_close_events();

REVOKE ALL ON FUNCTION public.sync_feed_shift_close_events() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shift_reconciliations(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN

  PERFORM set_config('pos.shift_fn','on',true);
  INSERT INTO public."shift_reconciliations" ("id","shift_id","store_id","count_id","expected_cash","expected_card","expected_digital","counted_cash","counted_card","counted_digital","variance_cash","variance_card","variance_digital","variance_total","variance_status","created_at")
  SELECT "id","shift_id","store_id","count_id","expected_cash","expected_card","expected_digital","counted_cash","counted_card","counted_digital","variance_cash","variance_card","variance_digital","variance_total","variance_status","created_at" FROM jsonb_populate_recordset(NULL::public."shift_reconciliations", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;

  PERFORM set_config('pos.shift_fn','',true);

  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shift_reconciliations(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN RETURN 0; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shift_reconciliations(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shift_reconciliations(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shift_reconciliations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shift_reconciliations',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shift_reconciliations";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_reconciliations" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shift_reconciliations();

REVOKE ALL ON FUNCTION public.sync_feed_shift_reconciliations() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shift_variance_alerts(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."shift_variance_alerts" ("id","shift_id","store_id","reconciliation_id","variance_total","variance_status","severity","message","delivery_status","attempts","last_error","last_attempt_at","acknowledged_at","acknowledged_by","created_at","updated_at")
  SELECT "id","shift_id","store_id","reconciliation_id","variance_total","variance_status","severity","message","delivery_status","attempts","last_error","last_attempt_at","acknowledged_at","acknowledged_by","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."shift_variance_alerts", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "shift_id"=EXCLUDED."shift_id","store_id"=EXCLUDED."store_id","reconciliation_id"=EXCLUDED."reconciliation_id","variance_total"=EXCLUDED."variance_total","variance_status"=EXCLUDED."variance_status","severity"=EXCLUDED."severity","message"=EXCLUDED."message","delivery_status"=EXCLUDED."delivery_status","attempts"=EXCLUDED."attempts","last_error"=EXCLUDED."last_error","last_attempt_at"=EXCLUDED."last_attempt_at","acknowledged_at"=EXCLUDED."acknowledged_at","acknowledged_by"=EXCLUDED."acknowledged_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shift_variance_alerts(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."shift_variance_alerts" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shift_variance_alerts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shift_variance_alerts(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shift_variance_alerts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shift_variance_alerts',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shift_variance_alerts";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_variance_alerts" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shift_variance_alerts();

REVOKE ALL ON FUNCTION public.sync_feed_shift_variance_alerts() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shift_notifications(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."shift_notifications" ("id","shift_id","store_id","store_name","terminal_name","closed_by","opened_at","closed_at","total_sales","transactions","discounts","refunds","expected_cash","counted_cash","payment_breakdown","summary","channels","created_at")
  SELECT "id","shift_id","store_id","store_name","terminal_name","closed_by","opened_at","closed_at","total_sales","transactions","discounts","refunds","expected_cash","counted_cash","payment_breakdown","summary","channels","created_at" FROM jsonb_populate_recordset(NULL::public."shift_notifications", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shift_notifications(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN RETURN 0; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shift_notifications(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shift_notifications(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shift_notifications() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shift_notifications',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shift_notifications";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_notifications" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shift_notifications();

REVOKE ALL ON FUNCTION public.sync_feed_shift_notifications() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_entity_status_history(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."entity_status_history" ("id","entity_type","entity_id","status_kind","previous_status","new_status","reason","actor_id","actor_name","actor_role","store_id","branch_id","terminal_id","related_entity_type","related_entity_id","metadata","client_event_id","occurred_at","created_at","updated_at","row_version")
  SELECT "id","entity_type","entity_id","status_kind","previous_status","new_status","reason","actor_id","actor_name","actor_role","store_id","branch_id","terminal_id","related_entity_type","related_entity_id","metadata","client_event_id","occurred_at","created_at","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."entity_status_history", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "entity_type"=EXCLUDED."entity_type","entity_id"=EXCLUDED."entity_id","status_kind"=EXCLUDED."status_kind","previous_status"=EXCLUDED."previous_status","new_status"=EXCLUDED."new_status","reason"=EXCLUDED."reason","actor_id"=EXCLUDED."actor_id","actor_name"=EXCLUDED."actor_name","actor_role"=EXCLUDED."actor_role","store_id"=EXCLUDED."store_id","branch_id"=EXCLUDED."branch_id","terminal_id"=EXCLUDED."terminal_id","related_entity_type"=EXCLUDED."related_entity_type","related_entity_id"=EXCLUDED."related_entity_id","metadata"=EXCLUDED."metadata","client_event_id"=EXCLUDED."client_event_id","occurred_at"=EXCLUDED."occurred_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."entity_status_history"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_entity_status_history(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."entity_status_history" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_entity_status_history(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_entity_status_history(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_entity_status_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'entity_status_history',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."entity_status_history";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."entity_status_history" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_entity_status_history();

REVOKE ALL ON FUNCTION public.sync_feed_entity_status_history() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_nav_pins(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."nav_pins" ("id","owner_id","item_kind","item_key","sort_order","created_at","updated_at")
  SELECT "id","owner_id","item_kind","item_key","sort_order","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."nav_pins", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "owner_id"=EXCLUDED."owner_id","item_kind"=EXCLUDED."item_kind","item_key"=EXCLUDED."item_key","sort_order"=EXCLUDED."sort_order","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_nav_pins(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."nav_pins" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_nav_pins(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_nav_pins(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_nav_pins() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'nav_pins',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."nav_pins";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."nav_pins" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_nav_pins();

REVOKE ALL ON FUNCTION public.sync_feed_nav_pins() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_store_groups(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."store_groups" ("id","code","name","is_active","archived_at","created_at","updated_at")
  SELECT "id","code","name","is_active","archived_at","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."store_groups", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "code"=EXCLUDED."code","name"=EXCLUDED."name","is_active"=EXCLUDED."is_active","archived_at"=EXCLUDED."archived_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_store_groups(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."store_groups" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_store_groups(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_store_groups(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_store_groups() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'store_groups',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."store_groups";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."store_groups" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_store_groups();

REVOKE ALL ON FUNCTION public.sync_feed_store_groups() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_change_history(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."change_history" ("id","organization_id","entity_type","entity_id","action","old_value","new_value","revision","scope_type","scope_id","changed_by","source_application","device_id","terminal_id","server_timestamp")
  SELECT "id","organization_id","entity_type","entity_id","action","old_value","new_value","revision","scope_type","scope_id","changed_by","source_application","device_id","terminal_id","server_timestamp" FROM jsonb_populate_recordset(NULL::public."change_history", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "organization_id"=EXCLUDED."organization_id","entity_type"=EXCLUDED."entity_type","entity_id"=EXCLUDED."entity_id","action"=EXCLUDED."action","old_value"=EXCLUDED."old_value","new_value"=EXCLUDED."new_value","revision"=EXCLUDED."revision","scope_type"=EXCLUDED."scope_type","scope_id"=EXCLUDED."scope_id","changed_by"=EXCLUDED."changed_by","source_application"=EXCLUDED."source_application","device_id"=EXCLUDED."device_id","terminal_id"=EXCLUDED."terminal_id","server_timestamp"=EXCLUDED."server_timestamp";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_change_history(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."change_history" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_change_history(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_change_history(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_change_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT COALESCE(NEW.organization_id,OLD.organization_id,'default'),branches.branch_id,branches.terminal_id,'change_history',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."change_history";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."change_history" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_change_history();

REVOKE ALL ON FUNCTION public.sync_feed_change_history() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pos_sync_push_batch(p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_table text,p_rows jsonb,p_changes jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_me public.app_users%ROWTYPE; v_count integer:=0; v_hash text:=md5(p_table||COALESCE(p_rows,'[]'::jsonb)::text||COALESCE(p_changes,'[]'::jsonb)::text); v_prior text;
BEGIN
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 PERFORM set_config('pos.source_application','electron',true);
 PERFORM set_config('pos.sync_terminal',p_terminal_id,true);
 PERFORM set_config('pos.device_id',p_terminal_id,true);
 IF auth.role()<>'service_role' THEN
  SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
  IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
  IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
 END IF;
 SELECT payload_hash INTO v_prior FROM public.sync_idempotency_receipts WHERE batch_id=p_batch_id;
 IF FOUND THEN IF v_prior<>v_hash THEN RAISE EXCEPTION 'SYNC_IDEMPOTENCY_MISMATCH'; END IF; RETURN jsonb_build_object('ok',true,'replayed',true,'batch_id',p_batch_id); END IF;
 CASE p_table WHEN 'coupon_campaigns' THEN  v_count:=public.sync_apply_coupon_campaigns(p_rows)+public.sync_delete_coupon_campaigns(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shifts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shifts(p_rows)+public.sync_delete_shifts(p_changes,p_branch_id,p_terminal_id);
    WHEN 'issued_vouchers' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_issued_vouchers(p_rows)+public.sync_delete_issued_vouchers(p_changes,p_branch_id,p_terminal_id);
    WHEN 'activity_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_activity_events(p_rows)+public.sync_delete_activity_events(p_changes,p_branch_id,p_terminal_id);
    WHEN 'audit_logs' THEN SELECT COALESCE(jsonb_agg(CASE WHEN NULLIF(btrim(r->>'store_id'),'') IS NULL THEN r||jsonb_build_object('store_id',p_branch_id) ELSE r END),'[]'::jsonb) INTO p_rows FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r; IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_audit_logs(p_rows)+public.sync_delete_audit_logs(p_changes,p_branch_id,p_terminal_id);
    WHEN 'booking_payments' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."bookings" p WHERE p."id"::text=r->>'booking_id' AND p.store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_booking_payments(p_rows)+public.sync_delete_booking_payments(p_changes,p_branch_id,p_terminal_id);
    WHEN 'bookings' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_bookings(p_rows)+public.sync_delete_bookings(p_changes,p_branch_id,p_terminal_id);
    WHEN 'branch_telemetry' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_branch_telemetry(p_rows)+public.sync_delete_branch_telemetry(p_changes,p_branch_id,p_terminal_id);
    WHEN 'coupon_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_coupon_events(p_rows)+public.sync_delete_coupon_events(p_changes,p_branch_id,p_terminal_id);
    WHEN 'drawer_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_drawer_events(p_rows)+public.sync_delete_drawer_events(p_changes,p_branch_id,p_terminal_id);
    WHEN 'held_orders' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_held_orders(p_rows)+public.sync_delete_held_orders(p_changes,p_branch_id,p_terminal_id);
    WHEN 'integration_settings' THEN  v_count:=public.sync_apply_integration_settings(p_rows)+public.sync_delete_integration_settings(p_changes,p_branch_id,p_terminal_id);
    WHEN 'item_activity_logs' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_item_activity_logs(p_rows)+public.sync_delete_item_activity_logs(p_changes,p_branch_id,p_terminal_id);
    WHEN 'member_verifications' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_member_verifications(p_rows)+public.sync_delete_member_verifications(p_changes,p_branch_id,p_terminal_id);
    WHEN 'members' THEN  v_count:=public.sync_apply_members(p_rows)+public.sync_delete_members(p_changes,p_branch_id,p_terminal_id);
    WHEN 'membership_tiers' THEN  v_count:=public.sync_apply_membership_tiers(p_rows)+public.sync_delete_membership_tiers(p_changes,p_branch_id,p_terminal_id);
    WHEN 'offline_sync_audit_log' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_offline_sync_audit_log(p_rows)+public.sync_delete_offline_sync_audit_log(p_changes,p_branch_id,p_terminal_id);
    WHEN 'payment_transactions' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_payment_transactions(p_rows)+public.sync_delete_payment_transactions(p_changes,p_branch_id,p_terminal_id);
    WHEN 'payment_types' THEN  v_count:=public.sync_apply_payment_types(p_rows)+public.sync_delete_payment_types(p_changes,p_branch_id,p_terminal_id);
    WHEN 'pin_attempts' THEN  v_count:=public.sync_apply_pin_attempts(p_rows)+public.sync_delete_pin_attempts(p_changes,p_branch_id,p_terminal_id);
    WHEN 'pos_settings' THEN  v_count:=public.sync_apply_pos_settings(p_rows)+public.sync_delete_pos_settings(p_changes,p_branch_id,p_terminal_id);
    WHEN 'product_barcodes' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=r->>'product_id' AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id))) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_product_barcodes(p_rows)+public.sync_delete_product_barcodes(p_changes,p_branch_id,p_terminal_id);
    WHEN 'product_categories' THEN  v_count:=public.sync_apply_product_categories(p_rows)+public.sync_delete_product_categories(p_changes,p_branch_id,p_terminal_id);
    WHEN 'products' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NULLIF(r->>'owner_store_id','') IS NOT NULL AND r->>'owner_store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_products(p_rows)+public.sync_delete_products(p_changes,p_branch_id,p_terminal_id);
    WHEN 'promotions' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NULLIF(r->>'foc_product_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=r->>'foc_product_id' AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id))) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_promotions(p_rows)+public.sync_delete_promotions(p_changes,p_branch_id,p_terminal_id);
    WHEN 'purchase_order_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."purchase_orders" p WHERE p."id"::text=r->>'po_id' AND p.store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_purchase_order_items(p_rows)+public.sync_delete_purchase_order_items(p_changes,p_branch_id,p_terminal_id);
    WHEN 'purchase_orders' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_purchase_orders(p_rows)+public.sync_delete_purchase_orders(p_changes,p_branch_id,p_terminal_id);
    WHEN 'sale_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'branch_id' IS NULL OR r->>'branch_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sale_items(p_rows)+public.sync_delete_sale_items(p_changes,p_branch_id,p_terminal_id);
    WHEN 'sales' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sales(p_rows)+public.sync_delete_sales(p_changes,p_branch_id,p_terminal_id);
    WHEN 'settings_overrides' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE lower(COALESCE(r->>'scope','')) NOT IN ('global','cluster','branch','terminal')) THEN RAISE EXCEPTION 'SYNC_SCOPE_FORBIDDEN'; END IF; SELECT COALESCE(jsonb_agg(r) FILTER (WHERE (lower(COALESCE(r->>'scope',''))='branch' AND r->>'scope_id'=p_branch_id) OR (lower(COALESCE(r->>'scope',''))='terminal' AND r->>'scope_id'=p_terminal_id)),'[]'::jsonb) INTO p_rows FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r; v_count:=public.sync_apply_settings_overrides(p_rows)+public.sync_delete_settings_overrides(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shift_sessions' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_sessions(p_rows)+public.sync_delete_shift_sessions(p_changes,p_branch_id,p_terminal_id);
    WHEN 'sku_audit' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sku_audit(p_rows)+public.sync_delete_sku_audit(p_changes,p_branch_id,p_terminal_id);
    WHEN 'stock_adjustments' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_adjustments(p_rows)+public.sync_delete_stock_adjustments(p_changes,p_branch_id,p_terminal_id);
    WHEN 'stock_delta_applied' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_delta_applied(p_rows)+public.sync_delete_stock_delta_applied(p_changes,p_branch_id,p_terminal_id);
    WHEN 'stock_transfer_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."stock_transfers" p WHERE p."id"::text=r->>'transfer_id' AND p_branch_id IN (p.from_store_id::text,p.to_store_id::text))) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_transfer_items(p_rows)+public.sync_delete_stock_transfer_items(p_changes,p_branch_id,p_terminal_id);
    WHEN 'stock_transfers' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE p_branch_id<>COALESCE(r->>'from_store_id','') AND p_branch_id<>COALESCE(r->>'to_store_id','')) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_transfers(p_rows)+public.sync_delete_stock_transfers(p_changes,p_branch_id,p_terminal_id);
    WHEN 'stores' THEN  v_count:=public.sync_apply_stores(p_rows)+public.sync_delete_stores(p_changes,p_branch_id,p_terminal_id);
    WHEN 'suppliers' THEN  v_count:=public.sync_apply_suppliers(p_rows)+public.sync_delete_suppliers(p_changes,p_branch_id,p_terminal_id);
    WHEN 'sync_metadata' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sync_metadata(p_rows)+public.sync_delete_sync_metadata(p_changes,p_branch_id,p_terminal_id);
    WHEN 'system_audit_logs' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_system_audit_logs(p_rows)+public.sync_delete_system_audit_logs(p_changes,p_branch_id,p_terminal_id);
    WHEN 'terminal_commands' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_terminal_commands(p_rows)+public.sync_delete_terminal_commands(p_changes,p_branch_id,p_terminal_id);
    WHEN 'uom_units' THEN  v_count:=public.sync_apply_uom_units(p_rows)+public.sync_delete_uom_units(p_changes,p_branch_id,p_terminal_id);
    WHEN 'whatsapp_queue' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_whatsapp_queue(p_rows)+public.sync_delete_whatsapp_queue(p_changes,p_branch_id,p_terminal_id);
    WHEN 'pos_store_settings' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_pos_store_settings(p_rows)+public.sync_delete_pos_store_settings(p_changes,p_branch_id,p_terminal_id);
    WHEN 'settings_scoped' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE lower(COALESCE(r->>'scope','')) NOT IN ('global','cluster','branch','terminal')) THEN RAISE EXCEPTION 'SYNC_SCOPE_FORBIDDEN'; END IF; SELECT COALESCE(jsonb_agg(r) FILTER (WHERE (lower(COALESCE(r->>'scope',''))='branch' AND r->>'scope_id'=p_branch_id) OR (lower(COALESCE(r->>'scope',''))='terminal' AND r->>'scope_id'=p_terminal_id)),'[]'::jsonb) INTO p_rows FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r; v_count:=public.sync_apply_settings_scoped(p_rows)+public.sync_delete_settings_scoped(p_changes,p_branch_id,p_terminal_id);
    WHEN 'stock_count_drafts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_count_drafts(p_rows)+public.sync_delete_stock_count_drafts(p_changes,p_branch_id,p_terminal_id);
    WHEN 'authorization_actions' THEN  v_count:=public.sync_apply_authorization_actions(p_rows)+public.sync_delete_authorization_actions(p_changes,p_branch_id,p_terminal_id);
    WHEN 'authorization_action_history' THEN  v_count:=public.sync_apply_authorization_action_history(p_rows)+public.sync_delete_authorization_action_history(p_changes,p_branch_id,p_terminal_id);
    WHEN 'authorization_requests' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_authorization_requests(p_rows)+public.sync_delete_authorization_requests(p_changes,p_branch_id,p_terminal_id);
    WHEN 'authorization_log' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_authorization_log(p_rows)+public.sync_delete_authorization_log(p_changes,p_branch_id,p_terminal_id);
    WHEN 'record_edits' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_record_edits(p_rows)+public.sync_delete_record_edits(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shift_cash_counts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_cash_counts(p_rows)+public.sync_delete_shift_cash_counts(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shift_close_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_close_events(p_rows)+public.sync_delete_shift_close_events(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shift_reconciliations' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_reconciliations(p_rows)+public.sync_delete_shift_reconciliations(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shift_variance_alerts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_variance_alerts(p_rows)+public.sync_delete_shift_variance_alerts(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shift_notifications' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_notifications(p_rows)+public.sync_delete_shift_notifications(p_changes,p_branch_id,p_terminal_id);
    WHEN 'entity_status_history' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_entity_status_history(p_rows)+public.sync_delete_entity_status_history(p_changes,p_branch_id,p_terminal_id);
    WHEN 'nav_pins' THEN  v_count:=public.sync_apply_nav_pins(p_rows)+public.sync_delete_nav_pins(p_changes,p_branch_id,p_terminal_id);
    WHEN 'store_groups' THEN  v_count:=public.sync_apply_store_groups(p_rows)+public.sync_delete_store_groups(p_changes,p_branch_id,p_terminal_id);
    WHEN 'change_history' THEN  v_count:=public.sync_apply_change_history(p_rows)+public.sync_delete_change_history(p_changes,p_branch_id,p_terminal_id); ELSE RAISE EXCEPTION 'SYNC_TABLE_FORBIDDEN'; END CASE;
 INSERT INTO public.sync_idempotency_receipts(batch_id,organization_id,branch_id,table_name,payload_hash,applied_count) VALUES(p_batch_id,p_organization_id,p_branch_id,p_table,v_hash,v_count);
 RETURN jsonb_build_object('ok',true,'applied',v_count,'batch_id',p_batch_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_sync_push_aggregate(p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_operations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_me public.app_users%ROWTYPE; v_op jsonb; v_table text; v_rows jsonb; v_count integer:=0; v_total integer:=0; v_hash text:=md5(COALESCE(p_operations,'[]'::jsonb)::text); v_prior text;
BEGIN
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 PERFORM set_config('pos.source_application','electron',true);
 PERFORM set_config('pos.sync_terminal',p_terminal_id,true);
 PERFORM set_config('pos.device_id',p_terminal_id,true);
 IF jsonb_typeof(p_operations)<>'array' OR jsonb_array_length(p_operations)>200 THEN RAISE EXCEPTION 'SYNC_AGGREGATE_INVALID'; END IF;
 IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
  IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
  IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 SELECT payload_hash INTO v_prior FROM public.sync_idempotency_receipts WHERE batch_id=p_batch_id;
 IF FOUND THEN IF v_prior<>v_hash THEN RAISE EXCEPTION 'SYNC_IDEMPOTENCY_MISMATCH'; END IF; RETURN jsonb_build_object('ok',true,'replayed',true,'batch_id',p_batch_id); END IF;
 FOR v_op IN SELECT value FROM jsonb_array_elements(p_operations) LOOP v_table:=v_op->>'table'; v_rows:=COALESCE(v_op->'rows','[]'::jsonb);
  IF v_table='products' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_operations) related WHERE related->>'table' IN ('item_activity_logs','stock_delta_applied')) THEN
   SELECT COALESCE(jsonb_agg((row_value-'stock_quantity'-'stock_by_store')||jsonb_build_object('stock_quantity',0,'stock_by_store','{}'::jsonb)),'[]'::jsonb) INTO v_rows FROM jsonb_array_elements(v_rows) AS product_rows(row_value);
  END IF;
  CASE v_table WHEN 'coupon_campaigns' THEN  v_count:=public.sync_apply_coupon_campaigns(v_rows)+public.sync_delete_coupon_campaigns(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shifts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shifts(v_rows)+public.sync_delete_shifts(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'issued_vouchers' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_issued_vouchers(v_rows)+public.sync_delete_issued_vouchers(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'activity_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_activity_events(v_rows)+public.sync_delete_activity_events(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'audit_logs' THEN SELECT COALESCE(jsonb_agg(CASE WHEN NULLIF(btrim(r->>'store_id'),'') IS NULL THEN r||jsonb_build_object('store_id',p_branch_id) ELSE r END),'[]'::jsonb) INTO v_rows FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r; IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_audit_logs(v_rows)+public.sync_delete_audit_logs(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'booking_payments' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."bookings" p WHERE p."id"::text=r->>'booking_id' AND p.store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_booking_payments(v_rows)+public.sync_delete_booking_payments(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'bookings' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_bookings(v_rows)+public.sync_delete_bookings(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'branch_telemetry' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_branch_telemetry(v_rows)+public.sync_delete_branch_telemetry(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'coupon_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_coupon_events(v_rows)+public.sync_delete_coupon_events(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'drawer_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_drawer_events(v_rows)+public.sync_delete_drawer_events(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'held_orders' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_held_orders(v_rows)+public.sync_delete_held_orders(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'integration_settings' THEN  v_count:=public.sync_apply_integration_settings(v_rows)+public.sync_delete_integration_settings(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'item_activity_logs' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_item_activity_logs(v_rows)+public.sync_delete_item_activity_logs(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'member_verifications' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_member_verifications(v_rows)+public.sync_delete_member_verifications(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'members' THEN  v_count:=public.sync_apply_members(v_rows)+public.sync_delete_members(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'membership_tiers' THEN  v_count:=public.sync_apply_membership_tiers(v_rows)+public.sync_delete_membership_tiers(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'offline_sync_audit_log' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_offline_sync_audit_log(v_rows)+public.sync_delete_offline_sync_audit_log(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'payment_transactions' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_payment_transactions(v_rows)+public.sync_delete_payment_transactions(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'payment_types' THEN  v_count:=public.sync_apply_payment_types(v_rows)+public.sync_delete_payment_types(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'pin_attempts' THEN  v_count:=public.sync_apply_pin_attempts(v_rows)+public.sync_delete_pin_attempts(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'pos_settings' THEN  v_count:=public.sync_apply_pos_settings(v_rows)+public.sync_delete_pos_settings(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'product_barcodes' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=r->>'product_id' AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id))) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_product_barcodes(v_rows)+public.sync_delete_product_barcodes(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'product_categories' THEN  v_count:=public.sync_apply_product_categories(v_rows)+public.sync_delete_product_categories(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'products' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NULLIF(r->>'owner_store_id','') IS NOT NULL AND r->>'owner_store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_products(v_rows)+public.sync_delete_products(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'promotions' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NULLIF(r->>'foc_product_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=r->>'foc_product_id' AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id))) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_promotions(v_rows)+public.sync_delete_promotions(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'purchase_order_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."purchase_orders" p WHERE p."id"::text=r->>'po_id' AND p.store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_purchase_order_items(v_rows)+public.sync_delete_purchase_order_items(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'purchase_orders' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_purchase_orders(v_rows)+public.sync_delete_purchase_orders(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'sale_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'branch_id' IS NULL OR r->>'branch_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sale_items(v_rows)+public.sync_delete_sale_items(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'sales' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sales(v_rows)+public.sync_delete_sales(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'settings_overrides' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE lower(COALESCE(r->>'scope','')) NOT IN ('global','cluster','branch','terminal')) THEN RAISE EXCEPTION 'SYNC_SCOPE_FORBIDDEN'; END IF; SELECT COALESCE(jsonb_agg(r) FILTER (WHERE (lower(COALESCE(r->>'scope',''))='branch' AND r->>'scope_id'=p_branch_id) OR (lower(COALESCE(r->>'scope',''))='terminal' AND r->>'scope_id'=p_terminal_id)),'[]'::jsonb) INTO v_rows FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r; v_count:=public.sync_apply_settings_overrides(v_rows)+public.sync_delete_settings_overrides(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shift_sessions' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_sessions(v_rows)+public.sync_delete_shift_sessions(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'sku_audit' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sku_audit(v_rows)+public.sync_delete_sku_audit(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'stock_adjustments' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_adjustments(v_rows)+public.sync_delete_stock_adjustments(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'stock_delta_applied' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_delta_applied(v_rows)+public.sync_delete_stock_delta_applied(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'stock_transfer_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."stock_transfers" p WHERE p."id"::text=r->>'transfer_id' AND p_branch_id IN (p.from_store_id::text,p.to_store_id::text))) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_transfer_items(v_rows)+public.sync_delete_stock_transfer_items(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'stock_transfers' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE p_branch_id<>COALESCE(r->>'from_store_id','') AND p_branch_id<>COALESCE(r->>'to_store_id','')) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_transfers(v_rows)+public.sync_delete_stock_transfers(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'stores' THEN  v_count:=public.sync_apply_stores(v_rows)+public.sync_delete_stores(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'suppliers' THEN  v_count:=public.sync_apply_suppliers(v_rows)+public.sync_delete_suppliers(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'sync_metadata' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sync_metadata(v_rows)+public.sync_delete_sync_metadata(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'system_audit_logs' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_system_audit_logs(v_rows)+public.sync_delete_system_audit_logs(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'terminal_commands' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_terminal_commands(v_rows)+public.sync_delete_terminal_commands(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'uom_units' THEN  v_count:=public.sync_apply_uom_units(v_rows)+public.sync_delete_uom_units(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'whatsapp_queue' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_whatsapp_queue(v_rows)+public.sync_delete_whatsapp_queue(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'pos_store_settings' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_pos_store_settings(v_rows)+public.sync_delete_pos_store_settings(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'settings_scoped' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE lower(COALESCE(r->>'scope','')) NOT IN ('global','cluster','branch','terminal')) THEN RAISE EXCEPTION 'SYNC_SCOPE_FORBIDDEN'; END IF; SELECT COALESCE(jsonb_agg(r) FILTER (WHERE (lower(COALESCE(r->>'scope',''))='branch' AND r->>'scope_id'=p_branch_id) OR (lower(COALESCE(r->>'scope',''))='terminal' AND r->>'scope_id'=p_terminal_id)),'[]'::jsonb) INTO v_rows FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r; v_count:=public.sync_apply_settings_scoped(v_rows)+public.sync_delete_settings_scoped(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'stock_count_drafts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_count_drafts(v_rows)+public.sync_delete_stock_count_drafts(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'authorization_actions' THEN  v_count:=public.sync_apply_authorization_actions(v_rows)+public.sync_delete_authorization_actions(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'authorization_action_history' THEN  v_count:=public.sync_apply_authorization_action_history(v_rows)+public.sync_delete_authorization_action_history(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'authorization_requests' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_authorization_requests(v_rows)+public.sync_delete_authorization_requests(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'authorization_log' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_authorization_log(v_rows)+public.sync_delete_authorization_log(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'record_edits' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_record_edits(v_rows)+public.sync_delete_record_edits(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shift_cash_counts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_cash_counts(v_rows)+public.sync_delete_shift_cash_counts(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shift_close_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_close_events(v_rows)+public.sync_delete_shift_close_events(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shift_reconciliations' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_reconciliations(v_rows)+public.sync_delete_shift_reconciliations(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shift_variance_alerts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_variance_alerts(v_rows)+public.sync_delete_shift_variance_alerts(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shift_notifications' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_notifications(v_rows)+public.sync_delete_shift_notifications(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'entity_status_history' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_entity_status_history(v_rows)+public.sync_delete_entity_status_history(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'nav_pins' THEN  v_count:=public.sync_apply_nav_pins(v_rows)+public.sync_delete_nav_pins(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'store_groups' THEN  v_count:=public.sync_apply_store_groups(v_rows)+public.sync_delete_store_groups(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'change_history' THEN  v_count:=public.sync_apply_change_history(v_rows)+public.sync_delete_change_history(v_op->'changes',p_branch_id,p_terminal_id); ELSE RAISE EXCEPTION 'SYNC_TABLE_FORBIDDEN'; END CASE; v_total:=v_total+v_count;
 END LOOP;
 INSERT INTO public.sync_idempotency_receipts(batch_id,organization_id,branch_id,table_name,payload_hash,applied_count) VALUES(p_batch_id,p_organization_id,p_branch_id,'__aggregate__',v_hash,v_total);
 RETURN jsonb_build_object('ok',true,'applied',v_total,'batch_id',p_batch_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_sync_pull(p_organization_id text,p_branch_id text,p_terminal_id text,p_after_cursor bigint DEFAULT 0,p_limit integer DEFAULT 500)
RETURNS TABLE(cursor bigint,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean,row_data jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_me public.app_users%ROWTYPE;
BEGIN PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id); IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 RETURN QUERY WITH feed_page AS MATERIALIZED (
  SELECT candidate.cursor,candidate.table_name,candidate.entity_id,candidate.operation,candidate.row_version,candidate.tombstone
  FROM public.sync_change_feed candidate
  WHERE candidate.organization_id=p_organization_id AND candidate.branch_id IN (p_branch_id,'global')
    AND (candidate.terminal_id IS NULL OR candidate.terminal_id=p_terminal_id) AND candidate.cursor>p_after_cursor
  ORDER BY candidate.cursor LIMIT LEAST(GREATEST(p_limit,100),2000)
 )
 SELECT f.cursor,f.table_name,f.entity_id,f.operation,f.row_version,f.tombstone,CASE f.table_name WHEN 'coupon_campaigns' THEN (SELECT to_jsonb(x) FROM public."coupon_campaigns" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'shifts' THEN (SELECT to_jsonb(x) FROM public."shifts" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'issued_vouchers' THEN (SELECT to_jsonb(x) FROM public."issued_vouchers" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'activity_events' THEN (SELECT to_jsonb(x) FROM public."activity_events" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'app_users' THEN (SELECT to_jsonb(x) FROM public."app_users" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'audit_logs' THEN (SELECT to_jsonb(x) FROM public."audit_logs" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'booking_payments' THEN (SELECT to_jsonb(x) FROM public."booking_payments" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'bookings' THEN (SELECT to_jsonb(x) FROM public."bookings" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'branch_telemetry' THEN (SELECT to_jsonb(x) FROM public."branch_telemetry" x WHERE x."terminal_id"=((f.entity_id::jsonb)->>'terminal_id') LIMIT 1)
    WHEN 'cashiers' THEN (SELECT to_jsonb(x) FROM public."cashiers" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'coupon_events' THEN (SELECT to_jsonb(x) FROM public."coupon_events" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'drawer_events' THEN (SELECT to_jsonb(x) FROM public."drawer_events" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'held_orders' THEN (SELECT to_jsonb(x) FROM public."held_orders" x WHERE x."id"=((f.entity_id::jsonb)->>'id') LIMIT 1)
    WHEN 'integration_settings' THEN (SELECT to_jsonb(x) FROM public."integration_settings" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'item_activity_logs' THEN (SELECT to_jsonb(x) FROM public."item_activity_logs" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'member_verifications' THEN (SELECT to_jsonb(x) FROM public."member_verifications" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'members' THEN (SELECT to_jsonb(x) FROM public."members" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'membership_tiers' THEN (SELECT to_jsonb(x) FROM public."membership_tiers" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'offline_sync_audit_log' THEN (SELECT to_jsonb(x) FROM public."offline_sync_audit_log" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'payment_transactions' THEN (SELECT to_jsonb(x) FROM public."payment_transactions" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'payment_types' THEN (SELECT to_jsonb(x) FROM public."payment_types" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'pin_attempts' THEN (SELECT to_jsonb(x) FROM public."pin_attempts" x WHERE x."key"=((f.entity_id::jsonb)->>'key') LIMIT 1)
    WHEN 'pos_settings' THEN (SELECT to_jsonb(x) FROM public."pos_settings" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::integer LIMIT 1)
    WHEN 'product_barcodes' THEN (SELECT to_jsonb(x) FROM public."product_barcodes" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'product_categories' THEN (SELECT to_jsonb(x) FROM public."product_categories" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'products' THEN (SELECT to_jsonb(x) FROM public."products" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'promotions' THEN (SELECT to_jsonb(x) FROM public."promotions" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'public_flags' THEN (SELECT to_jsonb(x) FROM public."public_flags" x WHERE x."key"=((f.entity_id::jsonb)->>'key') LIMIT 1)
    WHEN 'purchase_order_items' THEN (SELECT to_jsonb(x) FROM public."purchase_order_items" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'purchase_orders' THEN (SELECT to_jsonb(x) FROM public."purchase_orders" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'sale_items' THEN (SELECT to_jsonb(x) FROM public."sale_items" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'sales' THEN (SELECT to_jsonb(x) FROM public."sales" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'secure_settings' THEN (SELECT to_jsonb(x) FROM public."secure_settings" x WHERE x."key"=((f.entity_id::jsonb)->>'key') LIMIT 1)
    WHEN 'security_findings' THEN (SELECT to_jsonb(x) FROM public."security_findings" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'settings_locks' THEN (SELECT to_jsonb(x) FROM public."settings_locks" x WHERE x."section"=((f.entity_id::jsonb)->>'section') LIMIT 1)
    WHEN 'settings_overrides' THEN (SELECT to_jsonb(x) FROM public."settings_overrides" x WHERE x."scope"=((f.entity_id::jsonb)->>'scope') AND x."scope_id"=((f.entity_id::jsonb)->>'scope_id') AND x."section"=((f.entity_id::jsonb)->>'section') LIMIT 1)
    WHEN 'shift_sessions' THEN (SELECT to_jsonb(x) FROM public."shift_sessions" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'sku_audit' THEN (SELECT to_jsonb(x) FROM public."sku_audit" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'staff_roles' THEN (SELECT to_jsonb(x) FROM public."staff_roles" x WHERE x."slug"=((f.entity_id::jsonb)->>'slug') LIMIT 1)
    WHEN 'stock_adjustments' THEN (SELECT to_jsonb(x) FROM public."stock_adjustments" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'stock_delta_applied' THEN (SELECT to_jsonb(x) FROM public."stock_delta_applied" x WHERE x."movement_id"=((f.entity_id::jsonb)->>'movement_id')::uuid LIMIT 1)
    WHEN 'stock_transfer_items' THEN (SELECT to_jsonb(x) FROM public."stock_transfer_items" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'stock_transfers' THEN (SELECT to_jsonb(x) FROM public."stock_transfers" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'stores' THEN (SELECT to_jsonb(x) FROM public."stores" x WHERE x."id"=((f.entity_id::jsonb)->>'id') LIMIT 1)
    WHEN 'suppliers' THEN (SELECT to_jsonb(x) FROM public."suppliers" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'sync_metadata' THEN (SELECT to_jsonb(x) FROM public."sync_metadata" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'system_audit_logs' THEN (SELECT to_jsonb(x) FROM public."system_audit_logs" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'terminal_commands' THEN (SELECT to_jsonb(x) FROM public."terminal_commands" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'terminal_tokens' THEN (SELECT to_jsonb(x) FROM public."terminal_tokens" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'uom_units' THEN (SELECT to_jsonb(x) FROM public."uom_units" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'user_roles' THEN (SELECT to_jsonb(x) FROM public."user_roles" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'whatsapp_queue' THEN (SELECT to_jsonb(x) FROM public."whatsapp_queue" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'terminal_recovery_secrets' THEN (SELECT to_jsonb(x) FROM public."terminal_recovery_secrets" x WHERE x."terminal_token_id"=((f.entity_id::jsonb)->>'terminal_token_id')::uuid LIMIT 1)
    WHEN 'pos_store_settings' THEN (SELECT to_jsonb(x) FROM public."pos_store_settings" x WHERE x."store_id"=((f.entity_id::jsonb)->>'store_id') LIMIT 1)
    WHEN 'settings_scoped' THEN (SELECT to_jsonb(x) FROM public."settings_scoped" x WHERE x."scope"=((f.entity_id::jsonb)->>'scope') AND x."scope_id"=((f.entity_id::jsonb)->>'scope_id') AND x."key"=((f.entity_id::jsonb)->>'key') LIMIT 1)
    WHEN 'stock_count_drafts' THEN (SELECT to_jsonb(x) FROM public."stock_count_drafts" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'authorization_actions' THEN (SELECT to_jsonb(x) FROM public."authorization_actions" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'authorization_action_history' THEN (SELECT to_jsonb(x) FROM public."authorization_action_history" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'authorization_requests' THEN (SELECT to_jsonb(x) FROM public."authorization_requests" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'authorization_log' THEN (SELECT to_jsonb(x) FROM public."authorization_log" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'record_edits' THEN (SELECT to_jsonb(x) FROM public."record_edits" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'shift_cash_counts' THEN (SELECT to_jsonb(x) FROM public."shift_cash_counts" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'shift_close_events' THEN (SELECT to_jsonb(x) FROM public."shift_close_events" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'shift_reconciliations' THEN (SELECT to_jsonb(x) FROM public."shift_reconciliations" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'shift_variance_alerts' THEN (SELECT to_jsonb(x) FROM public."shift_variance_alerts" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'shift_notifications' THEN (SELECT to_jsonb(x) FROM public."shift_notifications" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'entity_status_history' THEN (SELECT to_jsonb(x) FROM public."entity_status_history" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'nav_pins' THEN (SELECT to_jsonb(x) FROM public."nav_pins" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)
    WHEN 'store_groups' THEN (SELECT to_jsonb(x) FROM public."store_groups" x WHERE x."id"=((f.entity_id::jsonb)->>'id') LIMIT 1)
    WHEN 'change_history' THEN (SELECT to_jsonb(x) FROM public."change_history" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1) ELSE NULL END
 FROM feed_page f ORDER BY f.cursor;
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_sync_bootstrap(p_organization_id text,p_branch_id text,p_terminal_id text,p_table text,p_after_cursor text DEFAULT NULL,p_history_days integer DEFAULT 90,p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_rows jsonb:='[]'::jsonb; v_cursor text; v_me public.app_users%ROWTYPE;
BEGIN PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id); IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 CASE p_table WHEN 'coupon_campaigns' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."coupon_campaigns" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shifts' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shifts" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'issued_vouchers' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."issued_vouchers" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'activity_events' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."activity_events" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'app_users' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."app_users" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'audit_logs' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."audit_logs" x WHERE (x.store_id::text=p_branch_id) AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'booking_payments' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."booking_payments" x WHERE (EXISTS(SELECT 1 FROM public."bookings" p WHERE p."id"::text=x."booking_id"::text AND p.store_id::text=p_branch_id))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'bookings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."bookings" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'branch_telemetry' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('terminal_id',x."terminal_id")::text cursor,x row_data FROM public."branch_telemetry" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('terminal_id',x."terminal_id")::text>p_after_cursor) ORDER BY jsonb_build_object('terminal_id',x."terminal_id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'cashiers' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."cashiers" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'coupon_events' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."coupon_events" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'drawer_events' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."drawer_events" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'held_orders' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."held_orders" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'integration_settings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."integration_settings" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'item_activity_logs' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."item_activity_logs" x WHERE (x.store_id::text=p_branch_id) AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'member_verifications' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."member_verifications" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'members' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."members" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'membership_tiers' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."membership_tiers" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'offline_sync_audit_log' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."offline_sync_audit_log" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'payment_transactions' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."payment_transactions" x WHERE (x.store_id::text=p_branch_id) AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'payment_types' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."payment_types" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'pin_attempts' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('key',x."key")::text cursor,x row_data FROM public."pin_attempts" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('key',x."key")::text>p_after_cursor) ORDER BY jsonb_build_object('key',x."key")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'pos_settings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."pos_settings" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'product_barcodes' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."product_barcodes" x WHERE (EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'product_categories' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."product_categories" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'products' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."products" x WHERE ((NULLIF(x.owner_store_id::text,'') IS NULL OR x.owner_store_id::text=p_branch_id))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'promotions' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."promotions" x WHERE (EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."foc_product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'public_flags' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('key',x."key")::text cursor,x row_data FROM public."public_flags" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('key',x."key")::text>p_after_cursor) ORDER BY jsonb_build_object('key',x."key")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'purchase_order_items' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."purchase_order_items" x WHERE (EXISTS(SELECT 1 FROM public."purchase_orders" p WHERE p."id"::text=x."po_id"::text AND p.store_id::text=p_branch_id))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'purchase_orders' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."purchase_orders" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'sale_items' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."sale_items" x WHERE (x.branch_id::text=p_branch_id) AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'sales' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."sales" x WHERE (x.store_id::text=p_branch_id) AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'secure_settings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('key',x."key")::text cursor,x row_data FROM public."secure_settings" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('key',x."key")::text>p_after_cursor) ORDER BY jsonb_build_object('key',x."key")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'security_findings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."security_findings" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'settings_locks' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('section',x."section")::text cursor,x row_data FROM public."settings_locks" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('section',x."section")::text>p_after_cursor) ORDER BY jsonb_build_object('section',x."section")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'settings_overrides' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('scope',x."scope",'scope_id',x."scope_id",'section',x."section")::text cursor,x row_data FROM public."settings_overrides" x WHERE ((lower(x.scope)='global' OR (lower(x.scope)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text)) OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id)))  AND (p_after_cursor IS NULL OR jsonb_build_object('scope',x."scope",'scope_id',x."scope_id",'section',x."section")::text>p_after_cursor) ORDER BY jsonb_build_object('scope',x."scope",'scope_id',x."scope_id",'section',x."section")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shift_sessions' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shift_sessions" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'sku_audit' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."sku_audit" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'staff_roles' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('slug',x."slug")::text cursor,x row_data FROM public."staff_roles" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('slug',x."slug")::text>p_after_cursor) ORDER BY jsonb_build_object('slug',x."slug")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'stock_adjustments' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."stock_adjustments" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'stock_delta_applied' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('movement_id',x."movement_id")::text cursor,x row_data FROM public."stock_delta_applied" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('movement_id',x."movement_id")::text>p_after_cursor) ORDER BY jsonb_build_object('movement_id',x."movement_id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'stock_transfer_items' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."stock_transfer_items" x WHERE (EXISTS(SELECT 1 FROM public."stock_transfers" p WHERE p."id"::text=x."transfer_id"::text AND p_branch_id IN (p.from_store_id::text,p.to_store_id::text)))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'stock_transfers' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."stock_transfers" x WHERE (p_branch_id IN (x.from_store_id::text,x.to_store_id::text))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'stores' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."stores" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'suppliers' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."suppliers" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'sync_metadata' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."sync_metadata" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'system_audit_logs' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."system_audit_logs" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'terminal_commands' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."terminal_commands" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'terminal_tokens' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."terminal_tokens" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'uom_units' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."uom_units" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'user_roles' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."user_roles" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'whatsapp_queue' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."whatsapp_queue" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'terminal_recovery_secrets' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('terminal_token_id',x."terminal_token_id")::text cursor,x row_data FROM public."terminal_recovery_secrets" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('terminal_token_id',x."terminal_token_id")::text>p_after_cursor) ORDER BY jsonb_build_object('terminal_token_id',x."terminal_token_id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'pos_store_settings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('store_id',x."store_id")::text cursor,x row_data FROM public."pos_store_settings" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('store_id',x."store_id")::text>p_after_cursor) ORDER BY jsonb_build_object('store_id',x."store_id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'settings_scoped' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('scope',x."scope",'scope_id',x."scope_id",'key',x."key")::text cursor,x row_data FROM public."settings_scoped" x WHERE ((lower(x.scope)='global' OR (lower(x.scope)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text)) OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id)))  AND (p_after_cursor IS NULL OR jsonb_build_object('scope',x."scope",'scope_id',x."scope_id",'key',x."key")::text>p_after_cursor) ORDER BY jsonb_build_object('scope',x."scope",'scope_id',x."scope_id",'key',x."key")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'stock_count_drafts' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."stock_count_drafts" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'authorization_actions' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."authorization_actions" x WHERE ((lower(x.scope_type)='global' OR (lower(x.scope_type)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope_type)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text))))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'authorization_action_history' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."authorization_action_history" x WHERE ((lower(x.scope_type)='global' OR (lower(x.scope_type)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope_type)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text))))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'authorization_requests' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."authorization_requests" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'authorization_log' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."authorization_log" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'record_edits' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."record_edits" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shift_cash_counts' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shift_cash_counts" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shift_close_events' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shift_close_events" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shift_reconciliations' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shift_reconciliations" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shift_variance_alerts' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shift_variance_alerts" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shift_notifications' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shift_notifications" x WHERE (x.store_id::text=p_branch_id) AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'entity_status_history' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."entity_status_history" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'nav_pins' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."nav_pins" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'store_groups' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."store_groups" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'change_history' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."change_history" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page; ELSE RAISE EXCEPTION 'SYNC_TABLE_FORBIDDEN'; END CASE;
 RETURN jsonb_build_object('rows',v_rows,'cursor',CASE WHEN jsonb_array_length(v_rows)>=LEAST(GREATEST(p_limit,100),2000) THEN v_cursor ELSE NULL END);
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_sync_counts(p_organization_id text,p_branch_id text,p_terminal_id text,p_history_days integer DEFAULT 90)
RETURNS TABLE(table_name text,row_count bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_me public.app_users%ROWTYPE;
BEGIN PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id); IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 RETURN QUERY SELECT 'coupon_campaigns'::text table_name,count(*)::bigint row_count FROM public."coupon_campaigns" x WHERE true UNION ALL SELECT 'shifts'::text table_name,count(*)::bigint row_count FROM public."shifts" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'issued_vouchers'::text table_name,count(*)::bigint row_count FROM public."issued_vouchers" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'activity_events'::text table_name,count(*)::bigint row_count FROM public."activity_events" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'app_users'::text table_name,count(*)::bigint row_count FROM public."app_users" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'audit_logs'::text table_name,count(*)::bigint row_count FROM public."audit_logs" x WHERE x.store_id::text=p_branch_id AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) UNION ALL SELECT 'booking_payments'::text table_name,count(*)::bigint row_count FROM public."booking_payments" x WHERE EXISTS(SELECT 1 FROM public."bookings" p WHERE p."id"::text=x."booking_id"::text AND p.store_id::text=p_branch_id) UNION ALL SELECT 'bookings'::text table_name,count(*)::bigint row_count FROM public."bookings" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'branch_telemetry'::text table_name,count(*)::bigint row_count FROM public."branch_telemetry" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'cashiers'::text table_name,count(*)::bigint row_count FROM public."cashiers" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'coupon_events'::text table_name,count(*)::bigint row_count FROM public."coupon_events" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'drawer_events'::text table_name,count(*)::bigint row_count FROM public."drawer_events" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'held_orders'::text table_name,count(*)::bigint row_count FROM public."held_orders" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'integration_settings'::text table_name,count(*)::bigint row_count FROM public."integration_settings" x WHERE true UNION ALL SELECT 'item_activity_logs'::text table_name,count(*)::bigint row_count FROM public."item_activity_logs" x WHERE x.store_id::text=p_branch_id AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) UNION ALL SELECT 'member_verifications'::text table_name,count(*)::bigint row_count FROM public."member_verifications" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'members'::text table_name,count(*)::bigint row_count FROM public."members" x WHERE true UNION ALL SELECT 'membership_tiers'::text table_name,count(*)::bigint row_count FROM public."membership_tiers" x WHERE true UNION ALL SELECT 'offline_sync_audit_log'::text table_name,count(*)::bigint row_count FROM public."offline_sync_audit_log" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'payment_transactions'::text table_name,count(*)::bigint row_count FROM public."payment_transactions" x WHERE x.store_id::text=p_branch_id AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) UNION ALL SELECT 'payment_types'::text table_name,count(*)::bigint row_count FROM public."payment_types" x WHERE true UNION ALL SELECT 'pin_attempts'::text table_name,count(*)::bigint row_count FROM public."pin_attempts" x WHERE true UNION ALL SELECT 'pos_settings'::text table_name,count(*)::bigint row_count FROM public."pos_settings" x WHERE true UNION ALL SELECT 'product_barcodes'::text table_name,count(*)::bigint row_count FROM public."product_barcodes" x WHERE EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)) UNION ALL SELECT 'product_categories'::text table_name,count(*)::bigint row_count FROM public."product_categories" x WHERE true UNION ALL SELECT 'products'::text table_name,count(*)::bigint row_count FROM public."products" x WHERE (NULLIF(x.owner_store_id::text,'') IS NULL OR x.owner_store_id::text=p_branch_id) UNION ALL SELECT 'promotions'::text table_name,count(*)::bigint row_count FROM public."promotions" x WHERE EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."foc_product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)) UNION ALL SELECT 'public_flags'::text table_name,count(*)::bigint row_count FROM public."public_flags" x WHERE true UNION ALL SELECT 'purchase_order_items'::text table_name,count(*)::bigint row_count FROM public."purchase_order_items" x WHERE EXISTS(SELECT 1 FROM public."purchase_orders" p WHERE p."id"::text=x."po_id"::text AND p.store_id::text=p_branch_id) UNION ALL SELECT 'purchase_orders'::text table_name,count(*)::bigint row_count FROM public."purchase_orders" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'sale_items'::text table_name,count(*)::bigint row_count FROM public."sale_items" x WHERE x.branch_id::text=p_branch_id AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) UNION ALL SELECT 'sales'::text table_name,count(*)::bigint row_count FROM public."sales" x WHERE x.store_id::text=p_branch_id AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) UNION ALL SELECT 'secure_settings'::text table_name,count(*)::bigint row_count FROM public."secure_settings" x WHERE true UNION ALL SELECT 'security_findings'::text table_name,count(*)::bigint row_count FROM public."security_findings" x WHERE true UNION ALL SELECT 'settings_locks'::text table_name,count(*)::bigint row_count FROM public."settings_locks" x WHERE true UNION ALL SELECT 'settings_overrides'::text table_name,count(*)::bigint row_count FROM public."settings_overrides" x WHERE (lower(x.scope)='global' OR (lower(x.scope)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text)) OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id)) UNION ALL SELECT 'shift_sessions'::text table_name,count(*)::bigint row_count FROM public."shift_sessions" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'sku_audit'::text table_name,count(*)::bigint row_count FROM public."sku_audit" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'staff_roles'::text table_name,count(*)::bigint row_count FROM public."staff_roles" x WHERE true UNION ALL SELECT 'stock_adjustments'::text table_name,count(*)::bigint row_count FROM public."stock_adjustments" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'stock_delta_applied'::text table_name,count(*)::bigint row_count FROM public."stock_delta_applied" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'stock_transfer_items'::text table_name,count(*)::bigint row_count FROM public."stock_transfer_items" x WHERE EXISTS(SELECT 1 FROM public."stock_transfers" p WHERE p."id"::text=x."transfer_id"::text AND p_branch_id IN (p.from_store_id::text,p.to_store_id::text)) UNION ALL SELECT 'stock_transfers'::text table_name,count(*)::bigint row_count FROM public."stock_transfers" x WHERE p_branch_id IN (x.from_store_id::text,x.to_store_id::text) UNION ALL SELECT 'stores'::text table_name,count(*)::bigint row_count FROM public."stores" x WHERE true UNION ALL SELECT 'suppliers'::text table_name,count(*)::bigint row_count FROM public."suppliers" x WHERE true UNION ALL SELECT 'sync_metadata'::text table_name,count(*)::bigint row_count FROM public."sync_metadata" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'system_audit_logs'::text table_name,count(*)::bigint row_count FROM public."system_audit_logs" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'terminal_commands'::text table_name,count(*)::bigint row_count FROM public."terminal_commands" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'terminal_tokens'::text table_name,count(*)::bigint row_count FROM public."terminal_tokens" x WHERE true UNION ALL SELECT 'uom_units'::text table_name,count(*)::bigint row_count FROM public."uom_units" x WHERE true UNION ALL SELECT 'user_roles'::text table_name,count(*)::bigint row_count FROM public."user_roles" x WHERE true UNION ALL SELECT 'whatsapp_queue'::text table_name,count(*)::bigint row_count FROM public."whatsapp_queue" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'terminal_recovery_secrets'::text table_name,count(*)::bigint row_count FROM public."terminal_recovery_secrets" x WHERE true UNION ALL SELECT 'pos_store_settings'::text table_name,count(*)::bigint row_count FROM public."pos_store_settings" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'settings_scoped'::text table_name,count(*)::bigint row_count FROM public."settings_scoped" x WHERE (lower(x.scope)='global' OR (lower(x.scope)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text)) OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id)) UNION ALL SELECT 'stock_count_drafts'::text table_name,count(*)::bigint row_count FROM public."stock_count_drafts" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'authorization_actions'::text table_name,count(*)::bigint row_count FROM public."authorization_actions" x WHERE (lower(x.scope_type)='global' OR (lower(x.scope_type)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope_type)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text))) UNION ALL SELECT 'authorization_action_history'::text table_name,count(*)::bigint row_count FROM public."authorization_action_history" x WHERE (lower(x.scope_type)='global' OR (lower(x.scope_type)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope_type)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text))) UNION ALL SELECT 'authorization_requests'::text table_name,count(*)::bigint row_count FROM public."authorization_requests" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'authorization_log'::text table_name,count(*)::bigint row_count FROM public."authorization_log" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'record_edits'::text table_name,count(*)::bigint row_count FROM public."record_edits" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'shift_cash_counts'::text table_name,count(*)::bigint row_count FROM public."shift_cash_counts" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'shift_close_events'::text table_name,count(*)::bigint row_count FROM public."shift_close_events" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'shift_reconciliations'::text table_name,count(*)::bigint row_count FROM public."shift_reconciliations" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'shift_variance_alerts'::text table_name,count(*)::bigint row_count FROM public."shift_variance_alerts" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'shift_notifications'::text table_name,count(*)::bigint row_count FROM public."shift_notifications" x WHERE x.store_id::text=p_branch_id AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) UNION ALL SELECT 'entity_status_history'::text table_name,count(*)::bigint row_count FROM public."entity_status_history" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'nav_pins'::text table_name,count(*)::bigint row_count FROM public."nav_pins" x WHERE true UNION ALL SELECT 'store_groups'::text table_name,count(*)::bigint row_count FROM public."store_groups" x WHERE true UNION ALL SELECT 'change_history'::text table_name,count(*)::bigint row_count FROM public."change_history" x WHERE true;
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_old_receipt_lookup(p_lookup text,p_branch_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_me public.app_users%ROWTYPE; v_sale public.sales%ROWTYPE;
BEGIN IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_process_refund')::boolean,false)) THEN RAISE EXCEPTION 'REFUND_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 SELECT * INTO v_sale FROM public.sales WHERE store_id=p_branch_id AND (id::text=p_lookup OR bill_number=p_lookup OR client_transaction_id::text=p_lookup) LIMIT 1;
 IF v_sale.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('sale',to_jsonb(v_sale),'items',(SELECT COALESCE(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM public.sale_items i WHERE i.sale_id=v_sale.id),'payments',(SELECT COALESCE(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.payment_transactions p WHERE p.sale_id=v_sale.id));
END $fn$;

REVOKE ALL ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_pull(text,text,text,bigint,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_bootstrap(text,text,text,text,text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_counts(text,text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_old_receipt_lookup(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_pull(text,text,text,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_bootstrap(text,text,text,text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_counts(text,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_old_receipt_lookup(text,text) TO service_role;

-- SQLSERVER_SYNC_CONTRACT_END

CREATE OR REPLACE FUNCTION public.pos_sync_push_governance_batch(
  p_batch_id uuid,p_organization_id text,p_branch_id text,p_table text,p_rows jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer:=0;
BEGIN
  IF p_table NOT IN ('authorization_actions','authorization_action_history') THEN RAISE EXCEPTION 'SYNC_TABLE_FORBIDDEN'; END IF;
  IF p_table='authorization_actions' THEN v_count:=public.sync_apply_authorization_actions(p_rows);
  ELSE v_count:=public.sync_apply_authorization_action_history(p_rows); END IF;
  RETURN jsonb_build_object('ok',true,'applied',v_count,'batch_id',p_batch_id);
END $$;
REVOKE ALL ON FUNCTION public.pos_sync_push_governance_batch(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_governance_batch(uuid,text,text,text,jsonb) TO service_role;

-- Resolve large spreadsheet batches against the authoritative catalogue in a
-- single indexed call. RLS remains in force because this is SECURITY INVOKER.
CREATE OR REPLACE FUNCTION public.product_lookup_batch(p_codes text[])
RETURNS SETOF public.products
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.*
  FROM public.products AS p
  WHERE COALESCE(p.is_archived, false) = false
    AND (
      lower(btrim(p.barcode)) = ANY (p_codes)
      OR lower(btrim(COALESCE(p.sku, ''))) = ANY (p_codes)
      OR EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.barcode_aliases, '{}'::text[])) AS alias(code)
        WHERE lower(btrim(alias.code)) = ANY (p_codes)
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p.barcode_variants, '[]'::jsonb)) AS variant(value)
        WHERE lower(btrim(variant.value->>'code')) = ANY (p_codes)
      )
      OR EXISTS (
        SELECT 1
        FROM public.product_barcodes AS indexed
        WHERE indexed.product_id = p.id
          AND lower(btrim(indexed.barcode)) = ANY (p_codes)
      )
    )
$fn$;

REVOKE ALL ON FUNCTION public.product_lookup_batch(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_lookup_batch(text[]) TO authenticated, service_role;

-- ===========================================================================
-- Public-schema privilege hardening for base routines
--
-- PostgreSQL gives PUBLIC execute permission on new routines unless it is
-- explicitly revoked.  Because anon and authenticated inherit from PUBLIC,
-- every SECURITY DEFINER routine must be closed after all routine definitions
-- have been installed.  Exact pre-login endpoints are granted back below.
-- ===========================================================================
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

DO $privilege_hardening$
DECLARE
  routine record;
BEGIN
  FOR routine IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',
      routine.signature
    );
  END LOOP;
END;
$privilege_hardening$;

-- These calls occur before a staff Supabase session exists.  Each routine or
-- its signed server endpoint performs narrow token, PIN, campaign, or ingest
-- validation.
GRANT EXECUTE ON FUNCTION public.coupon_claim(text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.member_welcome_claim(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.voucher_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.terminal_token_status(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.terminal_token_claim(uuid, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.terminal_token_heartbeat(uuid, boolean, text, boolean, text) TO anon;

-- These tables are implementation details behind privileged routines.  RLS
-- remains enabled as defence in depth, while client roles have no table-level
-- path that can produce the self-check's policy-less-table warning.
REVOKE ALL ON TABLE public.cashiers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pin_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.terminal_recovery_secrets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sync_idempotency_receipts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sync_change_feed FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "server-only deny client access" ON public.cashiers;
CREATE POLICY "server-only deny client access" ON public.cashiers
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "server-only deny client access" ON public.pin_attempts;
CREATE POLICY "server-only deny client access" ON public.pin_attempts
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "server-only deny client access" ON public.terminal_recovery_secrets;
CREATE POLICY "server-only deny client access" ON public.terminal_recovery_secrets
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "server-only deny client access" ON public.sync_idempotency_receipts;
CREATE POLICY "server-only deny client access" ON public.sync_idempotency_receipts
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "server-only deny client access" ON public.sync_change_feed;
CREATE POLICY "server-only deny client access" ON public.sync_change_feed
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMENT ON TABLE public.sync_idempotency_receipts IS
  'Server-only sync replay protection. Access is restricted to privileged synchronization routines.';
COMMENT ON TABLE public.sync_change_feed IS
  'Server-only synchronization feed. Access is restricted to privileged synchronization routines.';

-- Schema Manager creates this table only when it emits a repair.  Harden an
-- existing copy without making the optional table part of fresh installs.
DO $schema_migrations_hardening$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.schema_migrations FROM PUBLIC, anon, authenticated;
    DROP POLICY IF EXISTS "server-only deny client access" ON public.schema_migrations;
    CREATE POLICY "server-only deny client access" ON public.schema_migrations
      FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
    COMMENT ON TABLE public.schema_migrations IS
      'Server-only record of applied Schema Manager repairs.';
  END IF;
END;
$schema_migrations_hardening$;

-- Keep immutable defaults independent of any caller-controlled lookup path.
ALTER FUNCTION public.pos_rules_defaults()
  SET search_path TO 'public', 'pg_temp';
-- ------------------------------------------------------------------
-- Secure shift visibility, atomic approvals and scoped-settings Realtime
-- (source: 20260927115034_secure_shift_approvals_realtime.sql)
-- ------------------------------------------------------------------
-- Atomic approval decisions, permission-redacted shift reconciliation reads,
-- and Realtime coverage for centrally scoped settings.

CREATE OR REPLACE FUNCTION public.authorization_decide_request(
  p_id uuid,
  p_approve boolean,
  p_decided_by text,
  p_decided_by_name text,
  p_note text DEFAULT '',
  p_approved_amount numeric DEFAULT NULL,
  p_approved_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS SETOF public.authorization_requests
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  UPDATE public.authorization_requests
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_by = p_decided_by,
         decided_by_name = p_decided_by_name,
         decided_at = now(),
         decision_note = COALESCE(p_note, ''),
         approved_amount = CASE WHEN p_approve THEN p_approved_amount ELSE NULL END,
         approved_payload = CASE WHEN p_approve THEN COALESCE(p_approved_payload, '{}'::jsonb) ELSE '{}'::jsonb END,
         updated_at = now()
   WHERE id = p_id
     AND status = 'pending'
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.authorization_decide_request(uuid, boolean, text, text, text, numeric, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorization_decide_request(uuid, boolean, text, text, text, numeric, jsonb)
  TO service_role;

DROP POLICY IF EXISTS "Staff read shift cash counts" ON public.shift_cash_counts;
CREATE POLICY "Permission holders read shift cash counts"
  ON public.shift_cash_counts FOR SELECT TO authenticated
  USING (
    public.has_perm('can_shift_counted_cash_view')
    AND public.store_visible(store_id)
  );

DROP POLICY IF EXISTS "Staff read shift close events" ON public.shift_close_events;
CREATE POLICY "Permission holders read shift close events"
  ON public.shift_close_events FOR SELECT TO authenticated
  USING (
    public.has_perm('can_shift_closing_history_view')
    AND public.store_visible(store_id)
  );

REVOKE SELECT ON public.shift_reconciliations FROM authenticated;
DROP POLICY IF EXISTS "Variance viewers read reconciliations" ON public.shift_reconciliations;

CREATE OR REPLACE FUNCTION public.shift_reconciliation_view(p_shift uuid)
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  store_id text,
  count_id uuid,
  expected_cash numeric,
  expected_card numeric,
  expected_digital numeric,
  counted_cash numeric,
  counted_card numeric,
  counted_digital numeric,
  variance_cash numeric,
  variance_card numeric,
  variance_digital numeric,
  variance_total numeric,
  variance_status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    r.id,
    r.shift_id,
    r.store_id,
    r.count_id,
    CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN r.expected_cash END,
    CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN r.expected_card END,
    CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN r.expected_digital END,
    CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN r.counted_cash END,
    CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN r.counted_card END,
    CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN r.counted_digital END,
    CASE WHEN public.has_perm('can_shift_variance_view') THEN r.variance_cash END,
    CASE WHEN public.has_perm('can_shift_variance_view') THEN r.variance_card END,
    CASE WHEN public.has_perm('can_shift_variance_view') THEN r.variance_digital END,
    CASE WHEN public.has_perm('can_shift_variance_view') THEN r.variance_total END,
    CASE WHEN public.has_perm('can_shift_variance_view') THEN r.variance_status END,
    r.created_at
  FROM public.shift_reconciliations r
  WHERE r.shift_id = p_shift
    AND public.store_visible(r.store_id)
    AND (
      public.has_perm('can_shift_expected_cash_view')
      OR public.has_perm('can_shift_counted_cash_view')
      OR public.has_perm('can_shift_variance_view')
    )
  ORDER BY r.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.shift_reconciliation_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_reconciliation_view(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Permission holders read shift reconciliations" ON public.shift_reconciliations;

DROP POLICY IF EXISTS "Branch staff raise transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Branch staff read transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Branch staff update transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Branch supervisors delete transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Branch staff add transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Branch staff delete transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Branch staff read transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Branch staff update transfer items" ON public.stock_transfer_items;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['settings_overrides', 'settings_locks', 'settings_scoped']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
      IF NOT EXISTS (
        SELECT 1
          FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END IF;
  END LOOP;
END $$;


-- Never expose shift tender totals through an unrestricted row SELECT. The
-- public invoker wrappers below call a non-exposed helper that repeats the
-- authenticated staff, active-terminal, and visible-store checks, then redacts
-- each financial group using the caller's current permission matrix.
REVOKE SELECT ON public.shifts FROM authenticated;
GRANT SELECT (
  id, store_id, terminal_id, terminal_name, opened_by_name, opened_by_staff_id,
  opened_by_role, closed_by_name, closed_by_staff_id, closed_by_role, opened_at,
  closed_at, note, overdue, created_at, updated_at, status, user_id, row_version,
  state, close_reason, closing_started_at, closing_started_by
) ON public.shifts TO authenticated;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.shift_list_secure_impl(
  p_store_id text DEFAULT NULL,
  p_limit integer DEFAULT 300
)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.to_jsonb(s) || pg_catalog.jsonb_build_object(
    'opening_float', CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN s.opening_float END,
    'expected_cash', CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN s.expected_cash END,
    'expected_card', CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN s.expected_card END,
    'expected_digital', CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN s.expected_digital END,
    'counted_cash', CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN s.counted_cash END,
    'counted_card', CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN s.counted_card END,
    'counted_digital', CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN s.counted_digital END,
    'closing_float', CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN s.closing_float END,
    'final_counted_cash', CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN s.final_counted_cash END,
    'variance_cash', CASE WHEN public.has_perm('can_shift_variance_view') THEN s.variance_cash END,
    'variance_card', CASE WHEN public.has_perm('can_shift_variance_view') THEN s.variance_card END,
    'variance_digital', CASE WHEN public.has_perm('can_shift_variance_view') THEN s.variance_digital END,
    'variance_total', CASE WHEN public.has_perm('can_shift_variance_view') THEN s.variance_total END,
    'variance_status', CASE WHEN public.has_perm('can_shift_variance_view') THEN s.variance_status END
  )
  FROM public.shifts s
  WHERE public.is_staff((SELECT auth.uid()))
    AND public.is_terminal_active()
    AND public.store_visible(s.store_id)
    AND (p_store_id IS NULL OR s.store_id = p_store_id)
  ORDER BY s.opened_at DESC, s.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 1000);
$$;
REVOKE ALL ON FUNCTION private.shift_list_secure_impl(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.shift_list_secure_impl(text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shift_list_secure(
  p_store_id text DEFAULT NULL,
  p_limit integer DEFAULT 300
)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT secure_row
  FROM private.shift_list_secure_impl(p_store_id, p_limit)
    AS secure_rows(secure_row);
$$;
REVOKE ALL ON FUNCTION public.shift_list_secure(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_list_secure(text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shift_active_secure(p_store_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT secure_row
  FROM public.shift_list_secure(p_store_id, 1000) AS secure_rows(secure_row)
  WHERE secure_row->>'status' = 'OPEN' AND secure_row->>'closed_at' IS NULL
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.shift_active_secure(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_active_secure(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.shift_active_for_branch(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_active_for_branch(text) TO service_role;

DROP POLICY IF EXISTS "Staff raise transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Staff read transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Staff update transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Supervisors delete transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Staff read transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Staff write transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Branch staff write transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Scoped staff raise transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Scoped staff read transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Scoped staff update transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Scoped supervisors delete transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Scoped staff access transfer items" ON public.stock_transfer_items;

CREATE POLICY "Scoped staff raise transfers" ON public.stock_transfers FOR INSERT TO authenticated
  WITH CHECK (public.has_perm('can_create_transfer') AND (public.user_has_store_access(from_store_id) OR public.user_has_store_access(to_store_id)));
CREATE POLICY "Scoped staff read transfers" ON public.stock_transfers FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())) AND (public.user_has_store_access(from_store_id) OR public.user_has_store_access(to_store_id)));
CREATE POLICY "Scoped staff update transfers" ON public.stock_transfers FOR UPDATE TO authenticated
  USING ((public.has_perm('can_create_transfer') OR public.has_perm('can_receive_transfer') OR public.has_perm('can_approve_transfer')) AND (public.user_has_store_access(from_store_id) OR public.user_has_store_access(to_store_id)))
  WITH CHECK ((public.has_perm('can_create_transfer') OR public.has_perm('can_receive_transfer') OR public.has_perm('can_approve_transfer')) AND (public.user_has_store_access(from_store_id) OR public.user_has_store_access(to_store_id)));
CREATE POLICY "Scoped supervisors delete transfers" ON public.stock_transfers FOR DELETE TO authenticated
  USING (public.is_supervisor_now() AND public.user_has_store_access(from_store_id));
CREATE POLICY "Scoped staff access transfer items" ON public.stock_transfer_items TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id=stock_transfer_items.transfer_id AND (public.user_has_store_access(t.from_store_id) OR public.user_has_store_access(t.to_store_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id=stock_transfer_items.transfer_id AND (public.user_has_store_access(t.from_store_id) OR public.user_has_store_access(t.to_store_id))));

-- ===========================================================================
-- Final public-schema privilege hardening
-- This must remain after every routine definition in this canonical installer.
-- ===========================================================================
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

DO $final_privilege_hardening$
DECLARE
  routine record;
BEGIN
  FOR routine IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', routine.signature);
  END LOOP;
END;
$final_privilege_hardening$;

-- These privileged routines are only called by the application server.  A
-- direct client call would bypass its PIN throttling or signed ingest check.
REVOKE EXECUTE ON FUNCTION public.verify_cashier_pin(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_terminal_pin(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.security_report_findings(text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cashier_pin(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_terminal_pin(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_report_findings(text, text, jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.coupon_claim(text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.member_welcome_claim(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.voucher_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.terminal_token_status(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.terminal_token_claim(uuid, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.terminal_token_heartbeat(uuid, boolean, text, boolean, text) TO anon;
-- ---------------------------------------------------------------------------
-- Device session lifecycle and final least-privilege grants
-- ---------------------------------------------------------------------------
-- Sessions are server-managed. Keeping this definition in the canonical
-- installer prevents a fresh operator database from failing only after the
-- first successful sign-in.
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash text NOT NULL UNIQUE,
  user_id uuid,
  staff_user_id text,
  kind text NOT NULL DEFAULT 'staff',
  label text,
  branch_id text,
  terminal_id text,
  platform text,
  idle_timeout_minutes integer NOT NULL DEFAULT 30,
  last_activity_at timestamp with time zone NOT NULL DEFAULT now(),
  is_revoked boolean NOT NULL DEFAULT false,
  revoked_at timestamp with time zone,
  revoked_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_sessions_branch_idx
  ON public.user_sessions (branch_id);
CREATE INDEX IF NOT EXISTS user_sessions_terminal_idx
  ON public.user_sessions (terminal_id);
CREATE INDEX IF NOT EXISTS user_sessions_live_idx
  ON public.user_sessions (is_revoked, last_activity_at);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors read sessions" ON public.user_sessions;
-- Session hashes are deliberately available only to the service-backed app
-- boundary, which returns a safe projection after supervisor verification.
REVOKE ALL ON public.user_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_sessions TO service_role;

-- Clear historical broad grants before adding the intended exact privileges.
REVOKE ALL ON public.branch_telemetry FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.branch_telemetry TO authenticated;
GRANT ALL ON public.branch_telemetry TO service_role;

REVOKE ALL ON public.shift_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.shift_notifications TO authenticated;
GRANT ALL ON public.shift_notifications TO service_role;
