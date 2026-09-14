import React, { useState, useMemo } from "react";
import {
  useDimensionamento,
  DAYS,
  Day,
  TeamAgent,
  IntervalStatus,
  AgentSchedule,
} from "@/context/DimensionamentoContext";
import {
  toBlock20,
  isTimeInShift,
  getLunchEndTime,
  sortAgentsByShiftStart,
  getAgentDaySummary,
} from "@/lib/time";
import { DaySelector } from "@/components/DaySelector";
import { AgenteDiaTable } from "@/components/escala/AgenteDiaTable";
import { TimeIntervalCountTable } from "@/components/escala/TimeIntervalCountTable";
import { ScheduleGrid } from "@/components/escala/ScheduleGrid";
import { ConfigDrawer } from "@/components/escala/ConfigDrawer";
import {
  EXTRA_TABS,
  EscalaTab,
  SHIFT_PRESETS,
  generateTimeBlocks20,
} from "@/components/escala/constants";
import { SlidersHorizontal, Plus } from "lucide-react";
import { AgentScheduleModal } from "@/components/escala/AgentScheduleModal";

interface EscalaTeamManagerProps {
  showSimulated?: boolean;
  readOnlyCLT?: boolean;
}

export function EscalaTeamManager({
  showSimulated = false,
  readOnlyCLT = false,
}: EscalaTeamManagerProps = {}) {
  const teamAgents = useDimensionamento((s) => s.teamAgents);
  const setTeamAgents = useDimensionamento((s) => s.setTeamAgents);
  const toggleIntervalStatus = useDimensionamento((s) => s.toggleIntervalStatus);
  const applyPresetShift = useDimensionamento((s) => s.applyPresetShift);
  const toggleAgentActive = useDimensionamento((s) => s.toggleAgentActive);
  const addTeamAgent = useDimensionamento((s) => s.addTeamAgent);
  const removeTeamAgent = useDimensionamento((s) => s.removeTeamAgent);
  const resetAll = useDimensionamento((s) => s.resetAll);
  const updateTeamAgentName = useDimensionamento((s) => s.updateTeamAgentName);
  const rowCalculations = useDimensionamento((s) => s.rowCalculations);
  const newHires = useDimensionamento((s) => s.newHires);

  const [activeDay, setActiveDay] = useState<Day>("Segunda");
  const [activeTab, setActiveTab] = useState<EscalaTab>("Segunda");
  const [newAgentName, setNewAgentName] = useState("");
  const [selectedAgentForPreset, setSelectedAgentForPreset] = useState<string>("");
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");
  const [selectedDays, setSelectedDays] = useState<Record<Day, boolean>>({
    Segunda: true,
    Terça: true,
    Quarta: true,
    Quinta: true,
    Sexta: true,
    Sábado: false,
    Domingo: false,
  });
  const [selectedShiftIndex, setSelectedShiftIndex] = useState<number>(0);
  const [selectedLunchTime, setSelectedLunchTime] = useState<string>("12:00");
  const [selectedExternalTime, setSelectedExternalTime] = useState<string>("");
  const [selectedExternalDuration, setSelectedExternalDuration] = useState<number>(60);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"global" | "resumida">("global");

  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [selectedAgentForModal, setSelectedAgentForModal] = useState<TeamAgent | null>(null);

  const handleOpenNewAgent = () => {
    setSelectedAgentForModal(null);
    setIsScheduleModalOpen(true);
  };

  const handleOpenEditAgent = (agent: TeamAgent) => {
    setSelectedAgentForModal(agent);
    setIsScheduleModalOpen(true);
  };

  const handleSaveAgentSchedule = (agentData: {
    id?: string;
    name: string;
    active: boolean;
    schedules: Partial<Record<Day, AgentSchedule>>;
  }) => {
    if (agentData.id) {
      setTeamAgents((prev) =>
        prev.map((ag) =>
          ag.id === agentData.id
            ? {
                ...ag,
                name: agentData.name,
                active: agentData.active,
                schedules: agentData.schedules,
              }
            : ag,
        ),
      );
      setSuccessMessage(`Escala semanal de "${agentData.name}" atualizada com sucesso! 🎉`);
    } else {
      const newAgent: TeamAgent = {
        id: `clt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: agentData.name,
        active: true,
        schedules: agentData.schedules,
      };
      setTeamAgents((prev) => [...prev, newAgent]);
      setSuccessMessage(`Analista "${agentData.name}" cadastrado com sucesso! 🎉`);
    }
    setTimeout(() => setSuccessMessage(null), 3500);
  };

  const timeBlocks20 = useMemo(() => generateTimeBlocks20(), []);

  const allAgents = useMemo<TeamAgent[]>(() => {
    if (!showSimulated) return teamAgents;

    const mappedHires: TeamAgent[] = newHires
      .filter((hire) => hire.active)
      .map((hire) => {
        const schedules = {} as Record<Day, AgentSchedule>;
        DAYS.forEach((day) => {
          if (hire.schedules && hire.schedules[day]) {
            schedules[day] = hire.schedules[day] as AgentSchedule;
          } else {
            const intervals = {} as Record<string, IntervalStatus>;
            timeBlocks20.forEach((block) => {
              const isLunch =
                hire.days.includes(day) &&
                hire.lunch_start_time &&
                isTimeInShift(block, hire.lunch_start_time, getLunchEndTime(hire.lunch_start_time));
              const isWorking =
                hire.days.includes(day) && isTimeInShift(block, hire.start_time, hire.end_time);
              intervals[block] = isLunch ? "pausa" : isWorking ? "trabalhando" : "folga";
            });
            schedules[day] = { intervals };
          }
        });
        return {
          id: hire.id,
          name: hire.name,
          active: true,
          schedules,
          isSimulated: true,
        } as TeamAgent;
      });

    return [...teamAgents, ...mappedHires];
  }, [teamAgents, newHires, showSimulated, timeBlocks20]);

  const getAgentsForDay = (day: Day): string[] => {
    const activeAgents = allAgents.filter((agent) => {
      if (!agent.active || !agent.schedules[day]) return false;
      return Object.values(agent.schedules[day]!.intervals).some(
        (s) => s === "trabalhando" || s === "externo" || s === "pausa",
      );
    });

    const sortedAgents = sortAgentsByShiftStart(activeAgents, day);
    const list = sortedAgents.map((agent) =>
      agent.isSimulated ? `${agent.name} (Simulado)` : agent.name,
    );

    list.push("Yooga Suporte");
    return list;
  };

  const getActiveAgentsCount = (time: string, day: Day) => {
    const time20 = toBlock20(time);
    return allAgents.reduce((count, agent) => {
      if (agent.active && agent.schedules[day]) {
        const status = agent.schedules[day]!.intervals[time20] || "folga";
        if (status === "trabalhando") {
          return count + 1;
        }
      }
      return count;
    }, 0);
  };

  const getProvaRealAgentsCount = (time: string, day: Day) => {
    const agentsSch = getActiveAgentsCount(time, day);
    if (showSimulated) {
      return agentsSch;
    }
    const time20 = toBlock20(time);
    const activeNewHires = newHires.reduce((count, hire) => {
      if (!hire.active) return count;

      if (hire.schedules && hire.schedules[day]) {
        const status = hire.schedules[day]!.intervals[time20] || "folga";
        return status === "trabalhando" ? count + 1 : count;
      }

      if (hire.days.includes(day) && isTimeInShift(time, hire.start_time, hire.end_time)) {
        return count + 1;
      }
      return count;
    }, 0);
    return agentsSch + activeNewHires;
  };

  const visibleAgents = useMemo(() => {
    const activeAgents = allAgents.filter((agent) => {
      if (!agent.active) return false;
      const daySched = agent.schedules[activeDay];
      if (!daySched) return false;
      return Object.values(daySched.intervals).some(
        (status) => status === "trabalhando" || status === "externo" || status === "pausa",
      );
    });

    return sortAgentsByShiftStart(activeAgents, activeDay);
  }, [allAgents, activeDay]);

  const getAgentDaySummaryForAgent = (agent: TeamAgent, day: Day): string =>
    getAgentDaySummary(agent.schedules[day]);

  const handleAddAgent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim()) return;
    addTeamAgent(newAgentName.trim());
    setNewAgentName("");
  };

  const handleApplyCustomShift = () => {
    if (!selectedAgentForPreset) return;
    const preset = SHIFT_PRESETS[selectedShiftIndex];

    Object.entries(selectedDays).forEach(([dayStr, isChecked]) => {
      if (isChecked) {
        applyPresetShift(
          selectedAgentForPreset,
          dayStr as Day,
          preset.start,
          preset.end,
          selectedLunchTime,
          selectedExternalTime,
          selectedExternalDuration,
        );
      }
    });

    setSuccessMessage("Alterações realizadas com sucesso! 🎉");
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleApplyFolga = () => {
    if (!selectedAgentForPreset) return;

    Object.entries(selectedDays).forEach(([dayStr, isChecked]) => {
      if (isChecked) {
        applyPresetShift(selectedAgentForPreset, dayStr as Day, "00:00", "00:00", "00:00");
      }
    });
    setSuccessMessage("Folga registrada com sucesso! 🏖️");
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleClearAgentDay = (agentId: string) => {
    applyPresetShift(agentId, activeDay, "00:00", "00:00", "00:00");
  };

  const countActiveOnDay = (day: Day) =>
    allAgents.filter((a) => {
      if (!a.active || !a.schedules[day]) return false;
      return Object.values(a.schedules[day]!.intervals).some(
        (s) => s === "trabalhando" || s === "externo" || s === "pausa",
      );
    }).length;

  const isDayTab = (tab: EscalaTab): tab is Day => DAYS.includes(tab as Day);

  return (
    <div className="space-y-6">
      <div className="rounded-none border border-border bg-card px-5 pt-5 shadow-sm">
        <div className="flex flex-wrap justify-between items-end border-b border-border gap-4">
          <DaySelector
            value={activeTab}
            onChange={(day) => {
              if (day === "Todos") return;
              setActiveTab(day);
              setActiveDay(day);
            }}
            variant="tab"
            className=""
            getBadge={countActiveOnDay}
            extraTabs={EXTRA_TABS.map((tab) => ({ id: tab, label: tab }))}
            onExtraTabSelect={(id) => setActiveTab(id as EscalaTab)}
          />

          <div className="flex items-center gap-2 mb-1.5">
            {!readOnlyCLT && (
              <button
                type="button"
                onClick={handleOpenNewAgent}
                className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 px-3.5 py-1.5 text-xs font-bold transition-all rounded-md shadow-xs"
                title="Cadastrar novo analista com modelo semanal visual"
              >
                <Plus className="h-3.5 w-3.5" /> Novo Analista
              </button>
            )}

            <button
              onClick={() => setIsConfigOpen(true)}
              className="inline-flex items-center gap-1.5 border border-border border-b-transparent bg-background/50 px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all rounded-t-md mb-[0px]"
              title="Configurar presets e analistas em lote"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-primary" /> Configurar Escala
            </button>
          </div>
        </div>
      </div>

      {activeTab === "Agente dia" ? (
        <div className="rounded-none border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap justify-between items-center border-b border-border pb-3 gap-3">
            <h3 className="text-xs font-bold tracking-wider uppercase text-muted-foreground">
              Agente por Dia da Semana
            </h3>
          </div>
          <AgenteDiaTable getAgentsForDay={getAgentsForDay} />
        </div>
      ) : activeTab === "Quantidade de agente dia" ? (
        <div className="rounded-none border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap justify-between items-center border-b border-border pb-3 gap-3">
            <h3 className="text-xs font-bold tracking-wider uppercase text-muted-foreground">
              Quantidade de Agentes (a cada 10 min)
            </h3>
          </div>
          <TimeIntervalCountTable
            mode="actual"
            rowCalculations={rowCalculations}
            getActiveAgentsCount={getActiveAgentsCount}
            getProvaRealAgentsCount={getProvaRealAgentsCount}
          />
        </div>
      ) : isDayTab(activeTab) ? (
        <div className="rounded-none border border-border bg-card p-5 shadow-sm space-y-4">
          <ScheduleGrid
            activeDay={activeDay}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            visibleAgents={visibleAgents}
            timeBlocks20={timeBlocks20}
            readOnlyCLT={readOnlyCLT}
            getAgentDaySummary={getAgentDaySummaryForAgent}
            onToggleInterval={toggleIntervalStatus}
            onEditAgent={!readOnlyCLT ? handleOpenEditAgent : undefined}
          />
        </div>
      ) : null}

      <ConfigDrawer
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        successMessage={successMessage}
        teamAgents={teamAgents}
        timeBlocks20={timeBlocks20}
        activeDay={activeDay}
        selectedAgentForPreset={selectedAgentForPreset}
        onSelectedAgentForPresetChange={setSelectedAgentForPreset}
        selectedDays={selectedDays}
        onSelectedDaysChange={setSelectedDays}
        selectedShiftIndex={selectedShiftIndex}
        onSelectedShiftIndexChange={setSelectedShiftIndex}
        selectedLunchTime={selectedLunchTime}
        onSelectedLunchTimeChange={setSelectedLunchTime}
        selectedExternalTime={selectedExternalTime}
        onSelectedExternalTimeChange={setSelectedExternalTime}
        selectedExternalDuration={selectedExternalDuration}
        onSelectedExternalDurationChange={setSelectedExternalDuration}
        onApplyCustomShift={handleApplyCustomShift}
        onApplyFolga={handleApplyFolga}
        getAgentDaySummary={getAgentDaySummaryForAgent}
        editingAgentId={editingAgentId}
        onEditingAgentIdChange={setEditingAgentId}
        editingNameValue={editingNameValue}
        onEditingNameValueChange={setEditingNameValue}
        onUpdateTeamAgentName={updateTeamAgentName}
        onToggleAgentActive={toggleAgentActive}
        onRemoveTeamAgent={removeTeamAgent}
        onClearAgentDay={handleClearAgentDay}
        onResetAll={resetAll}
        newAgentName={newAgentName}
        onNewAgentNameChange={setNewAgentName}
        onAddAgent={handleAddAgent}
      />

      <AgentScheduleModal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        agent={selectedAgentForModal}
        onSave={handleSaveAgentSchedule}
        onDelete={removeTeamAgent}
        onToggleActive={toggleAgentActive}
      />
    </div>
  );
}
