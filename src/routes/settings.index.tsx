import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
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
import { useAuth } from "@/lib/pos-auth";
import {
  PINNED_SETTINGS,
  settingsCard,
  SETTINGS_CATEGORIES,
  type SettingsCard,
  type SettingsCategoryId,
} from "@/lib/settings-catalog";
import { PinButton } from "@/platforms/web/components/pos/PinButton";
import { useNavPins } from "@/lib/nav-pins";

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
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card pr-2 transition-colors hover:border-primary/60">
      <SettingsLink
        card={c}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <c.icon className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight">{c.label}</span>
          <span className="mt-0.5 block truncate text-[11px] leading-snug text-muted-foreground">
            {c.blurb}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </SettingsLink>
      <PinButton kind="settings" itemKey={c.id} label={c.label} />
    </div>
  );
}

function SettingsHome() {
  const { isAdmin, isSupervisor, can, authUserId } = useAuth();
  const allowed = isAdmin || can("can_access_pos_settings") || isSupervisor;
  const navigate = useNavigate({ from: "/settings/" });
  const { cat } = Route.useSearch();
  const { cards, categories } = useSettingsNav();

  const [query, setQuery] = useState("");
  const term = query.trim();
  const results = matchSettings(cards, term);

  const activeCat = cat && categories.some((g) => g.id === cat) ? cat : undefined;
  const category = categories.find((g) => g.id === activeCat);
  const { pins } = useNavPins(authUserId ?? null);
  const chosen = pins.filter((p) => p.kind === "settings").map((p) => p.key);
  // Until someone pins their own, the busiest areas stand in.
  const pinned = (chosen.length ? chosen : PINNED_SETTINGS)
    .map((id) => cards.find((c) => c.id === id))
    .filter((c): c is SettingsCard => !!c);

  return (
    <SettingsShell home>
      <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
        {/* Compact sticky header: title, description and search stay reachable. */}
        <header className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-border bg-background/95 px-4 pb-3 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="flex items-center gap-2">
            {activeCat ? (
              <button
                type="button"
                onClick={() => void navigate({ search: {}, replace: false })}
                className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="size-4" /> Settings
              </button>
            ) : (
              <Link
                to="/"
                className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="size-4" /> Register
              </Link>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold sm:text-2xl">
                {category ? category.label : "Settings"}
              </h1>
              <p className="truncate text-xs text-muted-foreground sm:text-sm">
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
            Configuration is managed by an administrator.
          </p>
        ) : term ? (
          <section className="space-y-2" aria-label="Search results">
            {results.length ? (
              results.map((c) => (
                <SettingsLink
                  key={c.id}
                  card={c}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/60"
                >
                  <c.icon className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{c.label}</span>
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
          <section className="grid gap-3 sm:grid-cols-2" aria-label={category.label}>
            {cards
              .filter((c) => c.category === category.id)
              .map((c) => (
                <Row key={c.id} c={c} />
              ))}
          </section>
        ) : (
          <>
            {pinned.length > 0 && (
              <section className="space-y-1.5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Quick access
                </h2>
                <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                  {pinned.map((c) => (
                    <SettingsLink
                      key={c.id}
                      card={c}
                      className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/60"
                    >
                      <c.icon className="size-3.5 text-primary" />
                      <span className="whitespace-nowrap">{c.label}</span>
                    </SettingsLink>
                  ))}
                </div>
              </section>
            )}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {categories.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => void navigate({ search: { cat: g.id }, replace: false })}
                  className="group flex min-h-40 w-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-sm"
                >
                  <span className="flex w-full items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
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
                  <span className="mt-auto block w-full border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground">
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
