import { Calendar, Edit2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useDimensionamento,
  type Day,
  type TeamAgent,
  type IntervalStatus,
} from "@/context/DimensionamentoContext";
import { getNext20MinTime } from "@/lib/time";
import { getCellStyles } from "./constants";

function formatAbbreviatedName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  return `${parts[0]} ${parts[1]}`;
}

type Props = {
  activeDay: Day;
  viewMode: "global" | "resumida";
  onViewModeChange: (mode: "global" | "resumida") => void;
  visibleAgents: TeamAgent[];
  timeBlocks20: string[];
  readOnlyCLT: boolean;
  getAgentDaySummary: (agent: TeamAgent, day: Day) => string;
  onToggleInterval: (agentId: string, day: Day, block: string) => void;
  onEditAgent?: (agent: TeamAgent) => void;
};

export function ScheduleGrid({
  activeDay,
  viewMode,
  onViewModeChange,
  visibleAgents,
  timeBlocks20,
  readOnlyCLT,
  getAgentDaySummary,
  onToggleInterval,
  onEditAgent,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragAction, setDragAction] = useState<"trabalhando" | "folga" | null>(null);
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);
  const [hasMoreToScrollRight, setHasMoreToScrollRight] = useState(false);

  const isReadOnly = useDimensionamento((s) => s.isReadOnly);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      setDragAction(null);
    };
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  const handleMouseDown = (
    agent: TeamAgent,
    block: string,
    currentStatus: IntervalStatus,
    canEdit: boolean,
  ) => {
    if (!canEdit) return;
    setIsDragging(true);
    const newAction = currentStatus === "trabalhando" ? "folga" : "trabalhando";
    setDragAction(newAction);
    onToggleInterval(agent.id, activeDay, block);
  };

  const handleMouseEnter = (
    agent: TeamAgent,
    block: string,
    currentStatus: IntervalStatus,
    canEdit: boolean,
  ) => {
    setHoveredBlock(block);
    if (!canEdit || !isDragging || !dragAction) return;

    if (
      (dragAction === "trabalhando" && currentStatus !== "trabalhando") ||
      (dragAction === "folga" && currentStatus === "trabalhando")
    ) {
      onToggleInterval(agent.id, activeDay, block);
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: timeBlocks20.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 18, // matches the fixed h-[18px] cell height below
    overscan: 6,
  });
  const virtualBlocks = rowVirtualizer.getVirtualItems();
  const virtualTotalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualBlocks.length > 0 ? virtualBlocks[0].start : 0;
  const paddingBottom =
    virtualBlocks.length > 0 ? virtualTotalSize - virtualBlocks[virtualBlocks.length - 1].end : 0;
  const globalColSpan = 3 + visibleAgents.length; // 2 time columns + N agents + 1 total column

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateScrollHint = () => {
      setHasMoreToScrollRight(el.scrollWidth - el.scrollLeft - el.clientWidth > 1);
    };

    updateScrollHint();
    el.addEventListener("scroll", updateScrollHint);
    const resizeObserver = new ResizeObserver(updateScrollHint);
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener("scroll", updateScrollHint);
      resizeObserver.disconnect();
    };
  }, [visibleAgents.length]);

  if (visibleAgents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-border/80 bg-muted/5 space-y-3">
        <Calendar className="h-8 w-8 text-muted-foreground/60" />
        <div className="space-y-1">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Nenhum analista escalado
          </h4>
          <p className="text-[11px] text-muted-foreground max-w-xs leading-relaxed">
            Não há analistas com turnos configurados para **{activeDay}**. Use o botão **Configurar
            Escala** no topo para aplicar turnos.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-between items-center border-b border-border pb-3 gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-bold tracking-wider uppercase text-muted-foreground">
            Escala de {activeDay}
          </h3>

          <div className="inline-flex border border-border p-0.5 bg-muted/20 rounded-none">
            <button
              type="button"
              onClick={() => onViewModeChange("global")}
              className={`px-2.5 py-1 text-[9px] font-bold uppercase transition-all rounded-none ${
                viewMode === "global"
                  ? "bg-primary text-primary-foreground font-extrabold shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Global
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("resumida")}
              className={`px-2.5 py-1 text-[9px] font-bold uppercase transition-all rounded-none ${
                viewMode === "resumida"
                  ? "bg-primary text-primary-foreground font-extrabold shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Resumida
            </button>
          </div>
        </div>

        {viewMode === "global" && (
          <div className="flex flex-wrap gap-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground animate-in fade-in duration-200 bg-muted/20 border border-border/50 px-3.5 py-2 rounded-lg">
            <span className="flex items-center gap-1.5 select-none">
              <span className="h-3.5 w-3.5 bg-[#006D3E] rounded border border-[#006D3E] shrink-0"></span>{" "}
              Trabalhando
            </span>
            <span className="flex items-center gap-1.5 select-none">
              <span className="h-3.5 w-3.5 bg-[#F54A00] rounded border border-[#F54A00] shrink-0"></span>{" "}
              Pausa / Almoço
            </span>
            <span className="flex items-center gap-1.5 select-none">
              <span className="h-3.5 w-3.5 bg-[#008AD4] rounded border border-[#008AD4] shrink-0"></span>{" "}
              Externo (Offchat)
            </span>
            <span className="flex items-center gap-1.5 select-none">
              <span className="h-3.5 w-3.5 bg-white dark:bg-[#1a1b23] rounded border border-slate-200 dark:border-slate-800 shrink-0"></span>{" "}
              Folga
            </span>
            <span className="flex items-center gap-1.5 border-l border-border/80 pl-3 select-none">
              <span className="h-3.5 w-3.5 bg-emerald-500/10 rounded border border-dashed border-emerald-500/40 shrink-0"></span>{" "}
              Analista Simulado
            </span>
          </div>
        )}
      </div>

      {viewMode === "resumida" ? (
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm animate-in fade-in duration-250">
          <table className="border-collapse text-xs table-fixed w-full text-left bg-background/50">
            <colgroup>
              <col style={{ width: "30%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "24%" }} />
            </colgroup>
            <thead>
              <tr className="bg-muted/50 border-b border-slate-200 dark:border-slate-800 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                <th className="p-3.5 pl-5">Analista</th>
                <th className="p-3.5">Turno de Trabalho</th>
                <th className="p-3.5">Horário de Almoço</th>
                <th className="p-3.5">Demanda Externa (Offchat)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {visibleAgents.map((agent) => {
                const summaryStr = getAgentDaySummary(agent, activeDay);
                if (summaryStr === "Folga") return null;

                let shift = "-";
                let lunch = "-";
                let ext = "-";

                const shiftMatch = summaryStr.match(/^(\d{2}:\d{2} às \d{2}:\d{2})/);
                if (shiftMatch) shift = shiftMatch[1];

                const lunchMatch = summaryStr.match(/\(Almoço: (\d{2}:\d{2} às \d{2}:\d{2})\)/);
                if (lunchMatch) lunch = lunchMatch[1];

                const extMatch = summaryStr.match(/\(Offchat: (\d{2}:\d{2} às \d{2}:\d{2})\)/);
                if (extMatch) ext = extMatch[1];

                return (
                  <tr key={agent.id} className="hover:bg-muted/20 transition-colors">
                    <td className="p-3.5 pl-5 font-bold text-foreground flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${agent.isSimulated ? "bg-emerald-500 animate-pulse" : "bg-emerald-400"}`}
                        ></span>
                        <span className="truncate">{agent.name}</span>
                        {agent.isSimulated && (
                          <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider shrink-0 scale-90">
                            Simulado
                          </span>
                        )}
                      </div>
                      {onEditAgent && !agent.isSimulated && (
                        <button
                          type="button"
                          onClick={() => onEditAgent(agent)}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all shrink-0"
                          title={`Editar escala semanal de ${agent.name}`}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                    <td className="p-3.5 font-bold text-foreground font-mono">{shift}</td>
                    <td className="p-3.5 font-medium font-mono">
                      {lunch !== "-" ? (
                        <span className="bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50 px-2 py-0.5 rounded-sm font-semibold text-[10px] uppercase">
                          {lunch}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30 font-sans font-normal">-</span>
                      )}
                    </td>
                    <td className="p-3.5 font-medium font-mono">
                      {ext !== "-" ? (
                        <span className="bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900/50 px-2 py-0.5 rounded-sm font-semibold text-[10px] uppercase">
                          {ext}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30 font-sans font-normal">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Remover painel dinâmico conforme solicitação */}

          <div className="relative">
            <div
              ref={scrollRef}
              className="overflow-x-auto max-h-[70vh] overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm animate-in fade-in duration-250 select-none"
            >
              <table className="border-collapse text-sm table-fixed w-full">
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col style={{ width: 44 }} />
                  {visibleAgents.map((a) => (
                    <col key={a.id} style={{ minWidth: 100 }} />
                  ))}
                  <col style={{ width: 52 }} />
                </colgroup>
                <thead className="sticky top-0 z-20 bg-card border-b border-slate-200 dark:border-slate-800">
                  <tr className="bg-muted/50">
                    <th
                      className="sticky left-0 bg-card z-30 p-2 font-semibold text-center border-r border-slate-200 dark:border-slate-800"
                      colSpan={2}
                    >
                      <div className="flex justify-center text-red-600 dark:text-red-500 font-bold uppercase tracking-wider text-xs">
                        HORÁRIO
                      </div>
                    </th>
                    {visibleAgents.map((col) => (
                      <th
                        key={col.id}
                        className={`border border-slate-200 dark:border-slate-800 p-2 font-medium text-center text-[11px] bg-card align-middle ${
                          col.isSimulated ? "border-emerald-500/20 bg-emerald-500/5" : ""
                        } ${onEditAgent && !col.isSimulated ? "cursor-pointer hover:bg-muted/60 transition-colors group" : ""}`}
                        style={{ minWidth: 100 }}
                        title={
                          onEditAgent && !col.isSimulated
                            ? `Clique para editar a escala semanal de ${col.name}`
                            : col.name
                        }
                        onClick={() => {
                          if (onEditAgent && !col.isSimulated) {
                            onEditAgent(col);
                          }
                        }}
                      >
                        <div className="flex flex-col items-center justify-center gap-0.5 w-full">
                          {col.isSimulated && (
                            <span className="text-[8px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                              SIM
                            </span>
                          )}
                          <div className="flex items-center justify-center gap-1 max-w-full">
                            <span className="truncate font-semibold text-foreground/80 tracking-wide">
                              {formatAbbreviatedName(col.name)}
                            </span>
                            {onEditAgent && !col.isSimulated && (
                              <Edit2 className="h-2.5 w-2.5 opacity-0 group-hover:opacity-70 transition-opacity text-muted-foreground shrink-0" />
                            )}
                          </div>
                        </div>
                      </th>
                    ))}
                    <th className="border border-slate-200 dark:border-slate-800 p-2 font-bold text-center text-red-600 bg-muted/80 w-[52px] align-middle text-[11px] uppercase tracking-wider">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody onMouseLeave={() => setHoveredBlock(null)}>
                  {paddingTop > 0 && (
                    <tr aria-hidden="true">
                      <td
                        style={{ height: paddingTop, padding: 0, border: 0 }}
                        colSpan={globalColSpan}
                      />
                    </tr>
                  )}
                  {virtualBlocks.map((virtualBlock) => {
                    const block = timeBlocks20[virtualBlock.index];
                    const endTime20 = getNext20MinTime(block);
                    const activeCount = visibleAgents.filter((agent) => {
                      const status = agent.schedules[activeDay]?.intervals[block];
                      return status === "trabalhando";
                    }).length;

                    return (
                      <tr
                        key={block}
                        data-index={virtualBlock.index}
                        className={`transition-colors ${hoveredBlock === block ? "bg-muted/60" : "hover:bg-muted/30"}`}
                        onMouseEnter={() => setHoveredBlock(block)}
                      >
                        <td className="border border-slate-200 dark:border-slate-800 p-1 text-center text-[11px] text-muted-foreground sticky left-0 z-10 bg-background/95 font-medium border-r-0 w-[44px]">
                          {block}
                        </td>
                        <td className="border border-slate-200 dark:border-slate-800 p-1 text-center text-[11px] text-muted-foreground sticky left-11 z-10 bg-background/95 font-medium border-l-0 w-[44px]">
                          {endTime20}
                        </td>
                        {visibleAgents.map((agent) => {
                          const status = agent.schedules[activeDay]?.intervals[block] || "folga";
                          const isSim = agent.isSimulated;
                          const canEdit = !isReadOnly && !(readOnlyCLT && !isSim);
                          const cellLabel = `${agent.name}, ${block} às ${getNext20MinTime(block)}: ${status}`;
                          return (
                            <td
                              key={agent.id}
                              className="p-0 border border-slate-200/50 dark:border-slate-800/50 text-center w-[36px]"
                              onMouseDown={() => handleMouseDown(agent, block, status, canEdit)}
                              onMouseEnter={() => handleMouseEnter(agent, block, status, canEdit)}
                            >
                              <div
                                role="button"
                                tabIndex={canEdit ? 0 : -1}
                                aria-label={cellLabel}
                                aria-disabled={!canEdit}
                                className={`w-full h-[18px] border-y border-transparent transition-all duration-75 ${
                                  canEdit ? "cursor-crosshair" : "cursor-not-allowed"
                                } ${getCellStyles(status, isSim)} ${!agent.active ? "opacity-20" : ""}`}
                              ></div>
                            </td>
                          );
                        })}
                        <td
                          className={`border border-slate-200 dark:border-slate-800 p-1 text-center text-xs font-bold w-[52px] ${
                            activeCount === 0
                              ? "bg-red-50 text-red-400 dark:bg-red-950/20"
                              : activeCount < 3
                                ? "bg-orange-50 text-orange-600 dark:bg-orange-950/20"
                                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20"
                          }`}
                        >
                          {activeCount > 0 ? activeCount : 0}
                        </td>
                      </tr>
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr aria-hidden="true">
                      <td
                        style={{ height: paddingBottom, padding: 0, border: 0 }}
                        colSpan={globalColSpan}
                      />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {hasMoreToScrollRight && (
              <div
                className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 rounded-r-lg bg-gradient-to-l from-background to-transparent"
                aria-hidden="true"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
