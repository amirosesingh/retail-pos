/**
 * Argument checks for the bridge between the window and the desktop process.
 *
 * The window renders application code, so everything arriving through the
 * bridge is treated as untrusted input: each channel that takes an argument
 * states the shape it accepts, and anything else is refused with a plain
 * message instead of being passed on to a printer, a file path or a database.
 */

/** A refusal the channel can hand straight back to the window. */
function refuse(message) {
  return { ok: false, code: "EBADARG", error: message };
}

class BadArg extends Error {
  constructor(message) {
    super(message);
    this.name = "BadArg";
  }
}

/** Run a channel body, turning an argument complaint into a clean refusal. */
async function guarded(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BadArg) return refuse(error.message);
    throw error;
  }
}

function text(value, { name = "value", max = 500, pattern = null, allowEmpty = false } = {}) {
  if (value === undefined || value === null) {
    if (allowEmpty) return "";
    throw new BadArg(`A ${name} is required.`);
  }
  if (typeof value !== "string") throw new BadArg(`The ${name} must be text.`);
  if (!allowEmpty && value.trim() === "") throw new BadArg(`The ${name} cannot be empty.`);
  if (value.length > max) throw new BadArg(`The ${name} is too long.`);
  if (pattern && value !== "" && !pattern.test(value)) {
    throw new BadArg(`The ${name} contains characters that are not allowed.`);
  }
  return value;
}

/**
 * A name that will be handed to a Windows command. Anything a shell could
 * read as punctuation is rejected rather than escaped.
 */
const SHELL_SAFE = /^[^&|<>^"'`;\r\n%$]*$/;

function shellSafeText(value, { name = "value", max = 200 } = {}) {
  const out = text(value, { name, max, allowEmpty: true });
  if (!SHELL_SAFE.test(out))
    throw new BadArg(`The ${name} contains characters that are not allowed.`);
  return out;
}

function plainObject(value, { name = "value" } = {}) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadArg(`The ${name} is not in the expected form.`);
  }
  return value;
}

function list(value, { name = "list", max = 1000 } = {}) {
  if (!Array.isArray(value)) throw new BadArg(`The ${name} is not in the expected form.`);
  if (value.length > max) throw new BadArg(`Too many entries in the ${name} (limit ${max}).`);
  return value;
}

/** Bytes for the receipt printer: a real byte list, size-capped. */
function bytes(value, { max = 4 * 1024 * 1024 } = {}) {
  const array = value instanceof Uint8Array ? Array.from(value) : value;
  if (!Array.isArray(array)) throw new BadArg("The print data is not in the expected form.");
  if (array.length > max) throw new BadArg("The print job is too large.");
  for (const b of array) {
    if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > 255) {
      throw new BadArg("The print data is not in the expected form.");
    }
  }
  return array;
}

/** A settings key: a plain identifier, never a path or an expression. */
const KEY = /^[A-Za-z0-9_.:-]{1,128}$/;

function key(value, { name = "setting name" } = {}) {
  return text(value, { name, max: 128, pattern: KEY });
}

/**
 * A file the operator chose to write. Absolute, on a local drive, with the
 * expected extension, and never a network share or a quoted expression.
 */
function filePath(value, { name = "file", extension = null } = {}) {
  const out = text(value, { name, max: 400 });
  if (/[\r\n"'`|&<>^]/.test(out))
    throw new BadArg(`The ${name} contains characters that are not allowed.`);
  if (out.startsWith("\\\\"))
    throw new BadArg(`A network location cannot be used for the ${name}.`);
  const absolute = /^[A-Za-z]:[\\/]/.test(out) || out.startsWith("/");
  if (!absolute) throw new BadArg(`The ${name} must be a full path.`);
  if (extension && !out.toLowerCase().endsWith(`.${extension}`)) {
    throw new BadArg(`The ${name} must end in .${extension}.`);
  }
  return out;
}

/**
 * One write instruction from the register: a table name, a kind, and rows.
 * Anything else never reaches the local database layer.
 */
const OP_KINDS = new Set(["insert", "update", "upsert", "delete", "rpc"]);

function writeOp(value, { name = "write" } = {}) {
  const op = plainObject(value, { name });
  const kind = String(op.kind ?? "");
  if (!OP_KINDS.has(kind)) throw new BadArg(`The ${name} kind is not recognised.`);
  key(op.table, { name: "table name" });
  if (op.rows !== undefined) list(op.rows, { name: "rows", max: 5000 });
  if (op.requireMatch !== undefined && typeof op.requireMatch !== "boolean")
    throw new BadArg(`The ${name} required-match flag must be true or false.`);
  return op;
}

function writeOps(value, { max = 500 } = {}) {
  const ops = list(value, { name: "write batch", max });
  return ops.map((op, i) => writeOp(op, { name: `write ${i + 1}` }));
}

function aggregate(value) {
  // Aggregate commits deliberately contain nested operation objects. The
  // generic `options()` validator is for flat scalar settings and rejects
  // those rows before they can reach SQL Server, so validate this envelope
  // explicitly and leave every nested write to `writeOps()` below.
  const input = plainObject(value, { name: "business aggregate" });
  const allowed = new Set(["kind", "operationId", "branchId", "operations"]);
  const fields = Object.keys(input);
  if (fields.length > allowed.size || fields.some((field) => !allowed.has(field)))
    throw new BadArg("The business aggregate contains an unexpected setting.");
  const kind = text(input.kind, { name: "aggregate kind", max: 32 });
  if (
    ![
      "sale",
      "payment",
      "refund",
      "shift",
      "product",
      "receiving",
      "stock",
      "transfer",
      "booking",
      "held_order",
      "general",
      "branch",
    ].includes(kind)
  )
    throw new BadArg("Unsupported aggregate kind.");
  return {
    kind,
    operationId:
      input.operationId === undefined
        ? undefined
        : uuid(input.operationId, { name: "operation id" }),
    branchId:
      input.branchId === undefined ? undefined : text(input.branchId, { name: "branch", max: 128 }),
    operations: writeOps(input.operations, { max: 200 }),
  };
}

/**
 * Options for a maintenance action (restore, compare, housekeeping): a plain
 * object of scalars only, so nothing nested can be smuggled through.
 */
function options(value, { name = "options", max = 40 } = {}) {
  const out = plainObject(value ?? {}, { name });
  const entries = Object.entries(out);
  if (entries.length > max) throw new BadArg(`Too many ${name}.`);
  for (const [k, v] of entries) {
    if (!KEY.test(k)) throw new BadArg(`The ${name} contain an unexpected setting.`);
    if (v === null || v === undefined) continue;
    const type = typeof v;
    if (type === "string") {
      if (v.length > 400) throw new BadArg(`The ${name} contain a value that is too long.`);
      continue;
    }
    if (type === "number" || type === "boolean") continue;
    if (Array.isArray(v) && v.every((e) => typeof e === "string" && e.length <= 200)) continue;
    throw new BadArg(`The ${name} are not in the expected form.`);
  }
  return out;
}

/** A bounded, read-only renderer query. Nested filters are validated here and
 * table/column membership is validated again against the schema registry. */
function queryOptions(value) {
  const raw = plainObject(value ?? {}, { name: "business query" });
  const allowed = new Set(["columns", "match", "in", "orderBy", "limit", "offset", "cursor"]);
  if (Object.keys(raw).some((field) => !allowed.has(field))) throw new BadArg("The business query contains an unexpected setting.");
  const result = {};
  if (raw.columns !== undefined) result.columns = text(raw.columns, { name: "selected columns", max: 2000 });
  if (raw.match !== undefined) {
    const match = plainObject(raw.match, { name: "query match" });
    if (Object.keys(match).length > 20) throw new BadArg("The business query has too many match fields.");
    for (const [field, item] of Object.entries(match)) {
      key(field, { name: "match column" });
      if (item !== null && !["string", "number", "boolean"].includes(typeof item)) throw new BadArg("The business query match has an invalid value.");
      if (typeof item === "string" && item.length > 4000) throw new BadArg("The business query match value is too long.");
    }
    result.match = match;
  }
  if (raw.in !== undefined) {
    const input = plainObject(raw.in, { name: "query list" });
    const values = list(input.values, { name: "query list values", max: 2000 });
    if (values.some((item) => !["string", "number"].includes(typeof item))) throw new BadArg("The business query list has an invalid value.");
    result.in = { column: key(input.column, { name: "list column" }), values };
  }
  if (raw.orderBy !== undefined) {
    const order = plainObject(raw.orderBy, { name: "query order" });
    result.orderBy = { column: key(order.column, { name: "order column" }), ascending: order.ascending === undefined ? true : boolean(order.ascending, { name: "order direction" }) };
  }
  if (raw.cursor !== undefined) {
    const cursor = plainObject(raw.cursor, { name: "query cursor" });
    result.cursor = {
      column: key(cursor.column, { name: "cursor column" }),
      value: text(cursor.value, { name: "cursor value", max: 200 }),
      id: text(cursor.id, { name: "cursor id", max: 200 }),
    };
  }
  if (raw.limit !== undefined) result.limit = integer(raw.limit, { name: "query limit", min: 1, max: 2000 });
  if (raw.offset !== undefined) result.offset = integer(raw.offset, { name: "query offset", min: 0, max: 10000000 });
  return result;
}

/** Connection details for the branch database. Scalars only, size-capped. */
function connectionConfig(value, { name = "connection details" } = {}) {
  return options(value, { name, max: 40 });
}

/** Signed-in POS proof with token-specific limits. */
function credentialProof(value) {
  const raw = plainObject(value ?? {}, { name: "signed-in session" });
  const limits = {
    accessToken: 4000,
    sessionToken: 400,
    cashierToken: 2000,
    terminalToken: 2000,
  };
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(limits, key))
      throw new BadArg("The signed-in session contains an unexpected setting.");
  }
  const proof = {};
  for (const [key, max] of Object.entries(limits)) {
    if (raw[key] !== null && raw[key] !== undefined && raw[key] !== "")
      proof[key] = text(raw[key], { name: key, max });
  }
  return proof;
}

const HOST = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/;
const INSTANCE_NAME = /^[A-Za-z0-9_$-]{1,128}$/;
const DB_NAME = /^[^;{}\\/\x00-\x1f]{1,128}$/;
function integer(value, { name, min, max }) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new BadArg(`The ${name} must be between ${min} and ${max}.`);
  }
  return value;
}
function boolean(value, { name }) {
  if (typeof value !== "boolean") throw new BadArg(`The ${name} must be true or false.`);
  return value;
}
function uuid(value, { name = "identifier" } = {}) {
  const result = text(value, { name, max: 36 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result))
    throw new BadArg(`The ${name} must be a UUID.`);
  return result;
}
function databaseProfile(value, { requireDatabase = false } = {}) {
  const raw = plainObject(value, { name: "database connection" });
  const authMode = text(raw.authMode, { name: "authentication mode", max: 16 });
  if (authMode !== "windows" && authMode !== "sql")
    throw new BadArg("The authentication mode is not supported.");
  const database = text(raw.database, {
    name: "database name",
    max: 128,
    allowEmpty: !requireDatabase,
  });
  if (database && !DB_NAME.test(database))
    throw new BadArg("The database name contains characters that are not allowed.");
  const username = text(raw.username, {
    name: "username",
    max: 128,
    allowEmpty: authMode === "windows",
  });
  const password = text(raw.password, {
    name: "password",
    max: 512,
    allowEmpty: authMode === "windows",
  });
  const serverAddress = text(raw.host, {
    name: "server hostname, IP, or named instance",
    max: 382,
  });
  const addressParts = serverAddress.split("\\");
  if (addressParts.length > 2) throw new BadArg("The SQL Server address is not valid.");
  const host = addressParts[0];
  if (!HOST.test(host)) throw new BadArg("The server hostname or IP is not valid.");
  const suppliedInstance =
    raw.instanceName === undefined
      ? ""
      : text(raw.instanceName, { name: "SQL Server instance", max: 128, allowEmpty: true });
  const instanceName = suppliedInstance || addressParts[1] || "";
  if (suppliedInstance && addressParts[1] && suppliedInstance !== addressParts[1])
    throw new BadArg("The SQL Server instance names do not match.");
  if (instanceName && !INSTANCE_NAME.test(instanceName))
    throw new BadArg("The SQL Server instance name contains characters that are not allowed.");
  const port = integer(raw.port, { name: "TCP port", min: instanceName ? 0 : 1, max: 65535 });
  return {
    host,
    instanceName,
    port,
    database,
    authMode,
    username: authMode === "sql" ? username : "",
    password: authMode === "sql" ? password : "",
    encrypt: boolean(raw.encrypt, { name: "encrypt setting" }),
    trustServerCertificate: boolean(raw.trustServerCertificate, {
      name: "certificate trust setting",
    }),
    connectionTimeoutMs: integer(raw.connectionTimeoutMs, {
      name: "connection timeout",
      min: 1000,
      max: 120000,
    }),
    requestTimeoutMs: integer(raw.requestTimeoutMs, {
      name: "request timeout",
      min: 1000,
      max: 300000,
    }),
    ...(raw.retentionDays === undefined
      ? {}
      : {
          retentionDays: integer(raw.retentionDays, {
            name: "retention period",
            min: 30,
            max: 7300,
          }),
        }),
  };
}

/** The sealed activation record, or null to forget it. */
function terminalConfig(value) {
  if (value === null || value === undefined) return null;
  const config = plainObject(value, { name: "activation" });
  text(config.tokenId, { name: "terminal id", max: 100 });
  return options(config, { name: "activation", max: 40 });
}

module.exports = {
  BadArg,
  guarded,
  refuse,
  text,
  shellSafeText,
  plainObject,
  list,
  bytes,
  key,
  filePath,
  writeOp,
  writeOps,
  aggregate,
  options,
  queryOptions,
  connectionConfig,
  credentialProof,
  databaseProfile,
  uuid,
  terminalConfig,
};
