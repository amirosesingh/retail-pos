import installerSql from "../../supabase/schema.sql?raw";

/** Fresh-project installer only. Existing projects require reviewed migrations. */
export const DEEP_INVENTORY_INSTALLER_SQL = installerSql;

export const DEEP_INVENTORY_INSTALLER_FILENAME =
  "schema.sql";
