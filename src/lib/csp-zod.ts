// Use Zod's supported interpreter under the app's strict CSP. Its default
// JIT capability probe calls Function even when the browser catches/blocks it.
import { config } from "zod/v4";
config({ jitless: true });
export * from "zod/v4";
export { default } from "zod/v4";
