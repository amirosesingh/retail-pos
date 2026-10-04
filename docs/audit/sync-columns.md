# Synchronization column matrix

Generated from the packaged registry: 70 tables and 1187 synchronized columns.

Columns listed here are synchronized unless the table is listed as local-only or cloud-only in the coverage matrix.

| Table | Cloud column | SQL Server column | Cloud type | SQL Server type | Null | Default | PK | FK target | Unique |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| activity_events | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| activity_events | event_type | event_type | text | nvarchar(max) | no | — | no | — | no |
| activity_events | severity | severity | text | nvarchar(max) | no | 'info' | no | — | no |
| activity_events | title | title | text | nvarchar(max) | no | — | no | — | no |
| activity_events | message | message | text | nvarchar(max) | no | '' | no | — | no |
| activity_events | actor_id | actor_id | text | nvarchar(max) | yes | — | no | — | no |
| activity_events | actor_name | actor_name | text | nvarchar(max) | yes | — | no | — | no |
| activity_events | actor_role | actor_role | text | nvarchar(max) | yes | — | no | — | no |
| activity_events | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| activity_events | terminal_name | terminal_name | text | nvarchar(max) | yes | — | no | — | no |
| activity_events | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| activity_events | entity_type | entity_type | text | nvarchar(max) | yes | — | no | — | no |
| activity_events | entity_id | entity_id | text | nvarchar(max) | yes | — | no | — | no |
| activity_events | amount | amount | numeric | decimal(38,12) | yes | — | no | — | no |
| activity_events | meta | meta | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| activity_events | whatsapp_status | whatsapp_status | text | nvarchar(max) | no | 'skipped' | no | — | no |
| activity_events | whatsapp_error | whatsapp_error | text | nvarchar(max) | yes | — | no | — | no |
| activity_events | client_event_id | client_event_id | text | nvarchar(450) | yes | — | no | — | yes |
| activity_events | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| activity_events | previous_state | previous_state | TEXT | nvarchar(max) | yes | — | no | — | no |
| activity_events | new_state | new_state | TEXT | nvarchar(max) | yes | — | no | — | no |
| activity_events | cleared_by | cleared_by | text[] | nvarchar(max) | no | N'[]' | no | — | no |
| activity_events | branch_id | branch_id | text | nvarchar(450) | yes | — | no | — | no |
| app_users | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| app_users | user_id | user_id | character varying(64) | nvarchar(64) | no | — | no | — | yes |
| app_users | full_name | full_name | character varying(160) | nvarchar(160) | no | — | no | — | no |
| app_users | email | email | character varying(255) | nvarchar(255) | no | — | no | — | no |
| app_users | role | role | public.app_role | nvarchar(max) | no | — | no | — | no |
| app_users | store_id | store_id | character varying(64) | nvarchar(64) | yes | — | no | — | no |
| app_users | is_active | is_active | boolean | bit | no | 1 | no | — | no |
| app_users | permissions | permissions | jsonb | nvarchar(max) | no | — | no | — | no |
| app_users | pin_hash | pin_hash | text | nvarchar(max) | no | '' | no | — | no |
| app_users | auth_user_id | auth_user_id | uuid | uniqueidentifier | yes | — | no | — | yes |
| app_users | last_login_at | last_login_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| app_users | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| app_users | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| app_users | role_slug | role_slug | text | nvarchar(max) | yes | — | no | — | no |
| app_users | pin_length | pin_length | smallint | smallint | no | 6 | no | — | no |
| app_users | row_version | row_version | integer | int | no | 1 | no | — | no |
| app_users | pin_set_at | pin_set_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| app_users | pin_updated_by | pin_updated_by | text | nvarchar(max) | yes | — | no | — | no |
| app_users | auth_secret | auth_secret | text | nvarchar(max) | no | '' | no | — | no |
| app_users | idle_timeout_minutes | idle_timeout_minutes | integer | int | yes | — | no | — | no |
| audit_logs | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| audit_logs | user_name | user_name | text | nvarchar(max) | yes | — | no | — | no |
| audit_logs | action_category | action_category | text | nvarchar(max) | no | — | no | — | no |
| audit_logs | action_name | action_name | text | nvarchar(max) | no | — | no | — | no |
| audit_logs | target_module | target_module | text | nvarchar(max) | yes | — | no | — | no |
| audit_logs | details | details | jsonb | nvarchar(max) | yes | — | no | — | no |
| audit_logs | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| audit_logs | user_id | user_id | text | nvarchar(max) | yes | — | no | — | no |
| audit_logs | action | action | text | nvarchar(max) | yes | — | no | — | no |
| audit_logs | entity | entity | text | nvarchar(max) | yes | — | no | — | no |
| audit_logs | before_state | before_state | jsonb | nvarchar(max) | yes | — | no | — | no |
| audit_logs | after_state | after_state | jsonb | nvarchar(max) | yes | — | no | — | no |
| audit_logs | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| authorization_action_history | id | id | uuid | uniqueidentifier | no | — | yes | — | no |
| authorization_action_history | action_id | action_id | uuid | uniqueidentifier | no | — | no | — | no |
| authorization_action_history | action_key | action_key | text | nvarchar(max) | no | — | no | — | no |
| authorization_action_history | scope_type | scope_type | text | nvarchar(max) | no | — | no | — | no |
| authorization_action_history | scope_id | scope_id | text | nvarchar(max) | no | '' | no | — | no |
| authorization_action_history | row_version | row_version | integer | int | no | — | no | — | no |
| authorization_action_history | changed_by | changed_by | text | nvarchar(max) | no | — | no | — | no |
| authorization_action_history | change_source | change_source | text | nvarchar(max) | no | — | no | — | no |
| authorization_action_history | change_kind | change_kind | text | nvarchar(max) | no | — | no | — | no |
| authorization_action_history | snapshot | snapshot | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| authorization_action_history | created_at | created_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| authorization_actions | id | id | uuid | uniqueidentifier | no | — | yes | — | no |
| authorization_actions | action_key | action_key | text | nvarchar(128) | no | — | no | — | no |
| authorization_actions | scope_type | scope_type | text | nvarchar(128) | no | 'global' | no | — | no |
| authorization_actions | scope_id | scope_id | text | nvarchar(128) | no | '' | no | — | no |
| authorization_actions | mode | mode | text | nvarchar(max) | no | 'none' | no | — | no |
| authorization_actions | allowed_roles | allowed_roles | text[] | nvarchar(max) | no | N'[]' | no | — | no |
| authorization_actions | allowed_user_ids | allowed_user_ids | text[] | nvarchar(max) | no | N'[]' | no | — | no |
| authorization_actions | requester_roles | requester_roles | text[] | nvarchar(max) | no | N'[]' | no | — | no |
| authorization_actions | requester_user_ids | requester_user_ids | text[] | nvarchar(max) | no | N'[]' | no | — | no |
| authorization_actions | authority_limits | authority_limits | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| authorization_actions | extra_authority | extra_authority | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| authorization_actions | absolute_ceilings | absolute_ceilings | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| authorization_actions | approval_timeout_minutes | approval_timeout_minutes | integer | int | no | 15 | no | — | no |
| authorization_actions | escalation_after_minutes | escalation_after_minutes | integer | int | yes | — | no | — | no |
| authorization_actions | escalation_roles | escalation_roles | text[] | nvarchar(max) | no | N'[]' | no | — | no |
| authorization_actions | require_reason | require_reason | boolean | bit | no | 0 | no | — | no |
| authorization_actions | threshold | threshold | numeric | decimal(38,12) | yes | — | no | — | no |
| authorization_actions | is_enabled | is_enabled | boolean | bit | no | 1 | no | — | no |
| authorization_actions | row_version | row_version | integer | int | no | 1 | no | — | no |
| authorization_actions | updated_by | updated_by | text | nvarchar(max) | yes | — | no | — | no |
| authorization_actions | created_at | created_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| authorization_actions | updated_at | updated_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| authorization_log | id | id | uuid | uniqueidentifier | no | — | yes | — | no |
| authorization_log | action_key | action_key | text | nvarchar(max) | no | — | no | — | no |
| authorization_log | mode_used | mode_used | text | nvarchar(max) | no | — | no | — | no |
| authorization_log | request_id | request_id | uuid | uniqueidentifier | yes | — | no | — | no |
| authorization_log | requested_by | requested_by | text | nvarchar(max) | yes | — | no | — | no |
| authorization_log | authorized_by | authorized_by | text | nvarchar(max) | yes | — | no | — | no |
| authorization_log | authorizer_role | authorizer_role | text | nvarchar(max) | yes | — | no | — | no |
| authorization_log | store_id | store_id | text | nvarchar(450) | no | '' | no | — | no |
| authorization_log | terminal_id | terminal_id | text | nvarchar(max) | no | '' | no | — | no |
| authorization_log | outcome | outcome | text | nvarchar(max) | no | — | no | — | no |
| authorization_log | detail | detail | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| authorization_log | created_at | created_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| authorization_requests | id | id | uuid | uniqueidentifier | no | — | yes | — | no |
| authorization_requests | action_key | action_key | text | nvarchar(max) | no | — | no | — | no |
| authorization_requests | requested_by | requested_by | text | nvarchar(max) | no | — | no | — | no |
| authorization_requests | requested_by_name | requested_by_name | text | nvarchar(max) | no | '' | no | — | no |
| authorization_requests | store_id | store_id | text | nvarchar(450) | no | '' | no | — | no |
| authorization_requests | terminal_id | terminal_id | text | nvarchar(max) | no | '' | no | — | no |
| authorization_requests | reason | reason | text | nvarchar(max) | no | '' | no | — | no |
| authorization_requests | payload | payload | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| authorization_requests | status | status | text | nvarchar(max) | no | 'pending' | no | — | no |
| authorization_requests | decided_by | decided_by | text | nvarchar(max) | yes | — | no | — | no |
| authorization_requests | decided_by_name | decided_by_name | text | nvarchar(max) | yes | — | no | — | no |
| authorization_requests | decided_at | decided_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| authorization_requests | decision_note | decision_note | text | nvarchar(max) | yes | — | no | — | no |
| authorization_requests | expires_at | expires_at | timestamptz | datetimeoffset(7) | no | — | no | — | no |
| authorization_requests | consumed_at | consumed_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| authorization_requests | requester_direct_limit | requester_direct_limit | numeric | decimal(38,12) | yes | — | no | — | no |
| authorization_requests | value_unit | value_unit | text | nvarchar(max) | no | 'number' | no | — | no |
| authorization_requests | created_at | created_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| authorization_requests | updated_at | updated_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| authorization_requests | approval_route | approval_route | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| authorization_requests | requested_amount | requested_amount | numeric | decimal(38,12) | yes | — | no | — | no |
| authorization_requests | approved_amount | approved_amount | numeric | decimal(38,12) | yes | — | no | — | no |
| authorization_requests | approved_payload | approved_payload | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| authorization_requests | bill_snapshot | bill_snapshot | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| authorization_requests | snapshot_hash | snapshot_hash | text | nvarchar(max) | no | '' | no | — | no |
| authorization_requests | held_order_id | held_order_id | text | nvarchar(max) | yes | — | no | — | no |
| authorization_requests | notified_at | notified_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| branch_telemetry | terminal_id | terminal_id | text | nvarchar(450) | no | — | yes | — | no |
| branch_telemetry | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| branch_telemetry | terminal_name | terminal_name | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | staff_name | staff_name | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | staff_role | staff_role | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | db_mode | db_mode | text | nvarchar(max) | no | 'online' | no | — | no |
| branch_telemetry | connection_status | connection_status | text | nvarchar(max) | no | 'online' | no | — | no |
| branch_telemetry | storage_engine | storage_engine | text | nvarchar(max) | no | 'cloud' | no | — | no |
| branch_telemetry | pending_count | pending_count | integer | int | no | 0 | no | — | no |
| branch_telemetry | conflict_count | conflict_count | integer | int | no | 0 | no | — | no |
| branch_telemetry | last_synced_at | last_synced_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| branch_telemetry | app_version | app_version | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | platform | platform | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | last_seen_at | last_seen_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| branch_telemetry | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| branch_telemetry | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| branch_telemetry | branch_id | branch_id | text | nvarchar(450) | yes | — | no | — | no |
| branch_telemetry | pending_queue_count | pending_queue_count | integer | int | yes | — | no | — | no |
| branch_telemetry | last_ping | last_ping | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| branch_telemetry | status | status | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | branch_code | branch_code | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | session_status | session_status | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | sql_server_state | sql_server_state | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | database_name | database_name | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | schema_version | schema_version | integer | int | yes | — | no | — | no |
| branch_telemetry | failed_count | failed_count | integer | int | no | 0 | no | — | no |
| branch_telemetry | sync_phase | sync_phase | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | current_table | current_table | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | last_push_at | last_push_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| branch_telemetry | last_pull_at | last_pull_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| branch_telemetry | device_name | device_name | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | device_type | device_type | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | location_name | location_name | text | nvarchar(max) | yes | — | no | — | no |
| branch_telemetry | last_heartbeat_at | last_heartbeat_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| cashiers | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| cashiers | username | username | text | nvarchar(max) | no | — | no | — | no |
| cashiers | full_name | full_name | text | nvarchar(max) | no | '' | no | — | no |
| cashiers | pin_hash | pin_hash | text | nvarchar(max) | no | — | no | — | no |
| cashiers | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| cashiers | permissions | permissions | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| cashiers | is_active | is_active | boolean | bit | no | 1 | no | — | no |
| cashiers | last_login_at | last_login_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| cashiers | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| cashiers | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| cashiers | role_slug | role_slug | text | nvarchar(max) | yes | — | no | — | no |
| cashiers | idle_timeout_minutes | idle_timeout_minutes | integer | int | yes | — | no | — | no |
| change_history | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| change_history | organization_id | organization_id | text | nvarchar(450) | no | 'default' | no | — | no |
| change_history | entity_type | entity_type | text | nvarchar(max) | no | — | no | — | no |
| change_history | entity_id | entity_id | text | nvarchar(max) | no | — | no | — | no |
| change_history | action | action | text | nvarchar(max) | no | — | no | — | no |
| change_history | old_value | old_value | jsonb | nvarchar(max) | yes | — | no | — | no |
| change_history | new_value | new_value | jsonb | nvarchar(max) | yes | — | no | — | no |
| change_history | revision | revision | bigint | bigint | no | — | no | — | no |
| change_history | scope_type | scope_type | text | nvarchar(max) | no | 'GLOBAL' | no | — | no |
| change_history | scope_id | scope_id | text | nvarchar(max) | yes | — | no | — | no |
| change_history | changed_by | changed_by | text | nvarchar(max) | yes | — | no | — | no |
| change_history | source_application | source_application | text | nvarchar(max) | no | 'web' | no | — | no |
| change_history | device_id | device_id | text | nvarchar(max) | yes | — | no | — | no |
| change_history | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| change_history | server_timestamp | server_timestamp | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| coupon_campaigns | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| coupon_campaigns | name | name | text | nvarchar(max) | no | — | no | — | no |
| coupon_campaigns | slug | slug | text | nvarchar(450) | no | — | no | — | yes |
| coupon_campaigns | discount_type | discount_type | text | nvarchar(max) | no | 'PERCENTAGE' | no | — | no |
| coupon_campaigns | discount_value | discount_value | numeric | decimal(38,12) | no | 0 | no | — | no |
| coupon_campaigns | scope | scope | text | nvarchar(max) | no | 'BILL' | no | — | no |
| coupon_campaigns | scope_value | scope_value | text | nvarchar(max) | yes | — | no | — | no |
| coupon_campaigns | max_claims | max_claims | integer | int | yes | — | no | — | no |
| coupon_campaigns | max_per_member | max_per_member | integer | int | yes | 1 | no | — | no |
| coupon_campaigns | claims_count | claims_count | integer | int | no | 0 | no | — | no |
| coupon_campaigns | starts_at | starts_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| coupon_campaigns | expires_at | expires_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| coupon_campaigns | is_active | is_active | boolean | bit | no | 1 | no | — | no |
| coupon_campaigns | is_welcome | is_welcome | boolean | bit | no | 0 | no | — | no |
| coupon_campaigns | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| coupon_campaigns | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| coupon_campaigns | row_version | row_version | integer | int | no | 1 | no | — | no |
| drawer_events | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| drawer_events | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| drawer_events | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| drawer_events | shift_id | shift_id | text | nvarchar(max) | yes | — | no | — | no |
| drawer_events | staff_id | staff_id | text | nvarchar(max) | yes | — | no | — | no |
| drawer_events | staff_name | staff_name | text | nvarchar(max) | yes | — | no | — | no |
| drawer_events | role | role | text | nvarchar(max) | yes | — | no | — | no |
| drawer_events | reason | reason | text | nvarchar(max) | no | — | no | — | no |
| drawer_events | note | note | text | nvarchar(max) | yes | — | no | — | no |
| drawer_events | approved_by | approved_by | text | nvarchar(max) | yes | — | no | — | no |
| drawer_events | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| entity_status_history | id | id | UUID | uniqueidentifier | no | NEWID() | yes | — | no |
| entity_status_history | entity_type | entity_type | TEXT | nvarchar(max) | no | — | no | — | no |
| entity_status_history | entity_id | entity_id | TEXT | nvarchar(max) | no | — | no | — | no |
| entity_status_history | status_kind | status_kind | TEXT | nvarchar(max) | no | 'status' | no | — | no |
| entity_status_history | previous_status | previous_status | TEXT | nvarchar(max) | yes | — | no | — | no |
| entity_status_history | new_status | new_status | TEXT | nvarchar(max) | no | — | no | — | no |
| entity_status_history | reason | reason | TEXT | nvarchar(max) | yes | — | no | — | no |
| entity_status_history | actor_id | actor_id | TEXT | nvarchar(max) | yes | — | no | — | no |
| entity_status_history | actor_name | actor_name | TEXT | nvarchar(max) | yes | — | no | — | no |
| entity_status_history | actor_role | actor_role | TEXT | nvarchar(max) | yes | — | no | — | no |
| entity_status_history | store_id | store_id | TEXT | nvarchar(450) | yes | — | no | — | no |
| entity_status_history | branch_id | branch_id | TEXT | nvarchar(450) | yes | — | no | — | no |
| entity_status_history | terminal_id | terminal_id | TEXT | nvarchar(max) | yes | — | no | — | no |
| entity_status_history | related_entity_type | related_entity_type | TEXT | nvarchar(max) | yes | — | no | — | no |
| entity_status_history | related_entity_id | related_entity_id | TEXT | nvarchar(max) | yes | — | no | — | no |
| entity_status_history | metadata | metadata | JSONB | nvarchar(max) | no | N'{}' | no | — | no |
| entity_status_history | client_event_id | client_event_id | TEXT | nvarchar(450) | yes | — | no | — | yes |
| entity_status_history | occurred_at | occurred_at | TIMESTAMPTZ | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| entity_status_history | created_at | created_at | TIMESTAMPTZ | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| entity_status_history | updated_at | updated_at | TIMESTAMPTZ | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| entity_status_history | row_version | row_version | BIGINT | bigint | no | 1 | no | — | no |
| held_orders | id | id | text | nvarchar(450) | no | NEWID() | yes | — | no |
| held_orders | label | label | text | nvarchar(max) | no | '' | no | — | no |
| held_orders | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| held_orders | shift_id | shift_id | text | nvarchar(max) | yes | — | no | — | no |
| held_orders | held_by | held_by | text | nvarchar(max) | yes | — | no | — | no |
| held_orders | total | total | numeric | decimal(38,12) | no | 0 | no | — | no |
| held_orders | lines | lines | jsonb | nvarchar(max) | no | N'[]' | no | — | no |
| held_orders | cart_discount | cart_discount | numeric | decimal(38,12) | no | 0 | no | — | no |
| held_orders | cart_discount_type | cart_discount_type | text | nvarchar(max) | no | 'amount' | no | — | no |
| held_orders | exchange_ref | exchange_ref | text | nvarchar(max) | yes | — | no | — | no |
| held_orders | member_id | member_id | text | nvarchar(max) | yes | — | no | — | no |
| held_orders | member_name | member_name | text | nvarchar(max) | yes | — | no | — | no |
| held_orders | coupon | coupon | jsonb | nvarchar(max) | yes | — | no | — | no |
| held_orders | note | note | text | nvarchar(max) | no | '' | no | — | no |
| held_orders | cancelled_from | cancelled_from | text | nvarchar(max) | yes | — | no | — | no |
| held_orders | held_at | held_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| held_orders | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| held_orders | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| held_orders | row_version | row_version | integer | int | no | 1 | no | — | no |
| held_orders | status | status | text | nvarchar(max) | no | 'held' | no | — | no |
| held_orders | pending_request_id | pending_request_id | uuid | uniqueidentifier | yes | — | no | — | no |
| held_orders | bill_no | bill_no | text | nvarchar(max) | yes | — | no | — | no |
| integration_settings | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| integration_settings | provider_name | provider_name | text | nvarchar(450) | no | — | no | — | yes |
| integration_settings | api_keys_encrypted | api_keys_encrypted | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| integration_settings | verification_channel | verification_channel | text | nvarchar(max) | no | 'whatsapp' | no | — | no |
| integration_settings | strict_verification | strict_verification | boolean | bit | no | 0 | no | — | no |
| integration_settings | is_active | is_active | boolean | bit | no | 1 | no | — | no |
| integration_settings | updated_by | updated_by | text | nvarchar(max) | yes | — | no | — | no |
| integration_settings | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| integration_settings | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| membership_tiers | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| membership_tiers | name | name | text | nvarchar(450) | no | — | no | — | yes |
| membership_tiers | discount_percentage | discount_percentage | numeric | decimal(38,12) | no | 0 | no | — | no |
| membership_tiers | points_multiplier | points_multiplier | numeric | decimal(38,12) | no | 1.0 | no | — | no |
| membership_tiers | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| membership_tiers | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| membership_tiers | row_version | row_version | integer | int | no | 1 | no | — | no |
| membership_tiers | deleted_at | deleted_at | text | nvarchar(max) | yes | — | no | — | no |
| nav_pins | id | id | uuid | uniqueidentifier | no | — | yes | — | no |
| nav_pins | owner_id | owner_id | uuid | uniqueidentifier | yes | — | no | — | no |
| nav_pins | item_kind | item_kind | text | nvarchar(max) | no | — | no | — | no |
| nav_pins | item_key | item_key | text | nvarchar(max) | no | — | no | — | no |
| nav_pins | sort_order | sort_order | integer | int | no | 0 | no | — | no |
| nav_pins | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| nav_pins | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| offline_sync_audit_log | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| offline_sync_audit_log | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| offline_sync_audit_log | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| offline_sync_audit_log | direction | direction | text | nvarchar(max) | no | — | no | — | no |
| offline_sync_audit_log | table_name | table_name | text | nvarchar(max) | no | — | no | — | no |
| offline_sync_audit_log | record_id | record_id | text | nvarchar(max) | yes | — | no | — | no |
| offline_sync_audit_log | records | records | integer | int | no | 0 | no | — | no |
| offline_sync_audit_log | status | status | text | nvarchar(max) | no | 'ok' | no | — | no |
| offline_sync_audit_log | error_message | error_message | text | nvarchar(max) | yes | — | no | — | no |
| offline_sync_audit_log | started_at | started_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| offline_sync_audit_log | finished_at | finished_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| offline_sync_audit_log | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| payment_types | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| payment_types | name | name | text | nvarchar(max) | no | — | no | — | no |
| payment_types | type_code | type_code | text | nvarchar(450) | no | — | no | — | yes |
| payment_types | requires_reference | requires_reference | boolean | bit | no | 0 | no | — | no |
| payment_types | is_active | is_active | boolean | bit | no | 1 | no | — | no |
| payment_types | icon | icon | text | nvarchar(max) | no | 'Wallet' | no | — | no |
| payment_types | sort_order | sort_order | integer | int | no | 0 | no | — | no |
| payment_types | is_system | is_system | boolean | bit | no | 0 | no | — | no |
| payment_types | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| payment_types | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| payment_types | row_version | row_version | integer | int | no | 1 | no | — | no |
| pin_attempts | key | key | text | nvarchar(450) | no | — | yes | — | no |
| pin_attempts | attempts | attempts | integer | int | no | 0 | no | — | no |
| pin_attempts | window_started_at | window_started_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| pin_attempts | locked_until | locked_until | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| pin_attempts | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| pin_attempts | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| pos_settings | id | id | integer | int | no | 1 | yes | — | no |
| pos_settings | tax_percentage | tax_percentage | numeric | decimal(38,12) | no | 0 | no | — | no |
| pos_settings | enable_tax | enable_tax | boolean | bit | no | 1 | no | — | no |
| pos_settings | tax_mode | tax_mode | text | nvarchar(max) | no | 'exclusive' | no | — | no |
| pos_settings | paper_size | paper_size | text | nvarchar(max) | no | '80mm' | no | — | no |
| pos_settings | header_text | header_text | text | nvarchar(max) | yes | — | no | — | no |
| pos_settings | footer_text | footer_text | text | nvarchar(max) | yes | — | no | — | no |
| pos_settings | show_logo | show_logo | boolean | bit | no | 1 | no | — | no |
| pos_settings | show_points | show_points | boolean | bit | no | 1 | no | — | no |
| pos_settings | show_barcode | show_barcode | boolean | bit | no | 1 | no | — | no |
| pos_settings | show_tax_details | show_tax_details | boolean | bit | no | 1 | no | — | no |
| pos_settings | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| pos_settings | company_name | company_name | text | nvarchar(max) | no | 'RETAIL' | no | — | no |
| pos_settings | tax_number | tax_number | text | nvarchar(max) | yes | — | no | — | no |
| pos_settings | reg_number | reg_number | text | nvarchar(max) | yes | — | no | — | no |
| pos_settings | phone | phone | text | nvarchar(max) | yes | — | no | — | no |
| pos_settings | website | website | text | nvarchar(max) | yes | — | no | — | no |
| pos_settings | fonts | fonts | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| pos_settings | custom_lines | custom_lines | jsonb | nvarchar(max) | no | N'[]' | no | — | no |
| pos_settings | qr | qr | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| pos_settings | ui_visibility | ui_visibility | jsonb | nvarchar(max) | no | N'{"hidden": {}}' | no | — | no |
| pos_settings | integration_settings | integration_settings | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| pos_settings | region_country | region_country | text | nvarchar(max) | no | '' | no | — | no |
| pos_settings | time_zone | time_zone | text | nvarchar(max) | no | '' | no | — | no |
| pos_settings | date_format | date_format | text | nvarchar(max) | no | 'dd/MM/yyyy' | no | — | no |
| pos_settings | time_format | time_format | text | nvarchar(max) | no | '24h' | no | — | no |
| pos_settings | booking_slip | booking_slip | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| pos_settings | notification_settings | notification_settings | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| pos_settings | row_version | row_version | integer | int | no | 1 | no | — | no |
| pos_settings | logo_data_url | logo_data_url | text | nvarchar(max) | yes | — | no | — | no |
| pos_settings | receipt_design | receipt_design | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| pos_settings | payment_details | payment_details | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| pos_settings | whatsapp_settings | whatsapp_settings | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| pos_settings | receipt_css | receipt_css | text | nvarchar(max) | no | '' | no | — | no |
| pos_store_settings | store_id | store_id | text | nvarchar(450) | no | — | yes | — | no |
| pos_store_settings | block_shift_close_on_hold | block_shift_close_on_hold | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_daily_sales_for_shift_close | require_daily_sales_for_shift_close | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_counted_cash_on_close | require_counted_cash_on_close | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_opening_float_count | require_opening_float_count | boolean | bit | yes | — | no | — | no |
| pos_store_settings | enable_blind_cash_count | enable_blind_cash_count | boolean | bit | yes | — | no | — | no |
| pos_store_settings | max_drawer_cash_limit | max_drawer_cash_limit | numeric | decimal(38,12) | yes | — | no | — | no |
| pos_store_settings | require_reason_for_payout | require_reason_for_payout | boolean | bit | yes | — | no | — | no |
| pos_store_settings | allow_multiple_shifts_per_terminal | allow_multiple_shifts_per_terminal | boolean | bit | yes | — | no | — | no |
| pos_store_settings | enable_cashier_x_report | enable_cashier_x_report | boolean | bit | yes | — | no | — | no |
| pos_store_settings | show_opening_float_at_close | show_opening_float_at_close | boolean | bit | yes | — | no | — | no |
| pos_store_settings | show_expected_totals_at_close | show_expected_totals_at_close | boolean | bit | yes | — | no | — | no |
| pos_store_settings | show_live_variance_at_close | show_live_variance_at_close | boolean | bit | yes | — | no | — | no |
| pos_store_settings | show_itemized_tender_breakdown | show_itemized_tender_breakdown | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_manager_pin_on_variance | require_manager_pin_on_variance | boolean | bit | yes | — | no | — | no |
| pos_store_settings | variance_pin_threshold | variance_pin_threshold | numeric | decimal(38,12) | yes | — | no | — | no |
| pos_store_settings | max_cashier_discount_percent | max_cashier_discount_percent | numeric | decimal(38,12) | yes | — | no | — | no |
| pos_store_settings | max_cart_discount_amount | max_cart_discount_amount | numeric | decimal(38,12) | yes | — | no | — | no |
| pos_store_settings | allow_discount_stacking | allow_discount_stacking | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_reason_for_price_override | require_reason_for_price_override | boolean | bit | yes | — | no | — | no |
| pos_store_settings | prevent_below_cost_sale | prevent_below_cost_sale | boolean | bit | yes | — | no | — | no |
| pos_store_settings | allow_tax_exemption | allow_tax_exemption | boolean | bit | yes | — | no | — | no |
| pos_store_settings | prevent_negative_stock_sale | prevent_negative_stock_sale | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_receipt_for_refund | require_receipt_for_refund | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_manager_pin_for_refund | require_manager_pin_for_refund | boolean | bit | yes | — | no | — | no |
| pos_store_settings | max_refund_days_limit | max_refund_days_limit | numeric | decimal(38,12) | yes | — | no | — | no |
| pos_store_settings | track_item_voids | track_item_voids | boolean | bit | yes | — | no | — | no |
| pos_store_settings | auto_lock_timeout_seconds | auto_lock_timeout_seconds | numeric | decimal(38,12) | yes | — | no | — | no |
| pos_store_settings | require_manager_pin_for_cash_drawer_open | require_manager_pin_for_cash_drawer_open | boolean | bit | yes | — | no | — | no |
| pos_store_settings | enable_manager_pin_audit_log | enable_manager_pin_audit_log | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_pin_void_cart | require_pin_void_cart | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_pin_void_line | require_pin_void_line | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_pin_reduce_qty | require_pin_reduce_qty | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_pin_manual_discount | require_pin_manual_discount | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_pin_price_override | require_pin_price_override | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_pin_stock_adjustment | require_pin_stock_adjustment | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_pin_shift_close | require_pin_shift_close | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_pin_edit_tenders | require_pin_edit_tenders | boolean | bit | yes | — | no | — | no |
| pos_store_settings | require_pin_terminal_reset | require_pin_terminal_reset | boolean | bit | yes | — | no | — | no |
| pos_store_settings | row_version | row_version | integer | int | no | 1 | no | — | no |
| pos_store_settings | updated_by | updated_by | text | nvarchar(max) | yes | — | no | — | no |
| pos_store_settings | updated_at | updated_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| pos_store_settings | allow_offline_approvals | allow_offline_approvals | boolean | bit | no | 1 | no | — | no |
| pos_store_settings | offline_approval_requires_pin | offline_approval_requires_pin | boolean | bit | no | 1 | no | — | no |
| pos_store_settings | online_only_void_cart | online_only_void_cart | boolean | bit | no | 0 | no | — | no |
| pos_store_settings | online_only_void_line | online_only_void_line | boolean | bit | no | 0 | no | — | no |
| pos_store_settings | online_only_reduce_qty | online_only_reduce_qty | boolean | bit | no | 0 | no | — | no |
| pos_store_settings | online_only_manual_discount | online_only_manual_discount | boolean | bit | no | 0 | no | — | no |
| pos_store_settings | online_only_price_override | online_only_price_override | boolean | bit | no | 0 | no | — | no |
| pos_store_settings | online_only_stock_adjustment | online_only_stock_adjustment | boolean | bit | no | 0 | no | — | no |
| pos_store_settings | online_only_shift_close | online_only_shift_close | boolean | bit | no | 0 | no | — | no |
| pos_store_settings | online_only_edit_tenders | online_only_edit_tenders | boolean | bit | no | 0 | no | — | no |
| pos_store_settings | online_only_terminal_reset | online_only_terminal_reset | boolean | bit | no | 0 | no | — | no |
| pos_store_settings | online_only_refund | online_only_refund | boolean | bit | no | 0 | no | — | no |
| pos_store_settings | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| pos_store_settings | idle_timeout_minutes | idle_timeout_minutes | integer | int | no | 30 | no | — | no |
| product_categories | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| product_categories | name | name | text | nvarchar(max) | no | — | no | — | no |
| product_categories | parent_id | parent_id | uuid | uniqueidentifier | yes | — | no | product_categories.id | no |
| product_categories | sort | sort | integer | int | no | 0 | no | — | no |
| product_categories | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| product_categories | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| product_categories | kind | kind | text | nvarchar(max) | no | 'category' | no | — | no |
| product_categories | row_version | row_version | integer | int | no | 1 | no | — | no |
| product_categories | is_active | is_active | boolean | bit | no | 1 | no | — | no |
| product_categories | deleted_at | deleted_at | text | nvarchar(max) | yes | — | no | — | no |
| public_flags | key | key | text | nvarchar(450) | no | — | yes | — | no |
| public_flags | enabled | enabled | boolean | bit | no | 1 | no | — | no |
| public_flags | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| record_edits | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| record_edits | record_type | record_type | text | nvarchar(max) | no | — | no | — | no |
| record_edits | record_id | record_id | text | nvarchar(max) | no | — | no | — | no |
| record_edits | reference | reference | text | nvarchar(max) | yes | — | no | — | no |
| record_edits | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| record_edits | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| record_edits | action_key | action_key | text | nvarchar(max) | no | — | no | — | no |
| record_edits | request_id | request_id | uuid | uniqueidentifier | yes | — | no | — | no |
| record_edits | edited_by | edited_by | text | nvarchar(max) | yes | — | no | — | no |
| record_edits | edited_by_name | edited_by_name | text | nvarchar(max) | yes | — | no | — | no |
| record_edits | authorized_by | authorized_by | text | nvarchar(max) | yes | — | no | — | no |
| record_edits | authorized_by_name | authorized_by_name | text | nvarchar(max) | yes | — | no | — | no |
| record_edits | mode_used | mode_used | text | nvarchar(max) | yes | — | no | — | no |
| record_edits | before_value | before_value | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| record_edits | after_value | after_value | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| record_edits | stock_deltas | stock_deltas | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| record_edits | note | note | text | nvarchar(max) | yes | — | no | — | no |
| record_edits | created_at | created_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| secure_settings | key | key | text | nvarchar(450) | no | — | yes | — | no |
| secure_settings | ciphertext | ciphertext | text | nvarchar(max) | no | — | no | — | no |
| secure_settings | hint | hint | text | nvarchar(max) | yes | — | no | — | no |
| secure_settings | updated_by | updated_by | text | nvarchar(max) | yes | — | no | — | no |
| secure_settings | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| secure_settings | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| security_findings | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| security_findings | fingerprint | fingerprint | text | nvarchar(450) | no | — | no | — | yes |
| security_findings | source | source | text | nvarchar(max) | no | — | no | — | no |
| security_findings | severity | severity | text | nvarchar(max) | no | 'medium' | no | — | no |
| security_findings | title | title | text | nvarchar(max) | no | — | no | — | no |
| security_findings | detail | detail | text | nvarchar(max) | no | '' | no | — | no |
| security_findings | deployment_ref | deployment_ref | text | nvarchar(max) | yes | — | no | — | no |
| security_findings | status | status | text | nvarchar(max) | no | 'open' | no | — | no |
| security_findings | first_seen_at | first_seen_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| security_findings | last_seen_at | last_seen_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| security_findings | acknowledged_by | acknowledged_by | text | nvarchar(max) | yes | — | no | — | no |
| security_findings | acknowledged_at | acknowledged_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| security_findings | resolved_at | resolved_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| security_findings | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| security_findings | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| settings_locks | section | section | text | nvarchar(450) | no | — | yes | — | no |
| settings_locks | locked | locked | boolean | bit | no | 0 | no | — | no |
| settings_locks | updated_by | updated_by | text | nvarchar(max) | yes | — | no | — | no |
| settings_locks | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| settings_locks | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| settings_overrides | scope | scope | text | nvarchar(128) | no | 'BRANCH' | yes | — | no |
| settings_overrides | scope_id | scope_id | text | nvarchar(128) | no | '' | yes | — | no |
| settings_overrides | section | section | text | nvarchar(128) | no | — | yes | — | no |
| settings_overrides | patch | patch | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| settings_overrides | updated_by | updated_by | text | nvarchar(max) | yes | — | no | — | no |
| settings_overrides | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| settings_overrides | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| settings_overrides | row_version | row_version | integer | int | no | 1 | no | — | no |
| settings_scoped | scope | scope | text | nvarchar(128) | no | 'GLOBAL' | yes | — | no |
| settings_scoped | scope_id | scope_id | text | nvarchar(128) | no | '' | yes | — | no |
| settings_scoped | key | key | text | nvarchar(128) | no | — | yes | — | no |
| settings_scoped | value | value | jsonb | nvarchar(max) | yes | — | no | — | no |
| settings_scoped | is_overridden | is_overridden | boolean | bit | no | 1 | no | — | no |
| settings_scoped | updated_by | updated_by | text | nvarchar(max) | yes | — | no | — | no |
| settings_scoped | created_at | created_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| settings_scoped | updated_at | updated_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| settings_scoped | row_version | row_version | integer | int | no | 1 | no | — | no |
| shift_sessions | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| shift_sessions | shift_id | shift_id | text | nvarchar(max) | yes | — | no | — | no |
| shift_sessions | store_id | store_id | text | nvarchar(450) | no | — | no | — | no |
| shift_sessions | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| shift_sessions | terminal_name | terminal_name | text | nvarchar(max) | yes | — | no | — | no |
| shift_sessions | staff_id | staff_id | text | nvarchar(max) | yes | — | no | — | no |
| shift_sessions | staff_name | staff_name | text | nvarchar(max) | no | — | no | — | no |
| shift_sessions | role | role | text | nvarchar(max) | yes | — | no | — | no |
| shift_sessions | signed_in_at | signed_in_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| shift_sessions | signed_out_at | signed_out_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| shift_sessions | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| shift_sessions | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| shift_sessions | row_version | row_version | integer | int | no | 1 | no | — | no |
| shifts | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| shifts | store_id | store_id | text | nvarchar(450) | no | — | no | — | no |
| shifts | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| shifts | terminal_name | terminal_name | text | nvarchar(max) | yes | — | no | — | no |
| shifts | opened_by_name | opened_by_name | text | nvarchar(max) | no | 'Cashier' | no | — | no |
| shifts | opened_by_staff_id | opened_by_staff_id | text | nvarchar(max) | yes | — | no | — | no |
| shifts | opened_by_role | opened_by_role | text | nvarchar(max) | yes | — | no | — | no |
| shifts | closed_by_name | closed_by_name | text | nvarchar(max) | yes | — | no | — | no |
| shifts | closed_by_staff_id | closed_by_staff_id | text | nvarchar(max) | yes | — | no | — | no |
| shifts | closed_by_role | closed_by_role | text | nvarchar(max) | yes | — | no | — | no |
| shifts | opened_at | opened_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| shifts | closed_at | closed_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| shifts | opening_float | opening_float | numeric | decimal(38,12) | no | 0 | no | — | no |
| shifts | counted_cash | counted_cash | numeric | decimal(38,12) | yes | — | no | — | no |
| shifts | expected_cash | expected_cash | numeric | decimal(38,12) | yes | — | no | — | no |
| shifts | note | note | text | nvarchar(max) | no | '' | no | — | no |
| shifts | overdue | overdue | boolean | bit | no | 0 | no | — | no |
| shifts | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| shifts | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| shifts | status | status | text | nvarchar(max) | no | 'OPEN' | no | — | no |
| shifts | closing_float | closing_float | numeric | decimal(38,12) | yes | — | no | — | no |
| shifts | user_id | user_id | uuid | uniqueidentifier | yes | — | no | — | no |
| shifts | row_version | row_version | integer | int | no | 1 | no | — | no |
| shifts | counted_card | counted_card | numeric | decimal(38,12) | yes | — | no | — | no |
| shifts | counted_digital | counted_digital | numeric | decimal(38,12) | yes | — | no | — | no |
| shifts | expected_card | expected_card | numeric | decimal(38,12) | yes | — | no | — | no |
| shifts | expected_digital | expected_digital | numeric | decimal(38,12) | yes | — | no | — | no |
| shifts | variance_cash | variance_cash | numeric | decimal(38,12) | yes | — | no | — | no |
| shifts | variance_card | variance_card | numeric | decimal(38,12) | yes | — | no | — | no |
| shifts | variance_digital | variance_digital | numeric | decimal(38,12) | yes | — | no | — | no |
| shifts | variance_total | variance_total | numeric | decimal(38,12) | yes | — | no | — | no |
| shifts | state | state | text | nvarchar(max) | no | 'ACTIVE' | no | — | no |
| shifts | close_reason | close_reason | text | nvarchar(max) | yes | — | no | — | no |
| shifts | closing_started_at | closing_started_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| shifts | closing_started_by | closing_started_by | text | nvarchar(max) | yes | — | no | — | no |
| shifts | final_counted_cash | final_counted_cash | numeric | decimal(38,12) | yes | — | no | — | no |
| shifts | variance_status | variance_status | text | nvarchar(max) | yes | — | no | — | no |
| sku_audit | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| sku_audit | sku | sku | text | nvarchar(max) | no | — | no | — | no |
| sku_audit | product_id | product_id | uuid | uniqueidentifier | yes | — | no | — | no |
| sku_audit | product_name | product_name | text | nvarchar(max) | yes | — | no | — | no |
| sku_audit | source | source | text | nvarchar(max) | no | 'auto' | no | — | no |
| sku_audit | previous_sku | previous_sku | text | nvarchar(max) | yes | — | no | — | no |
| sku_audit | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| sku_audit | store_name | store_name | text | nvarchar(max) | yes | — | no | — | no |
| sku_audit | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| sku_audit | staff_id | staff_id | text | nvarchar(max) | yes | — | no | — | no |
| sku_audit | staff_name | staff_name | text | nvarchar(max) | yes | — | no | — | no |
| sku_audit | role | role | text | nvarchar(max) | yes | — | no | — | no |
| sku_audit | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| staff_roles | slug | slug | text | nvarchar(450) | no | — | yes | — | no |
| staff_roles | name | name | text | nvarchar(max) | no | — | no | — | no |
| staff_roles | base_level | base_level | text | nvarchar(max) | no | 'cashier' | no | — | no |
| staff_roles | permissions | permissions | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| staff_roles | is_core | is_core | boolean | bit | no | 0 | no | — | no |
| staff_roles | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| staff_roles | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| stock_count_drafts | id | id | UUID | uniqueidentifier | no | — | yes | — | no |
| stock_count_drafts | store_id | store_id | TEXT | nvarchar(450) | yes | — | no | — | no |
| stock_count_drafts | terminal_id | terminal_id | TEXT | nvarchar(max) | yes | — | no | — | no |
| stock_count_drafts | staff_id | staff_id | TEXT | nvarchar(max) | yes | — | no | — | no |
| stock_count_drafts | staff_name | staff_name | TEXT | nvarchar(max) | yes | — | no | — | no |
| stock_count_drafts | status | status | TEXT | nvarchar(max) | no | 'draft' | no | — | no |
| stock_count_drafts | reason | reason | TEXT | nvarchar(max) | yes | — | no | — | no |
| stock_count_drafts | note | note | TEXT | nvarchar(max) | no | '' | no | — | no |
| stock_count_drafts | lines | lines | JSONB | nvarchar(max) | no | N'[]' | no | — | no |
| stock_count_drafts | line_count | line_count | INTEGER | int | no | 0 | no | — | no |
| stock_count_drafts | total_impact | total_impact | NUMERIC(18,4) | decimal(18,4) | no | 0 | no | — | no |
| stock_count_drafts | posted_at | posted_at | TIMESTAMPTZ | datetimeoffset(7) | yes | — | no | — | no |
| stock_count_drafts | posted_by | posted_by | TEXT | nvarchar(max) | yes | — | no | — | no |
| stock_count_drafts | created_at | created_at | TIMESTAMPTZ | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| stock_count_drafts | updated_at | updated_at | TIMESTAMPTZ | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| stock_count_drafts | reference | reference | text | nvarchar(450) | yes | — | no | — | yes |
| stock_count_drafts | store_code | store_code | text | nvarchar(max) | yes | — | no | — | no |
| stock_count_drafts | pending_edit_request_id | pending_edit_request_id | uuid | uniqueidentifier | yes | — | no | — | no |
| stock_count_drafts | pending_edit_by | pending_edit_by | text | nvarchar(max) | yes | — | no | — | no |
| stock_count_drafts | pending_edit_at | pending_edit_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| stock_delta_applied | movement_id | movement_id | uuid | uniqueidentifier | no | — | yes | — | no |
| stock_delta_applied | product_id | product_id | uuid | uniqueidentifier | yes | — | no | — | no |
| stock_delta_applied | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| stock_delta_applied | delta | delta | integer | int | no | 0 | no | — | no |
| stock_delta_applied | applied_at | applied_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| stock_transfers | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| stock_transfers | ref | ref | text | nvarchar(450) | no | — | no | — | yes |
| stock_transfers | kind | kind | text | nvarchar(max) | no | 'transfer' | no | — | no |
| stock_transfers | transfer_scope | transfer_scope | text | nvarchar(max) | no | 'INTRA_GROUP' | no | — | no |
| stock_transfers | from_store_id | from_store_id | text | nvarchar(max) | no | — | no | — | no |
| stock_transfers | from_store_name | from_store_name | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | from_group_id | from_group_id | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | to_store_id | to_store_id | text | nvarchar(max) | no | — | no | — | no |
| stock_transfers | to_store_name | to_store_name | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | to_group_id | to_group_id | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | status | status | text | nvarchar(max) | no | 'pending' | no | — | no |
| stock_transfers | note | note | text | nvarchar(max) | no | '' | no | — | no |
| stock_transfers | created_by | created_by | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | approved_by | approved_by | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | approved_at | approved_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| stock_transfers | received_by | received_by | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | received_at | received_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| stock_transfers | rejected_reason | rejected_reason | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| stock_transfers | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| stock_transfers | row_version | row_version | integer | int | no | 1 | no | — | no |
| stock_transfers | verified_by | verified_by | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | verified_at | verified_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| stock_transfers | posted_at | posted_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| stock_transfers | discrepancy_reason | discrepancy_reason | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | rejected_by | rejected_by | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | cancelled_reason | cancelled_reason | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | dispatched_by | dispatched_by | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | dispatched_at | dispatched_at | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | closed_at | closed_at | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | fulfilment | fulfilment | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfers | source_request_id | source_request_id | uuid | uniqueidentifier | yes | — | no | stock_transfers.id | no |
| store_groups | id | id | text | nvarchar(450) | no | — | yes | — | no |
| store_groups | code | code | text | nvarchar(max) | no | — | no | — | no |
| store_groups | name | name | text | nvarchar(max) | no | — | no | — | no |
| store_groups | is_active | is_active | boolean | bit | no | 1 | no | — | no |
| store_groups | archived_at | archived_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| store_groups | created_at | created_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| store_groups | updated_at | updated_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| suppliers | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| suppliers | name | name | text | nvarchar(max) | no | — | no | — | no |
| suppliers | contact_name | contact_name | text | nvarchar(max) | yes | — | no | — | no |
| suppliers | phone | phone | text | nvarchar(max) | yes | — | no | — | no |
| suppliers | email | email | text | nvarchar(max) | yes | — | no | — | no |
| suppliers | address | address | text | nvarchar(max) | yes | — | no | — | no |
| suppliers | tax_number | tax_number | text | nvarchar(max) | yes | — | no | — | no |
| suppliers | notes | notes | text | nvarchar(max) | yes | — | no | — | no |
| suppliers | is_active | is_active | boolean | bit | no | 1 | no | — | no |
| suppliers | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| suppliers | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| suppliers | row_version | row_version | integer | int | no | 1 | no | — | no |
| suppliers | deleted_at | deleted_at | text | nvarchar(max) | yes | — | no | — | no |
| sync_metadata | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| sync_metadata | store_id | store_id | text | nvarchar(128) | yes | — | no | — | no |
| sync_metadata | terminal_id | terminal_id | text | nvarchar(128) | yes | — | no | — | no |
| sync_metadata | table_name | table_name | text | nvarchar(128) | no | — | no | — | no |
| sync_metadata | last_synced_at | last_synced_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| sync_metadata | last_pushed_at | last_pushed_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| sync_metadata | rows_pushed | rows_pushed | integer | int | no | 0 | no | — | no |
| sync_metadata | last_error | last_error | text | nvarchar(max) | yes | — | no | — | no |
| sync_metadata | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| sync_metadata | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| system_audit_logs | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| system_audit_logs | actor_id | actor_id | text | nvarchar(max) | yes | — | no | — | no |
| system_audit_logs | actor_name | actor_name | text | nvarchar(max) | yes | — | no | — | no |
| system_audit_logs | actor_role | actor_role | text | nvarchar(max) | yes | — | no | — | no |
| system_audit_logs | action_type | action_type | text | nvarchar(max) | no | — | no | — | no |
| system_audit_logs | entity_affected | entity_affected | text | nvarchar(max) | yes | — | no | — | no |
| system_audit_logs | entity_id | entity_id | text | nvarchar(max) | yes | — | no | — | no |
| system_audit_logs | old_value | old_value | jsonb | nvarchar(max) | yes | — | no | — | no |
| system_audit_logs | new_value | new_value | jsonb | nvarchar(max) | yes | — | no | — | no |
| system_audit_logs | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| system_audit_logs | ip_address | ip_address | text | nvarchar(max) | yes | — | no | — | no |
| system_audit_logs | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| system_audit_logs | note | note | text | nvarchar(max) | yes | — | no | — | no |
| system_audit_logs | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| terminal_commands | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| terminal_commands | terminal_id | terminal_id | text | nvarchar(max) | no | — | no | — | no |
| terminal_commands | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| terminal_commands | command | command | text | nvarchar(max) | no | — | no | — | no |
| terminal_commands | status | status | text | nvarchar(max) | no | 'pending' | no | — | no |
| terminal_commands | note | note | text | nvarchar(max) | yes | — | no | — | no |
| terminal_commands | result | result | text | nvarchar(max) | yes | — | no | — | no |
| terminal_commands | issued_by | issued_by | text | nvarchar(max) | yes | — | no | — | no |
| terminal_commands | issued_role | issued_role | text | nvarchar(max) | yes | — | no | — | no |
| terminal_commands | picked_up_at | picked_up_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| terminal_commands | finished_at | finished_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| terminal_commands | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| terminal_commands | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| terminal_recovery_secrets | terminal_token_id | terminal_token_id | uuid | uniqueidentifier | no | — | yes | — | no |
| terminal_recovery_secrets | sealed_secret | sealed_secret | text | nvarchar(max) | no | — | no | — | no |
| terminal_recovery_secrets | fingerprint | fingerprint | text | nvarchar(max) | no | — | no | — | no |
| terminal_recovery_secrets | platform | platform | text | nvarchar(max) | no | 'unknown' | no | — | no |
| terminal_recovery_secrets | device_name | device_name | text | nvarchar(max) | yes | — | no | — | no |
| terminal_recovery_secrets | utc_offset_minutes | utc_offset_minutes | integer | int | no | 0 | no | — | no |
| terminal_recovery_secrets | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| terminal_recovery_secrets | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| uom_units | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| uom_units | code | code | text | nvarchar(450) | no | — | no | — | yes |
| uom_units | name | name | text | nvarchar(max) | no | — | no | — | no |
| uom_units | allow_decimal | allow_decimal | boolean | bit | no | 0 | no | — | no |
| uom_units | sort | sort | integer | int | no | 0 | no | — | no |
| uom_units | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| uom_units | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| uom_units | row_version | row_version | integer | int | no | 1 | no | — | no |
| uom_units | is_active | is_active | boolean | bit | no | 1 | no | — | no |
| uom_units | deleted_at | deleted_at | text | nvarchar(max) | yes | — | no | — | no |
| user_roles | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| user_roles | user_id | user_id | uuid | uniqueidentifier | no | — | no | — | no |
| user_roles | role | role | public.app_role | nvarchar(128) | no | — | no | — | no |
| user_roles | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| whatsapp_queue | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| whatsapp_queue | phone_number_id | phone_number_id | text | nvarchar(max) | no | '' | no | — | no |
| whatsapp_queue | recipient | recipient | text | nvarchar(max) | no | — | no | — | no |
| whatsapp_queue | body | body | text | nvarchar(max) | no | '' | no | — | no |
| whatsapp_queue | reference | reference | text | nvarchar(max) | yes | — | no | — | no |
| whatsapp_queue | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| whatsapp_queue | status | status | text | nvarchar(max) | no | 'QUEUED' | no | — | no |
| whatsapp_queue | error | error | text | nvarchar(max) | yes | — | no | — | no |
| whatsapp_queue | queued_at | queued_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| whatsapp_queue | sent_at | sent_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| whatsapp_queue | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| whatsapp_queue | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| members | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| members | member_code | member_code | text | nvarchar(450) | no | — | no | — | yes |
| members | full_name | full_name | text | nvarchar(max) | no | — | no | — | no |
| members | phone | phone | text | nvarchar(450) | no | — | no | — | yes |
| members | email | email | text | nvarchar(max) | yes | — | no | — | no |
| members | address | address | text | nvarchar(max) | yes | — | no | — | no |
| members | country_code | country_code | text | nvarchar(max) | yes | — | no | — | no |
| members | postal_code | postal_code | text | nvarchar(max) | yes | — | no | — | no |
| members | date_of_birth | date_of_birth | date | date | yes | — | no | — | no |
| members | tier_id | tier_id | uuid | uniqueidentifier | yes | — | no | membership_tiers.id | no |
| members | loyalty_points | loyalty_points | numeric | decimal(38,12) | no | 0 | no | — | no |
| members | total_spent | total_spent | numeric | decimal(38,12) | no | 0 | no | — | no |
| members | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| members | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| members | row_version | row_version | integer | int | no | 1 | no | — | no |
| members | is_verified | is_verified | boolean | bit | no | 0 | no | — | no |
| members | verified_at | verified_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| members | verified_channel | verified_channel | text | nvarchar(max) | yes | — | no | — | no |
| members | membership_member_id | membership_member_id | uuid | uniqueidentifier | yes | — | no | — | no |
| members | membership_revision | membership_revision | bigint | bigint | no | 0 | no | — | no |
| members | membership_status | membership_status | text | nvarchar(max) | no | 'active' | no | — | no |
| members | deleted_at | deleted_at | text | nvarchar(max) | yes | — | no | — | no |
| purchase_orders | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| purchase_orders | po_number | po_number | text | nvarchar(450) | no | — | no | — | yes |
| purchase_orders | supplier_name | supplier_name | text | nvarchar(max) | yes | — | no | — | no |
| purchase_orders | operator_name | operator_name | text | nvarchar(max) | yes | — | no | — | no |
| purchase_orders | total_cost | total_cost | numeric | decimal(38,12) | no | 0 | no | — | no |
| purchase_orders | total_items_count | total_items_count | integer | int | no | 0 | no | — | no |
| purchase_orders | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| purchase_orders | supplier_id | supplier_id | uuid | uniqueidentifier | yes | — | no | suppliers.id | no |
| purchase_orders | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| purchase_orders | store_code | store_code | text | nvarchar(max) | yes | — | no | — | no |
| purchase_orders | invoice_date | invoice_date | date | date | yes | — | no | — | no |
| purchase_orders | invoice_entry_date | invoice_entry_date | timestamp with time zone | datetimeoffset(7) | yes | SYSDATETIMEOFFSET() | no | — | no |
| purchase_orders | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| purchase_orders | row_version | row_version | integer | int | no | 1 | no | — | no |
| purchase_orders | pending_edit_request_id | pending_edit_request_id | uuid | uniqueidentifier | yes | — | no | — | no |
| purchase_orders | pending_edit_by | pending_edit_by | text | nvarchar(max) | yes | — | no | — | no |
| purchase_orders | pending_edit_at | pending_edit_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| purchase_orders | status | status | text | nvarchar(max) | no | 'posted' | no | — | no |
| purchase_orders | reference | reference | text | nvarchar(max) | yes | — | no | — | no |
| shift_cash_counts | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| shift_cash_counts | shift_id | shift_id | uuid | uniqueidentifier | no | — | no | shifts.id | yes |
| shift_cash_counts | store_id | store_id | text | nvarchar(450) | no | — | no | — | no |
| shift_cash_counts | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| shift_cash_counts | kind | kind | text | nvarchar(max) | no | 'ORIGINAL' | no | — | no |
| shift_cash_counts | counted_cash | counted_cash | numeric | decimal(38,12) | no | — | no | — | no |
| shift_cash_counts | counted_card | counted_card | numeric | decimal(38,12) | yes | — | no | — | no |
| shift_cash_counts | counted_digital | counted_digital | numeric | decimal(38,12) | yes | — | no | — | no |
| shift_cash_counts | reason | reason | text | nvarchar(max) | yes | — | no | — | no |
| shift_cash_counts | counted_by_name | counted_by_name | text | nvarchar(max) | yes | — | no | — | no |
| shift_cash_counts | counted_by_staff_id | counted_by_staff_id | text | nvarchar(max) | yes | — | no | — | no |
| shift_cash_counts | counted_by_user_id | counted_by_user_id | uuid | uniqueidentifier | yes | — | no | — | no |
| shift_cash_counts | client_key | client_key | text | nvarchar(450) | yes | — | no | — | yes |
| shift_cash_counts | created_at | created_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| shift_close_events | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| shift_close_events | shift_id | shift_id | uuid | uniqueidentifier | no | — | no | shifts.id | no |
| shift_close_events | store_id | store_id | text | nvarchar(450) | no | — | no | — | no |
| shift_close_events | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| shift_close_events | event | event | text | nvarchar(max) | no | — | no | — | no |
| shift_close_events | from_state | from_state | text | nvarchar(max) | yes | — | no | — | no |
| shift_close_events | to_state | to_state | text | nvarchar(max) | yes | — | no | — | no |
| shift_close_events | detail | detail | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| shift_close_events | actor_name | actor_name | text | nvarchar(max) | yes | — | no | — | no |
| shift_close_events | actor_staff_id | actor_staff_id | text | nvarchar(max) | yes | — | no | — | no |
| shift_close_events | actor_user_id | actor_user_id | uuid | uniqueidentifier | yes | — | no | — | no |
| shift_close_events | created_at | created_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| shift_notifications | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| shift_notifications | shift_id | shift_id | uuid | uniqueidentifier | no | — | no | shifts.id | yes |
| shift_notifications | store_id | store_id | text | nvarchar(450) | no | — | no | — | no |
| shift_notifications | store_name | store_name | text | nvarchar(max) | no | '' | no | — | no |
| shift_notifications | terminal_name | terminal_name | text | nvarchar(max) | no | '' | no | — | no |
| shift_notifications | closed_by | closed_by | text | nvarchar(max) | no | '' | no | — | no |
| shift_notifications | opened_at | opened_at | timestamptz | datetimeoffset(7) | no | — | no | — | no |
| shift_notifications | closed_at | closed_at | timestamptz | datetimeoffset(7) | no | — | no | — | no |
| shift_notifications | total_sales | total_sales | numeric | decimal(38,12) | no | 0 | no | — | no |
| shift_notifications | transactions | transactions | integer | int | no | 0 | no | — | no |
| shift_notifications | discounts | discounts | numeric | decimal(38,12) | no | 0 | no | — | no |
| shift_notifications | refunds | refunds | numeric | decimal(38,12) | no | 0 | no | — | no |
| shift_notifications | expected_cash | expected_cash | numeric | decimal(38,12) | no | 0 | no | — | no |
| shift_notifications | counted_cash | counted_cash | numeric | decimal(38,12) | no | 0 | no | — | no |
| shift_notifications | payment_breakdown | payment_breakdown | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| shift_notifications | summary | summary | text | nvarchar(max) | no | '' | no | — | no |
| shift_notifications | channels | channels | text[] | nvarchar(max) | no | N'[]' | no | — | no |
| shift_notifications | created_at | created_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| stores | id | id | text | nvarchar(450) | no | — | yes | — | no |
| stores | code | code | text | nvarchar(max) | no | — | no | — | no |
| stores | name | name | text | nvarchar(max) | no | — | no | — | no |
| stores | address | address | text | nvarchar(max) | yes | — | no | — | no |
| stores | phone | phone | text | nvarchar(max) | yes | — | no | — | no |
| stores | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| stores | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| stores | group_id | group_id | text | nvarchar(450) | yes | — | no | store_groups.id | no |
| stores | row_version | row_version | integer | int | no | 1 | no | — | no |
| stores | location_type | location_type | text | nvarchar(max) | no | 'store' | no | — | no |
| stores | parent_id | parent_id | text | nvarchar(450) | yes | — | no | stores.id | no |
| stores | is_central | is_central | boolean | bit | no | 0 | no | — | no |
| stores | building_name | building_name | text | nvarchar(max) | yes | — | no | — | no |
| stores | floor_label | floor_label | text | nvarchar(max) | yes | — | no | — | no |
| stores | is_active | is_active | boolean | bit | no | 1 | no | — | no |
| stores | archived_at | archived_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| stores | is_primary_sub | is_primary_sub | boolean | bit | no | 0 | no | — | no |
| stores | private_catalogue | private_catalogue | boolean | bit | no | 0 | no | — | no |
| stores | receipt_prefix | receipt_prefix | text | nvarchar(max) | yes | — | no | — | no |
| stores | deleted_at | deleted_at | text | nvarchar(max) | yes | — | no | — | no |
| bookings | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| bookings | ref | ref | text | nvarchar(450) | no | — | no | — | yes |
| bookings | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| bookings | shift_id | shift_id | text | nvarchar(max) | yes | — | no | — | no |
| bookings | customer_name | customer_name | text | nvarchar(max) | no | '' | no | — | no |
| bookings | customer_phone | customer_phone | text | nvarchar(max) | no | '' | no | — | no |
| bookings | member_id | member_id | uuid | uniqueidentifier | yes | — | no | members.id | no |
| bookings | service_type_id | service_type_id | text | nvarchar(max) | yes | — | no | — | no |
| bookings | service_name | service_name | text | nvarchar(max) | yes | — | no | — | no |
| bookings | service_fee | service_fee | numeric | decimal(38,12) | no | 0 | no | — | no |
| bookings | payment_timing | payment_timing | text | nvarchar(max) | yes | — | no | — | no |
| bookings | lines | lines | jsonb | nvarchar(max) | no | N'[]' | no | — | no |
| bookings | subtotal | subtotal | numeric | decimal(38,12) | no | 0 | no | — | no |
| bookings | discount | discount | numeric | decimal(38,12) | no | 0 | no | — | no |
| bookings | tax | tax | numeric | decimal(38,12) | no | 0 | no | — | no |
| bookings | total | total | numeric | decimal(38,12) | no | 0 | no | — | no |
| bookings | paid | paid | numeric | decimal(38,12) | no | 0 | no | — | no |
| bookings | due_date | due_date | date | date | yes | — | no | — | no |
| bookings | note | note | text | nvarchar(max) | no | '' | no | — | no |
| bookings | cashier | cashier | text | nvarchar(max) | yes | — | no | — | no |
| bookings | status | status | text | nvarchar(max) | no | 'active' | no | — | no |
| bookings | sale_receipt_no | sale_receipt_no | text | nvarchar(max) | yes | — | no | — | no |
| bookings | closed_at | closed_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| bookings | racket_model | racket_model | text | nvarchar(max) | yes | — | no | — | no |
| bookings | string_type | string_type | text | nvarchar(max) | yes | — | no | — | no |
| bookings | tension_main | tension_main | numeric | decimal(38,12) | yes | — | no | — | no |
| bookings | tension_cross | tension_cross | numeric | decimal(38,12) | yes | — | no | — | no |
| bookings | tension_unit | tension_unit | text | nvarchar(max) | no | 'lb' | no | — | no |
| bookings | grommet_notes | grommet_notes | text | nvarchar(max) | yes | — | no | — | no |
| bookings | job_notes | job_notes | text | nvarchar(max) | yes | — | no | — | no |
| bookings | dropped_off_at | dropped_off_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| bookings | promised_at | promised_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| bookings | job_status | job_status | text | nvarchar(max) | no | 'received' | no | — | no |
| bookings | job_status_by | job_status_by | text | nvarchar(max) | yes | — | no | — | no |
| bookings | job_status_at | job_status_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| bookings | notify_whatsapp | notify_whatsapp | boolean | bit | no | 0 | no | — | no |
| bookings | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| bookings | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| bookings | tag_id | tag_id | text | nvarchar(max) | yes | — | no | — | no |
| bookings | intake_note | intake_note | text | nvarchar(max) | yes | — | no | — | no |
| bookings | string_origin | string_origin | text | nvarchar(max) | yes | — | no | — | no |
| bookings | string_source_product_id | string_source_product_id | uuid | uniqueidentifier | yes | — | no | — | no |
| bookings | grip_product_id | grip_product_id | uuid | uniqueidentifier | yes | — | no | — | no |
| bookings | charges | charges | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| bookings | technician | technician | text | nvarchar(max) | yes | — | no | — | no |
| bookings | liability_accepted | liability_accepted | boolean | bit | no | 0 | no | — | no |
| bookings | incident_note | incident_note | text | nvarchar(max) | yes | — | no | — | no |
| bookings | row_version | row_version | integer | int | no | 1 | no | — | no |
| bookings | cancel_reason | cancel_reason | text | nvarchar(max) | yes | — | no | — | no |
| bookings | cancelled_by | cancelled_by | text | nvarchar(max) | yes | — | no | — | no |
| bookings | cancelled_at | cancelled_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| bookings | cancelled_terminal | cancelled_terminal | text | nvarchar(max) | yes | — | no | — | no |
| bookings | cancel_money_action | cancel_money_action | text | nvarchar(max) | yes | — | no | — | no |
| bookings | booking_ref | booking_ref | text | nvarchar(max) | yes | — | no | — | no |
| coupon_events | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| coupon_events | event_type | event_type | text | nvarchar(max) | no | — | no | — | no |
| coupon_events | campaign_id | campaign_id | uuid | uniqueidentifier | yes | — | no | coupon_campaigns.id | no |
| coupon_events | campaign_name | campaign_name | text | nvarchar(max) | yes | — | no | — | no |
| coupon_events | voucher_token | voucher_token | text | nvarchar(max) | yes | — | no | — | no |
| coupon_events | member_id | member_id | uuid | uniqueidentifier | yes | — | no | members.id | no |
| coupon_events | member_phone | member_phone | text | nvarchar(max) | yes | — | no | — | no |
| coupon_events | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| coupon_events | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| coupon_events | staff_name | staff_name | text | nvarchar(max) | yes | — | no | — | no |
| coupon_events | staff_role | staff_role | text | nvarchar(max) | yes | — | no | — | no |
| coupon_events | sale_id | sale_id | text | nvarchar(max) | yes | — | no | — | no |
| coupon_events | note | note | text | nvarchar(max) | yes | — | no | — | no |
| coupon_events | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| issued_vouchers | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| issued_vouchers | token_slug | token_slug | text | nvarchar(450) | no | — | no | — | yes |
| issued_vouchers | campaign_id | campaign_id | uuid | uniqueidentifier | no | — | no | coupon_campaigns.id | no |
| issued_vouchers | member_id | member_id | uuid | uniqueidentifier | yes | — | no | members.id | no |
| issued_vouchers | status | status | text | nvarchar(max) | no | 'ISSUED' | no | — | no |
| issued_vouchers | issued_at | issued_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| issued_vouchers | expires_at | expires_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| issued_vouchers | issued_by | issued_by | text | nvarchar(max) | yes | — | no | — | no |
| issued_vouchers | issued_source | issued_source | text | nvarchar(max) | no | 'PUBLIC' | no | — | no |
| issued_vouchers | redeemed_at | redeemed_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| issued_vouchers | redeemed_by | redeemed_by | text | nvarchar(max) | yes | — | no | — | no |
| issued_vouchers | redeemed_sale_id | redeemed_sale_id | text | nvarchar(max) | yes | — | no | — | no |
| issued_vouchers | disabled_at | disabled_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| issued_vouchers | disabled_by | disabled_by | text | nvarchar(max) | yes | — | no | — | no |
| issued_vouchers | disable_reason | disable_reason | text | nvarchar(max) | yes | — | no | — | no |
| issued_vouchers | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| issued_vouchers | row_version | row_version | integer | int | no | 1 | no | — | no |
| member_verifications | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| member_verifications | member_id | member_id | uuid | uniqueidentifier | yes | — | no | members.id | no |
| member_verifications | phone | phone | text | nvarchar(max) | yes | — | no | — | no |
| member_verifications | email | email | text | nvarchar(max) | yes | — | no | — | no |
| member_verifications | channel | channel | text | nvarchar(max) | no | 'whatsapp' | no | — | no |
| member_verifications | otp_code | otp_code | text | nvarchar(max) | yes | — | no | — | no |
| member_verifications | attempts | attempts | integer | int | no | 0 | no | — | no |
| member_verifications | status | status | text | nvarchar(max) | no | 'pending' | no | — | no |
| member_verifications | sent_by | sent_by | text | nvarchar(max) | yes | — | no | — | no |
| member_verifications | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| member_verifications | expires_at | expires_at | timestamp with time zone | datetimeoffset(7) | no | — | no | — | no |
| member_verifications | verified_at | verified_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| member_verifications | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| products | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| products | barcode | barcode | text | nvarchar(450) | no | — | no | — | yes |
| products | name | name | text | nvarchar(max) | no | — | no | — | no |
| products | category | category | text | nvarchar(max) | yes | — | no | — | no |
| products | cost_price | cost_price | numeric | decimal(38,12) | no | 0 | no | — | no |
| products | selling_price | selling_price | numeric | decimal(38,12) | no | 0 | no | — | no |
| products | ecom_price | ecom_price | numeric | decimal(38,12) | yes | — | no | — | no |
| products | stock_quantity | stock_quantity | integer | int | no | 0 | no | — | no |
| products | custom_points | custom_points | numeric | decimal(38,12) | yes | — | no | — | no |
| products | point_multiplier | point_multiplier | numeric | decimal(38,12) | no | 1.0 | no | — | no |
| products | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| products | sku | sku | text | nvarchar(max) | yes | — | no | — | no |
| products | reorder_level | reorder_level | integer | int | no | 0 | no | — | no |
| products | tax_rate | tax_rate | numeric | decimal(38,12) | no | 0 | no | — | no |
| products | ecom_visible | ecom_visible | boolean | bit | no | 1 | no | — | no |
| products | stock_by_store | stock_by_store | jsonb | nvarchar(max) | no | N'{}' | no | — | no |
| products | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| products | landing_pct | landing_pct | numeric | decimal(38,12) | yes | — | no | — | no |
| products | sub_category | sub_category | text | nvarchar(max) | yes | — | no | — | no |
| products | unit | unit | text | nvarchar(max) | yes | — | no | — | no |
| products | packs | packs | jsonb | nvarchar(max) | no | N'[]' | no | — | no |
| products | barcode_aliases | barcode_aliases | text[] | nvarchar(max) | no | N'[]' | no | — | no |
| products | is_archived | is_archived | boolean | bit | no | 0 | no | — | no |
| products | archived_at | archived_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| products | brand | brand | text | nvarchar(max) | yes | — | no | — | no |
| products | product_group | product_group | text | nvarchar(max) | yes | — | no | — | no |
| products | barcode_variants | barcode_variants | jsonb | nvarchar(max) | no | N'[]' | no | — | no |
| products | row_version | row_version | integer | int | no | 0 | no | — | no |
| products | owner_store_id | owner_store_id | text | nvarchar(450) | yes | — | no | stores.id | no |
| products | deleted_at | deleted_at | text | nvarchar(max) | yes | — | no | — | no |
| sales | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| sales | bill_number | bill_number | text | nvarchar(450) | no | — | no | — | yes |
| sales | member_id | member_id | uuid | uniqueidentifier | yes | — | no | members.id | no |
| sales | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| sales | cashier_name | cashier_name | text | nvarchar(max) | yes | — | no | — | no |
| sales | subtotal_amount | subtotal_amount | numeric | decimal(38,12) | no | 0 | no | — | no |
| sales | total_amount | total_amount | numeric | decimal(38,12) | no | 0 | no | — | no |
| sales | discount_amount | discount_amount | numeric | decimal(38,12) | no | 0 | no | — | no |
| sales | tax_amount | tax_amount | numeric | decimal(38,12) | no | 0 | no | — | no |
| sales | payment_type | payment_type | text | nvarchar(max) | no | 'cash' | no | — | no |
| sales | points_earned | points_earned | numeric | decimal(38,12) | no | 0 | no | — | no |
| sales | points_redeemed | points_redeemed | numeric | decimal(38,12) | no | 0 | no | — | no |
| sales | is_exchange | is_exchange | boolean | bit | no | 0 | no | — | no |
| sales | original_bill_number | original_bill_number | text | nvarchar(max) | yes | — | no | — | no |
| sales | is_refunded | is_refunded | boolean | bit | no | 0 | no | — | no |
| sales | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| sales | shift_id | shift_id | text | nvarchar(max) | yes | — | no | — | no |
| sales | paid_amount | paid_amount | numeric | decimal(38,12) | no | 0 | no | — | no |
| sales | change_amount | change_amount | numeric | decimal(38,12) | no | 0 | no | — | no |
| sales | exchange_credit | exchange_credit | numeric | decimal(38,12) | no | 0 | no | — | no |
| sales | exchanged_to_bill_number | exchanged_to_bill_number | text | nvarchar(max) | yes | — | no | — | no |
| sales | coupon_code | coupon_code | text | nvarchar(max) | yes | — | no | — | no |
| sales | coupon_promo_id | coupon_promo_id | text | nvarchar(max) | yes | — | no | — | no |
| sales | coupon_scope | coupon_scope | text | nvarchar(max) | yes | — | no | — | no |
| sales | coupon_discount | coupon_discount | numeric | decimal(38,12) | no | 0 | no | — | no |
| sales | payments | payments | jsonb | nvarchar(max) | no | N'[]' | no | — | no |
| sales | client_transaction_id | client_transaction_id | text | nvarchar(450) | yes | — | no | — | yes |
| sales | cashier_id | cashier_id | text | nvarchar(max) | yes | — | no | — | no |
| sales | created_by | created_by | text | nvarchar(max) | yes | — | no | — | no |
| sales | updated_by | updated_by | text | nvarchar(max) | yes | — | no | — | no |
| sales | row_version | row_version | integer | int | no | 1 | no | — | no |
| sales | store_name_snapshot | store_name_snapshot | text | nvarchar(max) | yes | — | no | — | no |
| sales | store_address_snapshot | store_address_snapshot | text | nvarchar(max) | yes | — | no | — | no |
| sales | authorization_request_id | authorization_request_id | uuid | uniqueidentifier | yes | — | no | — | no |
| sales | authorized_by | authorized_by | text | nvarchar(max) | yes | — | no | — | no |
| sales | authorized_at | authorized_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| sales | rounding_adjustment | rounding_adjustment | numeric(18,4) | decimal(18,4) | no | 0 | no | — | no |
| sales | rounding_label | rounding_label | text | nvarchar(max) | yes | — | no | — | no |
| sales | branch_id | branch_id | text | nvarchar(450) | yes | — | no | — | no |
| shift_reconciliations | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| shift_reconciliations | shift_id | shift_id | uuid | uniqueidentifier | no | — | no | shifts.id | no |
| shift_reconciliations | store_id | store_id | text | nvarchar(450) | no | — | no | — | no |
| shift_reconciliations | count_id | count_id | uuid | uniqueidentifier | yes | — | no | shift_cash_counts.id | no |
| shift_reconciliations | expected_cash | expected_cash | numeric | decimal(38,12) | no | 0 | no | — | no |
| shift_reconciliations | expected_card | expected_card | numeric | decimal(38,12) | no | 0 | no | — | no |
| shift_reconciliations | expected_digital | expected_digital | numeric | decimal(38,12) | no | 0 | no | — | no |
| shift_reconciliations | counted_cash | counted_cash | numeric | decimal(38,12) | yes | — | no | — | no |
| shift_reconciliations | counted_card | counted_card | numeric | decimal(38,12) | yes | — | no | — | no |
| shift_reconciliations | counted_digital | counted_digital | numeric | decimal(38,12) | yes | — | no | — | no |
| shift_reconciliations | variance_cash | variance_cash | numeric | decimal(38,12) | yes | — | no | — | no |
| shift_reconciliations | variance_card | variance_card | numeric | decimal(38,12) | yes | — | no | — | no |
| shift_reconciliations | variance_digital | variance_digital | numeric | decimal(38,12) | yes | — | no | — | no |
| shift_reconciliations | variance_total | variance_total | numeric | decimal(38,12) | yes | — | no | — | no |
| shift_reconciliations | variance_status | variance_status | text | nvarchar(max) | no | 'NO_VARIANCE' | no | — | no |
| shift_reconciliations | created_at | created_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| terminal_tokens | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| terminal_tokens | location_id | location_id | text | nvarchar(450) | yes | — | no | stores.id | no |
| terminal_tokens | location_name | location_name | text | nvarchar(max) | yes | — | no | — | no |
| terminal_tokens | device_name | device_name | text | nvarchar(max) | no | — | no | — | no |
| terminal_tokens | status | status | text | nvarchar(max) | no | 'active' | no | — | no |
| terminal_tokens | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| terminal_tokens | activated_at | activated_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| terminal_tokens | revoked_at | revoked_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| terminal_tokens | last_seen_at | last_seen_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| terminal_tokens | app_version | app_version | text | nvarchar(max) | yes | — | no | — | no |
| terminal_tokens | last_sync_at | last_sync_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| terminal_tokens | reissued_at | reissued_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| terminal_tokens | replaced_by | replaced_by | uuid | uniqueidentifier | yes | — | no | — | no |
| terminal_tokens | claimed_by_device | claimed_by_device | text | nvarchar(max) | yes | — | no | — | no |
| terminal_tokens | claimed_at | claimed_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| terminal_tokens | platform | platform | text | nvarchar(max) | no | 'pc' | no | — | no |
| terminal_tokens | row_version | row_version | integer | int | no | 1 | no | — | no |
| terminal_tokens | claim_secret_hash | claim_secret_hash | text | nvarchar(max) | yes | — | no | — | no |
| terminal_tokens | claim_expires_at | claim_expires_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| terminal_tokens | credentials_issued_at | credentials_issued_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| terminal_tokens | device_platform | device_platform | text | nvarchar(max) | yes | — | no | — | no |
| terminal_tokens | device_os | device_os | text | nvarchar(max) | yes | — | no | — | no |
| terminal_tokens | claimed_proof_hash | claimed_proof_hash | text | nvarchar(max) | yes | — | no | — | no |
| terminal_tokens | claimed_platform | claimed_platform | text | nvarchar(max) | yes | — | no | — | no |
| terminal_tokens | claimed_os | claimed_os | text | nvarchar(max) | yes | — | no | — | no |
| terminal_tokens | is_claimed | is_claimed | boolean | bit | no | 0 | no | — | no |
| terminal_tokens | expires_at | expires_at | timestamp with time zone | datetimeoffset(7) | yes | — | no | — | no |
| terminal_tokens | claim_proof | claim_proof | text | nvarchar(max) | yes | — | no | — | no |
| booking_payments | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| booking_payments | booking_id | booking_id | uuid | uniqueidentifier | no | — | no | bookings.id | no |
| booking_payments | amount | amount | numeric | decimal(38,12) | no | 0 | no | — | no |
| booking_payments | method | method | text | nvarchar(max) | no | 'cash' | no | — | no |
| booking_payments | cashier | cashier | text | nvarchar(max) | yes | — | no | — | no |
| booking_payments | paid_at | paid_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| booking_payments | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| booking_payments | row_version | row_version | integer | int | no | 1 | no | — | no |
| booking_payments | status | status | text | nvarchar(max) | no | 'settled' | no | — | no |
| booking_payments | client_payment_id | client_payment_id | text | nvarchar(128) | yes | — | no | — | no |
| booking_payments | reference | reference | text | nvarchar(max) | yes | — | no | — | no |
| booking_payments | reversed_at | reversed_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| booking_payments | reversed_by | reversed_by | text | nvarchar(max) | yes | — | no | — | no |
| booking_payments | kind | kind | text | nvarchar(max) | no | 'payment' | no | — | no |
| booking_payments | refund_reason | refund_reason | text | nvarchar(max) | yes | — | no | — | no |
| booking_payments | refunds_payment_id | refunds_payment_id | uuid | uniqueidentifier | yes | — | no | — | no |
| booking_payments | change_given | change_given | numeric | decimal(38,12) | no | 0 | no | — | no |
| item_activity_logs | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| item_activity_logs | product_id | product_id | uuid | uniqueidentifier | yes | — | no | products.id | no |
| item_activity_logs | product_name | product_name | text | nvarchar(max) | yes | — | no | — | no |
| item_activity_logs | sku | sku | text | nvarchar(max) | yes | — | no | — | no |
| item_activity_logs | barcode | barcode | text | nvarchar(max) | yes | — | no | — | no |
| item_activity_logs | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| item_activity_logs | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| item_activity_logs | activity_type | activity_type | text | nvarchar(max) | no | — | no | — | no |
| item_activity_logs | reference | reference | text | nvarchar(max) | yes | — | no | — | no |
| item_activity_logs | quantity_delta | quantity_delta | integer | int | no | 0 | no | — | no |
| item_activity_logs | stock_before | stock_before | integer | int | yes | — | no | — | no |
| item_activity_logs | stock_after | stock_after | integer | int | yes | — | no | — | no |
| item_activity_logs | unit_cost | unit_cost | numeric | decimal(38,12) | no | 0 | no | — | no |
| item_activity_logs | staff_id | staff_id | text | nvarchar(max) | yes | — | no | — | no |
| item_activity_logs | staff_name | staff_name | text | nvarchar(max) | yes | — | no | — | no |
| item_activity_logs | role | role | text | nvarchar(max) | yes | — | no | — | no |
| item_activity_logs | note | note | text | nvarchar(max) | no | '' | no | — | no |
| item_activity_logs | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| item_activity_logs | row_version | row_version | integer | int | no | 1 | no | — | no |
| item_activity_logs | item_id | item_id | uuid | uniqueidentifier | yes | — | no | — | no |
| item_activity_logs | sale_id | sale_id | uuid | uniqueidentifier | yes | — | no | — | no |
| item_activity_logs | transfer_id | transfer_id | uuid | uniqueidentifier | yes | — | no | — | no |
| item_activity_logs | quantity | quantity | integer | int | yes | — | no | — | no |
| item_activity_logs | created_by | created_by | text | nvarchar(max) | yes | — | no | — | no |
| item_activity_logs | notes | notes | text | nvarchar(max) | yes | — | no | — | no |
| payment_transactions | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| payment_transactions | source_type | source_type | text | nvarchar(max) | no | — | no | — | no |
| payment_transactions | sale_id | sale_id | uuid | uniqueidentifier | yes | — | no | sales.id | no |
| payment_transactions | booking_id | booking_id | uuid | uniqueidentifier | yes | — | no | bookings.id | no |
| payment_transactions | member_id | member_id | uuid | uniqueidentifier | yes | — | no | members.id | no |
| payment_transactions | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| payment_transactions | shift_id | shift_id | text | nvarchar(max) | yes | — | no | — | no |
| payment_transactions | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| payment_transactions | amount | amount | numeric | decimal(38,12) | no | 0 | no | — | no |
| payment_transactions | method | method | text | nvarchar(max) | no | 'cash' | no | — | no |
| payment_transactions | kind | kind | text | nvarchar(max) | no | 'payment' | no | — | no |
| payment_transactions | reference | reference | text | nvarchar(max) | yes | — | no | — | no |
| payment_transactions | cashier_id | cashier_id | text | nvarchar(max) | yes | — | no | — | no |
| payment_transactions | cashier_name | cashier_name | text | nvarchar(max) | yes | — | no | — | no |
| payment_transactions | note | note | text | nvarchar(max) | no | '' | no | — | no |
| payment_transactions | paid_at | paid_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| payment_transactions | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| payment_transactions | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| payment_transactions | row_version | row_version | integer | int | no | 1 | no | — | no |
| payment_transactions | status | status | text | nvarchar(max) | yes | 'completed' | no | — | no |
| payment_transactions | metadata | metadata | jsonb | nvarchar(max) | yes | N'{}' | no | — | no |
| payment_transactions | client_transaction_id | client_transaction_id | text | nvarchar(450) | yes | — | no | — | yes |
| payment_transactions | order_id | order_id | uuid | uniqueidentifier | yes | — | no | — | no |
| payment_transactions | payment_method | payment_method | text | nvarchar(max) | yes | — | no | — | no |
| payment_transactions | transaction_reference | transaction_reference | text | nvarchar(max) | yes | — | no | — | no |
| product_barcodes | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| product_barcodes | product_id | product_id | uuid | uniqueidentifier | no | — | no | products.id | no |
| product_barcodes | barcode | barcode | text | nvarchar(450) | no | — | no | — | yes |
| product_barcodes | label | label | text | nvarchar(max) | yes | — | no | — | no |
| product_barcodes | pack_size | pack_size | numeric | decimal(38,12) | no | 1 | no | — | no |
| product_barcodes | is_primary | is_primary | boolean | bit | no | 0 | no | — | no |
| product_barcodes | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| product_barcodes | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| product_barcodes | row_version | row_version | integer | int | no | 1 | no | — | no |
| product_barcodes | unit_label | unit_label | text | nvarchar(max) | yes | — | no | — | no |
| product_barcodes | deleted_at | deleted_at | text | nvarchar(max) | yes | — | no | — | no |
| promotions | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| promotions | title | title | text | nvarchar(max) | no | — | no | — | no |
| promotions | promo_type | promo_type | text | nvarchar(max) | no | — | no | — | no |
| promotions | min_spend | min_spend | numeric | decimal(38,12) | no | 0 | no | — | no |
| promotions | discount_percent | discount_percent | numeric | decimal(38,12) | no | 0 | no | — | no |
| promotions | discount_amount | discount_amount | numeric | decimal(38,12) | no | 0 | no | — | no |
| promotions | foc_product_id | foc_product_id | uuid | uniqueidentifier | yes | — | no | products.id | no |
| promotions | points_per_dollar | points_per_dollar | numeric | decimal(38,12) | no | 1 | no | — | no |
| promotions | tier_rates | tier_rates | jsonb | nvarchar(max) | yes | — | no | — | no |
| promotions | is_active | is_active | boolean | bit | no | 1 | no | — | no |
| promotions | start_date | start_date | date | date | yes | — | no | — | no |
| promotions | end_date | end_date | date | date | yes | — | no | — | no |
| promotions | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| promotions | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| promotions | row_version | row_version | integer | int | no | 1 | no | — | no |
| promotions | deleted_at | deleted_at | text | nvarchar(max) | yes | — | no | — | no |
| purchase_order_items | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| purchase_order_items | po_id | po_id | uuid | uniqueidentifier | no | — | no | purchase_orders.id | no |
| purchase_order_items | product_id | product_id | uuid | uniqueidentifier | yes | — | no | products.id | no |
| purchase_order_items | barcode | barcode | text | nvarchar(max) | yes | — | no | — | no |
| purchase_order_items | product_name | product_name | text | nvarchar(max) | yes | — | no | — | no |
| purchase_order_items | cost_price | cost_price | numeric | decimal(38,12) | no | 0 | no | — | no |
| purchase_order_items | selling_price | selling_price | numeric | decimal(38,12) | no | 0 | no | — | no |
| purchase_order_items | quantity_received | quantity_received | integer | int | no | 0 | no | — | no |
| purchase_order_items | subtotal_cost | subtotal_cost | numeric | decimal(38,12) | no | 0 | no | — | no |
| purchase_order_items | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| purchase_order_items | sku | sku | text | nvarchar(max) | yes | — | no | — | no |
| purchase_order_items | updated_at | updated_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| purchase_order_items | row_version | row_version | integer | int | no | 1 | no | — | no |
| sale_items | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| sale_items | sale_id | sale_id | uuid | uniqueidentifier | no | — | no | sales.id | no |
| sale_items | product_id | product_id | uuid | uniqueidentifier | yes | — | no | products.id | no |
| sale_items | product_name | product_name | text | nvarchar(max) | no | — | no | — | no |
| sale_items | variant_code | variant_code | text | nvarchar(max) | yes | — | no | — | no |
| sale_items | unit_price | unit_price | numeric | decimal(38,12) | no | 0 | no | — | no |
| sale_items | quantity | quantity | integer | int | no | 1 | no | — | no |
| sale_items | discount_percent | discount_percent | numeric | decimal(38,12) | no | 0 | no | — | no |
| sale_items | discount_amount | discount_amount | numeric | decimal(38,12) | no | 0 | no | — | no |
| sale_items | is_return | is_return | boolean | bit | no | 0 | no | — | no |
| sale_items | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| sale_items | tax_rate | tax_rate | numeric | decimal(38,12) | no | 0 | no | — | no |
| sale_items | is_foc | is_foc | boolean | bit | no | 0 | no | — | no |
| sale_items | promo_id | promo_id | text | nvarchar(max) | yes | — | no | — | no |
| sale_items | coupon_code | coupon_code | text | nvarchar(max) | yes | — | no | — | no |
| sale_items | coupon_discount | coupon_discount | numeric | decimal(38,12) | no | 0 | no | — | no |
| sale_items | unit_cost | unit_cost | numeric | decimal(38,12) | no | 0 | no | — | no |
| sale_items | row_version | row_version | integer | int | no | 1 | no | — | no |
| sale_items | refunded_qty | refunded_qty | integer | int | no | 0 | no | — | no |
| sale_items | branch_id | branch_id | text | nvarchar(450) | yes | — | no | — | no |
| shift_variance_alerts | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| shift_variance_alerts | shift_id | shift_id | uuid | uniqueidentifier | no | — | no | shifts.id | no |
| shift_variance_alerts | store_id | store_id | text | nvarchar(450) | no | — | no | — | no |
| shift_variance_alerts | reconciliation_id | reconciliation_id | uuid | uniqueidentifier | yes | — | no | shift_reconciliations.id | yes |
| shift_variance_alerts | variance_total | variance_total | numeric | decimal(38,12) | no | — | no | — | no |
| shift_variance_alerts | variance_status | variance_status | text | nvarchar(max) | no | — | no | — | no |
| shift_variance_alerts | severity | severity | text | nvarchar(max) | no | 'warning' | no | — | no |
| shift_variance_alerts | message | message | text | nvarchar(max) | no | — | no | — | no |
| shift_variance_alerts | delivery_status | delivery_status | text | nvarchar(max) | no | 'pending' | no | — | no |
| shift_variance_alerts | attempts | attempts | integer | int | no | 0 | no | — | no |
| shift_variance_alerts | last_error | last_error | text | nvarchar(max) | yes | — | no | — | no |
| shift_variance_alerts | last_attempt_at | last_attempt_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| shift_variance_alerts | acknowledged_at | acknowledged_at | timestamptz | datetimeoffset(7) | yes | — | no | — | no |
| shift_variance_alerts | acknowledged_by | acknowledged_by | text | nvarchar(max) | yes | — | no | — | no |
| shift_variance_alerts | created_at | created_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| shift_variance_alerts | updated_at | updated_at | timestamptz | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| stock_adjustments | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| stock_adjustments | product_id | product_id | uuid | uniqueidentifier | yes | — | no | products.id | no |
| stock_adjustments | product_name | product_name | text | nvarchar(max) | yes | — | no | — | no |
| stock_adjustments | sku | sku | text | nvarchar(max) | yes | — | no | — | no |
| stock_adjustments | barcode | barcode | text | nvarchar(max) | yes | — | no | — | no |
| stock_adjustments | store_id | store_id | text | nvarchar(450) | yes | — | no | — | no |
| stock_adjustments | terminal_id | terminal_id | text | nvarchar(max) | yes | — | no | — | no |
| stock_adjustments | reason | reason | text | nvarchar(max) | no | 'manual' | no | — | no |
| stock_adjustments | note | note | text | nvarchar(max) | no | '' | no | — | no |
| stock_adjustments | previous_stock | previous_stock | integer | int | no | 0 | no | — | no |
| stock_adjustments | updated_stock | updated_stock | integer | int | no | 0 | no | — | no |
| stock_adjustments | delta | delta | integer | int | no | 0 | no | — | no |
| stock_adjustments | cost_impact | cost_impact | numeric | decimal(38,12) | no | 0 | no | — | no |
| stock_adjustments | staff_id | staff_id | text | nvarchar(max) | yes | — | no | — | no |
| stock_adjustments | staff_name | staff_name | text | nvarchar(max) | yes | — | no | — | no |
| stock_adjustments | role | role | text | nvarchar(max) | yes | — | no | — | no |
| stock_adjustments | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| stock_adjustments | row_version | row_version | integer | int | no | 1 | no | — | no |
| stock_adjustments | draft_id | draft_id | UUID | uniqueidentifier | yes | — | no | — | no |
| stock_transfer_items | id | id | uuid | uniqueidentifier | no | NEWID() | yes | — | no |
| stock_transfer_items | transfer_id | transfer_id | uuid | uniqueidentifier | no | — | no | stock_transfers.id | no |
| stock_transfer_items | product_id | product_id | uuid | uniqueidentifier | yes | — | no | products.id | no |
| stock_transfer_items | barcode | barcode | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfer_items | sku | sku | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfer_items | product_name | product_name | text | nvarchar(max) | yes | — | no | — | no |
| stock_transfer_items | quantity | quantity | integer | int | no | 0 | no | — | no |
| stock_transfer_items | quantity_received | quantity_received | integer | int | no | 0 | no | — | no |
| stock_transfer_items | unit_cost | unit_cost | numeric | decimal(38,12) | no | 0 | no | — | no |
| stock_transfer_items | created_at | created_at | timestamp with time zone | datetimeoffset(7) | no | SYSDATETIMEOFFSET() | no | — | no |
| stock_transfer_items | row_version | row_version | integer | int | no | 1 | no | — | no |
| stock_transfer_items | quantity_approved | quantity_approved | integer | int | yes | — | no | — | no |
| stock_transfer_items | quantity_dispatched | quantity_dispatched | integer | int | yes | — | no | — | no |
| stock_transfer_items | quantity_verified | quantity_verified | integer | int | yes | — | no | — | no |
