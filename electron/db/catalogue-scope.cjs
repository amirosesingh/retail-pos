/** Parameterized SQL Server read scope matching the application's cluster catalogue rules. */
function catalogueReadPredicate(registry, alias = "source") {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("Invalid catalogue SQL alias.");
  const table = name => (registry.tables ?? []).find(entry => entry.cloudTable === name);
  const has = (name, columns) => {
    const entry = table(name);
    const names = new Set((entry?.columns ?? []).map(column => column.sqlServerColumn));
    return !!entry && columns.every(column => names.has(column));
  };
  const owner = `${alias}.[owner_store_id]`;
  const product = `${alias}.[id]`;
  // OPENJSON keys use BIN2 independently of the database's branch text. Resolve
  // that comparison conflict without changing the configured case/accent rules
  // or the existing operand normalization and catalogue eligibility clauses.
  const same = (left, right) => `LOWER(CONVERT(nvarchar(450),${left})) COLLATE DATABASE_DEFAULT=LOWER(CONVERT(nvarchar(450),${right})) COLLATE DATABASE_DEFAULT`;
  // An incomplete old registry cannot safely prove a catalogue relationship.
  // Do not turn a missing cluster/provenance schema into a company-wide read.
  if (!has("stores", ["id", "group_id", "private_catalogue"]) || !has("products", ["id", "owner_store_id", "stock_by_store"]))
    return `${owner}=@branch`;
  const targetGroup = `(SELECT TOP(1) NULLIF(LTRIM(RTRIM(ct.[group_id])),N'') FROM dbo.[stores] ct WHERE ${same("ct.[id]", "@branch")})`;
  const ownerGroup = `(SELECT TOP(1) NULLIF(LTRIM(RTRIM(co.[group_id])),N'') FROM dbo.[stores] co WHERE ${same("co.[id]", owner)})`;
  const groupCount = `(SELECT COUNT(DISTINCT NULLIF(LTRIM(RTRIM(cg.[group_id])),N'')) FROM dbo.[stores] cg)`;
  const sameGroup = (left, right) => `(NULLIF(LTRIM(RTRIM(${left})),N'') IS NOT NULL AND ${same(left, right)})`;
  const privacy = branch => {
    const row = `EXISTS(SELECT 1 FROM dbo.[stores] cp WHERE ${same("cp.[id]", branch)} AND cp.[private_catalogue]=1)`;
    const sources = [row];
    if (has("pos_settings", ["id", "integration_settings"])) sources.push(`EXISTS(SELECT 1 FROM dbo.[pos_settings] cs CROSS APPLY OPENJSON(JSON_QUERY(CASE WHEN ISJSON(cs.[integration_settings])=1 THEN cs.[integration_settings] ELSE N'{}' END,N'$.branches')) cb WHERE cs.[id]=1 AND ${same("cb.[key]", branch)} AND JSON_VALUE(cb.[value],N'$.privateCatalogue')=N'true')`);
    if (has("settings_scoped", ["scope", "scope_id", "key", "value"])) sources.push(`EXISTS(SELECT 1 FROM dbo.[settings_scoped] css CROSS APPLY OPENJSON(JSON_QUERY(CASE WHEN ISJSON(css.[value])=1 THEN css.[value] ELSE N'{}' END,N'$.branches')) cb WHERE css.[scope]=N'GLOBAL' AND css.[scope_id]=N'' AND css.[key]=N'pos_field:integration_settings' AND ${same("cb.[key]", branch)} AND JSON_VALUE(cb.[value],N'$.privateCatalogue')=N'true')`);
    return `(${sources.join(" OR ")})`;
  };
  const own = same(owner, "@branch");
  const sibling = sameGroup(ownerGroup, targetGroup);
  const unowned = `NULLIF(LTRIM(RTRIM(${owner})),N'') IS NULL`;
  const stock = `EXISTS(SELECT 1 FROM OPENJSON(CASE WHEN ISJSON(${alias}.[stock_by_store])=1 THEN ${alias}.[stock_by_store] ELSE N'{}' END) cq LEFT JOIN dbo.[stores] cq_store ON ${same("cq_store.[id]", "cq.[key]")} WHERE TRY_CONVERT(decimal(38,8),cq.[value])<>0 AND (${same("cq.[key]", "@branch")} OR ${sameGroup("cq_store.[group_id]", targetGroup)}))`;
  const sharedLegacy = `(${groupCount}<=1 AND NOT ${privacy("@branch")})`;
  const ungroupedOwned = `(EXISTS(SELECT 1 FROM dbo.[stores] ck WHERE ${same("ck.[id]", owner)}) AND ${ownerGroup} IS NULL AND ${targetGroup} IS NULL AND NOT ${privacy(owner)} AND NOT ${privacy("@branch")})`;
  let posted = "1=0";
  if (has("stock_transfers", ["id", "to_store_id", "status", "posted_at"]) && has("stock_transfer_items", ["transfer_id", "product_id", "quantity_verified", "quantity_received"])) {
    posted = `EXISTS(SELECT 1 FROM dbo.[stock_transfers] cv JOIN dbo.[stock_transfer_items] ci ON ci.[transfer_id]=cv.[id] LEFT JOIN dbo.[stores] cd ON ${same("cd.[id]", "cv.[to_store_id]")} WHERE ${same("ci.[product_id]", product)} AND cv.[status] IN(N'completed',N'completed_with_discrepancy') AND cv.[posted_at] IS NOT NULL AND COALESCE(ci.[quantity_verified],ci.[quantity_received],0)>0 AND (${same("cv.[to_store_id]", "@branch")} OR ${sameGroup("cd.[group_id]", targetGroup)}))`;
  }
  if (has("products", ["catalogue_store_ids"])) posted = `(${posted} OR EXISTS(SELECT 1 FROM OPENJSON(CASE WHEN ISJSON(${alias}.[catalogue_store_ids])=1 THEN ${alias}.[catalogue_store_ids] ELSE N'[]' END) cached_proof LEFT JOIN dbo.[stores] cached_store ON ${same("cached_store.[id]", "cached_proof.[value]")} WHERE ${same("cached_proof.[value]", "@branch")} OR ${sameGroup("cached_store.[group_id]", targetGroup)}))`;
  return `(@branch IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.[stores] ct_exists WHERE ${same("ct_exists.[id]", "@branch")}) AND (${own} OR ${sibling} OR ${posted} OR (${unowned} AND (${stock} OR ${sharedLegacy})) OR (NOT (${unowned}) AND ${ungroupedOwned})))`;
}
/** Compact read projection; never exposes transfer participants or references. */
function catalogueStoreIdsProjection(registry, alias = "source") {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("Invalid catalogue SQL alias.");
  const columns = name => new Set((registry.tables.find(table => table.cloudTable === name)?.columns ?? []).map(column => column.sqlServerColumn));
  if (!columns("stock_transfers").has("posted_at") || !columns("stock_transfer_items").has("quantity_verified")) return "N'[]'";
  const cached = columns("products").has("catalogue_store_ids") ? ` UNION SELECT cached.[value] FROM OPENJSON(CASE WHEN ISJSON(${alias}.[catalogue_store_ids])=1 THEN ${alias}.[catalogue_store_ids] ELSE N'[]' END) cached` : "";
  return `(SELECT N'['+COALESCE(STRING_AGG(CONVERT(nvarchar(max),N'"'+STRING_ESCAPE(proof.destination,'json')+N'"'),N','),N'')+N']' FROM (SELECT DISTINCT pt.to_store_id destination FROM dbo.stock_transfers pt JOIN dbo.stock_transfer_items pi ON pi.transfer_id=pt.id WHERE pi.product_id=${alias}.[id] AND pt.status IN(N'completed',N'completed_with_discrepancy') AND pt.posted_at IS NOT NULL AND COALESCE(pi.quantity_verified,pi.quantity_received,0)>0${cached}) proof)`;
}
module.exports = { catalogueReadPredicate, catalogueStoreIdsProjection };
