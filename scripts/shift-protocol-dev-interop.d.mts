export function shiftProtocolDevInterop(): {
  name: string;
  apply: "serve";
  enforce: "pre";
  configResolved(config: { root: string }): void;
  transform(source: string, id: string): { code: string; map: null } | null;
};
