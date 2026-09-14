import { createLazyFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ComponentType } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  YAxis,
  ReferenceLine,
  Tooltip,
  XAxis,
} from "recharts";
import { useDimensionamento, DAYS, Day } from "@/context/DimensionamentoContext";
import { DaySelector } from "@/components/DaySelector";
import { estimateAgentNeed } from "@/lib/optimization/solver";
import { buildDeficitTable } from "@/lib/ai-suggestion";
import { isHumanAgent } from "@/lib/agents";
import { AlertTriangle, CheckCircle2, CircleHelp, Users, RotateCcw } from "lucide-react";

export const Route = createLazyFileRoute("/painel")({
  component: Painel,
});

function Painel() {
  const { rowCalculations, kpis, currentMonth, resetAll, teamAgents, isReadOnly } =
    useDimensionamento();

  const [chartDay, setChartDay] = useState<Day>("Segunda");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("chamados");

  const comparisonChartData = useMemo(() => {
    const dIdx = DAYS.indexOf(chartDay);
    return rowCalculations
      .filter((r) => r.time < "03:00" || (r.time >= "07:00" && r.time <= "23:50"))
      .map((r) => ({
        time: r.time,
        resultadoChamados: Number((r.resultado[dIdx] ?? 0).toFixed(2)),
        prResultadoChamados: Number((r.prResultado[dIdx] ?? 0).toFixed(2)),
        resultadoAgentes: -(r.faltam10[dIdx] ?? 0),
        prResultadoAgentes: -(r.prFaltam10[dIdx] ?? 0),
      }));
  }, [rowCalculations, chartDay]);

  const agentNeed = useMemo(
    () => estimateAgentNeed({ deficitTable: buildDeficitTable(rowCalculations) }),
    [rowCalculations],
  );

  const activeHumanAgents = teamAgents.filter(
    (agent) => agent.active && isHumanAgent(agent.name),
  ).length;
  const chartKeys =
    chartMetric === "chamados"
      ? ({ base: "resultadoChamados", simulated: "prResultadoChamados" } as const)
      : ({ base: "resultadoAgentes", simulated: "prResultadoAgentes" } as const);
  const chartDomain = useMemo<[number, number]>(() => {
    const maxValue = comparisonChartData.reduce(
      (max, row) =>
        Math.max(max, Math.abs(row[chartKeys.base]), Math.abs(row[chartKeys.simulated])),
      0,
    );
    const limit = Math.max(1, Math.ceil(maxValue));
    return [-limit, limit];
  }, [comparisonChartData, chartKeys.base, chartKeys.simulated]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex rounded-full border bg-background/60 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Mapeador de Workforce · {currentMonth}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Painel de Dimensionamento Dinâmico
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Acompanhe volumes, déficit e capacidade em tempo real.
            </p>
          </div>
          <button
            onClick={resetAll}
            disabled={isReadOnly}
            className="self-start inline-flex items-center gap-1.5 rounded-lg border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title="Restaurar dados originais de Fev/26"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Restaurar Padrão
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={AlertTriangle}
            label="Pico Máximo de Defasagem"
            value={`${kpis.picoMaximo.deficit} agentes`}
            hint={`${kpis.picoMaximo.day} às ${kpis.picoMaximo.time}`}
            color="text-destructive bg-destructive/10"
            tone={kpis.picoMaximo.deficit > 0 ? "bad" : "good"}
            helpText="Maior falta simultânea de agentes em uma faixa de 10 minutos da semana."
          />
          <KpiCard
            icon={Users}
            label="Agentes Recomendados"
            value={agentNeed.quantity.toString()}
            hint={
              agentNeed.feasible
                ? "Necessidade total · contratações: até 4/mês"
                : `Restam ${agentNeed.residualDeficit.toLocaleString("pt-BR")} blocos sem cobertura nos horários permitidos`
            }
            color="text-primary bg-primary/10"
            tone={agentNeed.feasible ? "neutral" : "warn"}
            helpText="Calculado sem o limite mensal de contratações. Considera turnos de 9 horas com 1 hora de almoço e escala 5x2."
          />
          <KpiCard
            icon={Users}
            label="Tamanho da Equipe"
            value={`${activeHumanAgents} ativos`}
            hint="Somente agentes humanos ativos na escala"
            color="text-indigo-600 bg-indigo-600/10 dark:text-indigo-400 dark:bg-indigo-400/10"
            tone="neutral"
            helpText="Care IA (quando ativa) e Yooga Suporte contribuem para a capacidade da fila, mas não entram no tamanho da equipe humana."
          />
          <KpiCard
            icon={CheckCircle2}
            label="Cobertura Estimada do Volume"
            value={`${kpis.coberturaProjetada.toFixed(1).replace(".", ",")}%`}
            hint="Chamados cobertos em cada faixa de 10 minutos"
            color="text-success bg-success/10"
            tone={
              kpis.coberturaProjetada >= 95
                ? "good"
                : kpis.coberturaProjetada >= 85
                  ? "warn"
                  : "bad"
            }
            helpText="Percentual do volume semanal atendido pela capacidade disponível. Déficits e sobras são apurados por faixa; uma sobra em outro horário não compensa uma falta."
          />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-4 rounded-xl border bg-card px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Comparação operacional</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Valores positivos indicam sobra; valores negativos indicam déficit na fila única.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <MetricSelector value={chartMetric} onChange={setChartMetric} />
            <div className="max-w-full overflow-x-auto pb-1 sm:pb-0">
              <DaySelector
                value={chartDay}
                onChange={(day) => {
                  if (day !== "Todos") setChartDay(day);
                }}
                variant="compact"
                className="min-w-max !flex-nowrap"
              />
            </div>
          </div>
        </div>

        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          <ChartCard
            title={`Fila única atual — ${chartDay}`}
            subtitle="Balanço da capacidade com a escala vigente."
            dotClass="bg-[#3b82f6]"
            data={comparisonChartData}
            dataKey={chartKeys.base}
            fill="#3b82f6"
            seriesName="Fila única atual"
            metric={chartMetric}
            domain={chartDomain}
          />
          <ChartCard
            title={`Fila única com contratações — ${chartDay}`}
            subtitle="Balanço após aplicar os reforços da Prova Real."
            dotClass="bg-[#10b981]"
            data={comparisonChartData}
            dataKey={chartKeys.simulated}
            fill="#10b981"
            seriesName="Fila única com contratações"
            metric={chartMetric}
            domain={chartDomain}
          />
        </div>
      </section>
    </div>
  );
}

type ChartMetric = "chamados" | "agentes";

type ComparisonChartRow = {
  time: string;
  resultadoChamados: number;
  prResultadoChamados: number;
  resultadoAgentes: number;
  prResultadoAgentes: number;
};

type ComparisonChartKey = Exclude<keyof ComparisonChartRow, "time">;

function MetricSelector({
  value,
  onChange,
}: {
  value: ChartMetric;
  onChange: (value: ChartMetric) => void;
}) {
  return (
    <div
      className="flex min-w-max gap-1 rounded-lg bg-muted p-1"
      role="group"
      aria-label="Unidade dos gráficos"
    >
      {(["chamados", "agentes"] as const).map((metric) => (
        <button
          key={metric}
          type="button"
          aria-pressed={value === metric}
          onClick={() => onChange(metric)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors ${
            value === metric
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {metric}
        </button>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  dotClass,
  data,
  dataKey,
  fill,
  seriesName,
  metric,
  domain,
}: {
  title: string;
  subtitle: string;
  dotClass: string;
  data: ComparisonChartRow[];
  dataKey: ComparisonChartKey;
  fill: string;
  seriesName: string;
  metric: ChartMetric;
  domain: [number, number];
}) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm border-border">
      <div className="mb-5 min-h-14 border-b border-border/40 pb-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
            {title}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>

      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            syncId="whatsAppComparison"
            margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
            barCategoryGap={1}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="rgba(148, 163, 184, 0.08)"
            />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              interval={7}
              tick={{ fill: "rgba(148, 163, 184, 0.7)", fontSize: 9 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              domain={domain}
              tick={{ fill: "rgba(148, 163, 184, 0.7)", fontSize: 9 }}
            />
            <Tooltip
              cursor={{ fill: "rgba(148, 163, 184, 0.04)" }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const val = payload[0].value as number;
                  const isPositive = val >= 0;
                  const colorClass = isPositive
                    ? "text-emerald-500 font-bold"
                    : "text-rose-500 font-bold";
                  return (
                    <div className="rounded-lg border bg-popover p-2.5 shadow-md border-border text-xs">
                      <p className="font-semibold text-foreground border-b border-border/40 pb-1 mb-1">
                        Horário: {payload[0].payload.time}
                      </p>
                      <div className="flex justify-between gap-4 py-0.5">
                        <span className="text-muted-foreground">{seriesName}:</span>
                        <span className={colorClass}>
                          {isPositive ? "+" : ""}
                          {val.toLocaleString("pt-BR", {
                            minimumFractionDigits: metric === "chamados" ? 2 : 0,
                            maximumFractionDigits: 2,
                          })}{" "}
                          {metric}
                        </span>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <ReferenceLine y={0} stroke="rgba(148, 163, 184, 0.3)" strokeWidth={1} />
            <Bar
              dataKey={dataKey}
              name={seriesName}
              fill={fill}
              barSize={3.5}
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  color,
  tone,
  helpText,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  color?: string;
  tone?: "good" | "bad" | "warn" | "neutral";
  helpText?: string;
}) {
  const valueColor =
    tone === "good"
      ? "text-emerald-500 font-semibold"
      : tone === "bad"
        ? "text-rose-500 font-semibold"
        : tone === "warn"
          ? "text-amber-500 font-semibold"
          : "text-foreground";

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm backdrop-blur border-border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>{label}</span>
          {helpText && (
            <span
              tabIndex={0}
              title={helpText}
              aria-label={helpText}
              className="inline-flex cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CircleHelp className="h-3 w-3" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className={`grid h-8 w-8 place-items-center rounded-lg ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</div>
      {hint && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
