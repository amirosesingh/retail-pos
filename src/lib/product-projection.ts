type ProjectionError = { message: string; code?: string } | null;

/** One additive read column may lag the app rollout; authority errors never downgrade. */
export function isMissingCatalogueProjection(error: ProjectionError): boolean {
  if (!error) return false;
  return (error.code === "42703" && /^column\s+(?:(?:public\.)?products\.)?["']?catalogue_store_ids["']?\s+does not exist\b/i.test(error.message)) ||
    (error.code === "PGRST204" && /^Could not find the 'catalogue_store_ids' column of 'products' in the schema cache/i.test(error.message));
}

/** Capability is local to this read, so switching databases or applying a migration cannot leave a stale global override. */
export function createProductProjectionReader(initialColumns: string) {
  let columns = initialColumns;
  return async <T extends { error: ProjectionError }>(read: (columns: string) => PromiseLike<T>): Promise<T> => {
    const result = await read(columns);
    if (columns.split(",").some(column => column.trim() === "catalogue_store_ids") && isMissingCatalogueProjection(result.error)) {
      columns = columns.split(",").filter(column => column.trim() !== "catalogue_store_ids").join(",");
      return await read(columns);
    }
    return result;
  };
}
