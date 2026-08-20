import { createLazyFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState, type ComponentType } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCcw,
  Save,
  Timer,
  TrendingUp,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Wand2,
} from "lucide-react";
import { useDimensionamento, DAYS, type Day } from "@/context/DimensionamentoContext";
import { computeGridCalculations, computeDynamicTmaFactors } from "@/lib/calculations";
import {
  applyAbsence,
  applyTmaVariation,
  applyVolumeSpike,
  worstDeficitBlocks,
  type TimeRange,
} from "@/lib/simulador";
import { buildDeficitTable } from "@/lib/ai-suggestion";
import { estimateAgentsNeeded } from "@/lib/optimization/solver";
import { useAiSuggestion } from "@/features/ai-suggestion/useAiSuggestion";
import { AiSuggestionDialog } from "@/features/ai-suggestion/AiSuggestionDialog";
import type { NewAgentHire } from "@/context/types";

export const Route = createLazyFileRoute("/simulador")({
  component: Simulador,
});

type SpikeChannel = "webchat" | "whatsapp" | "ambos";

/**
 * Tudo que define um cenário. Estado único de propósito: é exatamente isto que
 * é salvo, recarregado e comparado — em estados separados, "salvar cenário"
 * viraria uma dúzia de campos soltos para manter em sincronia.
 */
type ScenarioInput = {
  absentIds: string[];
  absenceDays: Day[];
  absenceRange: TimeRange | null;
  spikePct: number;
  spikeDays: Day[];
  spikeChannel: SpikeChannel;
  spikeRange: TimeRange | null;
  tmaPct: number;
  /** null = usa o valor real do mês. */
  simWC: number | null;
  simWA: number | null;
  hireCount: number;
  hireStart: string;
  hireEnd: string;
  hireDays: Day[];
};

type SavedScenario = { id: string; name: string; input: ScenarioInput };

const EMPTY: ScenarioInput = {
  absentIds: [],
  absenceDays: [],
  absenceRange: null,
  spikePct: 0,
  spikeDays: [],
  spikeChannel: "whatsapp",
  spikeRange: null,
  tmaPct: 0,
  simWC: null,
  simWA: null,
  hireCount: 0,
  hireStart: "09:00",
  hireEnd: "18:00",
  hireDays: [],
};

// ponytail: localStorage basta — cenário é rascunho pessoal de quem monta a
// escala. Migrar para o Supabase quando precisar compartilhar entre usuários.
const STORAGE_KEY = "simulador:cenarios:v1";

function loadScenarios(): SavedScenario[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isDirty(input: ScenarioInput): boolean {
  return (
    input.absentIds.length > 0 ||
    (input.spikePct !== 0 && input.spikeDays.length > 0) ||
    input.tmaPct !== 0 ||
    input.simWC !== null ||
    input.simWA !== null ||
    input.hireCount > 0
  );
}

function Simulador() {
  const {
    currentMonth,
    teamAgents,
    capacityAgents,
    timeBlocks,
    webchatVolumes,
    whatsappVolumes,
    simultaneousWC,
    simultaneousWA,
    newHires,
    rowCalculations,
    kpis,
  } = useDimensionamento();

  const [input, setInput] = useState<ScenarioInput>(EMPTY);
  const [saved, setSaved] = useState<SavedScenario[]>(loadScenarios);
  const [compareId, setCompareId] = useState<string>("");
  const [scenarioName, setScenarioName] = useState("");

  const patch = useCallback(
    (next: Partial<ScenarioInput>) => setInput((prev) => ({ ...prev, ...next })),
    [],
  );

  const hasSimulation = isDirty(input);

  /**
   * Roda a semana inteira com as perturbações aplicadas. Tudo em memória:
   * nada aqui toca o estado real nem a persistência do mês.
   */
  const runScenario = useCallback(
    (params: ScenarioInput) => {
      const simTeam = applyAbsence(
        teamAgents,
        new Set(params.absentIds),
        params.absenceDays,
        params.absenceRange,
      );

      const spikesWC = params.spikeChannel !== "whatsapp";
      const spikesWA = params.spikeChannel !== "webchat";

      const extraHires: NewAgentHire[] = Array.from({ length: params.hireCount }, (_, i) => ({
        id: `sim_hire_${i}`,
        name: `Reforço ${i + 1}`,
        start_time: params.hireStart,
        end_time: params.hireEnd,
        days: params.hireDays.length > 0 ? params.hireDays : DAYS,
        active: true,
      }));

      return computeGridCalculations({
        days: DAYS,
        timeBlocks,
        webchatVolumes: spikesWC
          ? applyVolumeSpike(webchatVolumes, params.spikeDays, params.spikePct, params.spikeRange)
          : webchatVolumes,
        whatsappVolumes: spikesWA
          ? applyVolumeSpike(whatsappVolumes, params.spikeDays, params.spikePct, params.spikeRange)
          : whatsappVolumes,
        teamAgents: simTeam,
        dynamicTmaFactors: applyTmaVariation(
          computeDynamicTmaFactors(DAYS, simTeam, capacityAgents),
          params.tmaPct,
        ),
        simultaneousWC: params.simWC ?? simultaneousWC,
        simultaneousWA: params.simWA ?? simultaneousWA,
        newHires: [...newHires, ...extraHires],
      });
    },
    [
      teamAgents,
      capacityAgents,
      timeBlocks,
      webchatVolumes,
      whatsappVolumes,
      simultaneousWC,
      simultaneousWA,
      newHires,
    ],
  );

  const simulated = useMemo(() => runScenario(input), [runScenario, input]);

  const compared = useMemo(() => {
    const target = saved.find((s) => s.id === compareId);
    return target ? { name: target.name, result: runScenario(target.input) } : null;
  }, [compareId, saved, runScenario]);

  const baseAgents = useMemo(
    () => estimateAgentsNeeded({ deficitTable: buildDeficitTable(rowCalculations) }),
    [rowCalculations],
  );
  const simAgents = useMemo(
    () => estimateAgentsNeeded({ deficitTable: buildDeficitTable(simulated.rowCalculations) }),
    [simulated],
  );

  const worstBlocks = useMemo(
    () => worstDeficitBlocks(rowCalculations, simulated.rowCalculations),
    [rowCalculations, simulated],
  );

  // Sugestão de turnos roda sobre o grid SIMULADO, não sobre o real.
  const aiState = useAiSuggestion(simulated.rowCalculations);

  const activeAgents = useMemo(() => teamAgents.filter((a) => a.active), [teamAgents]);

  const persist = (next: SavedScenario[]) => {
    setSaved(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Cota cheia ou modo privado: o cenário atual continua valendo em memória.
    }
  };

  const saveScenario = () => {
    const name = scenarioName.trim();
    if (!name) return;
    // Mesmo nome sobrescreve, em vez de acumular duplicata.
    const existing = saved.find((s) => s.name.toLowerCase() === name.toLowerCase());
    const entry: SavedScenario = { id: existing?.id ?? `sc_${Date.now()}`, name, input };
    persist([...saved.filter((s) => s.id !== entry.id), entry]);
    setScenarioName("");
  };

  const toggleAbsent = (id: string) =>
    patch({
      absentIds: input.absentIds.includes(id)
        ? input.absentIds.filter((x) => x !== id)
        : [...input.absentIds, id],
    });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex rounded-full border bg-background/60 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Cenários · {currentMonth}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Simulador de Cenários
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Teste ausências, picos, TMA e reforços sem alterar a escala real. Nada aqui é salvo no
              mês.
            </p>
          </div>
          <button
            onClick={() => setInput(EMPTY)}
            disabled={!hasSimulation}
            className="self-start inline-flex items-center gap-1.5 rounded-lg border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Limpar cenário
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DeltaCard
            icon={AlertTriangle}
            label="Pico Máximo de Defasagem"
            base={kpis.picoMaximo.deficit}
            sim={simulated.kpis.picoMaximo.deficit}
            compare={compared?.result.kpis.picoMaximo.deficit}
            compareName={compared?.name}
            suffix=" agentes"
            hint={`${simulated.kpis.picoMaximo.day} às ${simulated.kpis.picoMaximo.time}`}
            higherIsWorse
            color="text-destructive bg-destructive/10"
          />
          <DeltaCard
            icon={CheckCircle2}
            label="Cobertura Semanal (SLA)"
            base={kpis.coberturaProjetada}
            sim={simulated.kpis.coberturaProjetada}
            compare={compared?.result.kpis.coberturaProjetada}
            compareName={compared?.name}
            suffix="%"
            decimals={1}
            hint="Fluxo total coberto pela equipe"
            color="text-success bg-success/10"
          />
          <DeltaCard
            icon={Users}
            label="Agentes Recomendados"
            base={baseAgents}
            sim={simAgents}
            hint="Estimativa para zerar a semana"
            higherIsWorse
            color="text-primary bg-primary/10"
          />
          <DeltaCard
            icon={TrendingUp}
            label="Déficit Total (10min)"
            base={kpis.totalDeficit10}
            sim={simulated.kpis.totalDeficit10}
            compare={compared?.result.kpis.totalDeficit10}
            compareName={compared?.name}
            hint="Soma das lacunas na semana"
            higherIsWorse
            color="text-amber-600 bg-amber-600/10 dark:text-amber-400 dark:bg-amber-400/10"
          />
        </div>

        <ScenarioBar
          saved={saved}
          name={scenarioName}
          onName={setScenarioName}
          onSave={saveScenario}
          canSave={hasSimulation && scenarioName.trim().length > 0}
          compareId={compareId}
          onCompare={setCompareId}
          onLoad={(id) => {
            const target = saved.find((s) => s.id === id);
            if (target) setInput(target.input);
          }}
          onDelete={(id) => {
            persist(saved.filter((s) => s.id !== id));
            if (compareId === id) setCompareId("");
          }}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          icon={UserMinus}
          title="Ausência de analistas"
          subtitle="Quem sai do time, se ausenta o dia todo ou só parte dele."
        >
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {activeAgents.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum analista ativo na escala.</p>
            )}
            {activeAgents.map((agent) => (
              <label
                key={agent.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={input.absentIds.includes(agent.id)}
                  onChange={() => toggleAbsent(agent.id)}
                  className="h-3.5 w-3.5 cursor-pointer accent-destructive"
                />
                <span className="truncate text-foreground">{agent.name}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 border-t border-border/40 pt-3">
            <FieldLabel>
              Dias da ausência
              <span className="ml-1.5 font-normal normal-case text-muted-foreground">
                (nenhum = semana toda)
              </span>
            </FieldLabel>
            <DayChips
              selected={input.absenceDays}
              onToggle={(absenceDays) => patch({ absenceDays })}
            />
          </div>

          <RangeToggle
            label="Ausência parcial (atraso, meio período, consulta)"
            range={input.absenceRange}
            defaultRange={{ start: "12:00", end: "18:00" }}
            onChange={(absenceRange) => patch({ absenceRange })}
          />
        </Panel>

        <Panel
          icon={TrendingUp}
          title="Pico de chamados"
          subtitle="Aumento (ou queda) percentual de volume nos dias selecionados."
        >
          <div className="flex flex-wrap items-end gap-4">
            <NumberField
              label="Variação"
              value={input.spikePct}
              step={5}
              suffix="%"
              onChange={(spikePct) => patch({ spikePct })}
            />
            <div>
              <FieldLabel>Canal</FieldLabel>
              <select
                value={input.spikeChannel}
                onChange={(e) => patch({ spikeChannel: e.target.value as SpikeChannel })}
                className="rounded-md border bg-background px-2.5 py-1.5 text-sm text-foreground border-border"
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="webchat">Webchat</option>
                <option value="ambos">Ambos</option>
              </select>
            </div>
          </div>

          <div className="mt-4 border-t border-border/40 pt-3">
            <FieldLabel>Dias afetados</FieldLabel>
            <DayChips selected={input.spikeDays} onToggle={(spikeDays) => patch({ spikeDays })} />
            {input.spikePct !== 0 && input.spikeDays.length === 0 && (
              <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                Selecione ao menos um dia para o pico valer.
              </p>
            )}
          </div>

          <RangeToggle
            label="Pico só em uma faixa (rush do almoço, fim de tarde)"
            range={input.spikeRange}
            defaultRange={{ start: "11:00", end: "14:00" }}
            onChange={(spikeRange) => patch({ spikeRange })}
          />
        </Panel>

        <Panel
          icon={Timer}
          title="Produtividade"
          subtitle="TMA mais lento e quantos chats cada analista toca ao mesmo tempo."
        >
          <div className="flex flex-wrap items-end gap-4">
            <NumberField
              label="Variação de TMA"
              value={input.tmaPct}
              step={5}
              suffix="%"
              onChange={(tmaPct) => patch({ tmaPct })}
            />
            <NumberField
              label="Simultâneos Webchat"
              value={input.simWC ?? simultaneousWC}
              step={1}
              min={1}
              onChange={(v) => patch({ simWC: v === simultaneousWC ? null : v })}
            />
            <NumberField
              label="Simultâneos WhatsApp"
              value={input.simWA ?? simultaneousWA}
              step={1}
              min={1}
              onChange={(v) => patch({ simWA: v === simultaneousWA ? null : v })}
            />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            TMA +20% = atendimento 20% mais lento, ou seja, 20% menos chats por analista. Use
            negativo para simular ganho de produtividade.
          </p>
        </Panel>

        <Panel
          icon={UserPlus}
          title="Reforço de equipe"
          subtitle="Quantos analistas a mais, em qual turno — para responder 'contratar resolve?'."
        >
          <div className="flex flex-wrap items-end gap-4">
            <NumberField
              label="Analistas extras"
              value={input.hireCount}
              step={1}
              min={0}
              onChange={(hireCount) => patch({ hireCount: Math.max(0, hireCount) })}
            />
            <div>
              <FieldLabel>Turno</FieldLabel>
              <div className="flex items-center gap-1.5">
                <TimeInput value={input.hireStart} onChange={(hireStart) => patch({ hireStart })} />
                <span className="text-xs text-muted-foreground">até</span>
                <TimeInput value={input.hireEnd} onChange={(hireEnd) => patch({ hireEnd })} />
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-border/40 pt-3">
            <FieldLabel>
              Dias do reforço
              <span className="ml-1.5 font-normal normal-case text-muted-foreground">
                (nenhum = semana toda)
              </span>
            </FieldLabel>
            <DayChips selected={input.hireDays} onToggle={(hireDays) => patch({ hireDays })} />
          </div>
        </Panel>
      </div>

      <WorstBlocks blocks={worstBlocks} hasSimulation={hasSimulation} />

      <section className="rounded-xl border bg-card p-5 shadow-sm border-border">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Como cobrir esse cenário</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {simAgents === 0
                ? "A equipe atual cobre o cenário simulado — nenhum reforço necessário."
                : `Faltam ${simAgents} agente(s) para zerar a semana simulada${
                    simAgents > baseAgents ? ` (${simAgents - baseAgents} a mais que hoje)` : ""
                  }.`}
            </p>
          </div>
          <button
            onClick={aiState.handleMathSuggest}
            disabled={aiState.aiLoading || simAgents === 0}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Wand2 className="h-4 w-4" />
            {aiState.aiLoading ? "Calculando…" : "Sugerir turnos"}
          </button>
        </div>
      </section>

      <AiSuggestionDialog
        isOpen={aiState.aiDialogOpen}
        onOpenChange={aiState.setAiDialogOpen}
        meta={aiState.aiMeta}
        currentMonth={currentMonth}
        validationErrors={aiState.aiValidationErrors}
        agents={aiState.aiAgents}
        result={aiState.aiResult}
        justification={aiState.aiJustification}
        onApply={() => {}}
        // Simulação é efêmera: aplicar gravaria em newHires (estado real).
        isReadOnly
      />
    </div>
  );
}

function ScenarioBar({
  saved,
  name,
  onName,
  onSave,
  canSave,
  compareId,
  onCompare,
  onLoad,
  onDelete,
}: {
  saved: SavedScenario[];
  name: string;
  onName: (v: string) => void;
  onSave: () => void;
  canSave: boolean;
  compareId: string;
  onCompare: (id: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-border/40 pt-4">
      <div>
        <FieldLabel>Salvar cenário</FieldLabel>
        <div className="flex items-center gap-1.5">
          <input
            value={name}
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) onSave();
            }}
            placeholder="Black Friday"
            className="w-40 rounded-md border bg-background px-2.5 py-1.5 text-sm text-foreground border-border"
          />
          <button
            onClick={onSave}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> Salvar
          </button>
        </div>
      </div>

      {saved.length > 0 && (
        <>
          <div>
            <FieldLabel>Comparar com</FieldLabel>
            <select
              value={compareId}
              onChange={(e) => onCompare(e.target.value)}
              className="rounded-md border bg-background px-2.5 py-1.5 text-sm text-foreground border-border"
            >
              <option value="">— nenhum —</option>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel>Cenários salvos</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {saved.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground"
                >
                  <button
                    onClick={() => onLoad(s.id)}
                    className="font-medium hover:text-foreground"
                    title="Carregar este cenário"
                  >
                    {s.name}
                  </button>
                  <button
                    onClick={() => onDelete(s.id)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Excluir"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function WorstBlocks({
  blocks,
  hasSimulation,
}: {
  blocks: { day: Day; time: string; base: number; sim: number }[];
  hasSimulation: boolean;
}) {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm border-border">
      <div className="mb-3 border-b border-border/40 pb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Onde o cenário dói
        </h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Os blocos de 10 minutos com maior falta de analistas — é aqui que o reforço precisa cair.
        </p>
      </div>

      {blocks.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {hasSimulation
            ? "Nenhum bloco com déficit no cenário simulado."
            : "Monte um cenário acima para ver os horários críticos."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 text-left font-semibold">Dia</th>
                <th className="pb-2 text-left font-semibold">Horário</th>
                <th className="pb-2 text-right font-semibold">Hoje</th>
                <th className="pb-2 text-right font-semibold">Cenário</th>
                <th className="pb-2 text-right font-semibold">Piora</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => {
                const delta = b.sim - b.base;
                return (
                  <tr key={`${b.day}-${b.time}`} className="border-t border-border/40">
                    <td className="py-1.5 text-foreground">{b.day}</td>
                    <td className="py-1.5 tabular-nums text-muted-foreground">{b.time}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {b.base}
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums text-foreground">
                      {b.sim}
                    </td>
                    <td
                      className={`py-1.5 text-right tabular-nums ${
                        delta > 0 ? "text-rose-500" : "text-muted-foreground"
                      }`}
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Panel({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm border-border">
      <div className="mb-4 border-b border-border/40 pb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  step,
  min,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-24 rounded-md border bg-background px-2.5 py-1.5 text-sm tabular-nums text-foreground border-border"
        />
        {suffix && <span className="text-sm font-medium text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums text-foreground border-border"
    />
  );
}

function RangeToggle({
  label,
  range,
  defaultRange,
  onChange,
}: {
  label: string;
  range: TimeRange | null;
  defaultRange: TimeRange;
  onChange: (range: TimeRange | null) => void;
}) {
  return (
    <div className="mt-4 border-t border-border/40 pt-3">
      <label className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-muted-foreground">
        <input
          type="checkbox"
          checked={range !== null}
          onChange={(e) => onChange(e.target.checked ? defaultRange : null)}
          className="h-3.5 w-3.5 cursor-pointer accent-primary"
        />
        {label}
      </label>

      {range && (
        <div className="mt-2 flex items-center gap-1.5">
          <TimeInput value={range.start} onChange={(start) => onChange({ ...range, start })} />
          <span className="text-xs text-muted-foreground">até</span>
          <TimeInput value={range.end} onChange={(end) => onChange({ ...range, end })} />
        </div>
      )}
    </div>
  );
}

function DayChips({ selected, onToggle }: { selected: Day[]; onToggle: (next: Day[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1 select-none">
      {DAYS.map((day) => {
        const isOn = selected.includes(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() => onToggle(isOn ? selected.filter((d) => d !== day) : [...selected, day])}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-all ${
              isOn
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            {day.slice(0, 3)}
          </button>
        );
      })}
    </div>
  );
}

function DeltaCard({
  icon: Icon,
  label,
  base,
  sim,
  compare,
  compareName,
  suffix = "",
  decimals = 0,
  hint,
  higherIsWorse = false,
  color,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  base: number;
  sim: number;
  compare?: number;
  compareName?: string;
  suffix?: string;
  decimals?: number;
  hint?: string;
  higherIsWorse?: boolean;
  color?: string;
}) {
  const diff = sim - base;
  const changed = Math.abs(diff) >= 0.05;
  const isWorse = higherIsWorse ? diff > 0 : diff < 0;
  const fmt = (n: number) => n.toFixed(decimals).replace(".", ",");

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

      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={`text-2xl font-bold tabular-nums ${
            changed ? (isWorse ? "text-rose-500" : "text-emerald-500") : "text-foreground"
          }`}
        >
          {fmt(sim)}
          {suffix}
        </span>
        {changed && (
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
            de {fmt(base)}
            {suffix} ({diff > 0 ? "+" : ""}
            {fmt(diff)})
          </span>
        )}
      </div>

      {compare !== undefined && compareName && (
        <div className="mt-1 text-[10px] tabular-nums text-muted-foreground">
          {compareName}: {fmt(compare)}
          {suffix}
        </div>
      )}

      {hint && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
