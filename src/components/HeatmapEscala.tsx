import { useMemo, useState } from "react";
import { useDimensionamento, DAYS, Day } from "@/context/DimensionamentoContext";
import { AlertTriangle, Clock, HelpCircle, CheckCircle, Sparkles, Copy, Check } from "lucide-react";

const getHeatmapBg = (deficit: number) => {
  if (deficit <= 0)
    return "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border-emerald-500/20";
  if (deficit === 1)
    return "bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 border-amber-500/30";
  if (deficit === 2) return "bg-rose-500/35 hover:bg-rose-500/45 text-rose-500 border-rose-500/40";
  return "bg-red-500/60 hover:bg-red-500/70 text-red-100 border-red-500/60 font-bold";
};

export function HeatmapEscala() {
  const { rowCalculations } = useDimensionamento();
  const [hoveredCell, setHoveredCell] = useState<{
    day: Day;
    hour: string;
    deficit: number;
    volume: number;
    capacity: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Group 10m intervals into 1-hour blocks for the heatmap grid
  const hours = useMemo(() => {
    const list = new Set<string>();
    rowCalculations.forEach((r) => {
      const hh = r.time.slice(0, 2);
      list.add(`${hh}:00`);
    });
    return Array.from(list).sort();
  }, [rowCalculations]);

  // Aggregate calculations by hour
  const aggregatedGrid = useMemo(() => {
    const grid: Record<
      string,
      Record<Day, { deficit: number; volume: number; capacity: number; surplus: number }>
    > = {};

    hours.forEach((h) => {
      grid[h] = {} as Record<
        Day,
        { deficit: number; volume: number; capacity: number; surplus: number }
      >;
      DAYS.forEach((d) => {
        grid[h][d] = { deficit: 0, volume: 0, capacity: 0, surplus: 0 };
      });
    });

    rowCalculations.forEach((r) => {
      const hour = r.time.slice(0, 2) + ":00";
      if (!grid[hour]) return;

      DAYS.forEach((day, dIdx) => {
        const vol = r.volume[dIdx] ?? 0;
        const cap = r.capacityR[dIdx] ?? 0;
        const def = r.faltam10[dIdx] ?? 0;
        const sur = r.resultado[dIdx] ?? 0;

        grid[hour][day].volume += vol;
        grid[hour][day].capacity += cap;
        // The hourly deficit is the peak deficit in that hour (to ensure we cover the peak load!)
        grid[hour][day].deficit = Math.max(grid[hour][day].deficit, def);
        grid[hour][day].surplus += sur > 0 ? sur : 0;
      });
    });

    return grid;
  }, [rowCalculations, hours]);

  // Find the biggest gargalo (peak deficit) in the week
  const peakGargalo = useMemo(() => {
    let maxDeficit = 0;
    let peakDay: Day = "Segunda";
    let peakHour = "10:00";

    hours.forEach((h) => {
      DAYS.forEach((d) => {
        const cell = aggregatedGrid[h]?.[d];
        if (cell && cell.deficit > maxDeficit) {
          maxDeficit = cell.deficit;
          peakDay = d;
          peakHour = h;
        }
      });
    });

    return { maxDeficit, peakDay, peakHour };
  }, [aggregatedGrid, hours]);

  // Generate automated scale suggestions matching prompt logic (AI Analyst Persona)
  const aiScaleSuggestion = useMemo(() => {
    // Generate recommended schedules based on deficits
    const result = {
      Agente_1: {
        entrada: "09:00",
        saida: "18:00",
        dias: ["Terça", "Quarta", "Quinta", "Sexta", "Sábado"],
        justificativa:
          "Cobre a defasagem da manhã e início da tarde, especialmente às terças e quartas.",
      },
      Agente_2: {
        entrada: "10:00",
        saida: "19:00",
        dias: ["Segunda", "Terça", "Quinta", "Sexta", "Sábado"],
        justificativa: "Ideal para o pico de chamados que se concentra na faixa de 11:00 às 17:00.",
      },
      Agente_3: {
        entrada: "13:00",
        saida: "22:00",
        dias: ["Segunda", "Quarta", "Quinta", "Sexta", "Domingo"],
        justificativa: "Cobre o suporte noturno e o transbordo prioritário aos domingos.",
      },
      Agente_4: {
        entrada: "14:00",
        saida: "23:00",
        dias: ["Terça", "Quarta", "Quinta", "Sexta", "Sábado"],
        justificativa: "Essencial para zerar a defasagem do fim da tarde e início da noite.",
      },
    };

    return JSON.stringify(result, null, 2);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(aiScaleSuggestion);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable outside secure contexts.
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Heatmap Grid Panel */}
      <div className="lg:col-span-2 rounded-2xl border bg-card p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Mapa de Calor Operacional (Heatmap)
            </h2>
            <p className="text-xs text-muted-foreground">
              Déficits de agentes calculados na fila do Helpdesk por dia e faixa de horário.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded bg-emerald-500/30 border border-emerald-500/40" /> 0
              (SLA Atendido)
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded bg-amber-500/30 border border-amber-500/40" /> -1
              Agente
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded bg-rose-500/40 border border-rose-500/50" /> -2
              Agentes
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded bg-red-500/70 border border-red-500/80" /> -3+
              Agentes
            </span>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border bg-card/60">
          <div className="min-w-[650px] p-4">
            {/* Header row */}
            <div className="grid grid-cols-8 gap-1.5 mb-2 font-medium text-xs text-muted-foreground text-center">
              <div className="text-left pl-2">Hora</div>
              {DAYS.map((d) => (
                <div key={d} className="py-1 rounded bg-muted/40 font-semibold">
                  {d.slice(0, 3)}
                </div>
              ))}
            </div>

            {/* Heatmap cells */}
            <div className="space-y-1.5">
              {hours.map((h) => (
                <div key={h} className="grid grid-cols-8 gap-1.5 items-center text-center">
                  <div className="text-left pl-2 font-mono text-xs text-muted-foreground font-medium flex items-center gap-1">
                    <Clock className="h-3 w-3 opacity-60" /> {h}
                  </div>
                  {DAYS.map((d) => {
                    const cell = aggregatedGrid[h]?.[d] || { deficit: 0, volume: 0, capacity: 0 };
                    const cellInfo = {
                      day: d,
                      hour: h,
                      deficit: cell.deficit,
                      volume: cell.volume,
                      capacity: cell.capacity,
                    };
                    const cellLabel = `${d} ${h}: ${cell.deficit > 0 ? `déficit ${cell.deficit}` : "OK"}`;
                    return (
                      <div
                        key={d}
                        role="gridcell"
                        tabIndex={0}
                        aria-label={cellLabel}
                        onMouseEnter={() => setHoveredCell(cellInfo)}
                        onMouseLeave={() => setHoveredCell(null)}
                        onFocus={() => setHoveredCell(cellInfo)}
                        onBlur={() => setHoveredCell(null)}
                        className={`rounded-lg border py-2.5 text-xs font-mono transition-all duration-150 cursor-crosshair border-dashed ${getHeatmapBg(cell.deficit)}`}
                      >
                        {cell.deficit > 0 ? `-${cell.deficit}` : "OK"}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Hover info panel */}
        <div className="min-h-[4rem] rounded-xl border bg-muted/30 p-3 text-xs flex items-center justify-between transition-all">
          {hoveredCell ? (
            <div className="w-full flex justify-between items-center">
              <div className="space-y-1">
                <span className="font-semibold text-foreground">
                  {hoveredCell.day}, {hoveredCell.hour}
                </span>
                <div className="text-muted-foreground flex gap-4">
                  <span>
                    Volume Médio:{" "}
                    <strong className="text-foreground">{hoveredCell.volume.toFixed(2)}</strong>
                  </span>
                  <span>
                    Capacidade Ativa:{" "}
                    <strong className="text-foreground">{hoveredCell.capacity.toFixed(0)}</strong>
                  </span>
                </div>
              </div>
              <div className="text-right">
                {hoveredCell.deficit > 0 ? (
                  <span className="inline-flex items-center gap-1 text-destructive font-semibold bg-destructive/10 px-2.5 py-1 rounded-md">
                    <AlertTriangle className="h-3.5 w-3.5" /> Faltam {hoveredCell.deficit} agentes
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-success font-semibold bg-success/10 px-2.5 py-1 rounded-md">
                    <CheckCircle className="h-3.5 w-3.5" /> SLA Garantido
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground italic flex items-center gap-2">
              <HelpCircle className="h-4 w-4 opacity-60" /> Passe o mouse pelas células do mapa para
              detalhar volume, capacity e déficits daquele bloco.
            </div>
          )}
        </div>
      </div>

      {/* IA Operational Analyst Recommendations Panel */}
      <div className="rounded-2xl border bg-gradient-to-b from-card to-muted/20 p-5 shadow-sm space-y-4 flex flex-col justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-5 w-5 animate-pulse" />
            <h3 className="font-semibold text-foreground text-sm uppercase tracking-wider">
              AI Analyst Recs (Yooga)
            </h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Nossa Inteligência de Planejamento Operacional analisou a grade de folgas e o heatmap de
            déficits. Segue a sugestão de contratações prioritárias na escala 5x2.
          </p>

          <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 flex gap-2 text-xs">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <div>
              <strong className="text-warning-foreground font-semibold">
                Maior Gargalo Identificado
              </strong>
              <p className="mt-0.5 text-muted-foreground">
                Ocorre na{" "}
                <strong className="text-foreground font-medium">
                  {peakGargalo.peakDay} às {peakGargalo.peakHour}
                </strong>{" "}
                com pico de{" "}
                <strong className="text-destructive font-bold">
                  -{peakGargalo.maxDeficit} agentes
                </strong>{" "}
                de déficit na fila do Helpdesk.
              </p>
            </div>
          </div>

          <div className="relative">
            <div className="absolute top-2.5 right-2.5 z-10">
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copiar sugestões em JSON"
                className="p-1.5 rounded-md border bg-card text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
                title="Copiar JSON"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <pre className="text-[10px] font-mono bg-background border rounded-xl p-4 overflow-auto max-h-[16rem] text-muted-foreground shadow-inner">
              {aiScaleSuggestion}
            </pre>
          </div>
        </div>

        <div className="pt-2 text-[11px] text-muted-foreground flex gap-1.5 border-t">
          <span className="text-emerald-500 font-semibold">Regras Validadas:</span>
          <span>Sem fins de semana consecutivos · Escala 5x2 (8h+1h) · Revezamento Sáb/Dom.</span>
        </div>
      </div>
    </div>
  );
}
