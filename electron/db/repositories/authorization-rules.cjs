const { randomUUID } = require("node:crypto");

const MODES = new Set(["none", "pin", "request", "either"]);
const SCOPES = new Set(["global", "branch"]);

function text(value, max = 128) {
  return String(value ?? "").trim().slice(0, max);
}

function stringList(value, max = 50) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => text(item, 128)).filter(Boolean))].slice(0, max);
}

function numericMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, amount]) => [text(key.toLowerCase(), 160), Number(amount)])
    .filter(([key, amount]) => key && Number.isFinite(amount) && amount >= 0));
}

function json(value) { return JSON.stringify(value); }

function cleanRule(value, { branchId, actor, isAdmin }) {
  const scopeType = SCOPES.has(value?.scopeType) ? value.scopeType : "branch";
  if (scopeType === "global" && !isAdmin)
    throw Object.assign(new Error("Only an administrator can change global authorization rules."), { code: "PERMISSION_DENIED" });
  const scopeId = scopeType === "global" ? "" : text(value?.scopeId || branchId, 128);
  if (scopeType === "branch" && (!branchId || scopeId !== branchId))
    throw Object.assign(new Error("Authorization rules can only be changed for this terminal branch."), { code: "STORE_FORBIDDEN" });
  const actionKey = text(value?.actionKey, 128);
  if (!actionKey) throw Object.assign(new Error("Select an authorization rule to save."), { code: "ERULE" });
  const mode = MODES.has(value?.mode) ? value.mode : "none";
  return {
    action_key: actionKey,
    scope_type: scopeType,
    scope_id: scopeId,
    mode,
    allowed_roles: stringList(value?.allowedRoles, 20),
    allowed_user_ids: stringList(value?.allowedUserIds),
    requester_roles: stringList(value?.requesterRoles, 20),
    requester_user_ids: stringList(value?.requesterUserIds),
    authority_limits: numericMap(value?.authorityLimits),
    extra_authority: numericMap(value?.extraAuthority),
    absolute_ceilings: numericMap(value?.absoluteCeilings),
    approval_timeout_minutes: Math.min(1440, Math.max(1, Number(value?.approvalTimeoutMinutes) || 15)),
    escalation_after_minutes: value?.escalationAfterMinutes == null ? null : Math.min(1440, Math.max(1, Number(value.escalationAfterMinutes) || 1)),
    escalation_roles: stringList(value?.escalationRoles, 20),
    require_reason: value?.requireReason === true,
    threshold: value?.threshold == null ? null : Number(value.threshold),
    is_enabled: value?.isEnabled !== false,
    updated_by: text(actor, 160),
    expected_version: Math.max(0, Number(value?.expectedVersion ?? value?.rowVersion ?? 0) || 0),
  };
}

class AuthorizationRulesRepository {
  constructor(connectionManager) { this.connectionManager = connectionManager; }
  pool() {
    if (!this.connectionManager.pool)
      throw Object.assign(new Error("SQL Server is not connected."), { code: "EDATABASE" });
    return this.connectionManager.pool;
  }
  async save(value, authority) {
    const rule = cleanRule(value, authority);
    const sql = this.connectionManager.sql();
    const transaction = new sql.Transaction(this.pool());
    await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      const lookup = await new sql.Request(transaction)
        .input("action_key", rule.action_key)
        .input("scope_type", rule.scope_type)
        .input("scope_id", rule.scope_id)
        .query("SELECT TOP (1) * FROM dbo.authorization_actions WITH (UPDLOCK,HOLDLOCK) WHERE action_key=@action_key AND scope_type=@scope_type AND scope_id=@scope_id;");
      const existing = lookup.recordset?.[0] ?? null;
      const currentVersion = Number(existing?.row_version ?? 0);
      if (currentVersion !== rule.expected_version)
        throw Object.assign(new Error("This rule changed on another device. Reopen it to review the latest settings before saving."), { code: "ESTALE_RULE" });

      const id = existing?.id ?? randomUUID();
      const nextVersion = currentVersion + 1;
      const request = new sql.Request(transaction)
        .input("id", id)
        .input("action_key", rule.action_key)
        .input("scope_type", rule.scope_type)
        .input("scope_id", rule.scope_id)
        .input("mode", rule.mode)
        .input("allowed_roles", json(rule.allowed_roles))
        .input("allowed_user_ids", json(rule.allowed_user_ids))
        .input("requester_roles", json(rule.requester_roles))
        .input("requester_user_ids", json(rule.requester_user_ids))
        .input("authority_limits", json(rule.authority_limits))
        .input("extra_authority", json(rule.extra_authority))
        .input("absolute_ceilings", json(rule.absolute_ceilings))
        .input("approval_timeout_minutes", rule.approval_timeout_minutes)
        .input("escalation_after_minutes", rule.escalation_after_minutes)
        .input("escalation_roles", json(rule.escalation_roles))
        .input("require_reason", rule.require_reason)
        .input("threshold", rule.threshold)
        .input("is_enabled", rule.is_enabled)
        .input("updated_by", rule.updated_by)
        .input("row_version", nextVersion);
      const columns = "mode=@mode,allowed_roles=@allowed_roles,allowed_user_ids=@allowed_user_ids,requester_roles=@requester_roles,requester_user_ids=@requester_user_ids,authority_limits=@authority_limits,extra_authority=@extra_authority,absolute_ceilings=@absolute_ceilings,approval_timeout_minutes=@approval_timeout_minutes,escalation_after_minutes=@escalation_after_minutes,escalation_roles=@escalation_roles,require_reason=@require_reason,threshold=@threshold,is_enabled=@is_enabled,updated_by=@updated_by,row_version=@row_version,updated_at=SYSDATETIMEOFFSET()";
      if (existing) {
        await request.query(`UPDATE dbo.authorization_actions SET ${columns} WHERE id=@id;`);
      } else {
        await request.query(`INSERT dbo.authorization_actions(id,action_key,scope_type,scope_id,mode,allowed_roles,allowed_user_ids,requester_roles,requester_user_ids,authority_limits,extra_authority,absolute_ceilings,approval_timeout_minutes,escalation_after_minutes,escalation_roles,require_reason,threshold,is_enabled,updated_by,row_version,created_at,updated_at) VALUES(@id,@action_key,@scope_type,@scope_id,@mode,@allowed_roles,@allowed_user_ids,@requester_roles,@requester_user_ids,@authority_limits,@extra_authority,@absolute_ceilings,@approval_timeout_minutes,@escalation_after_minutes,@escalation_roles,@require_reason,@threshold,@is_enabled,@updated_by,@row_version,SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());`);
      }
      const saved = await new sql.Request(transaction).input("id", id)
        .query("SELECT TOP (1) * FROM dbo.authorization_actions WHERE id=@id;");
      const row = saved.recordset?.[0];
      await new sql.Request(transaction)
        .input("id", randomUUID())
        .input("action_id", id)
        .input("action_key", rule.action_key)
        .input("scope_type", rule.scope_type)
        .input("scope_id", rule.scope_id)
        .input("row_version", nextVersion)
        .input("changed_by", rule.updated_by)
        .input("change_kind", existing ? "updated" : "created")
        .input("snapshot", json(row ?? {}))
        .query("INSERT dbo.authorization_action_history(id,action_id,action_key,scope_type,scope_id,row_version,changed_by,change_source,change_kind,snapshot,created_at) VALUES(@id,@action_id,@action_key,@scope_type,@scope_id,@row_version,@changed_by,N'desktop',@change_kind,@snapshot,SYSDATETIMEOFFSET());");
      await transaction.commit();
      return { ok: true, rule: row };
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      throw error;
    }
  }
}

module.exports = { AuthorizationRulesRepository, cleanRule };
