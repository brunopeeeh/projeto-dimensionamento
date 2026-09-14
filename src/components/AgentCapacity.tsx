import { useMemo, useState } from "react";
import { fmtNum } from "@/lib/utils";
import { RotateCcw, TrendingUp, Users, Headphones, Bot, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  findAiAgent,
  findSupportAgent,
  matchAgentName,
  isAiAgent,
  isSupportAgent,
} from "@/lib/agents";
import { useDimensionamento, Day, TeamAgent } from "@/context/DimensionamentoContext";
import { DaySelector } from "@/components/DaySelector";
import { Tooltip } from "@/components/ui/tooltip";
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

const isScheduledOnDay = (agent: TeamAgent, day: Day) => {
  if (!agent.active || !agent.schedules[day]) return false;
  return Object.values(agent.schedules[day]!.intervals).some(
    (s) => s === "trabalhando" || s === "externo" || s === "pausa",
  );
};

export function AgentCapacity() {
  const capacityAgents = useDimensionamento((s) => s.capacityAgents);
  const updateCapacityAgent = useDimensionamento((s) => s.updateCapacityAgent);
  const setCapacityAgentActive = useDimensionamento((s) => s.setCapacityAgentActive);
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
    const loadingId = toast.loading(`Sincronizando com Freshchat/HubSpot (${currentMonth})…`);
    try {
      const humanTeamNames = teamAgents
        .filter((a) => a.active && !isAiAgent(a.name) && !isSupportAgent(a.name))
        .map((a) => a.name);

      const res = await fetch("/api/sync-from-freshchat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          month: currentMonth,
          teamAgentNames: humanTeamNames,
        }),
      });
      const data = (await res.json()) as {
        success: boolean;
        message: string;
        agents_synced?: number;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Erro na sincronização.");
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
    const row = findSupportAgent(capacityAgents) ?? { name: "Yooga Suporte", mediaTri: 0 };
    return { ...row, ...deriveRow(row.mediaTri) };
  }, [capacityAgents]);

  const aiRow = useMemo(() => {
    const row = findAiAgent(capacityAgents) ?? { name: "Care IA", mediaTri: 0, active: true };
    const active = row.active !== false;
    return {
      ...row,
      active,
      ...deriveRow(row.mediaTri),
    };
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

  const totalResolvidos20 = useMemo(() => {
    const list = humanAgentsFiltered;
    return list.reduce((s, r) => s + r.resolvidos20, 0);
  }, [humanAgentsFiltered]);

  const totalResolvidos10 = useMemo(() => {
    const list = humanAgentsFiltered;
    return list.reduce((s, r) => s + r.resolvidos10, 0);
  }, [humanAgentsFiltered]);

  const aiResolvidosHora = aiRow?.active ? aiRow.resolvidosHora : 0;
  const aiResolvidos20 = aiRow?.active ? aiRow.resolvidos20 : 0;
  const aiResolvidos10 = aiRow?.active ? aiRow.resolvidos10 : 0;

  // Yooga Suporte soma 1 no divisor; Care IA não entra no divisor
  const currentCapacity = useMemo(() => {
    const support = supportRow?.resolvidosHora ?? 0;
    return computeAverageCapacity(
      totalResolvidosHora + support + aiResolvidosHora,
      operationalDivisor,
    );
  }, [totalResolvidosHora, operationalDivisor, supportRow, aiResolvidosHora]);

  const currentCapacity20min = useMemo(() => {
    const support = supportRow?.resolvidos20 ?? 0;
    return computeAverageCapacity(totalResolvidos20 + support + aiResolvidos20, operationalDivisor);
  }, [totalResolvidos20, operationalDivisor, supportRow, aiResolvidos20]);

  const currentCapacityWebchat = useMemo(() => {
    const support = supportRow?.resolvidos10 ?? 0;
    return computeAverageCapacity(totalResolvidos10 + support + aiResolvidos10, operationalDivisor);
  }, [totalResolvidos10, operationalDivisor, supportRow, aiResolvidos10]);

  return (
    <div className="space-y-6">
      {/* Operational cards grid */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        {/* Card 1: Equipe Care */}
        <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center gap-4 transition-all duration-300 hover:scale-[1.01] hover:shadow-md border-border">
          <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
            <Users className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <span className="text-xs text-muted-foreground font-medium block">Equipe Care</span>
            <div className="text-3xl font-bold tracking-tight mt-0.5 text-foreground">
              {humanAgentsFiltered.length}
            </div>
            <span className="text-[10px] text-muted-foreground font-medium lowercase block">
              agentes ativos
            </span>
          </div>
        </div>

        {/* Card 2: Yooga Suporte */}
        <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center gap-4 transition-all duration-300 hover:scale-[1.01] hover:shadow-md border-border">
          <div className="p-3 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 shrink-0">
            <Headphones className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <span className="text-xs text-muted-foreground font-medium block">Yooga Suporte</span>
            <div className="text-3xl font-bold tracking-tight mt-0.5 text-foreground">
              {supportRow ? fmtNum(supportRow.resolvidosDia, 2) : "61,00"}
            </div>
            <span className="text-[10px] text-muted-foreground font-medium lowercase block">
              resolvidos/dia
            </span>
          </div>
        </div>

        {/* Card 3: Care IA */}
        <div
          className={`rounded-xl border bg-card p-5 shadow-sm flex items-center justify-between gap-3 transition-all duration-300 hover:scale-[1.01] hover:shadow-md ${
            aiRow?.active && aiRow.mediaTri > 0
              ? "border-indigo-500/30 bg-indigo-500/5 dark:border-indigo-500/20"
              : "border-border opacity-90"
          }`}
        >
          <div className="flex items-center gap-4 min-w-0">
            <div
              className={`p-3 rounded-lg shrink-0 ${
                aiRow?.active && aiRow.mediaTri > 0
                  ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Bot className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <span className="text-xs text-muted-foreground font-medium block">Care IA</span>
              <div className="text-3xl font-bold tracking-tight mt-0.5 text-foreground font-mono truncate">
                {aiRow?.active ? fmtNum(aiRow.resolvidosDia, 2) : "0,00"}
              </div>
              <span className="text-[10px] text-muted-foreground font-medium lowercase block">
                {aiRow?.active
                  ? aiRow.mediaTri > 0
                    ? "resolvidos/dia"
                    : "volume zerado"
                  : "desativada do cálculo"}
              </span>
            </div>
          </div>

          <button
            type="button"
            disabled={isReadOnly}
            onClick={() => {
              if (aiRow) {
                setCapacityAgentActive(aiRow.name, !aiRow.active);
                toast.info(
                  !aiRow.active
                    ? "Care IA ativada no dimensionamento."
                    : "Care IA desativada do dimensionamento (volume zerado no cálculo).",
                );
              }
            }}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              aiRow?.active
                ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/25 border border-indigo-500/30"
                : "bg-muted text-muted-foreground hover:bg-muted/80 border border-border"
            }`}
            title={
              aiRow?.active
                ? "Clique para desativar a Care IA do cálculo"
                : "Clique para ativar a Care IA no cálculo"
            }
          >
            <span
              className={`h-2 w-2 rounded-full ${
                aiRow?.active && aiRow.mediaTri > 0
                  ? "bg-indigo-600 dark:bg-indigo-400 animate-pulse"
                  : aiRow?.active
                    ? "bg-amber-500"
                    : "bg-muted-foreground/50"
              }`}
            />
            {aiRow?.active ? (aiRow.mediaTri > 0 ? "Ativa" : "Zerada") : "Inativa"}
          </button>
        </div>
      </div>

      {/* Métricas de Capacidade Card */}
      <div className="rounded-xl border bg-card p-5 shadow-sm border-border">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          Métricas de Capacidade
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {selectedDay === "Todos" ? (
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

              {/* Capsule 2: Capacity/20min */}
              <div className="bg-muted/40 border border-border/80 rounded-lg p-3 text-center">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider flex items-center justify-center gap-0.5">
                  Capacity/20min{" "}
                  <Tooltip content="Capacidade média calculada em blocos de 20 minutos." />
                </span>
                <div className="text-xl font-bold text-foreground mt-1 font-mono tracking-tight">
                  {fmtNum(currentCapacity20min, 2)}
                </div>
              </div>

              {/* Capsule 3: Capacity Helpdesk/10min */}
              <div className="bg-muted/40 border border-border/80 rounded-lg p-3 text-center">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider flex items-center justify-center gap-0.5">
                  Capacity Helpdesk/10min{" "}
                  <Tooltip content="(Volume dos humanos + Yooga Suporte + Care IA se ativa) dividido pelos humanos + 1 posição de Yooga Suporte." />
                </span>
                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-mono tracking-tight">
                  {fmtNum(currentCapacityWebchat, 2)}
                </div>
              </div>

              {/* Capsule 4: Care IA por 10min (apenas na Visão Geral) */}
              <div
                className={`border rounded-lg p-3 text-center transition-colors ${
                  aiRow?.active && aiRow.mediaTri > 0
                    ? "bg-indigo-500/10 border-indigo-500/30"
                    : "bg-muted/40 border-border/80 opacity-70"
                }`}
              >
                <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider flex items-center justify-center gap-0.5">
                  Care IA/10min{" "}
                  <Tooltip content="Volume de chamados absorvidos pela Care IA a cada 10 min (base 20d x 8h). Não ocupa assento no divisor." />
                </span>
                <div
                  className={`text-xl font-bold mt-1 font-mono tracking-tight ${
                    aiRow?.active && aiRow.mediaTri > 0
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {aiRow?.active ? fmtNum(aiRow.resolvidos10, 2) : "0,00"}
                </div>
              </div>
            </>
          ) : (
            /* Em dias específicos (Segunda a Domingo), exibe somente o Capacity Helpdesk daquele dia, sem replicar Care IA */
            <div className="bg-muted/40 border border-border/80 rounded-lg p-3 text-center">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider flex items-center justify-center gap-0.5">
                Capacity Helpdesk/10min{" "}
                <Tooltip
                  content={`Capacidade média calculada especificamente para ${selectedDay}.`}
                />
              </span>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-mono tracking-tight">
                {fmtNum(currentCapacityWebchat, 2)}
              </div>
            </div>
          )}
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

              {/* Blank separator row to divide active agents from Yooga Suporte */}
              {humanAgentsFiltered.length > 0 && (
                <tr className="h-6 bg-muted/5 border-b border-border/10">
                  <td colSpan={7} className="p-0"></td>
                </tr>
              )}

              {/* Static Average Row: Yooga Suporte */}
              {supportRow && (
                <tr className="border-b last:border-0 bg-muted/10 font-medium">
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

              {/* Special Row: Care IA */}
              {aiRow && (
                <tr
                  className={`border-b last:border-0 font-medium transition-colors ${
                    aiRow.active
                      ? "bg-indigo-500/5 hover:bg-indigo-500/10"
                      : "bg-muted/10 opacity-60 hover:opacity-90"
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground font-semibold">{aiRow.name}</span>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => {
                          setCapacityAgentActive(aiRow.name, !aiRow.active);
                          toast.info(
                            !aiRow.active
                              ? "Care IA ativada no dimensionamento."
                              : "Care IA desativada do dimensionamento.",
                          );
                        }}
                        className={`px-2 py-0.5 text-[10px] rounded-full border transition-all ${
                          aiRow.active
                            ? "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-500/40"
                            : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                        }`}
                        title="Clique para alternar entre ativo e inativo"
                      >
                        {aiRow.active ? "Ativa" : "Desativada"}
                      </button>
                    </div>
                  </td>
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
