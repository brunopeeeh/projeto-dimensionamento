import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DAYS,
  type Day,
  type TeamAgent,
  type AgentSchedule,
  type IntervalStatus,
} from "@/context/DimensionamentoContext";
import { SHIFT_PRESETS, generateLunchOptions } from "./constants";
import { extractAgentDaySchedule } from "@/components/escala-ops/agent-adapter";
import {
  User,
  Clock,
  Sparkles,
  AlertTriangle,
  ShieldAlert,
  Trash2,
  CheckCircle2,
  Coffee,
  Briefcase,
  Layers,
} from "lucide-react";

export type DayScheduleConfig = {
  works: boolean;
  start: string;
  end: string;
  lunchStart: string;
  externalStart?: string;
  externalDurationMin?: number;
};

export interface AgentScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent?: TeamAgent | null;
  onSave: (agentData: {
    id?: string;
    name: string;
    active: boolean;
    schedules: Partial<Record<Day, AgentSchedule>>;
  }) => void;
  onDelete?: (agentId: string) => void;
  onToggleActive?: (agentId: string) => void;
}

const DEFAULT_WEEK_5X2: Record<Day, DayScheduleConfig> = {
  Segunda: { works: true, start: "08:00", end: "17:00", lunchStart: "12:00" },
  Terça: { works: true, start: "08:00", end: "17:00", lunchStart: "12:00" },
  Quarta: { works: true, start: "08:00", end: "17:00", lunchStart: "12:00" },
  Quinta: { works: true, start: "08:00", end: "17:00", lunchStart: "12:00" },
  Sexta: { works: true, start: "08:00", end: "17:00", lunchStart: "12:00" },
  Sábado: { works: false, start: "08:00", end: "17:00", lunchStart: "12:00" },
  Domingo: { works: false, start: "08:00", end: "17:00", lunchStart: "12:00" },
};

function calculateShiftWorkedHours(cfg: DayScheduleConfig): number {
  if (!cfg.works) return 0;
  const [sh, sm] = cfg.start.split(":").map(Number);
  const [eh, em] = cfg.end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  let durationHours = (endMin - startMin) / 60;
  if (cfg.lunchStart && cfg.lunchStart !== "none") {
    durationHours = Math.max(0, durationHours - 1);
  }
  return durationHours;
}

function buildIntervalsFromConfig(cfg: DayScheduleConfig): Record<string, IntervalStatus> {
  if (!cfg.works) return {};

  const intervals: Record<string, IntervalStatus> = {};
  const [sh, sm] = cfg.start.split(":").map(Number);
  const [eh, em] = cfg.end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;

  let lunchStartMin = -1;
  let lunchEndMin = -1;
  if (cfg.lunchStart && cfg.lunchStart !== "none") {
    const [lh, lm] = cfg.lunchStart.split(":").map(Number);
    lunchStartMin = lh * 60 + lm;
    if (endMin >= 24 * 60 && lunchStartMin < startMin) {
      lunchStartMin += 24 * 60;
    }
    lunchEndMin = lunchStartMin + 60;
  }

  let extStartMin = -1;
  let extEndMin = -1;
  if (cfg.externalStart && cfg.externalDurationMin && cfg.externalDurationMin > 0) {
    const [xh, xm] = cfg.externalStart.split(":").map(Number);
    extStartMin = xh * 60 + xm;
    if (endMin >= 24 * 60 && extStartMin < startMin) {
      extStartMin += 24 * 60;
    }
    extEndMin = extStartMin + cfg.externalDurationMin;
  }

  let t = startMin;
  while (t < endMin) {
    const currentMin = t % (24 * 60);
    const h = Math.floor(currentMin / 60);
    const m = currentMin % 60;
    const timeStr = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;

    let status: IntervalStatus = "trabalhando";
    if (lunchStartMin !== -1 && t >= lunchStartMin && t < lunchEndMin) {
      status = "pausa";
    } else if (extStartMin !== -1 && t >= extStartMin && t < extEndMin) {
      status = "externo";
    }

    intervals[timeStr] = status;
    t += 20;
  }

  return intervals;
}

export function AgentScheduleModal({
  isOpen,
  onClose,
  agent,
  onSave,
  onDelete,
  onToggleActive,
}: AgentScheduleModalProps) {
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [days, setDays] = useState<Record<Day, DayScheduleConfig>>(DEFAULT_WEEK_5X2);
  const [error, setError] = useState<string | null>(null);

  // Inicializa os dados quando o modal abre ou o agente selecionado muda
  useEffect(() => {
    if (!isOpen) return;

    if (agent) {
      setName(agent.name);
      setActive(agent.active);
      const parsedDays: Record<Day, DayScheduleConfig> = {} as Record<Day, DayScheduleConfig>;

      DAYS.forEach((day) => {
        const sched = extractAgentDaySchedule(agent, day);
        if (sched.works) {
          parsedDays[day] = {
            works: true,
            start: sched.shift[0],
            end: sched.shift[1],
            lunchStart: sched.pause ? sched.pause[0] : "none",
            externalStart: sched.externos?.[0]?.[0] || "",
            externalDurationMin: 60,
          };
        } else {
          parsedDays[day] = {
            works: false,
            start: "08:00",
            end: "17:00",
            lunchStart: "12:00",
          };
        }
      });
      setDays(parsedDays);
    } else {
      // Novo analista
      setName("");
      setActive(true);
      setDays(DEFAULT_WEEK_5X2);
    }
    setError(null);
  }, [isOpen, agent]);

  // Cálculos de carga horária em tempo real
  const stats = useMemo(() => {
    let totalHours = 0;
    let workingDays = 0;
    let offDays = 0;

    DAYS.forEach((d) => {
      const cfg = days[d];
      if (cfg?.works) {
        workingDays++;
        totalHours += calculateShiftWorkedHours(cfg);
      } else {
        offDays++;
      }
    });

    const worksSat = days["Sábado"]?.works;
    const worksSun = days["Domingo"]?.works;
    const weekendConsecutive = !!(worksSat && worksSun);

    return {
      totalHours: Number(totalHours.toFixed(1)),
      workingDays,
      offDays,
      weekendConsecutive,
      isOver44: totalHours > 44,
      noRestDay: workingDays >= 7,
    };
  }, [days]);

  const lunchOptions = useMemo(() => generateLunchOptions(), []);

  // Aplicação rápida de presets em lote
  const applyWeekPreset = (
    start: string,
    end: string,
    lunchStart: string,
    isWeekendShift = false,
  ) => {
    setDays(() => {
      const next: Record<Day, DayScheduleConfig> = {} as Record<Day, DayScheduleConfig>;
      DAYS.forEach((d) => {
        const isWeekend = d === "Sábado" || d === "Domingo";
        if (isWeekendShift) {
          next[d] = {
            works: isWeekend,
            start,
            end,
            lunchStart,
          };
        } else {
          next[d] = {
            works: !isWeekend,
            start,
            end,
            lunchStart,
          };
        }
      });
      return next;
    });
  };

  const handleClearAll = () => {
    setDays(() => {
      const next: Record<Day, DayScheduleConfig> = {} as Record<Day, DayScheduleConfig>;
      DAYS.forEach((d) => {
        next[d] = {
          works: false,
          start: "08:00",
          end: "17:00",
          lunchStart: "12:00",
        };
      });
      return next;
    });
  };

  const handleDayFieldChange = (day: Day, patch: Partial<DayScheduleConfig>) => {
    setDays((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        ...patch,
      },
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Por favor, preencha o nome do analista.");
      return;
    }

    const schedules: Partial<Record<Day, AgentSchedule>> = {};
    DAYS.forEach((d) => {
      const cfg = days[d];
      schedules[d] = {
        intervals: buildIntervalsFromConfig(cfg),
      };
    });

    onSave({
      id: agent?.id,
      name: cleanName,
      active,
      schedules,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0 border-border bg-card text-card-foreground shadow-2xl">
        {/* Cabeçalho do Modal */}
        <div className="p-5 border-b border-border bg-muted/20 shrink-0">
          <DialogHeader className="space-y-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-bold text-foreground">
                    {agent ? `Editar Analista: ${agent.name}` : "Cadastrar Novo Analista"}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    Configure os turnos, pausas para almoço e folgas de cada dia da semana.
                  </DialogDescription>
                </div>
              </div>

              {/* Status de Carga Horária e Conformidade */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-background border border-border text-xs font-semibold">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  <span>
                    <b>{stats.totalHours}h</b> / semana
                  </span>
                  <span className="text-muted-foreground font-normal">
                    ({stats.workingDays} dias · {stats.offDays} folgas)
                  </span>
                </div>

                {stats.isOver44 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] font-bold text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> &gt;44h semanais
                  </span>
                )}

                {stats.weekendConsecutive && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] font-bold text-amber-700 dark:text-amber-400">
                    <ShieldAlert className="h-3.5 w-3.5" /> Sáb + Dom
                  </span>
                )}
              </div>
            </div>
          </DialogHeader>

          {/* Nome do Analista */}
          <div className="mt-4 pt-3 border-t border-border/50 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                Nome Completo do Analista *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Ex: Carlos Eduardo de Oliveira"
                className="w-full bg-background border border-border px-3.5 py-2 text-sm font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                autoFocus={!agent}
              />
            </div>

            {agent && onToggleActive && (
              <div className="sm:self-end pb-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setActive(!active);
                    onToggleActive(agent.id);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold uppercase tracking-wider rounded-lg border transition-all ${
                    active
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                      : "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30 hover:bg-red-500/20"
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>{active ? "Analista Ativo" : "Analista Inativo"}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Barra de Presets Rápidos (1 clique) */}
        <div className="px-5 py-3 border-b border-border bg-muted/10 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Modelos rápidos (preencher semana inteira):</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => applyWeekPreset("08:00", "17:00", "12:00")}
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-background hover:bg-muted border border-border/70 text-foreground transition-all shadow-2xs"
                title="Segunda a Sexta das 08h às 17h com 1h de almoço às 12h"
              >
                08h–17h (5x2)
              </button>

              <button
                type="button"
                onClick={() => applyWeekPreset("09:00", "18:00", "13:00")}
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-background hover:bg-muted border border-border/70 text-foreground transition-all shadow-2xs"
                title="Segunda a Sexta das 09h às 18h com 1h de almoço às 13h"
              >
                09h–18h (5x2)
              </button>

              <button
                type="button"
                onClick={() => applyWeekPreset("10:00", "19:00", "14:00")}
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-background hover:bg-muted border border-border/70 text-foreground transition-all shadow-2xs"
                title="Segunda a Sexta das 10h às 19h com 1h de almoço às 14h"
              >
                10h–19h (5x2)
              </button>

              <button
                type="button"
                onClick={() => applyWeekPreset("13:00", "22:00", "17:00")}
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-background hover:bg-muted border border-border/70 text-foreground transition-all shadow-2xs"
                title="Segunda a Sexta das 13h às 22h com 1h de almoço às 17h"
              >
                13h–22h (5x2)
              </button>

              <button
                type="button"
                onClick={() => applyWeekPreset("08:00", "17:00", "12:00", true)}
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-background hover:bg-muted border border-border/70 text-foreground transition-all shadow-2xs"
                title="Plantão de fim de semana (Sábado e Domingo das 08h às 17h)"
              >
                Plantão Sáb/Dom
              </button>

              <button
                type="button"
                onClick={handleClearAll}
                className="px-2 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                title="Marcar folga em todos os dias"
              >
                Folga Geral
              </button>
            </div>
          </div>
        </div>

        {/* Visão Semanal dos 7 Dias Lado a Lado */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {DAYS.map((day) => {
              const cfg = days[day] || {
                works: false,
                start: "08:00",
                end: "17:00",
                lunchStart: "12:00",
              };
              const isWeekend = day === "Sábado" || day === "Domingo";
              const dayHours = calculateShiftWorkedHours(cfg);

              return (
                <div
                  key={day}
                  className={`rounded-xl border transition-all flex flex-col p-3.5 space-y-3 ${
                    cfg.works
                      ? "border-emerald-500/40 bg-card shadow-xs"
                      : "border-border/60 bg-muted/20 opacity-80"
                  }`}
                >
                  {/* Cabeçalho do Dia */}
                  <div className="flex items-center justify-between border-b border-border/40 pb-2">
                    <div>
                      <span
                        className={`text-xs font-bold block ${isWeekend ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}
                      >
                        {day}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {cfg.works ? `${dayHours.toFixed(1)}h de turno` : "Folga"}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDayFieldChange(day, { works: !cfg.works })}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase transition-all tracking-wider ${
                        cfg.works
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                          : "bg-muted text-muted-foreground border border-border/80 hover:bg-muted/80"
                      }`}
                    >
                      {cfg.works ? "Trabalha" : "Folga"}
                    </button>
                  </div>

                  {/* Detalhes do Dia */}
                  {cfg.works ? (
                    <div className="space-y-2.5 flex-1 flex flex-col justify-between">
                      {/* Turno */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1">
                          <Briefcase className="h-3 w-3 text-primary" /> Turno
                        </label>
                        <select
                          value={`${cfg.start}|${cfg.end}`}
                          onChange={(e) => {
                            const [start, end] = e.target.value.split("|");
                            handleDayFieldChange(day, { start, end });
                          }}
                          className="w-full bg-background border border-border text-xs px-2 py-1.5 rounded-md font-mono font-semibold focus:outline-none focus:border-primary"
                        >
                          {SHIFT_PRESETS.map((p) => (
                            <option key={p.label} value={`${p.start}|${p.end}`}>
                              {p.start}–{p.end}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Almoço */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1">
                          <Coffee className="h-3 w-3 text-amber-600 dark:text-amber-400" /> Almoço
                          (1h)
                        </label>
                        <select
                          value={cfg.lunchStart}
                          onChange={(e) =>
                            handleDayFieldChange(day, { lunchStart: e.target.value })
                          }
                          className="w-full bg-background border border-border text-xs px-2 py-1.5 rounded-md font-mono font-semibold focus:outline-none focus:border-primary"
                        >
                          <option value="none">Sem Intervalo</option>
                          {lunchOptions.map((time) => {
                            const [h] = time.split(":").map(Number);
                            const endTime = `${((h + 1) % 24).toString().padStart(2, "0")}:00`;
                            return (
                              <option key={time} value={time}>
                                {time} às {endTime}
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      {/* Demanda Externa (Opcional) */}
                      <div className="space-y-1 pt-1 border-t border-border/30">
                        <label className="text-[9px] font-bold uppercase text-muted-foreground flex items-center gap-1">
                          <Layers className="h-2.5 w-2.5 text-sky-600 dark:text-sky-400" /> Offchat
                          (Opcional)
                        </label>
                        <select
                          value={cfg.externalStart || ""}
                          onChange={(e) =>
                            handleDayFieldChange(day, {
                              externalStart: e.target.value,
                              externalDurationMin: e.target.value ? 60 : undefined,
                            })
                          }
                          className="w-full bg-background border border-border text-[11px] px-1.5 py-1 rounded-md font-mono focus:outline-none focus:border-primary"
                        >
                          <option value="">Nenhum</option>
                          {lunchOptions.map((time) => (
                            <option key={time} value={time}>
                              1h às {time}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center py-6 text-center space-y-2">
                      <span className="text-2xl opacity-60">🏖️</span>
                      <span className="text-xs font-semibold text-muted-foreground">
                        Dia de Folga
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDayFieldChange(day, { works: true })}
                        className="text-[11px] text-primary hover:underline font-semibold"
                      >
                        + Ativar Turno
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="p-4 border-t border-border bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div>
            {agent && onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Tem certeza que deseja excluir o analista "${agent.name}"?`)) {
                    onDelete(agent.id);
                    onClose();
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 transition-all"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Excluir Analista</span>
              </button>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted text-foreground transition-all"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-xs"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>{agent ? "Salvar Alterações" : "Cadastrar Analista"}</span>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
