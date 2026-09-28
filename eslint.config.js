import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-desktop",
      ".output",
      ".vinxi",
      ".wrangler",
      "release",
      "capacitor-shell",
      ".codex-*/**",
      "src/routeTree.gen.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // react-hooks 7 adds React Compiler adoption rules to its recommended
      // preset. Keep the two correctness rules this codebase already enforces;
      // compiler migration is a separate source refactor, not a package-update
      // side effect that should suddenly fail every existing screen.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      // These exports are stable hooks, pure helpers, or immutable style
      // descriptors colocated with their provider/component. Declaring them
      // explicitly keeps Fast Refresh strict for every unreviewed export.
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: [
            "badgeVariants", "buttonVariants", "toggleVariants",
            "useFormField", "navigationMenuTriggerStyle", "useSidebar",
            "useManagerGate", "fromDbRole", "hasPermission", "normalizePermissions",
            "toDbRole", "APP_ROLES", "useAuth", "useAuthOptional", "useUserPermissions",
            "platformName", "posRulesQueryKey", "usePosRules", "stockAt", "reservedAt",
            "availableAt", "usePos", "usePosOptional", "money", "cartTotals",
            "REGISTER_ACTIONS", "ACTION_CATEGORIES", "ACTION_BY_ID", "isActionId", "useRegisterActions",
            "useTheme", "isDriverMissing", "usePanelWidth", "permissionLabel",
            "permissionMessage", "denyPermission", "requirePermission", "useSidebarCollapsed",
            "parseLines", "PAGE_SIZES", "usePagination", "readRecentBanks", "rememberBanks",
            "statusStyle", "fulfilmentLabel", "when", "useTransferRecord", "CUSTOM_ICONS",
            "useNodeOptions", "isoDay", "defaultRange", "inRange", "stamp", "downloadCsv",
            "usePanelSave", "scopeForPath", "pathSection", "clusterList", "useSettingsCtx",
            "readNavCollapsed", "writeNavCollapsed", "readOpenCategories",
            "initialOpenCategories", "useEmbeddedSettings",
            "useAnimatedItems",
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": "off",
      // Existing boundary adapters still need typed follow-up work. Keep this
      // visible as debt without making it indistinguishable from correctness
      // and security failures.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // A few Electron integration tests intentionally load CommonJS modules
    // from the desktop runtime. Application TypeScript remains ESM-only.
    files: ["src/lib/__tests__/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // These modules adapt schemaless SQL/Supabase rows and fluent query
    // builders at the boundary. Their runtime validators/mappers narrow the
    // values before application use; forcing a fabricated static row shape
    // here would be less accurate than the SDK's intentionally dynamic type.
    files: [
      "src/core/activation/terminal-tokens.ts",
      "src/core/api/pos-db.ts",
      "src/core/types/feature-schema.ts",
      "src/core/types/payment-types.ts",
      "src/lib/{bookings-db,coupons,db-health,stock-transfers,suppliers}.ts",
      "src/lib/__tests__/deep-drift.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Screens must go through the data layer (`dbRouter`/`db-query`), so an
    // offline till keeps working instead of hitting the cloud directly.
    files: ["src/components/**/*.{ts,tsx}", "src/routes/**/*.{ts,tsx}"],
    ignores: [
      // Sign-in and diagnostics are about the connection itself.
      "src/components/admin/StaffManager.tsx",
      "src/components/pos/ConnectionCheck.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/integrations/supabase/external-client", "@/integrations/supabase/external-client"],
              message:
                "Screens must not read or write the central database directly. Use dbRouter / routedQuery from @/lib/db-router so the till still works offline, or an admin helper from @/lib/admin-session.",
            },
          ],
        },
      ],
    },
  },
  {
    // TanStack Router route modules intentionally export both the generated
    // `Route` descriptor and their screen components. The router's Vite
    // plugin owns their reload boundary, so React Refresh's generic
    // single-export heuristic is not applicable to this directory.
    files: ["src/routes/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  // Formatting is checked by Prettier, not surfaced as thousands of ESLint
  // correctness failures. This only disables conflicting style rules; it does
  // not weaken hooks, TypeScript, refresh, or restricted-import validation.
  prettier,
);
