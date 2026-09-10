import { useMemo, useState } from "react";
import { fmtNum } from "@/lib/utils";
import { RotateCcw, TrendingUp, Users, Headphones, Bot, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { matchAgentName, isAiAgent, isSupportAgent } from "@/lib/agents";
import { useDimensionamento, Day, TeamAgent } from "@/context/DimensionamentoContext";
import { DaySelector } from "@/components/DaySelector";
import { Tooltip } from "@/components/ui/tooltip";
import { AI_DAYS_PER_MONTH, AI_HOURS_PER_DAY } from "@/lib/constants";
import { computeAverageCapacity } from "@/lib/calculations";

const SHIFT_HOURS = 8;

function deriveRow(mediaTri: number) {
  const mediaMes = mediaTri / 3;
  const resolvidosDia = mediaMes / 20;
  const resolvidosHora = resolvidosDia / SHIFT_HOURS;
  const resolvidos20 = resolvidosHora / 3;
  const resolvidos10 = resolvidosHora / 6;
  return { mediaMes, resolvidosDia, resolvidosHora, resolvidos20, resolvidos10 };
}

// A IA atende 24/7 — a jornada é o calendário completo (30 dias x 24h), não a
// jornada humana de 8h x 20 dias úteis.
function deriveAiRow(mediaTri: number) {
  const mediaMes = mediaTri / 3;
  const resolvidosDia = mediaMes / AI_DAYS_PER_MONTH;
  const resolvidosHora = resolvidosDia / AI_HOURS_PER_DAY;
  const resolvidos20 = resolvidosHora / 3;
  const resolvidos10 = resolvidosHora / 6;
  return { mediaMes, resolvidosDia, resolvidosHora, resolvidos20, resolvidos10 };
}

const isScheduledOnDay = (agent: TeamAgent, day: Day) => {
  if (!agent.active || !agent.schedules[day]) return false;
  return Object.values(agent.schedules[day]!.intervals).some(
    (s) => s === "trabalhando" || s === "externo" || s === "pausa",
  );
};

export function AgentCapacity() {
  const capacityAgents = useDimensionamento((s) => s.capacityAgents);
  const updateCapacityAgent = useDimensionamento((s) => s.updateCapacityAgent);
  const resetAll = useDimensionamento((s) => s.resetAll);
  const isReadOnly = useDimensionamento((s) => s.isReadOnly);
  const teamAgents = useDimensionamento((s) => s.teamAgents);
  const currentMonth = useDimensionamento((s) => s.currentMonth);
  const refreshCurrentMonth = useDimensionamento((s) => s.refreshCurrentMonth);
  const [selectedDay, setSelectedDay] = useState<Day | "Todos">("Todos");
  const [isSyncing, setIsSyncing] = useState(false);

  const handleFreshchatSync = async () => {
    if (!currentMonth) {
      toast.error("Selecione um mês de planejamento antes de sincronizar.");
      return;
    }
    setIsSyncing(true);
    const loadingId = toast.loading(`Sincronizando Freshchat → ${currentMonth}…`);
    try {
      const teamAgentNames = teamAgents.filter((a) => a.active).map((a) => a.name);
      const res = await fetch("/api/sync-from-freshchat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month: currentMonth, teamAgentNames }),
      });
      const data = (await res.json()) as {
        success: boolean;
        message: string;
        agents_synced: number;
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }
      await refreshCurrentMonth();
      toast.success(data.message, { id: loadingId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido.";
      toast.error(`Falha no sync: ${message}`, { id: loadingId });
    } finally {
      setIsSyncing(false);
    }
  };

  const supportRow = useMemo(() => {
    const row = capacityAgents.find((a) => isSupportAgent(a.name));
    return row ? { ...row, ...deriveRow(row.mediaTri) } : undefined;
  }, [capacityAgents]);

  const aiRow = useMemo(() => {
    const row = capacityAgents.find((a) => isAiAgent(a.name));
    return row ? { ...row, ...deriveAiRow(row.mediaTri) } : undefined;
  }, [capacityAgents]);

  // Dynamically map active team agents to capacity humanRows, defaulting mediaTri to 750
  const humanRows = useMemo(() => {
    return teamAgents
      .filter((agent) => agent.active && !isAiAgent(agent.name) && !isSupportAgent(agent.name))
      .map((agent) => {
        const capMatch = capacityAgents.find((ca) => matchAgentName(ca.name, agent.name));
        const mediaTri = capMatch ? capMatch.mediaTri : 750;
        return {
          name: agent.name,
          mediaTri,
          ...deriveRow(mediaTri),
        };
      });
  }, [teamAgents, capacityAgents]);

  const humanAgentsFiltered = useMemo(() => {
    if (selectedDay === "Todos") {
      return humanRows;
    }
    return humanRows.filter((row) => {
      const match = teamAgents.find((agent) => agent.name === row.name);
      if (!match) return false;
      return isScheduledOnDay(match, selectedDay);
    });
  }, [humanRows, selectedDay, teamAgents]);

  // Total active human agents in the entire team roster (constant across days)
  const totalTeamAgentsCount = useMemo(() => {
    return teamAgents.filter(
      (agent) => agent.active && !isAiAgent(agent.name) && !isSupportAgent(agent.name),
    ).length;
  }, [teamAgents]);

  // Divisor dynamically switches between total team count (for Visão Geral) and daily count (for specific days)
  const currentDivisor = useMemo(() => {
    if (selectedDay === "Todos") {
      return totalTeamAgentsCount;
    }
    return humanAgentsFiltered.length;
  }, [selectedDay, totalTeamAgentsCount, humanAgentsFiltered]);

  const operationalDivisor = currentDivisor + (supportRow ? 1 : 0);

  const totalResolvidosHora = useMemo(() => {
    const list = humanAgentsFiltered;
    return list.reduce((s, r) => s + r.resolvidosHora, 0);
  }, [humanAgentsFiltered]);

  // Yooga Suporte representa uma posição agregada; Care IA contribui com
  // volume resolvido, mas nunca aumenta o divisor de posições.
  const currentCapacity = useMemo(() => {
    const support = supportRow?.resolvidosHora ?? 0;
    const ai = aiRow?.resolvidosHora ?? 0;
    return computeAverageCapacity(totalResolvidosHora + support + ai, operationalDivisor);
  }, [totalResolvidosHora, operationalDivisor, supportRow, aiRow]);

  const totalResolvidos20 = useMemo(() => {
    const list = humanAgentsFiltered;
    return list.reduce((s, r) => s + r.resolvidos20, 0);
  }, [humanAgentsFiltered]);

  const currentCapacity20min = useMemo(() => {
    const support = supportRow?.resolvidos20 ?? 0;
    const ai = aiRow?.resolvidos20 ?? 0;
    return computeAverageCapacity(totalResolvidos20 + support + ai, operationalDivisor);
  }, [totalResolvidos20, operationalDivisor, supportRow, aiRow]);

  const totalResolvidos10 = useMemo(() => {
    const list = humanAgentsFiltered;
    return list.reduce((s, r) => s + r.resolvidos10, 0);
  }, [humanAgentsFiltered]);

  const currentCapacityWebchat = useMemo(() => {
    const support = supportRow?.resolvidos10 ?? 0;
    const ai = aiRow?.resolvidos10 ?? 0;
    return computeAverageCapacity(totalResolvidos10 + support + ai, operationalDivisor);
  }, [totalResolvidos10, operationalDivisor, supportRow, aiRow]);

  return (
    <div className="space-y-6">
      {/* Premium themed operational cards grid */}
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Card 1: Equipe Care */}
        <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center gap-4 transition-all duration-300 hover:scale-[1.01] hover:shadow-md border-border">
          <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs text-muted-foreground font-medium">Equipe Care</span>
            <div className="text-3xl font-bold tracking-tight mt-0.5 text-foreground">
              {humanAgentsFiltered.length}
            </div>
            <span className="text-[10px] text-muted-foreground font-medium lowercase">
              agentes ativos
            </span>
          </div>
        </div>

        {/* Card 2: Yooga Suporte */}
        <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center gap-4 transition-all duration-300 hover:scale-[1.01] hover:shadow-md border-border">
          <div className="p-3 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <Headphones className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs text-muted-foreground font-medium">Yooga Suporte</span>
            <div className="text-3xl font-bold tracking-tight mt-0.5 text-foreground">
              {supportRow ? fmtNum(supportRow.mediaTri / 3 / 20, 4) : 61}
            </div>
            <span className="text-[10px] text-muted-foreground font-medium lowercase">
              resolvidos/dia
            </span>
          </div>
        </div>

        {/* Card 3: Care AI */}
        <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center gap-4 transition-all duration-300 hover:scale-[1.01] hover:shadow-md border-border">
          <div className="p-3 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs text-muted-foreground font-medium">Care AI</span>
            <div className="text-3xl font-bold tracking-tight mt-0.5 text-foreground">
              {aiRow ? fmtNum(aiRow.resolvidosDia, 4) : 245}
            </div>
            <span className="text-[10px] text-muted-foreground font-medium lowercase">
              resolvidos/dia (24/7)
            </span>
          </div>
        </div>
      </div>

      {/* Métricas de Capacidade Premium Card */}
      <div className="rounded-xl border bg-card p-5 shadow-sm border-border">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          Métricas de Capacidade
        </h3>
        <div
          className={`grid gap-3 ${selectedDay === "Todos" ? "grid-cols-2 md:grid-cols-4" : "grid-cols-1"}`}
        >
          {selectedDay === "Todos" && (
            <>
              {/* Capsule 1: Capacity */}
              <div className="bg-muted/40 border border-border/80 rounded-lg p-3 text-center">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider flex items-center justify-center gap-0.5">
                  Capacity{" "}
                  <Tooltip content="Capacidade média de conversas resolvidas por hora por analista humano." />
                </span>
                <div className="text-xl font-bold text-foreground mt-1 font-mono tracking-tight">
                  {fmtNum(currentCapacity, 2)}
                </div>
              </div>
              {/* Capsule 2: contribuição da IA */}
              <div className="bg-muted/40 border border-border/80 rounded-lg p-3 text-center">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider flex items-center justify-center gap-0.5">
                  Care IA/10min{" "}
                  <Tooltip content="Volume resolvido pela Care IA por bloco de 10 minutos. Entra no cálculo do Capacity, mas a IA não entra no divisor de agentes." />
                </span>
                <div className="text-xl font-bold text-foreground mt-1 font-mono tracking-tight">
                  {fmtNum(aiRow?.resolvidos10 ?? 0, 3)}
                </div>
              </div>
              {/* Capsule 3: Capacity/20min */}
              <div className="bg-muted/40 border border-border/80 rounded-lg p-3 text-center">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider flex items-center justify-center gap-0.5">
                  Capacity/20min{" "}
                  <Tooltip content="Capacidade média calculada em blocos de 20 minutos." />
                </span>
                <div className="text-xl font-bold text-foreground mt-1 font-mono tracking-tight">
                  {fmtNum(currentCapacity20min, 2)}
                </div>
              </div>
            </>
          )}
          {/* Capsule 4: capacity composto da fila única */}
          <div className="bg-muted/40 border border-border/80 rounded-lg p-3 text-center">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider flex items-center justify-center gap-0.5">
              Capacity Helpdesk/10min{" "}
              <Tooltip content="(Volume dos humanos + Yooga Suporte + Care IA) dividido pelos humanos + 1 posição de Yooga Suporte. A Care IA não entra como agente." />
            </span>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-mono tracking-tight">
              {fmtNum(currentCapacityWebchat, 2)}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Capacity por Agente</h2>
              <p className="text-xs text-muted-foreground">
                Edite o volume trimestral (os demais valores são recalculados automaticamente).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleFreshchatSync}
                disabled={isSyncing || isReadOnly}
                className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Sincronizando…" : "Sincronizar com Freshchat"}
              </button>
              <button
                onClick={resetAll}
                disabled={isReadOnly}
                className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-3 w-3" /> Restaurar valores
              </button>
            </div>
          </div>

          <DaySelector
            value={selectedDay}
            onChange={setSelectedDay}
            includeAll
            className="border-t border-border/40 pt-3.5"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <Th>Team Member {selectedDay !== "Todos" && selectedDay}</Th>
                <Th right>Média / Tri</Th>
                <Th right>Média / Mês</Th>
                <Th right>Resolv / Dia</Th>
                <Th right>Resolv / Hora</Th>
                <Th right>/ 20min</Th>
                <Th right>/ 10min</Th>
              </tr>
            </thead>
            <tbody>
              {humanAgentsFiltered.map((r) => (
                <tr key={r.name} className="border-b hover:bg-accent/30">
                  <td className="px-4 py-2.5 font-medium">{r.name}</td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      aria-label={`Média trimestral de ${r.name}`}
                      value={r.mediaTri}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        updateCapacityAgent(r.name, v);
                      }}
                      disabled={isReadOnly}
                      className="w-24 border bg-background px-2 py-1 text-right tabular-nums focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </td>
                  <Td>{fmtNum(r.mediaMes, 1)}</Td>
                  <Td bold>{fmtNum(r.resolvidosDia, 4)}</Td>
                  <Td>{fmtNum(r.resolvidosHora, 3)}</Td>
                  <Td>{fmtNum(r.resolvidos20, 3)}</Td>
                  <Td>{fmtNum(r.resolvidos10, 3)}</Td>
                </tr>
              ))}

              {/* Blank separator row to divide active agents from Yooga Suporte and Care AI */}
              {humanAgentsFiltered.length > 0 && (
                <tr className="h-6 bg-muted/5 border-b border-border/10">
                  <td colSpan={7} className="p-0"></td>
                </tr>
              )}

              {/* Static Average and AI Rows */}
              {supportRow && (
                <tr className="border-b bg-muted/10 font-medium">
                  <td className="px-4 py-2.5 text-muted-foreground">{supportRow.name}</td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      aria-label={`Média trimestral de ${supportRow.name}`}
                      value={supportRow.mediaTri}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        updateCapacityAgent(supportRow.name, v);
                      }}
                      disabled={isReadOnly}
                      className="w-24 border bg-background px-2 py-1 text-right tabular-nums focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </td>
                  <Td>{fmtNum(supportRow.mediaMes, 1)}</Td>
                  <Td bold>{fmtNum(supportRow.resolvidosDia, 4)}</Td>
                  <Td>{fmtNum(supportRow.resolvidosHora, 3)}</Td>
                  <Td>{fmtNum(supportRow.resolvidos20, 3)}</Td>
                  <Td>{fmtNum(supportRow.resolvidos10, 3)}</Td>
                </tr>
              )}
              {aiRow && (
                <tr className="border-b last:border-0 bg-muted/20 font-semibold">
                  <td className="px-4 py-2.5 text-foreground">{aiRow.name}</td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      aria-label={`Média trimestral de ${aiRow.name}`}
                      value={aiRow.mediaTri}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        updateCapacityAgent(aiRow.name, v);
                      }}
                      disabled={isReadOnly}
                      className="w-24 border bg-background px-2 py-1 text-right tabular-nums focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </td>
                  <Td>{fmtNum(aiRow.mediaMes, 1)}</Td>
                  <Td bold>{fmtNum(aiRow.resolvidosDia, 4)}</Td>
                  <Td>{fmtNum(aiRow.resolvidosHora, 3)}</Td>
                  <Td>{fmtNum(aiRow.resolvidos20, 3)}</Td>
                  <Td>{fmtNum(aiRow.resolvidos10, 3)}</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-4 py-2.5 font-medium ${right ? "text-right" : ""}`}>{children}</th>;
}
function Td({ children, bold }: { children: React.ReactNode; bold?: boolean }) {
  return (
    <td
      className={`px-4 py-2 text-right tabular-nums ${bold ? "font-semibold" : "text-muted-foreground"}`}
    >
      {children}
    </td>
  );
}
