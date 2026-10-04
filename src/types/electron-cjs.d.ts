declare module "*.cjs" {
  // CommonJS files are runtime-validated at their IPC boundary; this wildcard
  // cannot express every module's shape without duplicating those definitions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moduleExports: any;
  export = moduleExports;
}
