export interface ExactJsonLimits { maxBytes?: number; maxDepth?: number }
export function parseExactJson(text: string, limits?: ExactJsonLimits): unknown;
export function stringifyExactJson(value: unknown, limits?: ExactJsonLimits): string;
export function isExactNumber(value: unknown): boolean;
export function boundedText(response: Response, maxBytes?: number): Promise<string>;
export function decimal(value: unknown): string | undefined;
export function instant(value: unknown): string | undefined;
export function projection(table: { columns: Array<{ sqlServerColumn: string; sqlServerType: string }> }, alias?: string): string;
export function exactRows(table: unknown, local: unknown[], remote: unknown[]): boolean;
export function rememberGraph<T extends object>(graph: T, raw: string, capability?: string): T;
export function exactGraph(graph: object, branch: string, shift: string): unknown | null;
export function witnessBytes(graph: object): number;
