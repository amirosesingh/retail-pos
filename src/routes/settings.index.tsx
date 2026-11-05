import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { SettingsLink, SettingsShell } from "@/platforms/web/components/pos/settings/SettingsShell";
import {
  matchSettings,
  routeOf,
  searchOf,
  useSettingsNav,
} from "@/platforms/web/components/pos/settings/use-settings-nav";
import { Input } from "@/components/ui/input";
import {
  settingsCard,
  SETTINGS_CATEGORIES,
  type SettingsCard,
  type SettingsCategoryId,
} from "@/lib/settings-catalog";

/** `section` and `card` are legacy deep links; `beforeLoad` forwards them. */
type Search = { cat?: SettingsCategoryId; section?: string; card?: string };

const CATEGORY_IDS = SETTINGS_CATEGORIES.map((c) => c.id) as string[];

export const Route = createFileRoute("/settings/")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const cat = search["cat"];
    const section = search["section"];
    const card = search["card"];
    return {
      ...(typeof cat === "string" && CATEGORY_IDS.includes(cat)
        ? { cat: cat as SettingsCategoryId }
        : {}),
      ...(typeof section === "string" && section ? { section } : {}),
      ...(typeof card === "string" && card ? { card } : {}),
    };
  },
  // Older links used ?section=tax or ?card=tax — both now open the real page.
  beforeLoad: ({ search }) => {
    const raw = search as Record<string, unknown>;
    const legacy = typeof raw["card"] === "string" ? raw["card"] : raw["section"];
    if (typeof legacy !== "string" || !legacy) return;
    if (legacy === "access") throw redirect({ to: "/staff", search: { tab: "policies" }, replace: true });
    const card = settingsCard(legacy);
    if (!card) throw redirect({ to: "/settings", search: {} });
    throw redirect({
      to: routeOf(card) as never,
      search: searchOf(card) as never,
      replace: true,
    });
  },
  head: () => ({
    meta: [
      { title: "Settings — Retail" },
      {
        name: "description",
        content:
          "Every POS configuration area in one window: terminal and display, receipts and printing, tax and pricing, payments, bookings, sync and health checks.",
      },
      { property: "og:title", content: "Settings — Retail" },
      {
        property: "og:description",
        content: "All register configuration in one responsive settings window.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsHome,
});

function Row({ c }: { c: SettingsCard }) {
  return (
    <div data-settings-category={c.category} className="flex items-center gap-1 rounded-lg border border-border bg-card pr-2 transition-colors hover:border-primary/60">
      <SettingsLink
        card={c}
        className="settings-menu-link flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <c.icon className="size-5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium leading-tight">{c.label}</span>
          <span className="mt-0.5 block break-words text-sm leading-relaxed text-muted-foreground">
            {c.blurb}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </SettingsLink>
    </div>
  );
}

function SettingsHome() {
  const navigate = useNavigate({ from: "/settings/" });
  const { cat } = Route.useSearch();
  const { cards, categories } = useSettingsNav();
  const allowed = cards.length > 0;

  const [query, setQuery] = useState("");
  const term = query.trim();
  const results = matchSettings(cards, term);

  const activeCat = cat && categories.some((g) => g.id === cat) ? cat : undefined;
  const category = categories.find((g) => g.id === activeCat);

  return (
    <SettingsShell home>
      <div className="pos-page-container">
        {/* Compact sticky header: title, description and search stay reachable. */}
        <header className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-border bg-background/95 px-4 pb-3 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="flex items-start gap-3">
            {activeCat && (
              <button type="button" aria-label="Back to Settings" title="Back to Settings"
                onClick={() => void navigate({ search: {}, replace: false })}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold sm:text-2xl">
                {category ? category.label : "Settings"}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground page-description">
                {category
                  ? category.blurb
                  : "Everything this till can be configured to do, grouped by area."}
              </p>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings — tax, printer, sync…"
              aria-label="Search settings"
              className="h-9 pl-9 pr-9"
            />
            {term && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </header>

        {!allowed ? (
          <p className="text-sm text-muted-foreground">
            No settings are available with your current permissions.
          </p>
        ) : term ? (
          <section className="settings-menu-grid grid grid-cols-1 gap-2 sm:grid-cols-2 xl:block xl:space-y-2" aria-label="Search results">
            {results.length ? (
              results.map((c) => (
                <SettingsLink
                  key={c.id}
                  card={c}
                  className="settings-menu-link flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/60"
                >
                  <c.icon className="size-5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium">{c.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      Settings → {categories.find((g) => g.id === c.category)?.label}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </SettingsLink>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing matches “{query}”. Try a shorter word.
              </p>
            )}
          </section>
        ) : category ? (
          <section className="settings-menu-grid grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3" aria-label={category.label}>
            {cards
              .filter((c) => c.category === category.id)
              .map((c) => (
                <Row key={c.id} c={c} />
              ))}
          </section>
        ) : (
          <>
            <div className="settings-menu-grid grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
              {categories.map((g) => (
                <button
                  key={g.id}
                  data-settings-category={g.id}
                  type="button"
                  onClick={() => void navigate({ search: { cat: g.id }, replace: false })}
                  className="settings-menu-category group flex min-w-0 w-full flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-sm"
                >
                  <span className="flex w-full items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                      <g.icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold">{g.label}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        {g.blurb}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="mt-auto block w-full border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
                    {cards
                      .filter((card) => card.category === g.id)
                      .map((card) => card.label)
                      .join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </SettingsShell>
  );
}
