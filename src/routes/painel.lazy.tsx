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
import { estimateAgentsNeeded } from "@/lib/optimization/solver";
import { buildDeficitTable } from "@/lib/ai-suggestion";
import { AlertTriangle, CheckCircle2, Users, RotateCcw } from "lucide-react";

export const Route = createLazyFileRoute("/painel")({
  component: Painel,
});

function Painel() {
  const { rowCalculations, kpis, currentMonth, resetAll, teamAgents, isReadOnly } =
    useDimensionamento();

  const [chartDay, setChartDay] = useState<Day>("Segunda");

  const comparisonChartData = useMemo(() => {
    const dIdx = DAYS.indexOf(chartDay);
    return rowCalculations
      .filter((r) => r.time < "03:00" || (r.time >= "07:00" && r.time <= "23:50"))
      .map((r) => ({
        time: r.time,
        resultado: Number((r.resultado[dIdx] ?? 0).toFixed(2)),
        prResultado: Number((r.prResultado[dIdx] ?? 0).toFixed(2)),
      }));
  }, [rowCalculations, chartDay]);

  // Greedy estimate of how many agents are needed to zero out the whole week's
  // Helpdesk deficit — same shift/folga rules as the math solver in Contratações,
  // but cheap enough to recompute on every edit (see estimateAgentsNeeded docs).
  const agentesRecomendados = useMemo(
    () => estimateAgentsNeeded({ deficitTable: buildDeficitTable(rowCalculations) }),
    [rowCalculations],
  );

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
          />
          <KpiCard
            icon={Users}
            label="Agentes Recomendados"
            value={agentesRecomendados.toString()}
            hint="Estimativa para zerar a semana"
            color="text-primary bg-primary/10"
          />
          <KpiCard
            icon={Users}
            label="Tamanho da Equipe"
            value={`${teamAgents.filter((a) => a.active).length} ativos`}
            hint="Total de analistas disponíveis na escala"
            color="text-indigo-600 bg-indigo-600/10 dark:text-indigo-400 dark:bg-indigo-400/10"
            tone="neutral"
          />
          <KpiCard
            icon={CheckCircle2}
            label="Cobertura Semanal (SLA)"
            value={`${kpis.coberturaProjetada.toFixed(1).replace(".", ",")}%`}
            hint="Fluxo total coberto pela equipe"
            color="text-success bg-success/10"
            tone={
              kpis.coberturaProjetada >= 95
                ? "good"
                : kpis.coberturaProjetada >= 85
                  ? "warn"
                  : "bad"
            }
          />
        </div>
      </section>

      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard
            title={`Helpdesk Original - ${chartDay}`}
            subtitle="Excedente ou déficit operacional antes do simulador."
            dotClass="bg-[#3b82f6]"
            chartDay={chartDay}
            setChartDay={setChartDay}
            data={comparisonChartData}
            dataKey="resultado"
            fill="#3b82f6"
            seriesName="Helpdesk Original"
          />
          <ChartCard
            title={`Prova Real (Simulado) - ${chartDay}`}
            subtitle="Excedente ou déficit operacional após o simulador."
            dotClass="bg-[#10b981]"
            chartDay={chartDay}
            setChartDay={setChartDay}
            data={comparisonChartData}
            dataKey="prResultado"
            fill="#10b981"
            seriesName="Prova Real"
          />
        </div>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  dotClass,
  chartDay,
  setChartDay,
  data,
  dataKey,
  fill,
  seriesName,
}: {
  title: string;
  subtitle: string;
  dotClass: string;
  chartDay: Day;
  setChartDay: (day: Day) => void;
  data: { time: string; resultado: number; prResultado: number }[];
  dataKey: "resultado" | "prResultado";
  fill: string;
  seriesName: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm border-border">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-4 mb-5">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
            {title}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <DaySelector
          value={chartDay}
          onChange={(day) => {
            if (day !== "Todos") setChartDay(day);
          }}
          variant="compact"
        />
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
              domain={[-6, 6]}
              ticks={[-6, -4, -2, 0, 2, 4, 6]}
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
                          {isPositive ? `+${val.toFixed(2)}` : val.toFixed(2)}
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
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  color?: string;
  tone?: "good" | "bad" | "warn" | "neutral";
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
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
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
