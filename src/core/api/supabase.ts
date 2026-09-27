/**
 * The one door to the cloud client for platform code.
 *
 * This app talks only to the operator-configured project,
 * so the tenant-aware external client is what /platforms may use. The
 * generated integration files stay where the platform regenerates them; only
 * this module re-exports them.
 */
export {
  supabaseExternal,
  createTenantClient,
  resetExternalClient,
} from "@/integrations/supabase/external-client";
