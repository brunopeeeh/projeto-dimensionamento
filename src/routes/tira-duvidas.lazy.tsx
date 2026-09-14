import { createLazyFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  BookOpenText,
  Calculator,
  ChevronDown,
  CircleHelp,
  Database,
  FlaskConical,
  Search,
  Users,
  X,
} from "lucide-react";
import { useDimensionamento } from "@/context/DimensionamentoContext";
import { isHumanAgent } from "@/lib/agents";
import { capacityPerAgent } from "@/lib/calculations";
import {
  DIMENSIONAMENTO_HELP_ITEMS,
  HELP_CATEGORIES,
  filterHelpItems,
  type HelpCategory,
  type HelpItem,
} from "@/lib/dimensionamento-help";

export const Route = createLazyFileRoute("/tira-duvidas")({
  component: TiraDuvidas,
});

const CATEGORY_ICONS = {
  Fundamentos: BookOpenText,
  Painel: Calculator,
  "Escala e contratações": Users,
  "Dados e operação": Database,
  "Modelos em teste": FlaskConical,
} satisfies Record<HelpCategory, typeof CircleHelp>;

function formatDecimal(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function TiraDuvidas() {
  const { currentMonth, kpis, simultaneous, tmaFactors, teamAgents } = useDimensionamento();
  const { q: query = "", category: selectedCategory } = Route.useSearch();
  const navigate = Route.useNavigate();
  const category: HelpCategory | "Todos" = selectedCategory ?? "Todos";

  const updateFilters = (nextQuery: string, nextCategory: HelpCategory | "Todos") => {
    void navigate({
      search: {
        q: nextQuery.trim() ? nextQuery : undefined,
        category: nextCategory === "Todos" ? undefined : nextCategory,
      },
      replace: true,
    });
  };

  const visibleItems = useMemo(
    () => filterHelpItems(DIMENSIONAMENTO_HELP_ITEMS, query, category),
    [query, category],
  );
  const humanAgents = teamAgents.filter((agent) => agent.active && isHumanAgent(agent.name)).length;
  const factors = Object.values(tmaFactors).filter(Number.isFinite);
  const averageFactor = factors.length
    ? factors.reduce((sum, factor) => sum + factor, 0) / factors.length
    : 0;
  const averagePerAgent = capacityPerAgent(averageFactor, simultaneous);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b bg-primary px-5 py-6 text-primary-foreground sm:px-7 sm:py-8">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/75">
            <CircleHelp className="h-4 w-4" aria-hidden="true" />
            Central de apoio
          </div>
          <h1 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Tira-dúvidas do dimensionamento
          </h1>
          <p className="mt-2 max-w-[70ch] text-sm leading-6 text-primary-foreground/80">
            Entenda os números do painel, as regras da escala e como cada cálculo apoia a operação.
          </p>
        </div>

        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          <ContextValue label="Período consultado" value={currentMonth} />
          <ContextValue
            label="Volume semanal"
            value={Math.round(kpis.helpdeskVolume).toLocaleString("pt-BR")}
          />
          <ContextValue label="Equipe humana ativa" value={humanAgents.toString()} />
          <ContextValue label="Atendimentos simultâneos" value={simultaneous.toString()} />
        </div>
      </section>

      <section
        aria-labelledby="buscar-duvidas"
        className="rounded-xl border bg-card p-4 shadow-sm sm:p-5"
      >
        <div className="max-w-3xl">
          <label id="buscar-duvidas" htmlFor="help-search" className="text-sm font-semibold">
            O que você quer entender?
          </label>
          <div className="relative mt-2">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="help-search"
              name="duvida"
              type="search"
              value={query}
              onChange={(event) => updateFilters(event.target.value, category)}
              placeholder="Ex.: capacity, TMA, agentes que faltam…"
              autoComplete="off"
              className="h-11 w-full rounded-lg border bg-background pl-10 pr-11 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            {query && (
              <button
                type="button"
                onClick={() => updateFilters("", category)}
                aria-label="Limpar busca"
                className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div
          role="group"
          className="mt-4 flex gap-2 overflow-x-auto pb-1"
          aria-label="Categorias de dúvidas"
        >
          <CategoryButton
            label="Todos"
            active={category === "Todos"}
            onClick={() => updateFilters(query, "Todos")}
          />
          {HELP_CATEGORIES.map((item) => (
            <CategoryButton
              key={item}
              label={item}
              active={category === item}
              onClick={() => updateFilters(query, item)}
            />
          ))}
        </div>
      </section>

      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Perguntas frequentes</h2>
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
            {visibleItems.length === 1
              ? "1 dúvida encontrada"
              : `${visibleItems.length} dúvidas encontradas`}
          </p>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:block">
          Abra uma pergunta para ver o cálculo
        </span>
      </div>

      {visibleItems.length > 0 ? (
        <div className="space-y-6">
          {HELP_CATEGORIES.map((group) => {
            const groupItems = visibleItems.filter((item) => item.category === group);
            if (groupItems.length === 0) return null;
            const Icon = CATEGORY_ICONS[group];

            return (
              <section key={group} aria-labelledby={`category-${group}`}>
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <h3 id={`category-${group}`} className="text-sm font-semibold">
                    {group}
                  </h3>
                </div>
                <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
                  {groupItems.map((item) => (
                    <HelpQuestion
                      key={item.id}
                      item={item}
                      currentExample={
                        item.id === "capacity"
                          ? `Exemplo com a configuração atual: cada agente representa, em média, ${formatDecimal(averagePerAgent)} atendimentos por faixa de 10 minutos.`
                          : undefined
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <section className="rounded-xl border border-dashed bg-card px-5 py-12 text-center">
          <CircleHelp className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">Nenhuma dúvida encontrada</h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            Tente buscar por outro termo ou selecione a categoria “Todos”.
          </p>
          <button
            type="button"
            onClick={() => {
              updateFilters("", "Todos");
            }}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg border bg-background px-4 text-xs font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Limpar filtros
          </button>
        </section>
      )}
    </div>
  );
}

function ContextValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-5 py-4 sm:px-6">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-base font-semibold tabular-nums" title={value}>
        {value}
      </div>
    </div>
  );
}

function CategoryButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 shrink-0 rounded-lg border px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function HelpQuestion({ item, currentExample }: { item: HelpItem; currentExample?: string }) {
  return (
    <details className="group">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block break-words text-sm font-semibold leading-5">{item.question}</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {item.shortAnswer}
          </span>
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t bg-muted/30 px-4 py-4 sm:px-5">
        <div className="max-w-[75ch] space-y-3 text-sm leading-6 text-muted-foreground">
          {item.details.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {item.formula && (
            <div className="rounded-lg border bg-background px-4 py-3 font-mono text-xs font-medium text-foreground">
              {item.formula}
            </div>
          )}
          {currentExample && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs font-medium text-foreground">
              {currentExample}
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
