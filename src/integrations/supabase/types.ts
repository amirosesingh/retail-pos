export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          amount: number | null
          branch_id: string | null
          cleared_by: string[]
          client_event_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          message: string
          meta: Json
          new_state: string | null
          previous_state: string | null
          severity: string
          store_id: string | null
          terminal_id: string | null
          terminal_name: string | null
          title: string
          whatsapp_error: string | null
          whatsapp_status: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          amount?: number | null
          branch_id?: string | null
          cleared_by?: string[]
          client_event_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          message?: string
          meta?: Json
          new_state?: string | null
          previous_state?: string | null
          severity?: string
          store_id?: string | null
          terminal_id?: string | null
          terminal_name?: string | null
          title: string
          whatsapp_error?: string | null
          whatsapp_status?: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          amount?: number | null
          branch_id?: string | null
          cleared_by?: string[]
          client_event_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          message?: string
          meta?: Json
          new_state?: string | null
          previous_state?: string | null
          severity?: string
          store_id?: string | null
          terminal_id?: string | null
          terminal_name?: string | null
          title?: string
          whatsapp_error?: string | null
          whatsapp_status?: string
        }
        Relationships: []
      }
      app_users: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          last_login_at: string | null
          permissions: Json
          pin_hash: string
          pin_length: number
          pin_set_at: string | null
          pin_updated_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          role_slug: string | null
          row_version: number
          store_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email: string
          full_name: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          permissions?: Json
          pin_hash?: string
          pin_length?: number
          pin_set_at?: string | null
          pin_updated_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          role_slug?: string | null
          row_version?: number
          store_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          permissions?: Json
          pin_hash?: string
          pin_length?: number
          pin_set_at?: string | null
          pin_updated_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          role_slug?: string | null
          row_version?: number
          store_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string | null
          action_category: string
          action_name: string
          after_state: Json | null
          before_state: Json | null
          created_at: string
          details: Json | null
          entity: string | null
          id: string
          store_id: string | null
          target_module: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action?: string | null
          action_category: string
          action_name: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          details?: Json | null
          entity?: string | null
          id?: string
          store_id?: string | null
          target_module?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string | null
          action_category?: string
          action_name?: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          details?: Json | null
          entity?: string | null
          id?: string
          store_id?: string | null
          target_module?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      authorization_actions: {
        Row: {
          action_key: string
          allowed_roles: string[]
          allowed_user_ids: string[]
          requester_roles: string[]
          requester_user_ids: string[]
          authority_limits: Json
          extra_authority: Json
          absolute_ceilings: Json
          created_at: string
          id: string
          is_enabled: boolean
          mode: string
          require_reason: boolean
          scope_id: string
          scope_type: string
          threshold: number | null
          updated_at: string
        }
        Insert: {
          action_key: string
          allowed_roles?: string[]
          allowed_user_ids?: string[]
          requester_roles?: string[]
          requester_user_ids?: string[]
          authority_limits?: Json
          extra_authority?: Json
          absolute_ceilings?: Json
          created_at?: string
          id?: string
          is_enabled?: boolean
          mode?: string
          require_reason?: boolean
          scope_id?: string
          scope_type?: string
          threshold?: number | null
          updated_at?: string
        }
        Update: {
          action_key?: string
          allowed_roles?: string[]
          allowed_user_ids?: string[]
          requester_roles?: string[]
          requester_user_ids?: string[]
          authority_limits?: Json
          extra_authority?: Json
          absolute_ceilings?: Json
          created_at?: string
          id?: string
          is_enabled?: boolean
          mode?: string
          require_reason?: boolean
          scope_id?: string
          scope_type?: string
          threshold?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      authorization_log: {
        Row: {
          action_key: string
          authorized_by: string | null
          authorizer_role: string | null
          created_at: string
          detail: Json
          id: string
          mode_used: string
          outcome: string
          request_id: string | null
          requested_by: string | null
          store_id: string
          terminal_id: string
        }
        Insert: {
          action_key: string
          authorized_by?: string | null
          authorizer_role?: string | null
          created_at?: string
          detail?: Json
          id?: string
          mode_used: string
          outcome: string
          request_id?: string | null
          requested_by?: string | null
          store_id?: string
          terminal_id?: string
        }
        Update: {
          action_key?: string
          authorized_by?: string | null
          authorizer_role?: string | null
          created_at?: string
          detail?: Json
          id?: string
          mode_used?: string
          outcome?: string
          request_id?: string | null
          requested_by?: string | null
          store_id?: string
          terminal_id?: string
        }
        Relationships: []
      }
      authorization_requests: {
        Row: {
          action_key: string
          approved_amount: number | null
          approved_payload: Json
          bill_snapshot: Json
          consumed_at: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_by_name: string | null
          decision_note: string | null
          expires_at: string
          held_order_id: string | null
          id: string
          notified_at: string | null
          payload: Json
          reason: string
          requested_amount: number | null
          requester_direct_limit: number | null
          value_unit: string
          requested_by: string
          requested_by_name: string
          snapshot_hash: string
          status: string
          store_id: string
          terminal_id: string
          updated_at: string
        }
        Insert: {
          action_key: string
          approved_amount?: number | null
          approved_payload?: Json
          bill_snapshot?: Json
          consumed_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_note?: string | null
          expires_at?: string
          held_order_id?: string | null
          id?: string
          notified_at?: string | null
          payload?: Json
          reason?: string
          requested_amount?: number | null
          requester_direct_limit?: number | null
          value_unit?: string
          requested_by: string
          requested_by_name?: string
          snapshot_hash?: string
          status?: string
          store_id?: string
          terminal_id?: string
          updated_at?: string
        }
        Update: {
          action_key?: string
          approved_amount?: number | null
          approved_payload?: Json
          bill_snapshot?: Json
          consumed_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_note?: string | null
          expires_at?: string
          held_order_id?: string | null
          id?: string
          notified_at?: string | null
          payload?: Json
          reason?: string
          requested_amount?: number | null
          requester_direct_limit?: number | null
          value_unit?: string
          requested_by?: string
          requested_by_name?: string
          snapshot_hash?: string
          status?: string
          store_id?: string
          terminal_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      booking_payments: {
        Row: {
          amount: number
          booking_id: string
          cashier: string | null
          change_given: number
          client_payment_id: string | null
          created_at: string
          id: string
          kind: string
          method: string
          paid_at: string
          reference: string | null
          refund_reason: string | null
          refunds_payment_id: string | null
          reversed_at: string | null
          reversed_by: string | null
          row_version: number
          status: string
        }
        Insert: {
          amount?: number
          booking_id: string
          cashier?: string | null
          change_given?: number
          client_payment_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          method?: string
          paid_at?: string
          reference?: string | null
          refund_reason?: string | null
          refunds_payment_id?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          row_version?: number
          status?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          cashier?: string | null
          change_given?: number
          client_payment_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          method?: string
          paid_at?: string
          reference?: string | null
          refund_reason?: string | null
          refunds_payment_id?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          row_version?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booking_ref: string | null
          cancel_money_action: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_terminal: string | null
          cashier: string | null
          charges: Json
          closed_at: string | null
          created_at: string
          customer_name: string
          customer_phone: string
          discount: number
          dropped_off_at: string | null
          due_date: string | null
          grip_product_id: string | null
          grommet_notes: string | null
          id: string
          incident_note: string | null
          intake_note: string | null
          job_notes: string | null
          job_status: string
          job_status_at: string | null
          job_status_by: string | null
          liability_accepted: boolean
          lines: Json
          member_id: string | null
          note: string
          notify_whatsapp: boolean
          paid: number
          payment_timing: string | null
          promised_at: string | null
          racket_model: string | null
          ref: string
          row_version: number
          sale_receipt_no: string | null
          service_fee: number
          service_name: string | null
          service_type_id: string | null
          shift_id: string | null
          status: string
          store_id: string | null
          string_origin: string | null
          string_source_product_id: string | null
          string_type: string | null
          subtotal: number
          tag_id: string | null
          tax: number
          technician: string | null
          tension_cross: number | null
          tension_main: number | null
          tension_unit: string
          total: number
          updated_at: string
        }
        Insert: {
          booking_ref?: string | null
          cancel_money_action?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_terminal?: string | null
          cashier?: string | null
          charges?: Json
          closed_at?: string | null
          created_at?: string
          customer_name?: string
          customer_phone?: string
          discount?: number
          dropped_off_at?: string | null
          due_date?: string | null
          grip_product_id?: string | null
          grommet_notes?: string | null
          id?: string
          incident_note?: string | null
          intake_note?: string | null
          job_notes?: string | null
          job_status?: string
          job_status_at?: string | null
          job_status_by?: string | null
          liability_accepted?: boolean
          lines?: Json
          member_id?: string | null
          note?: string
          notify_whatsapp?: boolean
          paid?: number
          payment_timing?: string | null
          promised_at?: string | null
          racket_model?: string | null
          ref: string
          row_version?: number
          sale_receipt_no?: string | null
          service_fee?: number
          service_name?: string | null
          service_type_id?: string | null
          shift_id?: string | null
          status?: string
          store_id?: string | null
          string_origin?: string | null
          string_source_product_id?: string | null
          string_type?: string | null
          subtotal?: number
          tag_id?: string | null
          tax?: number
          technician?: string | null
          tension_cross?: number | null
          tension_main?: number | null
          tension_unit?: string
          total?: number
          updated_at?: string
        }
        Update: {
          booking_ref?: string | null
          cancel_money_action?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_terminal?: string | null
          cashier?: string | null
          charges?: Json
          closed_at?: string | null
          created_at?: string
          customer_name?: string
          customer_phone?: string
          discount?: number
          dropped_off_at?: string | null
          due_date?: string | null
          grip_product_id?: string | null
          grommet_notes?: string | null
          id?: string
          incident_note?: string | null
          intake_note?: string | null
          job_notes?: string | null
          job_status?: string
          job_status_at?: string | null
          job_status_by?: string | null
          liability_accepted?: boolean
          lines?: Json
          member_id?: string | null
          note?: string
          notify_whatsapp?: boolean
          paid?: number
          payment_timing?: string | null
          promised_at?: string | null
          racket_model?: string | null
          ref?: string
          row_version?: number
          sale_receipt_no?: string | null
          service_fee?: number
          service_name?: string | null
          service_type_id?: string | null
          shift_id?: string | null
          status?: string
          store_id?: string | null
          string_origin?: string | null
          string_source_product_id?: string | null
          string_type?: string | null
          subtotal?: number
          tag_id?: string | null
          tax?: number
          technician?: string | null
          tension_cross?: number | null
          tension_main?: number | null
          tension_unit?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_telemetry: {
        Row: {
          app_version: string | null
          branch_id: string | null
          conflict_count: number
          connection_status: string
          created_at: string
          db_mode: string
          device_name: string | null
          device_type: string | null
          last_heartbeat_at: string | null
          last_ping: string | null
          last_seen_at: string
          last_synced_at: string | null
          location_name: string | null
          pending_count: number
          pending_queue_count: number | null
          platform: string | null
          session_status: string | null
          staff_name: string | null
          staff_role: string | null
          status: string | null
          storage_engine: string
          store_id: string | null
          terminal_id: string
          terminal_name: string | null
          updated_at: string
        }
        Insert: {
          app_version?: string | null
          branch_id?: string | null
          conflict_count?: number
          connection_status?: string
          created_at?: string
          db_mode?: string
          device_name?: string | null
          device_type?: string | null
          last_heartbeat_at?: string | null
          last_ping?: string | null
          last_seen_at?: string
          last_synced_at?: string | null
          location_name?: string | null
          pending_count?: number
          pending_queue_count?: number | null
          platform?: string | null
          session_status?: string | null
          staff_name?: string | null
          staff_role?: string | null
          status?: string | null
          storage_engine?: string
          store_id?: string | null
          terminal_id: string
          terminal_name?: string | null
          updated_at?: string
        }
        Update: {
          app_version?: string | null
          branch_id?: string | null
          conflict_count?: number
          connection_status?: string
          created_at?: string
          db_mode?: string
          device_name?: string | null
          device_type?: string | null
          last_heartbeat_at?: string | null
          last_ping?: string | null
          last_seen_at?: string
          last_synced_at?: string | null
          location_name?: string | null
          pending_count?: number
          pending_queue_count?: number | null
          platform?: string | null
          session_status?: string | null
          staff_name?: string | null
          staff_role?: string | null
          status?: string | null
          storage_engine?: string
          store_id?: string | null
          terminal_id?: string
          terminal_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cashiers: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          last_login_at: string | null
          permissions: Json
          pin_hash: string
          role_slug: string | null
          store_id: string | null
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          permissions?: Json
          pin_hash: string
          role_slug?: string | null
          store_id?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          permissions?: Json
          pin_hash?: string
          role_slug?: string | null
          store_id?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      coupon_campaigns: {
        Row: {
          claims_count: number
          created_at: string
          discount_type: string
          discount_value: number
          expires_at: string | null
          id: string
          is_active: boolean
          is_welcome: boolean
          max_claims: number | null
          max_per_member: number | null
          name: string
          row_version: number
          scope: string
          scope_value: string | null
          slug: string
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          claims_count?: number
          created_at?: string
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_welcome?: boolean
          max_claims?: number | null
          max_per_member?: number | null
          name: string
          row_version?: number
          scope?: string
          scope_value?: string | null
          slug: string
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          claims_count?: number
          created_at?: string
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_welcome?: boolean
          max_claims?: number | null
          max_per_member?: number | null
          name?: string
          row_version?: number
          scope?: string
          scope_value?: string | null
          slug?: string
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      coupon_events: {
        Row: {
          campaign_id: string | null
          campaign_name: string | null
          created_at: string
          event_type: string
          id: string
          member_id: string | null
          member_phone: string | null
          note: string | null
          sale_id: string | null
          staff_name: string | null
          staff_role: string | null
          store_id: string | null
          terminal_id: string | null
          voucher_token: string | null
        }
        Insert: {
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string
          event_type: string
          id?: string
          member_id?: string | null
          member_phone?: string | null
          note?: string | null
          sale_id?: string | null
          staff_name?: string | null
          staff_role?: string | null
          store_id?: string | null
          terminal_id?: string | null
          voucher_token?: string | null
        }
        Update: {
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string
          event_type?: string
          id?: string
          member_id?: string | null
          member_phone?: string | null
          note?: string | null
          sale_id?: string | null
          staff_name?: string | null
          staff_role?: string | null
          store_id?: string | null
          terminal_id?: string | null
          voucher_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupon_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "coupon_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      drawer_events: {
        Row: {
          approved_by: string | null
          created_at: string
          id: string
          note: string | null
          reason: string
          role: string | null
          shift_id: string | null
          staff_id: string | null
          staff_name: string | null
          store_id: string | null
          terminal_id: string | null
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          id?: string
          note?: string | null
          reason: string
          role?: string | null
          shift_id?: string | null
          staff_id?: string | null
          staff_name?: string | null
          store_id?: string | null
          terminal_id?: string | null
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          id?: string
          note?: string | null
          reason?: string
          role?: string | null
          shift_id?: string | null
          staff_id?: string | null
          staff_name?: string | null
          store_id?: string | null
          terminal_id?: string | null
        }
        Relationships: []
      }
      entity_status_history: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          branch_id: string | null
          client_event_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          new_status: string
          occurred_at: string
          previous_status: string | null
          reason: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          row_version: number
          status_kind: string
          store_id: string | null
          terminal_id: string | null
          updated_at: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          branch_id?: string | null
          client_event_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
          new_status: string
          occurred_at?: string
          previous_status?: string | null
          reason?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          row_version?: number
          status_kind?: string
          store_id?: string | null
          terminal_id?: string | null
          updated_at?: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          branch_id?: string | null
          client_event_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          new_status?: string
          occurred_at?: string
          previous_status?: string | null
          reason?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          row_version?: number
          status_kind?: string
          store_id?: string | null
          terminal_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      held_orders: {
        Row: {
          cancelled_from: string | null
          cart_discount: number
          cart_discount_type: string
          coupon: Json | null
          created_at: string
          exchange_ref: string | null
          held_at: string
          held_by: string | null
          id: string
          label: string
          lines: Json
          member_id: string | null
          member_name: string | null
          note: string
          pending_request_id: string | null
          row_version: number
          shift_id: string | null
          status: string
          store_id: string | null
          total: number
          updated_at: string
        }
        Insert: {
          cancelled_from?: string | null
          cart_discount?: number
          cart_discount_type?: string
          coupon?: Json | null
          created_at?: string
          exchange_ref?: string | null
          held_at?: string
          held_by?: string | null
          id?: string
          label?: string
          lines?: Json
          member_id?: string | null
          member_name?: string | null
          note?: string
          pending_request_id?: string | null
          row_version?: number
          shift_id?: string | null
          status?: string
          store_id?: string | null
          total?: number
          updated_at?: string
        }
        Update: {
          cancelled_from?: string | null
          cart_discount?: number
          cart_discount_type?: string
          coupon?: Json | null
          created_at?: string
          exchange_ref?: string | null
          held_at?: string
          held_by?: string | null
          id?: string
          label?: string
          lines?: Json
          member_id?: string | null
          member_name?: string | null
          note?: string
          pending_request_id?: string | null
          row_version?: number
          shift_id?: string | null
          status?: string
          store_id?: string | null
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      integration_settings: {
        Row: {
          api_keys_encrypted: Json
          created_at: string
          id: string
          is_active: boolean
          provider_name: string
          strict_verification: boolean
          updated_at: string
          updated_by: string | null
          verification_channel: string
        }
        Insert: {
          api_keys_encrypted?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          provider_name: string
          strict_verification?: boolean
          updated_at?: string
          updated_by?: string | null
          verification_channel?: string
        }
        Update: {
          api_keys_encrypted?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          provider_name?: string
          strict_verification?: boolean
          updated_at?: string
          updated_by?: string | null
          verification_channel?: string
        }
        Relationships: []
      }
      issued_vouchers: {
        Row: {
          campaign_id: string
          disable_reason: string | null
          disabled_at: string | null
          disabled_by: string | null
          expires_at: string | null
          id: string
          issued_at: string
          issued_by: string | null
          issued_source: string
          member_id: string | null
          redeemed_at: string | null
          redeemed_by: string | null
          redeemed_sale_id: string | null
          row_version: number
          status: string
          store_id: string | null
          token_slug: string
        }
        Insert: {
          campaign_id: string
          disable_reason?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          expires_at?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          issued_source?: string
          member_id?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          redeemed_sale_id?: string | null
          row_version?: number
          status?: string
          store_id?: string | null
          token_slug: string
        }
        Update: {
          campaign_id?: string
          disable_reason?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          expires_at?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          issued_source?: string
          member_id?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          redeemed_sale_id?: string | null
          row_version?: number
          status?: string
          store_id?: string | null
          token_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "issued_vouchers_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "coupon_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issued_vouchers_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      item_activity_logs: {
        Row: {
          activity_type: string
          barcode: string | null
          created_at: string
          id: string
          note: string
          product_id: string | null
          product_name: string | null
          quantity_delta: number
          reference: string | null
          role: string | null
          row_version: number
          sku: string | null
          staff_id: string | null
          staff_name: string | null
          stock_after: number | null
          stock_before: number | null
          store_id: string | null
          terminal_id: string | null
          unit_cost: number
        }
        Insert: {
          activity_type: string
          barcode?: string | null
          created_at?: string
          id?: string
          note?: string
          product_id?: string | null
          product_name?: string | null
          quantity_delta?: number
          reference?: string | null
          role?: string | null
          row_version?: number
          sku?: string | null
          staff_id?: string | null
          staff_name?: string | null
          stock_after?: number | null
          stock_before?: number | null
          store_id?: string | null
          terminal_id?: string | null
          unit_cost?: number
        }
        Update: {
          activity_type?: string
          barcode?: string | null
          created_at?: string
          id?: string
          note?: string
          product_id?: string | null
          product_name?: string | null
          quantity_delta?: number
          reference?: string | null
          role?: string | null
          row_version?: number
          sku?: string | null
          staff_id?: string | null
          staff_name?: string | null
          stock_after?: number | null
          stock_before?: number | null
          store_id?: string | null
          terminal_id?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_activity_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      member_verifications: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          email: string | null
          expires_at: string
          id: string
          member_id: string | null
          otp_code: string | null
          phone: string | null
          sent_by: string | null
          status: string
          store_id: string | null
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          channel?: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          member_id?: string | null
          otp_code?: string | null
          phone?: string | null
          sent_by?: string | null
          status?: string
          store_id?: string | null
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          member_id?: string | null
          otp_code?: string | null
          phone?: string | null
          sent_by?: string | null
          status?: string
          store_id?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_member_verifications_member"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          address: string | null
          created_at: string
          date_of_birth: string | null
          deleted_at: string | null
          email: string | null
          full_name: string
          id: string
          is_verified: boolean
          loyalty_points: number
          member_code: string
          phone: string
          row_version: number
          tier_id: string | null
          total_spent: number
          updated_at: string
          verified_at: string | null
          verified_channel: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_verified?: boolean
          loyalty_points?: number
          member_code: string
          phone: string
          row_version?: number
          tier_id?: string | null
          total_spent?: number
          updated_at?: string
          verified_at?: string | null
          verified_channel?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_verified?: boolean
          loyalty_points?: number
          member_code?: string
          phone?: string
          row_version?: number
          tier_id?: string | null
          total_spent?: number
          updated_at?: string
          verified_at?: string | null
          verified_channel?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_tiers: {
        Row: {
          created_at: string
          deleted_at: string | null
          discount_percentage: number
          id: string
          name: string
          points_multiplier: number
          row_version: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          discount_percentage?: number
          id?: string
          name: string
          points_multiplier?: number
          row_version?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          discount_percentage?: number
          id?: string
          name?: string
          points_multiplier?: number
          row_version?: number
          updated_at?: string
        }
        Relationships: []
      }
      nav_pins: {
        Row: {
          created_at: string
          id: string
          item_key: string
          item_kind: string
          owner_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_key: string
          item_kind: string
          owner_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          item_key?: string
          item_kind?: string
          owner_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      offline_sync_audit_log: {
        Row: {
          created_at: string
          direction: string
          error_message: string | null
          finished_at: string | null
          id: string
          record_id: string | null
          records: number
          started_at: string
          status: string
          store_id: string | null
          table_name: string
          terminal_id: string | null
        }
        Insert: {
          created_at?: string
          direction: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          record_id?: string | null
          records?: number
          started_at?: string
          status?: string
          store_id?: string | null
          table_name: string
          terminal_id?: string | null
        }
        Update: {
          created_at?: string
          direction?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          record_id?: string | null
          records?: number
          started_at?: string
          status?: string
          store_id?: string | null
          table_name?: string
          terminal_id?: string | null
        }
        Relationships: []
      }
      payment_transactions: {
        Row: {
          amount: number
          booking_id: string | null
          cashier_id: string | null
          cashier_name: string | null
          client_transaction_id: string | null
          created_at: string
          id: string
          kind: string
          member_id: string | null
          metadata: Json | null
          method: string
          note: string
          paid_at: string
          reference: string | null
          row_version: number
          sale_id: string | null
          shift_id: string | null
          source_type: string
          status: string | null
          store_id: string | null
          terminal_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          booking_id?: string | null
          cashier_id?: string | null
          cashier_name?: string | null
          client_transaction_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          member_id?: string | null
          metadata?: Json | null
          method?: string
          note?: string
          paid_at?: string
          reference?: string | null
          row_version?: number
          sale_id?: string | null
          shift_id?: string | null
          source_type: string
          status?: string | null
          store_id?: string | null
          terminal_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string | null
          cashier_id?: string | null
          cashier_name?: string | null
          client_transaction_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          member_id?: string | null
          metadata?: Json | null
          method?: string
          note?: string
          paid_at?: string
          reference?: string | null
          row_version?: number
          sale_id?: string | null
          shift_id?: string | null
          source_type?: string
          status?: string | null
          store_id?: string | null
          terminal_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_types: {
        Row: {
          created_at: string
          icon: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          requires_reference: boolean
          row_version: number
          sort_order: number
          type_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          icon?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          requires_reference?: boolean
          row_version?: number
          sort_order?: number
          type_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          icon?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          requires_reference?: boolean
          row_version?: number
          sort_order?: number
          type_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      pin_attempts: {
        Row: {
          attempts: number
          created_at: string
          key: string
          locked_until: string | null
          updated_at: string
          window_started_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          key: string
          locked_until?: string | null
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          key?: string
          locked_until?: string | null
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      pos_settings: {
        Row: {
          booking_slip: Json
          company_name: string
          custom_lines: Json
          date_format: string
          day_end_time: string
          day_start_time: string
          enable_tax: boolean
          fonts: Json
          footer_text: string | null
          header_text: string | null
          id: number
          integration_settings: Json
          logo_data_url: string | null
          max_shift_hours: number
          notification_settings: Json
          paper_size: string
          phone: string | null
          qr: Json
          receipt_css: string
          receipt_design: Json
          reg_number: string | null
          region_country: string
          review_max_discount_pct: number
          review_max_nosale: number
          review_max_refund_value: number
          review_max_refunds: number
          review_max_voids: number
          row_version: number
          shift_reminder_minutes: number
          show_barcode: boolean
          show_logo: boolean
          show_points: boolean
          show_tax_details: boolean
          tax_mode: string
          tax_number: string | null
          tax_percentage: number
          time_format: string
          time_zone: string
          ui_visibility: Json
          updated_at: string
          website: string | null
        }
        Insert: {
          booking_slip?: Json
          company_name?: string
          custom_lines?: Json
          date_format?: string
          day_end_time?: string
          day_start_time?: string
          enable_tax?: boolean
          fonts?: Json
          footer_text?: string | null
          header_text?: string | null
          id?: number
          integration_settings?: Json
          logo_data_url?: string | null
          max_shift_hours?: number
          notification_settings?: Json
          paper_size?: string
          phone?: string | null
          qr?: Json
          receipt_css?: string
          receipt_design?: Json
          reg_number?: string | null
          region_country?: string
          review_max_discount_pct?: number
          review_max_nosale?: number
          review_max_refund_value?: number
          review_max_refunds?: number
          review_max_voids?: number
          row_version?: number
          shift_reminder_minutes?: number
          show_barcode?: boolean
          show_logo?: boolean
          show_points?: boolean
          show_tax_details?: boolean
          tax_mode?: string
          tax_number?: string | null
          tax_percentage?: number
          time_format?: string
          time_zone?: string
          ui_visibility?: Json
          updated_at?: string
          website?: string | null
        }
        Update: {
          booking_slip?: Json
          company_name?: string
          custom_lines?: Json
          date_format?: string
          day_end_time?: string
          day_start_time?: string
          enable_tax?: boolean
          fonts?: Json
          footer_text?: string | null
          header_text?: string | null
          id?: number
          integration_settings?: Json
          logo_data_url?: string | null
          max_shift_hours?: number
          notification_settings?: Json
          paper_size?: string
          phone?: string | null
          qr?: Json
          receipt_css?: string
          receipt_design?: Json
          reg_number?: string | null
          region_country?: string
          review_max_discount_pct?: number
          review_max_nosale?: number
          review_max_refund_value?: number
          review_max_refunds?: number
          review_max_voids?: number
          row_version?: number
          shift_reminder_minutes?: number
          show_barcode?: boolean
          show_logo?: boolean
          show_points?: boolean
          show_tax_details?: boolean
          tax_mode?: string
          tax_number?: string | null
          tax_percentage?: number
          time_format?: string
          time_zone?: string
          ui_visibility?: Json
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      pos_store_settings: {
        Row: {
          allow_discount_stacking: boolean | null
          allow_multiple_shifts_per_terminal: boolean | null
          allow_offline_approvals: boolean
          allow_tax_exemption: boolean | null
          auto_lock_timeout_seconds: number | null
          block_shift_close_on_hold: boolean | null
          enable_blind_cash_count: boolean | null
          enable_cashier_x_report: boolean | null
          enable_manager_pin_audit_log: boolean | null
          max_cart_discount_amount: number | null
          max_cashier_discount_percent: number | null
          max_drawer_cash_limit: number | null
          max_refund_days_limit: number | null
          offline_approval_requires_pin: boolean
          online_only_edit_tenders: boolean
          online_only_manual_discount: boolean
          online_only_price_override: boolean
          online_only_reduce_qty: boolean
          online_only_refund: boolean
          online_only_shift_close: boolean
          online_only_stock_adjustment: boolean
          online_only_terminal_reset: boolean
          online_only_void_cart: boolean
          online_only_void_line: boolean
          prevent_below_cost_sale: boolean | null
          prevent_negative_stock_sale: boolean | null
          require_counted_cash_on_close: boolean | null
          require_daily_sales_for_shift_close: boolean | null
          require_manager_pin_for_cash_drawer_open: boolean | null
          require_manager_pin_for_refund: boolean | null
          require_manager_pin_on_variance: boolean | null
          require_opening_float_count: boolean | null
          require_pin_edit_tenders: boolean | null
          require_pin_manual_discount: boolean | null
          require_pin_price_override: boolean | null
          require_pin_reduce_qty: boolean | null
          require_pin_shift_close: boolean | null
          require_pin_stock_adjustment: boolean | null
          require_pin_terminal_reset: boolean | null
          require_pin_void_cart: boolean | null
          require_pin_void_line: boolean | null
          require_reason_for_payout: boolean | null
          require_reason_for_price_override: boolean | null
          require_receipt_for_refund: boolean | null
          row_version: number
          show_expected_totals_at_close: boolean | null
          show_itemized_tender_breakdown: boolean | null
          show_live_variance_at_close: boolean | null
          show_opening_float_at_close: boolean | null
          store_id: string
          track_item_voids: boolean | null
          updated_at: string
          updated_by: string | null
          variance_pin_threshold: number | null
        }
        Insert: {
          allow_discount_stacking?: boolean | null
          allow_multiple_shifts_per_terminal?: boolean | null
          allow_offline_approvals?: boolean
          allow_tax_exemption?: boolean | null
          auto_lock_timeout_seconds?: number | null
          block_shift_close_on_hold?: boolean | null
          enable_blind_cash_count?: boolean | null
          enable_cashier_x_report?: boolean | null
          enable_manager_pin_audit_log?: boolean | null
          max_cart_discount_amount?: number | null
          max_cashier_discount_percent?: number | null
          max_drawer_cash_limit?: number | null
          max_refund_days_limit?: number | null
          offline_approval_requires_pin?: boolean
          online_only_edit_tenders?: boolean
          online_only_manual_discount?: boolean
          online_only_price_override?: boolean
          online_only_reduce_qty?: boolean
          online_only_refund?: boolean
          online_only_shift_close?: boolean
          online_only_stock_adjustment?: boolean
          online_only_terminal_reset?: boolean
          online_only_void_cart?: boolean
          online_only_void_line?: boolean
          prevent_below_cost_sale?: boolean | null
          prevent_negative_stock_sale?: boolean | null
          require_counted_cash_on_close?: boolean | null
          require_daily_sales_for_shift_close?: boolean | null
          require_manager_pin_for_cash_drawer_open?: boolean | null
          require_manager_pin_for_refund?: boolean | null
          require_manager_pin_on_variance?: boolean | null
          require_opening_float_count?: boolean | null
          require_pin_edit_tenders?: boolean | null
          require_pin_manual_discount?: boolean | null
          require_pin_price_override?: boolean | null
          require_pin_reduce_qty?: boolean | null
          require_pin_shift_close?: boolean | null
          require_pin_stock_adjustment?: boolean | null
          require_pin_terminal_reset?: boolean | null
          require_pin_void_cart?: boolean | null
          require_pin_void_line?: boolean | null
          require_reason_for_payout?: boolean | null
          require_reason_for_price_override?: boolean | null
          require_receipt_for_refund?: boolean | null
          row_version?: number
          show_expected_totals_at_close?: boolean | null
          show_itemized_tender_breakdown?: boolean | null
          show_live_variance_at_close?: boolean | null
          show_opening_float_at_close?: boolean | null
          store_id: string
          track_item_voids?: boolean | null
          updated_at?: string
          updated_by?: string | null
          variance_pin_threshold?: number | null
        }
        Update: {
          allow_discount_stacking?: boolean | null
          allow_multiple_shifts_per_terminal?: boolean | null
          allow_offline_approvals?: boolean
          allow_tax_exemption?: boolean | null
          auto_lock_timeout_seconds?: number | null
          block_shift_close_on_hold?: boolean | null
          enable_blind_cash_count?: boolean | null
          enable_cashier_x_report?: boolean | null
          enable_manager_pin_audit_log?: boolean | null
          max_cart_discount_amount?: number | null
          max_cashier_discount_percent?: number | null
          max_drawer_cash_limit?: number | null
          max_refund_days_limit?: number | null
          offline_approval_requires_pin?: boolean
          online_only_edit_tenders?: boolean
          online_only_manual_discount?: boolean
          online_only_price_override?: boolean
          online_only_reduce_qty?: boolean
          online_only_refund?: boolean
          online_only_shift_close?: boolean
          online_only_stock_adjustment?: boolean
          online_only_terminal_reset?: boolean
          online_only_void_cart?: boolean
          online_only_void_line?: boolean
          prevent_below_cost_sale?: boolean | null
          prevent_negative_stock_sale?: boolean | null
          require_counted_cash_on_close?: boolean | null
          require_daily_sales_for_shift_close?: boolean | null
          require_manager_pin_for_cash_drawer_open?: boolean | null
          require_manager_pin_for_refund?: boolean | null
          require_manager_pin_on_variance?: boolean | null
          require_opening_float_count?: boolean | null
          require_pin_edit_tenders?: boolean | null
          require_pin_manual_discount?: boolean | null
          require_pin_price_override?: boolean | null
          require_pin_reduce_qty?: boolean | null
          require_pin_shift_close?: boolean | null
          require_pin_stock_adjustment?: boolean | null
          require_pin_terminal_reset?: boolean | null
          require_pin_void_cart?: boolean | null
          require_pin_void_line?: boolean | null
          require_reason_for_payout?: boolean | null
          require_reason_for_price_override?: boolean | null
          require_receipt_for_refund?: boolean | null
          row_version?: number
          show_expected_totals_at_close?: boolean | null
          show_itemized_tender_breakdown?: boolean | null
          show_live_variance_at_close?: boolean | null
          show_opening_float_at_close?: boolean | null
          store_id?: string
          track_item_voids?: boolean | null
          updated_at?: string
          updated_by?: string | null
          variance_pin_threshold?: number | null
        }
        Relationships: []
      }
      product_barcodes: {
        Row: {
          barcode: string
          created_at: string
          deleted_at: string | null
          id: string
          is_primary: boolean
          label: string | null
          pack_size: number
          product_id: string
          row_version: number
          updated_at: string
        }
        Insert: {
          barcode: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_primary?: boolean
          label?: string | null
          pack_size?: number
          product_id: string
          row_version?: number
          updated_at?: string
        }
        Update: {
          barcode?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_primary?: boolean
          label?: string | null
          pack_size?: number
          product_id?: string
          row_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_barcodes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          kind: string
          name: string
          parent_id: string | null
          row_version: number
          sort: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          parent_id?: string | null
          row_version?: number
          sort?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          parent_id?: string | null
          row_version?: number
          sort?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
          barcode: string
          barcode_aliases: string[]
          barcode_variants: Json
          brand: string | null
          category: string | null
          cost_price: number
          created_at: string
          custom_points: number | null
          deleted_at: string | null
          ecom_price: number | null
          ecom_visible: boolean
          id: string
          is_archived: boolean
          landing_pct: number | null
          name: string
          owner_store_id: string | null
          packs: Json
          point_multiplier: number
          product_group: string | null
          reorder_level: number
          row_version: number
          selling_price: number
          sku: string | null
          stock_by_store: Json
          stock_quantity: number
          sub_category: string | null
          tax_rate: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          barcode: string
          barcode_aliases?: string[]
          barcode_variants?: Json
          brand?: string | null
          category?: string | null
          cost_price?: number
          created_at?: string
          custom_points?: number | null
          deleted_at?: string | null
          ecom_price?: number | null
          ecom_visible?: boolean
          id?: string
          is_archived?: boolean
          landing_pct?: number | null
          name: string
          owner_store_id?: string | null
          packs?: Json
          point_multiplier?: number
          product_group?: string | null
          reorder_level?: number
          row_version?: number
          selling_price?: number
          sku?: string | null
          stock_by_store?: Json
          stock_quantity?: number
          sub_category?: string | null
          tax_rate?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          barcode?: string
          barcode_aliases?: string[]
          barcode_variants?: Json
          brand?: string | null
          category?: string | null
          cost_price?: number
          created_at?: string
          custom_points?: number | null
          deleted_at?: string | null
          ecom_price?: number | null
          ecom_visible?: boolean
          id?: string
          is_archived?: boolean
          landing_pct?: number | null
          name?: string
          owner_store_id?: string | null
          packs?: Json
          point_multiplier?: number
          product_group?: string | null
          reorder_level?: number
          row_version?: number
          selling_price?: number
          sku?: string | null
          stock_by_store?: Json
          stock_quantity?: number
          sub_category?: string | null
          tax_rate?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_owner_store_id_fkey"
            columns: ["owner_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          created_at: string
          deleted_at: string | null
          discount_amount: number
          discount_percent: number
          end_date: string | null
          foc_product_id: string | null
          id: string
          is_active: boolean
          min_spend: number
          points_per_dollar: number
          promo_type: string
          row_version: number
          start_date: string | null
          tier_rates: Json | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          discount_amount?: number
          discount_percent?: number
          end_date?: string | null
          foc_product_id?: string | null
          id?: string
          is_active?: boolean
          min_spend?: number
          points_per_dollar?: number
          promo_type: string
          row_version?: number
          start_date?: string | null
          tier_rates?: Json | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          discount_amount?: number
          discount_percent?: number
          end_date?: string | null
          foc_product_id?: string | null
          id?: string
          is_active?: boolean
          min_spend?: number
          points_per_dollar?: number
          promo_type?: string
          row_version?: number
          start_date?: string | null
          tier_rates?: Json | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotions_foc_product_id_fkey"
            columns: ["foc_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      public_flags: {
        Row: {
          enabled: boolean
          key: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          key: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          barcode: string | null
          cost_price: number
          created_at: string
          id: string
          po_id: string
          product_id: string | null
          product_name: string | null
          quantity_received: number
          row_version: number
          selling_price: number
          sku: string | null
          subtotal_cost: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          po_id: string
          product_id?: string | null
          product_name?: string | null
          quantity_received?: number
          row_version?: number
          selling_price?: number
          sku?: string | null
          subtotal_cost?: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          po_id?: string
          product_id?: string | null
          product_name?: string | null
          quantity_received?: number
          row_version?: number
          selling_price?: number
          sku?: string | null
          subtotal_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          id: string
          invoice_date: string | null
          invoice_entry_date: string | null
          operator_name: string | null
          pending_edit_at: string | null
          pending_edit_by: string | null
          pending_edit_request_id: string | null
          po_number: string | null
          reference: string | null
          row_version: number
          status: string
          store_code: string | null
          store_id: string | null
          supplier_id: string | null
          supplier_name: string | null
          total_cost: number
          total_items_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_date?: string | null
          invoice_entry_date?: string | null
          operator_name?: string | null
          pending_edit_at?: string | null
          pending_edit_by?: string | null
          pending_edit_request_id?: string | null
          po_number?: string | null
          reference?: string | null
          row_version?: number
          status?: string
          store_code?: string | null
          store_id?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_cost?: number
          total_items_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_date?: string | null
          invoice_entry_date?: string | null
          operator_name?: string | null
          pending_edit_at?: string | null
          pending_edit_by?: string | null
          pending_edit_request_id?: string | null
          po_number?: string | null
          reference?: string | null
          row_version?: number
          status?: string
          store_code?: string | null
          store_id?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_cost?: number
          total_items_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      record_edits: {
        Row: {
          action_key: string
          after_value: Json
          authorized_by: string | null
          authorized_by_name: string | null
          before_value: Json
          created_at: string
          edited_by: string | null
          edited_by_name: string | null
          id: string
          mode_used: string | null
          note: string | null
          record_id: string
          record_type: string
          reference: string | null
          request_id: string | null
          stock_deltas: Json
          store_id: string | null
          terminal_id: string | null
        }
        Insert: {
          action_key: string
          after_value?: Json
          authorized_by?: string | null
          authorized_by_name?: string | null
          before_value?: Json
          created_at?: string
          edited_by?: string | null
          edited_by_name?: string | null
          id?: string
          mode_used?: string | null
          note?: string | null
          record_id: string
          record_type: string
          reference?: string | null
          request_id?: string | null
          stock_deltas?: Json
          store_id?: string | null
          terminal_id?: string | null
        }
        Update: {
          action_key?: string
          after_value?: Json
          authorized_by?: string | null
          authorized_by_name?: string | null
          before_value?: Json
          created_at?: string
          edited_by?: string | null
          edited_by_name?: string | null
          id?: string
          mode_used?: string | null
          note?: string | null
          record_id?: string
          record_type?: string
          reference?: string | null
          request_id?: string | null
          stock_deltas?: Json
          store_id?: string | null
          terminal_id?: string | null
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          branch_id: string | null
          coupon_code: string | null
          coupon_discount: number
          created_at: string
          discount_amount: number
          discount_percent: number
          id: string
          is_foc: boolean
          is_return: boolean
          product_id: string | null
          product_name: string
          promo_id: string | null
          quantity: number
          refunded_qty: number
          row_version: number
          sale_id: string
          tax_rate: number
          unit_cost: number
          unit_price: number
        }
        Insert: {
          branch_id?: string | null
          coupon_code?: string | null
          coupon_discount?: number
          created_at?: string
          discount_amount?: number
          discount_percent?: number
          id?: string
          is_foc?: boolean
          is_return?: boolean
          product_id?: string | null
          product_name: string
          promo_id?: string | null
          quantity?: number
          refunded_qty?: number
          row_version?: number
          sale_id: string
          tax_rate?: number
          unit_cost?: number
          unit_price?: number
        }
        Update: {
          branch_id?: string | null
          coupon_code?: string | null
          coupon_discount?: number
          created_at?: string
          discount_amount?: number
          discount_percent?: number
          id?: string
          is_foc?: boolean
          is_return?: boolean
          product_id?: string | null
          product_name?: string
          promo_id?: string | null
          quantity?: number
          refunded_qty?: number
          row_version?: number
          sale_id?: string
          tax_rate?: number
          unit_cost?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          authorization_request_id: string | null
          authorized_at: string | null
          authorized_by: string | null
          bill_number: string
          branch_id: string | null
          cashier_id: string | null
          cashier_name: string | null
          change_amount: number
          client_transaction_id: string | null
          coupon_code: string | null
          coupon_discount: number
          coupon_promo_id: string | null
          coupon_scope: string | null
          created_at: string
          created_by: string | null
          discount_amount: number
          exchange_credit: number
          exchanged_to_bill_number: string | null
          id: string
          is_exchange: boolean
          is_refunded: boolean
          member_id: string | null
          original_bill_number: string | null
          paid_amount: number
          payment_type: string
          payments: Json
          points_earned: number
          points_redeemed: number
          rounding_adjustment: number
          rounding_label: string | null
          row_version: number
          shift_id: string | null
          store_address_snapshot: string | null
          store_id: string | null
          store_name_snapshot: string | null
          subtotal_amount: number
          tax_amount: number
          total_amount: number
          updated_by: string | null
        }
        Insert: {
          authorization_request_id?: string | null
          authorized_at?: string | null
          authorized_by?: string | null
          bill_number: string
          branch_id?: string | null
          cashier_id?: string | null
          cashier_name?: string | null
          change_amount?: number
          client_transaction_id?: string | null
          coupon_code?: string | null
          coupon_discount?: number
          coupon_promo_id?: string | null
          coupon_scope?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          exchange_credit?: number
          exchanged_to_bill_number?: string | null
          id?: string
          is_exchange?: boolean
          is_refunded?: boolean
          member_id?: string | null
          original_bill_number?: string | null
          paid_amount?: number
          payment_type?: string
          payments?: Json
          points_earned?: number
          points_redeemed?: number
          rounding_adjustment?: number
          rounding_label?: string | null
          row_version?: number
          shift_id?: string | null
          store_address_snapshot?: string | null
          store_id?: string | null
          store_name_snapshot?: string | null
          subtotal_amount?: number
          tax_amount?: number
          total_amount?: number
          updated_by?: string | null
        }
        Update: {
          authorization_request_id?: string | null
          authorized_at?: string | null
          authorized_by?: string | null
          bill_number?: string
          branch_id?: string | null
          cashier_id?: string | null
          cashier_name?: string | null
          change_amount?: number
          client_transaction_id?: string | null
          coupon_code?: string | null
          coupon_discount?: number
          coupon_promo_id?: string | null
          coupon_scope?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          exchange_credit?: number
          exchanged_to_bill_number?: string | null
          id?: string
          is_exchange?: boolean
          is_refunded?: boolean
          member_id?: string | null
          original_bill_number?: string | null
          paid_amount?: number
          payment_type?: string
          payments?: Json
          points_earned?: number
          points_redeemed?: number
          rounding_adjustment?: number
          rounding_label?: string | null
          row_version?: number
          shift_id?: string | null
          store_address_snapshot?: string | null
          store_id?: string | null
          store_name_snapshot?: string | null
          subtotal_amount?: number
          tax_amount?: number
          total_amount?: number
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      secure_settings: {
        Row: {
          ciphertext: string
          created_at: string
          hint: string | null
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ciphertext: string
          created_at?: string
          hint?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ciphertext?: string
          created_at?: string
          hint?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      security_findings: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          deployment_ref: string | null
          detail: string
          fingerprint: string
          first_seen_at: string
          id: string
          last_seen_at: string
          resolved_at: string | null
          severity: string
          source: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          deployment_ref?: string | null
          detail?: string
          fingerprint: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          resolved_at?: string | null
          severity?: string
          source: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          deployment_ref?: string | null
          detail?: string
          fingerprint?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          resolved_at?: string | null
          severity?: string
          source?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      settings_locks: {
        Row: {
          created_at: string
          locked: boolean
          section: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          locked?: boolean
          section: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          locked?: boolean
          section?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      settings_overrides: {
        Row: {
          created_at: string
          patch: Json
          scope: string
          scope_id: string
          section: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          patch?: Json
          scope?: string
          scope_id?: string
          section: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          patch?: Json
          scope?: string
          scope_id?: string
          section?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      settings_scoped: {
        Row: {
          created_at: string
          is_overridden: boolean
          key: string
          scope: string
          scope_id: string
          updated_at: string
          updated_by: string | null
          value: Json | null
        }
        Insert: {
          created_at?: string
          is_overridden?: boolean
          key: string
          scope?: string
          scope_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json | null
        }
        Update: {
          created_at?: string
          is_overridden?: boolean
          key?: string
          scope?: string
          scope_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json | null
        }
        Relationships: []
      }
      shift_cash_counts: {
        Row: {
          client_key: string | null
          counted_by_name: string | null
          counted_by_staff_id: string | null
          counted_by_user_id: string | null
          counted_card: number | null
          counted_cash: number
          counted_digital: number | null
          created_at: string
          id: string
          kind: string
          reason: string | null
          shift_id: string
          store_id: string
          terminal_id: string | null
        }
        Insert: {
          client_key?: string | null
          counted_by_name?: string | null
          counted_by_staff_id?: string | null
          counted_by_user_id?: string | null
          counted_card?: number | null
          counted_cash: number
          counted_digital?: number | null
          created_at?: string
          id?: string
          kind?: string
          reason?: string | null
          shift_id: string
          store_id: string
          terminal_id?: string | null
        }
        Update: {
          client_key?: string | null
          counted_by_name?: string | null
          counted_by_staff_id?: string | null
          counted_by_user_id?: string | null
          counted_card?: number | null
          counted_cash?: number
          counted_digital?: number | null
          created_at?: string
          id?: string
          kind?: string
          reason?: string | null
          shift_id?: string
          store_id?: string
          terminal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_cash_counts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_close_events: {
        Row: {
          actor_name: string | null
          actor_staff_id: string | null
          actor_user_id: string | null
          created_at: string
          detail: Json
          event: string
          from_state: string | null
          id: string
          shift_id: string
          store_id: string
          terminal_id: string | null
          to_state: string | null
        }
        Insert: {
          actor_name?: string | null
          actor_staff_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          event: string
          from_state?: string | null
          id?: string
          shift_id: string
          store_id: string
          terminal_id?: string | null
          to_state?: string | null
        }
        Update: {
          actor_name?: string | null
          actor_staff_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          event?: string
          from_state?: string | null
          id?: string
          shift_id?: string
          store_id?: string
          terminal_id?: string | null
          to_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_close_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_reconciliations: {
        Row: {
          count_id: string | null
          counted_card: number | null
          counted_cash: number | null
          counted_digital: number | null
          created_at: string
          expected_card: number
          expected_cash: number
          expected_digital: number
          id: string
          shift_id: string
          store_id: string
          variance_card: number | null
          variance_cash: number | null
          variance_digital: number | null
          variance_status: string
          variance_total: number | null
        }
        Insert: {
          count_id?: string | null
          counted_card?: number | null
          counted_cash?: number | null
          counted_digital?: number | null
          created_at?: string
          expected_card?: number
          expected_cash?: number
          expected_digital?: number
          id?: string
          shift_id: string
          store_id: string
          variance_card?: number | null
          variance_cash?: number | null
          variance_digital?: number | null
          variance_status?: string
          variance_total?: number | null
        }
        Update: {
          count_id?: string | null
          counted_card?: number | null
          counted_cash?: number | null
          counted_digital?: number | null
          created_at?: string
          expected_card?: number
          expected_cash?: number
          expected_digital?: number
          id?: string
          shift_id?: string
          store_id?: string
          variance_card?: number | null
          variance_cash?: number | null
          variance_digital?: number | null
          variance_status?: string
          variance_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_reconciliations_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "shift_cash_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_reconciliations_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_sessions: {
        Row: {
          created_at: string
          id: string
          role: string | null
          row_version: number
          shift_id: string | null
          signed_in_at: string
          signed_out_at: string | null
          staff_id: string | null
          staff_name: string
          store_id: string
          terminal_id: string | null
          terminal_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string | null
          row_version?: number
          shift_id?: string | null
          signed_in_at?: string
          signed_out_at?: string | null
          staff_id?: string | null
          staff_name: string
          store_id: string
          terminal_id?: string | null
          terminal_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string | null
          row_version?: number
          shift_id?: string | null
          signed_in_at?: string
          signed_out_at?: string | null
          staff_id?: string | null
          staff_name?: string
          store_id?: string
          terminal_id?: string | null
          terminal_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shift_variance_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          attempts: number
          created_at: string
          delivery_status: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          message: string
          reconciliation_id: string | null
          severity: string
          shift_id: string
          store_id: string
          updated_at: string
          variance_status: string
          variance_total: number
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          attempts?: number
          created_at?: string
          delivery_status?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          message: string
          reconciliation_id?: string | null
          severity?: string
          shift_id: string
          store_id: string
          updated_at?: string
          variance_status: string
          variance_total: number
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          attempts?: number
          created_at?: string
          delivery_status?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          message?: string
          reconciliation_id?: string | null
          severity?: string
          shift_id?: string
          store_id?: string
          updated_at?: string
          variance_status?: string
          variance_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "shift_variance_alerts_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "shift_reconciliations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_variance_alerts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          close_reason: string | null
          closed_at: string | null
          closed_by_name: string | null
          closed_by_role: string | null
          closed_by_staff_id: string | null
          closing_float: number | null
          closing_started_at: string | null
          closing_started_by: string | null
          counted_card: number | null
          counted_cash: number | null
          counted_digital: number | null
          created_at: string
          expected_card: number | null
          expected_cash: number | null
          expected_digital: number | null
          final_counted_cash: number | null
          id: string
          note: string
          opened_at: string
          opened_by_name: string
          opened_by_role: string | null
          opened_by_staff_id: string | null
          opening_float: number
          overdue: boolean
          row_version: number
          state: string
          status: string
          store_id: string
          terminal_id: string | null
          terminal_name: string | null
          updated_at: string
          user_id: string | null
          variance_card: number | null
          variance_cash: number | null
          variance_digital: number | null
          variance_status: string | null
          variance_total: number | null
        }
        Insert: {
          close_reason?: string | null
          closed_at?: string | null
          closed_by_name?: string | null
          closed_by_role?: string | null
          closed_by_staff_id?: string | null
          closing_float?: number | null
          closing_started_at?: string | null
          closing_started_by?: string | null
          counted_card?: number | null
          counted_cash?: number | null
          counted_digital?: number | null
          created_at?: string
          expected_card?: number | null
          expected_cash?: number | null
          expected_digital?: number | null
          final_counted_cash?: number | null
          id?: string
          note?: string
          opened_at?: string
          opened_by_name?: string
          opened_by_role?: string | null
          opened_by_staff_id?: string | null
          opening_float?: number
          overdue?: boolean
          row_version?: number
          state?: string
          status?: string
          store_id: string
          terminal_id?: string | null
          terminal_name?: string | null
          updated_at?: string
          user_id?: string | null
          variance_card?: number | null
          variance_cash?: number | null
          variance_digital?: number | null
          variance_status?: string | null
          variance_total?: number | null
        }
        Update: {
          close_reason?: string | null
          closed_at?: string | null
          closed_by_name?: string | null
          closed_by_role?: string | null
          closed_by_staff_id?: string | null
          closing_float?: number | null
          closing_started_at?: string | null
          closing_started_by?: string | null
          counted_card?: number | null
          counted_cash?: number | null
          counted_digital?: number | null
          created_at?: string
          expected_card?: number | null
          expected_cash?: number | null
          expected_digital?: number | null
          final_counted_cash?: number | null
          id?: string
          note?: string
          opened_at?: string
          opened_by_name?: string
          opened_by_role?: string | null
          opened_by_staff_id?: string | null
          opening_float?: number
          overdue?: boolean
          row_version?: number
          state?: string
          status?: string
          store_id?: string
          terminal_id?: string | null
          terminal_name?: string | null
          updated_at?: string
          user_id?: string | null
          variance_card?: number | null
          variance_cash?: number | null
          variance_digital?: number | null
          variance_status?: string | null
          variance_total?: number | null
        }
        Relationships: []
      }
      sku_audit: {
        Row: {
          created_at: string
          id: string
          previous_sku: string | null
          product_id: string | null
          product_name: string | null
          role: string | null
          sku: string
          source: string
          staff_id: string | null
          staff_name: string | null
          store_id: string | null
          store_name: string | null
          terminal_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          previous_sku?: string | null
          product_id?: string | null
          product_name?: string | null
          role?: string | null
          sku: string
          source?: string
          staff_id?: string | null
          staff_name?: string | null
          store_id?: string | null
          store_name?: string | null
          terminal_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          previous_sku?: string | null
          product_id?: string | null
          product_name?: string | null
          role?: string | null
          sku?: string
          source?: string
          staff_id?: string | null
          staff_name?: string | null
          store_id?: string | null
          store_name?: string | null
          terminal_id?: string | null
        }
        Relationships: []
      }
      staff_roles: {
        Row: {
          base_level: string
          created_at: string
          is_core: boolean
          name: string
          permissions: Json
          slug: string
          updated_at: string
        }
        Insert: {
          base_level?: string
          created_at?: string
          is_core?: boolean
          name: string
          permissions?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          base_level?: string
          created_at?: string
          is_core?: boolean
          name?: string
          permissions?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_adjustments: {
        Row: {
          barcode: string | null
          cost_impact: number
          created_at: string
          delta: number
          draft_id: string | null
          id: string
          note: string
          previous_stock: number
          product_id: string | null
          product_name: string | null
          reason: string
          role: string | null
          row_version: number
          sku: string | null
          staff_id: string | null
          staff_name: string | null
          store_id: string | null
          terminal_id: string | null
          updated_stock: number
        }
        Insert: {
          barcode?: string | null
          cost_impact?: number
          created_at?: string
          delta?: number
          draft_id?: string | null
          id?: string
          note?: string
          previous_stock?: number
          product_id?: string | null
          product_name?: string | null
          reason?: string
          role?: string | null
          row_version?: number
          sku?: string | null
          staff_id?: string | null
          staff_name?: string | null
          store_id?: string | null
          terminal_id?: string | null
          updated_stock?: number
        }
        Update: {
          barcode?: string | null
          cost_impact?: number
          created_at?: string
          delta?: number
          draft_id?: string | null
          id?: string
          note?: string
          previous_stock?: number
          product_id?: string | null
          product_name?: string | null
          reason?: string
          role?: string | null
          row_version?: number
          sku?: string | null
          staff_id?: string | null
          staff_name?: string | null
          store_id?: string | null
          terminal_id?: string | null
          updated_stock?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_drafts: {
        Row: {
          created_at: string
          id: string
          line_count: number
          lines: string
          note: string
          pending_edit_at: string | null
          pending_edit_by: string | null
          pending_edit_request_id: string | null
          posted_at: string | null
          posted_by: string | null
          reason: string | null
          reference: string | null
          staff_id: string | null
          staff_name: string | null
          status: string
          store_code: string | null
          store_id: string | null
          terminal_id: string | null
          total_impact: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          line_count?: number
          lines?: string
          note?: string
          pending_edit_at?: string | null
          pending_edit_by?: string | null
          pending_edit_request_id?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reason?: string | null
          reference?: string | null
          staff_id?: string | null
          staff_name?: string | null
          status?: string
          store_code?: string | null
          store_id?: string | null
          terminal_id?: string | null
          total_impact?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          line_count?: number
          lines?: string
          note?: string
          pending_edit_at?: string | null
          pending_edit_by?: string | null
          pending_edit_request_id?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reason?: string | null
          reference?: string | null
          staff_id?: string | null
          staff_name?: string | null
          status?: string
          store_code?: string | null
          store_id?: string | null
          terminal_id?: string | null
          total_impact?: number
          updated_at?: string
        }
        Relationships: []
      }
      stock_delta_applied: {
        Row: {
          applied_at: string
          delta: number
          movement_id: string
          product_id: string | null
          store_id: string | null
        }
        Insert: {
          applied_at?: string
          delta?: number
          movement_id: string
          product_id?: string | null
          store_id?: string | null
        }
        Update: {
          applied_at?: string
          delta?: number
          movement_id?: string
          product_id?: string | null
          store_id?: string | null
        }
        Relationships: []
      }
      stock_transfer_items: {
        Row: {
          barcode: string | null
          created_at: string
          id: string
          product_id: string | null
          product_name: string | null
          quantity: number
          quantity_approved: number | null
          quantity_dispatched: number | null
          quantity_received: number
          quantity_verified: number | null
          row_version: number
          sku: string | null
          transfer_id: string
          unit_cost: number
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          product_name?: string | null
          quantity?: number
          quantity_approved?: number | null
          quantity_dispatched?: number | null
          quantity_received?: number
          quantity_verified?: number | null
          row_version?: number
          sku?: string | null
          transfer_id: string
          unit_cost?: number
        }
        Update: {
          barcode?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          product_name?: string | null
          quantity?: number
          quantity_approved?: number | null
          quantity_dispatched?: number | null
          quantity_received?: number
          quantity_verified?: number | null
          row_version?: number
          sku?: string | null
          transfer_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          cancelled_reason: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          discrepancy_reason: string | null
          dispatched_at: string | null
          dispatched_by: string | null
          from_group_id: string | null
          from_store_id: string
          from_store_name: string | null
          fulfilment: string | null
          id: string
          kind: string
          note: string
          posted_at: string | null
          received_at: string | null
          received_by: string | null
          ref: string
          rejected_by: string | null
          rejected_reason: string | null
          row_version: number
          source_request_id: string | null
          status: string
          to_group_id: string | null
          to_store_id: string
          to_store_name: string | null
          transfer_scope: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          cancelled_reason?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          discrepancy_reason?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          from_group_id?: string | null
          from_store_id: string
          from_store_name?: string | null
          fulfilment?: string | null
          id?: string
          kind?: string
          note?: string
          posted_at?: string | null
          received_at?: string | null
          received_by?: string | null
          ref: string
          rejected_by?: string | null
          rejected_reason?: string | null
          row_version?: number
          source_request_id?: string | null
          status?: string
          to_group_id?: string | null
          to_store_id: string
          to_store_name?: string | null
          transfer_scope?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          cancelled_reason?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          discrepancy_reason?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          from_group_id?: string | null
          from_store_id?: string
          from_store_name?: string | null
          fulfilment?: string | null
          id?: string
          kind?: string
          note?: string
          posted_at?: string | null
          received_at?: string | null
          received_by?: string | null
          ref?: string
          rejected_by?: string | null
          rejected_reason?: string | null
          row_version?: number
          source_request_id?: string | null
          status?: string
          to_group_id?: string | null
          to_store_id?: string
          to_store_name?: string | null
          transfer_scope?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_source_request_id_fkey"
            columns: ["source_request_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      store_groups: {
        Row: {
          archived_at: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          code: string
          created_at?: string
          id: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      stores: {
        Row: {
          address: string | null
          archived_at: string | null
          building_name: string | null
          code: string
          created_at: string
          deleted_at: string | null
          floor_label: string | null
          group_id: string | null
          id: string
          is_active: boolean
          is_central: boolean
          is_primary_sub: boolean
          location_type: string
          name: string
          parent_id: string | null
          phone: string | null
          private_catalogue: boolean
          receipt_prefix: string | null
          row_version: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          building_name?: string | null
          code: string
          created_at?: string
          deleted_at?: string | null
          floor_label?: string | null
          group_id?: string | null
          id: string
          is_active?: boolean
          is_central?: boolean
          is_primary_sub?: boolean
          location_type?: string
          name: string
          parent_id?: string | null
          phone?: string | null
          private_catalogue?: boolean
          receipt_prefix?: string | null
          row_version?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          building_name?: string | null
          code?: string
          created_at?: string
          deleted_at?: string | null
          floor_label?: string | null
          group_id?: string | null
          id?: string
          is_active?: boolean
          is_central?: boolean
          is_primary_sub?: boolean
          location_type?: string
          name?: string
          parent_id?: string | null
          phone?: string | null
          private_catalogue?: boolean
          receipt_prefix?: string | null
          row_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "store_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_name: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          row_version: number
          tax_number: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          row_version?: number
          tax_number?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          row_version?: number
          tax_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sync_metadata: {
        Row: {
          created_at: string
          id: string
          last_error: string | null
          last_pushed_at: string | null
          last_synced_at: string | null
          rows_pushed: number
          store_id: string | null
          table_name: string
          terminal_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_error?: string | null
          last_pushed_at?: string | null
          last_synced_at?: string | null
          rows_pushed?: number
          store_id?: string | null
          table_name: string
          terminal_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_error?: string | null
          last_pushed_at?: string | null
          last_synced_at?: string | null
          rows_pushed?: number
          store_id?: string | null
          table_name?: string
          terminal_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      system_audit_logs: {
        Row: {
          action_type: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          created_at: string
          entity_affected: string | null
          entity_id: string | null
          id: string
          ip_address: string | null
          new_value: Json | null
          note: string | null
          old_value: Json | null
          store_id: string | null
          terminal_id: string | null
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string
          entity_affected?: string | null
          entity_id?: string | null
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          note?: string | null
          old_value?: Json | null
          store_id?: string | null
          terminal_id?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string
          entity_affected?: string | null
          entity_id?: string | null
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          note?: string | null
          old_value?: Json | null
          store_id?: string | null
          terminal_id?: string | null
        }
        Relationships: []
      }
      terminal_commands: {
        Row: {
          command: string
          created_at: string
          finished_at: string | null
          id: string
          issued_by: string | null
          issued_role: string | null
          note: string | null
          picked_up_at: string | null
          result: string | null
          status: string
          store_id: string | null
          terminal_id: string
          updated_at: string
        }
        Insert: {
          command: string
          created_at?: string
          finished_at?: string | null
          id?: string
          issued_by?: string | null
          issued_role?: string | null
          note?: string | null
          picked_up_at?: string | null
          result?: string | null
          status?: string
          store_id?: string | null
          terminal_id: string
          updated_at?: string
        }
        Update: {
          command?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          issued_by?: string | null
          issued_role?: string | null
          note?: string | null
          picked_up_at?: string | null
          result?: string | null
          status?: string
          store_id?: string | null
          terminal_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      terminal_recovery_secrets: {
        Row: {
          created_at: string
          device_name: string | null
          fingerprint: string
          platform: string
          sealed_secret: string
          terminal_token_id: string
          updated_at: string
          utc_offset_minutes: number
        }
        Insert: {
          created_at?: string
          device_name?: string | null
          fingerprint: string
          platform?: string
          sealed_secret: string
          terminal_token_id: string
          updated_at?: string
          utc_offset_minutes?: number
        }
        Update: {
          created_at?: string
          device_name?: string | null
          fingerprint?: string
          platform?: string
          sealed_secret?: string
          terminal_token_id?: string
          updated_at?: string
          utc_offset_minutes?: number
        }
        Relationships: []
      }
      terminal_tokens: {
        Row: {
          activated_at: string | null
          app_version: string | null
          claim_proof: string | null
          claimed_at: string | null
          claimed_by_device: string | null
          claimed_os: string | null
          created_at: string
          device_name: string
          expires_at: string | null
          id: string
          last_seen_at: string | null
          last_sync_at: string | null
          location_id: string | null
          location_name: string | null
          platform: string
          reissued_at: string | null
          replaced_by: string | null
          revoked_at: string | null
          row_version: number
          status: string
        }
        Insert: {
          activated_at?: string | null
          app_version?: string | null
          claim_proof?: string | null
          claimed_at?: string | null
          claimed_by_device?: string | null
          claimed_os?: string | null
          created_at?: string
          device_name: string
          expires_at?: string | null
          id?: string
          last_seen_at?: string | null
          last_sync_at?: string | null
          location_id?: string | null
          location_name?: string | null
          platform?: string
          reissued_at?: string | null
          replaced_by?: string | null
          revoked_at?: string | null
          row_version?: number
          status?: string
        }
        Update: {
          activated_at?: string | null
          app_version?: string | null
          claim_proof?: string | null
          claimed_at?: string | null
          claimed_by_device?: string | null
          claimed_os?: string | null
          created_at?: string
          device_name?: string
          expires_at?: string | null
          id?: string
          last_seen_at?: string | null
          last_sync_at?: string | null
          location_id?: string | null
          location_name?: string | null
          platform?: string
          reissued_at?: string | null
          replaced_by?: string | null
          revoked_at?: string | null
          row_version?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "terminal_tokens_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      uom_units: {
        Row: {
          allow_decimal: boolean
          code: string
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          row_version: number
          sort: number
          updated_at: string
        }
        Insert: {
          allow_decimal?: boolean
          code: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          row_version?: number
          sort?: number
          updated_at?: string
        }
        Update: {
          allow_decimal?: boolean
          code?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          row_version?: number
          sort?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_queue: {
        Row: {
          body: string
          created_at: string
          error: string | null
          id: string
          phone_number_id: string
          queued_at: string
          recipient: string
          reference: string | null
          sent_at: string | null
          status: string
          store_id: string | null
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          error?: string | null
          id?: string
          phone_number_id?: string
          queued_at?: string
          recipient: string
          reference?: string | null
          sent_at?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          error?: string | null
          id?: string
          phone_number_id?: string
          queued_at?: string
          recipient?: string
          reference?: string | null
          sent_at?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_daily_item_sales: {
        Row: {
          cost: number | null
          product_id: string | null
          product_name: string | null
          product_category: string | null
          profit: number | null
          revenue: number | null
          sale_day: string | null
          sale_month: string | null
          store_id: string | null
          units: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      v_daily_store_sales: {
        Row: {
          bills: number | null
          cost: number | null
          discount: number | null
          foc_value: number | null
          profit: number | null
          revenue: number | null
          sale_day: string | null
          sale_month: string | null
          store_id: string | null
          units: number | null
        }
        Relationships: []
      }
      v_sale_line_facts: {
        Row: {
          bill_number: string | null
          cashier_name: string | null
          created_at: string | null
          is_foc: boolean | null
          is_refunded: boolean | null
          is_return: boolean | null
          line_cost: number | null
          line_discount: number | null
          line_id: string | null
          line_revenue: number | null
          payment_type: string | null
          product_id: string | null
          product_name: string | null
          quantity: number | null
          sale_day: string | null
          sale_id: string | null
          sale_month: string | null
          store_id: string | null
          unit_cost: number | null
          unit_discount: number | null
          unit_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      set_activity_event_cleared: {
        Args: { p_cleared: boolean; p_event_id: string }
        Returns: undefined
      }
      set_all_activity_events_cleared: { Args: never; Returns: number }
      assert_supervisor_caller: { Args: never; Returns: undefined }
      authorization_verify_pin: {
        Args: {
          p_allowed_roles?: string[]
          p_allowed_users?: string[]
          p_pin: string
          p_user_id: string
        }
        Returns: {
          full_name: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      booking_balance_state: {
        Args: { _booking_id: string }
        Returns: {
          booking_id: string
          fully_paid: boolean
          job_status: string
          outstanding: number
          settled_paid: number
          status: string
          total: number
        }[]
      }
      booking_cancel: {
        Args: {
          _booking_id: string
          _cancelled_by?: string
          _client_payment_id?: string
          _money_action?: string
          _reason: string
          _terminal?: string
        }
        Returns: {
          booking_ref: string | null
          cancel_money_action: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_terminal: string | null
          cashier: string | null
          charges: Json
          closed_at: string | null
          created_at: string
          customer_name: string
          customer_phone: string
          discount: number
          dropped_off_at: string | null
          due_date: string | null
          grip_product_id: string | null
          grommet_notes: string | null
          id: string
          incident_note: string | null
          intake_note: string | null
          job_notes: string | null
          job_status: string
          job_status_at: string | null
          job_status_by: string | null
          liability_accepted: boolean
          lines: Json
          member_id: string | null
          note: string
          notify_whatsapp: boolean
          paid: number
          payment_timing: string | null
          promised_at: string | null
          racket_model: string | null
          ref: string
          row_version: number
          sale_receipt_no: string | null
          service_fee: number
          service_name: string | null
          service_type_id: string | null
          shift_id: string | null
          status: string
          store_id: string | null
          string_origin: string | null
          string_source_product_id: string | null
          string_type: string | null
          subtotal: number
          tag_id: string | null
          tax: number
          technician: string | null
          tension_cross: number | null
          tension_main: number | null
          tension_unit: string
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      booking_collect: {
        Args: {
          _amount: number
          _booking_id: string
          _cashier?: string
          _client_payment_id?: string
          _complete?: boolean
          _method: string
          _reference?: string
        }
        Returns: {
          change_due: number
          duplicate: boolean
          fully_paid: boolean
          job_status: string
          outstanding: number
          settled_paid: number
          status: string
          total: number
        }[]
      }
      booking_net_paid: { Args: { _booking_id: string }; Returns: number }
      booking_refund: {
        Args: {
          _amount: number
          _booking_id: string
          _cashier?: string
          _client_payment_id?: string
          _method?: string
          _reason?: string
        }
        Returns: {
          change_due: number
          duplicate: boolean
          fully_paid: boolean
          job_status: string
          outstanding: number
          settled_paid: number
          status: string
          total: number
        }[]
      }
      campaign_is_live: {
        Args: { _c: Database["public"]["Tables"]["coupon_campaigns"]["Row"] }
        Returns: boolean
      }
      coupon_claim: {
        Args: {
          _email?: string
          _full_name?: string
          _phone: string
          _slug: string
        }
        Returns: string
      }
      coupon_issue_manual: {
        Args: {
          _expires_at?: string
          _full_name?: string
          _ignore_limit?: boolean
          _phone: string
          _role?: string
          _slug: string
          _staff?: string
          _store?: string
        }
        Returns: string
      }
      coupon_log: {
        Args: {
          _campaign: Database["public"]["Tables"]["coupon_campaigns"]["Row"]
          _member?: string
          _note?: string
          _phone?: string
          _role?: string
          _sale?: string
          _staff?: string
          _store?: string
          _terminal?: string
          _token?: string
          _type: string
        }
        Returns: undefined
      }
      current_app_user: {
        Args: never
        Returns: {
          email: string
          full_name: string
          id: string
          is_active: boolean
          permissions: Json
          role: Database["public"]["Enums"]["app_role"]
          store_id: string
          user_id: string
        }[]
      }
      delete_cashier: { Args: { p_id: string }; Returns: undefined }
      delete_terminal_user: { Args: { p_user_id: string }; Returns: undefined }
      has_perm: { Args: { _flag: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      held_orders_open_count: { Args: { _store_id?: string }; Returns: number }
      is_app_supervisor: { Args: never; Returns: boolean }
      is_cross_group_transfer: {
        Args: { _from: string; _to: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      is_staff_now: { Args: never; Returns: boolean }
      is_supervisor_now: { Args: never; Returns: boolean }
      legacy_cashiers_for_migration: {
        Args: never
        Returns: {
          full_name: string
          is_active: boolean
          pin_hash: string
          role_slug: string
          store_id: string
          username: string
        }[]
      }
      list_app_users: {
        Args: never
        Returns: {
          auth_user_id: string
          created_at: string
          email: string
          full_name: string
          has_pin: boolean
          id: string
          is_active: boolean
          last_login_at: string
          permissions: Json
          pin_length: number
          role: Database["public"]["Enums"]["app_role"]
          role_slug: string
          store_id: string
          user_id: string
        }[]
      }
      list_cashiers: {
        Args: never
        Returns: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          last_login_at: string
          permissions: Json
          store_id: string
          username: string
        }[]
      }
      log_manager_override: {
        Args: {
          _action: string
          _approved_by?: string
          _approved_role?: string
          _detail?: string
          _outcome?: string
          _requested_by?: string
          _rule_key?: string
          _store_id?: string
          _terminal_id?: string
        }
        Returns: string
      }
      may_approve_cross_group_transfer: { Args: never; Returns: boolean }
      member_join: {
        Args: { _email?: string; _full_name: string; _phone: string }
        Returns: string
      }
      member_welcome_claim: {
        Args: { _email?: string; _full_name: string; _phone: string }
        Returns: string
      }
      normalize_phone: { Args: { _phone: string }; Returns: string }
      operational_relational_health: { Args: never; Returns: Json }
      pin_throttle_fail: {
        Args: {
          _key: string
          _limit?: number
          _lock_secs?: number
          _window_secs?: number
        }
        Returns: Json
      }
      pin_throttle_reset: { Args: { _key: string }; Returns: undefined }
      pin_throttle_status: { Args: { _key: string }; Returns: Json }
      pos_rules_defaults: { Args: never; Returns: Json }
      pos_rules_get: { Args: { _store_id?: string }; Returns: Json }
      pos_rules_row: { Args: { _store_id: string }; Returns: Json }
      pos_rules_save: {
        Args: { _expected_version?: number; _patch: Json; _store_id: string }
        Returns: Json
      }
      product_delete_guard: { Args: { _product_id: string }; Returns: Json }
      product_visible_to_me: {
        Args: { _owner_store_id: string }
        Returns: boolean
      }
      sale_refund: {
        Args: {
          _client_refund_id?: string
          _lines?: Json
          _reason?: string
          _sale_id: string
        }
        Returns: Json
      }
      schema_inventory: { Args: never; Returns: Json }
      schema_inventory_deep: { Args: never; Returns: Json }
      security_report_findings: {
        Args: { _deployment_ref: string; _findings: Json; _source: string }
        Returns: Json
      }
      security_selfcheck: { Args: never; Returns: Json }
      security_set_finding_status: {
        Args: { _by?: string; _id: string; _status: string }
        Returns: undefined
      }
      set_app_user_permissions: {
        Args: { p_permissions: Json; p_user_id: string }
        Returns: undefined
      }
      set_app_user_profile: {
        Args: {
          p_full_name: string
          p_is_active: boolean
          p_role: Database["public"]["Enums"]["app_role"]
          p_store_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      set_authorization_pin: {
        Args: { p_pin: string; p_updated_by?: string; p_user_id: string }
        Returns: boolean
      }
      set_cashier_permissions: {
        Args: { p_id: string; p_permissions: Json }
        Returns: undefined
      }
      set_terminal_active: {
        Args: { p_active: boolean; p_user_id: string }
        Returns: undefined
      }
      settings_cluster_of: {
        Args: { _scope: string; _scope_id: string }
        Returns: string
      }
      settings_effective: {
        Args: { _scope: string; _scope_id: string }
        Returns: {
          effective_value: Json
          is_overridden: boolean
          parent_inherited_value: Json
          setting_key: string
          source: string
        }[]
      }
      settings_private_key: { Args: never; Returns: string }
      settings_sync_batch: {
        Args: { _keys: string[]; _scope: string; _scope_id: string }
        Returns: Json
      }
      settings_upsert: {
        Args: { _patch: Json; _scope: string; _scope_id: string }
        Returns: {
          effective_value: Json
          is_overridden: boolean
          parent_inherited_value: Json
          setting_key: string
          source: string
        }[]
      }
      shift_active_for_branch: {
        Args: { p_store_id: string }
        Returns: {
          close_reason: string | null
          closed_at: string | null
          closed_by_name: string | null
          closed_by_role: string | null
          closed_by_staff_id: string | null
          closing_float: number | null
          closing_started_at: string | null
          closing_started_by: string | null
          counted_card: number | null
          counted_cash: number | null
          counted_digital: number | null
          created_at: string
          expected_card: number | null
          expected_cash: number | null
          expected_digital: number | null
          final_counted_cash: number | null
          id: string
          note: string
          opened_at: string
          opened_by_name: string
          opened_by_role: string | null
          opened_by_staff_id: string | null
          opening_float: number
          overdue: boolean
          row_version: number
          state: string
          status: string
          store_id: string
          terminal_id: string | null
          terminal_name: string | null
          updated_at: string
          user_id: string | null
          variance_card: number | null
          variance_cash: number | null
          variance_digital: number | null
          variance_status: string | null
          variance_total: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shift_cash_count_submit: {
        Args: {
          p_card?: number
          p_cash: number
          p_client_key?: string
          p_digital?: number
          p_shift: string
          p_terminal?: string
        }
        Returns: string
      }
      shift_close_start: {
        Args: { p_reason: string; p_shift: string; p_terminal?: string }
        Returns: string
      }
      shift_expected_totals: {
        Args: { p_shift: string }
        Returns: {
          expected_card: number
          expected_cash: number
          expected_digital: number
        }[]
      }
      shift_expected_view: {
        Args: { p_shift: string }
        Returns: {
          expected_card: number
          expected_cash: number
          expected_digital: number
        }[]
      }
      shift_log_event: {
        Args: {
          p_detail: Json
          p_event: string
          p_from: string
          p_shift: string
          p_terminal: string
          p_to: string
        }
        Returns: undefined
      }
      shift_open: {
        Args: {
          p_id: string
          p_opened_by_name: string
          p_opened_by_role?: string
          p_opened_by_staff_id?: string
          p_opening_float?: number
          p_store_id: string
          p_terminal_id?: string
          p_terminal_name?: string
          p_user_id?: string
        }
        Returns: {
          close_reason: string | null
          closed_at: string | null
          closed_by_name: string | null
          closed_by_role: string | null
          closed_by_staff_id: string | null
          closing_float: number | null
          closing_started_at: string | null
          closing_started_by: string | null
          counted_card: number | null
          counted_cash: number | null
          counted_digital: number | null
          created_at: string
          expected_card: number | null
          expected_cash: number | null
          expected_digital: number | null
          final_counted_cash: number | null
          id: string
          note: string
          opened_at: string
          opened_by_name: string
          opened_by_role: string | null
          opened_by_staff_id: string | null
          opening_float: number
          overdue: boolean
          row_version: number
          state: string
          status: string
          store_id: string
          terminal_id: string | null
          terminal_name: string | null
          updated_at: string
          user_id: string | null
          variance_card: number | null
          variance_cash: number | null
          variance_digital: number | null
          variance_status: string | null
          variance_total: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shift_reconcile_now: {
        Args: {
          p_card: number
          p_cash: number
          p_count_id: string
          p_digital: number
          p_shift: string
        }
        Returns: {
          state: string
          variance_status: string
        }[]
      }
      shift_recount_submit: {
        Args: {
          p_card?: number
          p_cash: number
          p_digital?: number
          p_reason: string
          p_shift: string
          p_terminal?: string
        }
        Returns: string
      }
      shift_state: { Args: { p_shift: string }; Returns: string }
      shift_variance_approve: {
        Args: { p_note?: string; p_shift: string }
        Returns: string
      }
      staff_account_adopt_legacy: {
        Args: { p_username: string }
        Returns: undefined
      }
      staff_account_delete_profile: {
        Args: { p_auth_user_id: string; p_user_id: string }
        Returns: undefined
      }
      staff_account_set_active: {
        Args: { p_active: boolean; p_user_id: string }
        Returns: undefined
      }
      staff_account_set_pin: {
        Args: { p_pin: string; p_pin_length?: number; p_user_id: string }
        Returns: undefined
      }
      staff_account_upsert: {
        Args: {
          p_auth_user_id: string
          p_email: string
          p_full_name: string
          p_is_active: boolean
          p_permissions?: Json
          p_pin: string
          p_pin_length: number
          p_role: Database["public"]["Enums"]["app_role"]
          p_role_slug: string
          p_store_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      staff_role_delete: { Args: { _slug: string }; Returns: undefined }
      staff_role_save: {
        Args: {
          _base_level: string
          _name: string
          _permissions: Json
          _slug: string
        }
        Returns: undefined
      }
      stock_apply_delta: {
        Args: {
          _delta: number
          _movement_id: string
          _product_id: string
          _store_id: string
        }
        Returns: number
      }
      stock_apply_deltas: {
        Args: { _movements: Json }
        Returns: {
          balance: number
          movement_id: string
          reason: string
          status: string
        }[]
      }
      stock_reconcile: {
        Args: { _since?: string; _store_id: string }
        Returns: Json
      }
      stock_transfer_approval_required:
        | { Args: { _store_id: string }; Returns: boolean }
        | {
            Args: { _store_id: string; _to_store_id: string }
            Returns: boolean
          }
      stock_transfer_approve: {
        Args: { p_approved_by?: string; p_lines?: Json; p_transfer_id: string }
        Returns: undefined
      }
      stock_transfer_dispatch: {
        Args: {
          p_dispatched_by?: string
          p_lines?: Json
          p_transfer_id: string
        }
        Returns: undefined
      }
      stock_transfer_receive: {
        Args: {
          p_deduct_source?: boolean
          p_lines?: Json
          p_received_by?: string
          p_transfer_id: string
        }
        Returns: undefined
      }
      stock_transfer_verify: {
        Args: {
          p_lines?: Json
          p_reason?: string
          p_transfer_id: string
          p_verified_by?: string
        }
        Returns: undefined
      }
      store_group_of: { Args: { _store_id: string }; Returns: string }
      store_visible: { Args: { _store_id: string }; Returns: boolean }
      terminal_staff_list: {
        Args: { p_store_id?: string }
        Returns: {
          full_name: string
          kind: string
          pin_length: number
          role_slug: string
          store_id: string
          user_id: string
        }[]
      }
      terminal_token_claim: {
        Args: {
          p_device?: string
          p_os?: string
          p_platform?: string
          p_proof_hash?: string
          p_token_id: string
        }
        Returns: boolean
      }
      terminal_token_heartbeat: {
        Args: {
          p_activate?: boolean
          p_synced?: boolean
          p_token_id: string
          p_version?: string
        }
        Returns: undefined
      }
      terminal_token_status: {
        Args: { p_token_id: string }
        Returns: {
          expires_at: string
          is_claimed: boolean
          location_id: string
          location_name: string
          status: string
        }[]
      }
      transfer_in_my_branch: {
        Args: { _transfer_id: string }
        Returns: boolean
      }
      upsert_cashier: {
        Args: {
          p_full_name: string
          p_id: string
          p_is_active: boolean
          p_pin: string
          p_store_id: string
          p_username: string
        }
        Returns: string
      }
      upsert_terminal_user: {
        Args: {
          p_email: string
          p_full_name: string
          p_password: string
          p_pin: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_store_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      user_cluster_id: { Args: never; Returns: string }
      user_has_store_access: { Args: { _store_id: string }; Returns: boolean }
      user_store_id: { Args: never; Returns: string }
      verify_cashier_pin: {
        Args: { p_pin: string; p_username: string }
        Returns: {
          full_name: string
          id: string
          permissions: Json
          store_id: string
          username: string
        }[]
      }
      verify_manager_pin: {
        Args: {
          p_action?: string
          p_detail?: string
          p_pin: string
          p_requested_by?: string
          p_rule_key?: string
          p_store_id?: string
          p_terminal_id?: string
          p_user_id: string
        }
        Returns: {
          full_name: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      verify_terminal_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: {
          email: string
          full_name: string
          role: Database["public"]["Enums"]["app_role"]
          store_id: string
          user_id: string
        }[]
      }
      voucher_by_token: {
        Args: { _token: string }
        Returns: {
          campaign: Json
          member_code: string
          member_name: string
          voucher: Json
        }[]
      }
      voucher_redeem: {
        Args: {
          _sale_id?: string
          _staff?: string
          _store_id?: string
          _token: string
        }
        Returns: {
          campaign_id: string
          disable_reason: string | null
          disabled_at: string | null
          disabled_by: string | null
          expires_at: string | null
          id: string
          issued_at: string
          issued_by: string | null
          issued_source: string
          member_id: string | null
          redeemed_at: string | null
          redeemed_by: string | null
          redeemed_sale_id: string | null
          row_version: number
          status: string
          store_id: string | null
          token_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "issued_vouchers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      voucher_set_status: {
        Args: {
          _reason?: string
          _role?: string
          _staff?: string
          _status: string
          _store?: string
          _token: string
        }
        Returns: {
          campaign_id: string
          disable_reason: string | null
          disabled_at: string | null
          disabled_by: string | null
          expires_at: string | null
          id: string
          issued_at: string
          issued_by: string | null
          issued_source: string
          member_id: string | null
          redeemed_at: string | null
          redeemed_by: string | null
          redeemed_sale_id: string | null
          row_version: number
          status: string
          store_id: string | null
          token_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "issued_vouchers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      voucher_token: { Args: never; Returns: string }
    }
    Enums: {
      app_role: "admin" | "manager" | "staff"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "staff"],
    },
  },
} as const
