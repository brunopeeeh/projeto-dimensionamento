import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { useDimensionamento } from "@/context/DimensionamentoContext";
import { useTheme } from "@/context/ThemeContext";
import { adaptAllAgents, WEEKDAY_TO_DAY, DAY_TO_WEEKDAY, PALETTE } from "./agent-adapter";
import type { Agent, Override, OverrideKind, DayEntry, ToastItem } from "./types";
import {
  DAYS,
  type Day,
  type TeamAgent,
  type AgentSchedule,
  type IntervalStatus,
} from "@/context/types";
import { capacityPerAgent } from "@/lib/calculations";
import {
  hasFixedOvernightCoverage,
  isHelpdeskOpen,
  FIXED_OVERNIGHT_AGENTS,
} from "@/lib/operating-hours";
import { supabase } from "@/lib/supabaseClient";
import { changedDates, loadExcecoes, persistExcecoes } from "./escala-excecoes";
import "./escala-ops.css";

/* ---------------- CONSTANTES & PRESETS ---------------- */
const TL0 = 7 * 60; // 07:00
const TL_END = 28 * 60; // 04:00 (+1d)
const TL_LEN = TL_END - TL0; // 1260 minutos
const LSKEY = "escalaops.v1";
const DB_SYNCED_KEY = "escalaops.dbSynced";

const WD_MED = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WD_LONG = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];
const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const MONTHS_S = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

const SHIFT_PRESETS: [string, string][] = [
  ["07:00", "16:00"],
  ["08:00", "17:00"],
  ["09:00", "18:00"],
  ["10:00", "19:00"],
  ["11:00", "20:00"],
  ["12:00", "21:00"],
  ["13:00", "22:00"],
  ["14:00", "23:00"],
  ["15:00", "00:00"],
  ["16:00", "01:00"],
  ["17:00", "02:00"],
  ["18:00", "03:00"],
];

const PAUSE_PRESETS: [string, string][] = [
  ["11:00", "12:00"],
  ["12:00", "13:00"],
  ["13:00", "14:00"],
  ["14:00", "15:00"],
  ["15:00", "16:00"],
  ["16:00", "17:00"],
  ["17:00", "18:00"],
  ["18:00", "19:00"],
  ["19:00", "20:00"],
  ["20:00", "21:00"],
  ["21:00", "22:00"],
  ["22:00", "23:00"],
];

const KIND_LABEL: Record<string, string> = {
  falta: "Falta",
  atestado: "Atestado",
  ferias: "Férias",
  extra: "Extra",
  ajuste: "Ajuste",
};

/* ---------------- UTILITÁRIOS DE HORA E DATA ---------------- */
const toMin = (t: string): number => {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
};

const toHHMM = (m: number): string => {
  const normalized = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
};

const fmtHM = (raw: number) => toHHMM(raw);

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id" + Date.now() + Math.random().toString(16).slice(2);

const isoOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const parseISO = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const addDaysISO = (s: string, n: number): string => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};

const weekdayOf = (s: string): number => parseISO(s).getDay();

const fmtBR = (s: string): string => {
  const d = parseISO(s);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const mondayOf = (s: string): string => {
  const d = parseISO(s);
  const wd = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - wd);
  return isoOf(d);
};

const fmtDateShort = (s: string): string => {
  const d = parseISO(s);
  return `${WD_MED[d.getDay()]} · ${d.getDate()} ${MONTHS_S[d.getMonth()]}`;
};

const fmtDateLong = (s: string): string => {
  const d = parseISO(s);
  return `${WD_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
};

const fmtDur = (mins: number): string => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
};

function opWindow(dateISO: string): [number, number] {
  const wd = weekdayOf(dateISO);
  return [TL0, wd >= 2 && wd <= 6 ? 27 * 60 : 24 * 60];
}

/**
 * Cobertura mínima esperada:
 * Segunda, Terça, Sábado e Domingo: time reduzido.
 * No primeiro horário (07:00–08:00) e no último horário (fechamento), a cobertura esperada é de 1 pessoa.
 * Nos demais horários e dias, segue a meta padrão configurada (ex: 2 pessoas).
 */
function getExpectedMinCoverage(dateISO: string, t: number, baseMin: number): number {
  const wd = weekdayOf(dateISO);
  // Segunda (1), Terça (2), Sábado (6), Domingo (0): time reduzido
  const isReducedDay = wd === 0 || wd === 1 || wd === 2 || wd === 6;
  if (!isReducedDay) return baseMin;

  const [opS, opE] = opWindow(dateISO);
  const raw = TL0 + t;
  // Primeiro horário operacional (07:00 às 08:00)
  const isFirstHour = raw >= opS && raw < opS + 60;
  // Último horário operacional antes do fechamento
  const isLastHour = raw >= opE - 60 && raw < opE;

  if (isFirstHour || isLastHour) {
    return 1;
  }
  return baseMin;
}

function mapSpan(s: string, e: string): [number, number] {
  const a = toMin(s);
  let b = toMin(e);
  if (b <= a) b += 1440;
  return [a - TL0, b - TL0];
}

function mapPauseInShift(shiftStart: string, ps: string, pe: string): [number, number] {
  const s = toMin(shiftStart);
  let a = toMin(ps);
  let b = toMin(pe);
  while (a < s) a += 1440;
  if (b <= a) b += 1440;
  return [a - TL0, b - TL0];
}

const clipSpan = (sp: [number, number]): [number, number] => [
  Math.max(0, sp[0]),
  Math.min(TL_LEN, sp[1]),
];

function generateIntervalsForShift(
  start: string,
  end: string,
  lunchStart?: string | null,
): Record<string, IntervalStatus> {
  const intervals: Record<string, IntervalStatus> = {};
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);

  const startMin = startH * 60 + startM;
  let endMin = endH * 60 + endM;
  if (endMin <= startMin) endMin += 24 * 60;

  let lunchStartMin = -1;
  let lunchEndMin = -1;
  if (lunchStart && lunchStart !== "none") {
    const [lH, lM] = lunchStart.split(":").map(Number);
    lunchStartMin = lH * 60 + lM;
    if (endMin >= 24 * 60 && lunchStartMin < startMin) {
      lunchStartMin += 24 * 60;
    }
    lunchEndMin = lunchStartMin + 60;
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
    }

    intervals[timeStr] = status;
    t += 20;
  }

  return intervals;
}

function validateShiftAndPause(
  shift: [string, string],
  pause: [string, string] | null,
): string | null {
  const s = toMin(shift[0]);
  let e = toMin(shift[1]);
  if (e <= s) e += 1440;
  if (e - s < 60) return "O turno deve durar pelo menos 1 hora.";
  if (pause) {
    let ps = toMin(pause[0]);
    let pe = toMin(pause[1]);
    if (ps < s) ps += 1440;
    if (pe <= ps) pe += 1440;
    if (ps < s || pe > e) return "A pausa deve ficar dentro do turno.";
  }
  return null;
}

function loadLocalMeta(): {
  overrides: Record<string, Record<string, Override>>;
  settings: { minCoverage: number; theme?: "dark" | "light" };
  dismissed: Record<string, string[]>;
  agentColors: Record<string, string>;
} {
  try {
    const raw = localStorage.getItem(LSKEY);
    if (!raw) {
      return {
        overrides: {},
        settings: { minCoverage: 2, theme: "dark" },
        dismissed: {},
        agentColors: {},
      };
    }
    const d = JSON.parse(raw);
    return {
      overrides: d.overrides || {},
      settings: Object.assign({ minCoverage: 2, theme: "dark" }, d.settings),
      dismissed: d.dismissed || {},
      agentColors: d.agentColors || {},
    };
  } catch {
    return {
      overrides: {},
      settings: { minCoverage: 2, theme: "dark" },
      dismissed: {},
      agentColors: {},
    };
  }
}

/* =========================================================================
   COMPONENTE PRINCIPAL: EscalaOps
   ========================================================================= */
export interface EscalaOpsProps {
  defaultIncludeSimulated?: boolean;
  pageTitle?: string;
}

export function EscalaOps({ defaultIncludeSimulated = false, pageTitle }: EscalaOpsProps = {}) {
  // Conexão com a Gestão de Escalas do projeto
  const teamAgents = useDimensionamento((s) => s.teamAgents);
  const newHires = useDimensionamento((s) => s.newHires);
  const setTeamAgents = useDimensionamento((s) => s.setTeamAgents);
  const removeTeamAgent = useDimensionamento((s) => s.removeTeamAgent);
  const helpdeskVolumes = useDimensionamento((s) => s.helpdeskVolumes);
  const tmaFactors = useDimensionamento((s) => s.tmaFactors);
  const simultaneous = useDimensionamento((s) => s.simultaneous);

  const [includeSimulated, setIncludeSimulated] = useState<boolean>(defaultIncludeSimulated);

  // Metadados locais: exceções pontuais do dia, configurações, dispensas e cores
  const [meta, setMeta] = useState(loadLocalMeta);
  const metaRef = useRef(meta);

  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);

  // Mapeamento dos agentes reais do projeto
  const agents = useMemo<Agent[]>(() => {
    return adaptAllAgents(teamAgents, newHires, includeSimulated, meta.agentColors);
  }, [teamAgents, newHires, includeSimulated, meta.agentColors]);

  const [view, setView] = useState<"day" | "week" | "cov">("day");
  const [cursor, setCursor] = useState<string>(() => isoOf(new Date()));
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [isZen, setIsZen] = useState(false);

  // Cálculo da curva de demanda real dimensionada (chamados, TMA e Erlang)
  const realDemandInfo = useMemo(() => {
    const wd = weekdayOf(cursor);
    const dayName: Day = WEEKDAY_TO_DAY[wd];
    const demand: number[] = new Array(TL_LEN).fill(0);
    const volumes: number[] = new Array(TL_LEN).fill(0);
    let peakDemand = 0;
    let peakVol = 0;
    let peakTime = "—";
    const factor = tmaFactors?.[dayName] ?? 1;
    const perAgent = capacityPerAgent(factor, simultaneous);

    for (let t = 0; t < TL_LEN; t++) {
      const m = TL0 + t;
      const h = Math.floor((m % 1440) / 60);
      const min = m % 60;
      const min10 = Math.floor(min / 10) * 10;
      const timeKey = `${String(h).padStart(2, "0")}:${String(min10).padStart(2, "0")}`;

      const vol = helpdeskVolumes?.[timeKey]?.[dayName] ?? 0;
      volumes[t] = vol;

      const isOvernight = hasFixedOvernightCoverage(dayName, timeKey);
      const isOpen = isHelpdeskOpen(dayName, timeKey);
      let needed = 0;
      if (isOpen) {
        needed = isOvernight ? FIXED_OVERNIGHT_AGENTS : Math.ceil(vol / perAgent);
      }
      demand[t] = needed;

      if (needed > peakDemand) {
        peakDemand = needed;
        peakVol = vol;
        peakTime = timeKey;
      }
    }

    return { demand, volumes, peakDemand, peakVol, peakTime, dayName };
  }, [cursor, helpdeskVolumes, tmaFactors, simultaneous]);

  // Sincronização direta de exceções registradas com a escala oficial
  const syncScheduleToContext = useCallback(
    (
      agentId: string,
      day: Day,
      ov: Override | null,
      baseShift: [string, string],
      basePause?: [string, string] | null,
    ) => {
      setTeamAgents((prev) =>
        prev.map((ag) => {
          if (ag.id !== agentId) return ag;
          let intervals: Record<string, IntervalStatus> = {};
          if (ov) {
            if (ov.kind === "falta" || ov.kind === "atestado" || ov.kind === "ferias") {
              // Limpa todos os blocos do dia (folga)
              intervals = {};
            } else if (ov.kind === "extra" || ov.kind === "ajuste") {
              const targetShift = ov.shift || baseShift;
              const targetPause =
                ov.pause !== undefined
                  ? ov.pause
                    ? ov.pause[0]
                    : null
                  : basePause
                    ? basePause[0]
                    : null;
              intervals = generateIntervalsForShift(targetShift[0], targetShift[1], targetPause);
            }
          } else {
            intervals = generateIntervalsForShift(
              baseShift[0],
              baseShift[1],
              basePause ? basePause[0] : null,
            );
          }

          return {
            ...ag,
            schedules: {
              ...ag.schedules,
              [day]: { intervals },
            },
          };
        }),
      );
    },
    [setTeamAgents],
  );

  // Simulação: { date, entries: Record<agentId, Override> }
  const [sim, setSim] = useState<{ date: string; entries: Record<string, Override> } | null>(null);

  // Modais e Gavetas
  const [activeModal, setActiveModal] = useState<
    | { type: "day"; agentId: string; dateISO: string }
    | { type: "agent"; agentId?: string }
    | { type: "delete-agent-confirm"; agentId: string }
    | { type: "restore-confirm" }
    | null
  >(null);

  const [activeDrawer, setActiveDrawer] = useState<"team" | "menu" | "sim" | null>(null);
  const [isBellOpen, setIsBellOpen] = useState(false);

  // Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Tooltip
  const [tip, setTip] = useState<{ html: string; x: number; y: number } | null>(null);

  // Persistência local de metadados
  const saveMeta = useCallback((nextMeta: typeof meta) => {
    setMeta(nextMeta);
    try {
      localStorage.setItem(
        LSKEY,
        JSON.stringify({
          overrides: nextMeta.overrides,
          settings: nextMeta.settings,
          dismissed: nextMeta.dismissed,
          agentColors: nextMeta.agentColors,
        }),
      );
    } catch {
      // localStorage quota
    }
  }, []);

  const { theme } = useTheme();
  const currentTheme: "dark" | "light" = theme;

  const triggerToast = useCallback(
    (
      msg: string,
      type: "ok" | "warn" | "err" = "ok",
      action?: { label: string; fn: () => void },
    ) => {
      const id = uid();
      setToasts((prev) => [...prev, { id, msg, type, action }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4200);
    },
    [],
  );

  // Exceções da escala: o Supabase é a fonte de verdade quando configurado;
  // o localStorage segue como cache/fallback offline (chave `escalaops.v1`).
  const [excecoesReady, setExcecoesReady] = useState(!supabase);
  const persistedOverridesRef = useRef(meta.overrides);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let cancelled = false;

    (async () => {
      try {
        const dbOverrides = await loadExcecoes(client);
        if (cancelled) return;

        const localOverrides = metaRef.current.overrides;
        let dbSynced = false;
        try {
          dbSynced = localStorage.getItem(DB_SYNCED_KEY) === "1";
        } catch {
          dbSynced = false;
        }

        // Migração única: na primeira carga com Supabase, sobe o que só
        // existia no navegador. Depois disso o banco manda (mesmo vazio).
        const shouldMigrate =
          !dbSynced &&
          Object.keys(dbOverrides).length === 0 &&
          Object.keys(localOverrides).length > 0;

        let migrationOk = true;
        if (shouldMigrate) {
          try {
            await persistExcecoes(client, {}, localOverrides);
          } catch (err) {
            migrationOk = false;
            console.error("Falha ao migrar exceções locais para o Supabase:", err);
          }
        }

        const resolved = shouldMigrate ? localOverrides : dbOverrides;
        persistedOverridesRef.current = resolved;
        saveMeta({ ...metaRef.current, overrides: resolved });

        if (!shouldMigrate || migrationOk) {
          try {
            localStorage.setItem(DB_SYNCED_KEY, "1");
          } catch {
            // localStorage indisponível
          }
        }
      } catch (err) {
        console.error("Falha ao carregar exceções da escala:", err);
      } finally {
        if (!cancelled) setExcecoesReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [saveMeta]);

  useEffect(() => {
    const client = supabase;
    if (!client || !excecoesReady) return;

    const prev = persistedOverridesRef.current;
    const next = meta.overrides;
    if (prev === next || changedDates(prev, next).length === 0) {
      persistedOverridesRef.current = next;
      return;
    }

    persistExcecoes(client, prev, next)
      .then(() => {
        persistedOverridesRef.current = next;
      })
      .catch((err) => {
        console.error("Falha ao salvar exceções da escala:", err);
        triggerToast("Falha ao salvar exceção no servidor.", "err");
      });
  }, [meta.overrides, excecoesReady, triggerToast]);

  // Cadastro e edição padrão de operadores na escala oficial
  const handleSaveAgent = useCallback(
    (data: {
      id?: string;
      name: string;
      color: string;
      workdays: number[];
      shift: [string, string];
      pause: [string, string] | null;
    }) => {
      const isNew = !data.id;
      const targetId = data.id || `a_${Date.now()}`;

      const schedules: Partial<Record<Day, AgentSchedule>> = {};
      DAYS.forEach((day) => {
        const wd = DAY_TO_WEEKDAY[day];
        if (data.workdays.includes(wd)) {
          schedules[day] = {
            intervals: generateIntervalsForShift(
              data.shift[0],
              data.shift[1],
              data.pause ? data.pause[0] : null,
            ),
          };
        } else {
          schedules[day] = {
            intervals: {},
          };
        }
      });

      setTeamAgents((prev) => {
        if (isNew) {
          const newAgent: TeamAgent = {
            id: targetId,
            name: data.name,
            active: true,
            schedules,
          };
          return [...prev, newAgent];
        }
        return prev.map((ag) => (ag.id === targetId ? { ...ag, name: data.name, schedules } : ag));
      });

      const nextColors = { ...(meta.agentColors || {}), [targetId]: data.color };
      saveMeta({ ...meta, agentColors: nextColors });

      setActiveModal(null);
      triggerToast(isNew ? "Agente adicionado à escala." : "Agente atualizado.", "ok");
    },
    [meta, saveMeta, setTeamAgents, triggerToast],
  );

  const handleConfirmDelete = useCallback(
    (agentId: string) => {
      const target = agents.find((a) => a.id === agentId);
      removeTeamAgent(agentId);

      const nextOverrides = { ...meta.overrides };
      for (const d in nextOverrides) {
        if (nextOverrides[d]?.[agentId]) {
          delete nextOverrides[d][agentId];
        }
      }
      const nextColors = { ...(meta.agentColors || {}) };
      delete nextColors[agentId];
      saveMeta({ ...meta, overrides: nextOverrides, agentColors: nextColors });

      setActiveModal(null);
      triggerToast(`Agente “${target?.name || ""}” excluído.`, "warn");
    },
    [agents, meta, removeTeamAgent, saveMeta, triggerToast],
  );

  // Batimento operacional em tempo real (atualiza a cada 30 segundos, economizando 97% de re-renders)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Atalhos de teclado
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = /input|select|textarea/i.test(target.tagName);
      if (e.key === "Escape") {
        setActiveModal(null);
        setActiveDrawer(null);
        setIsBellOpen(false);
        if (isZen) setIsZen(false);
        return;
      }
      if (isInput) return;
      if (e.key === "ArrowLeft") {
        setCursor((c) => addDaysISO(c, view === "week" ? -7 : -1));
      } else if (e.key === "ArrowRight") {
        setCursor((c) => addDaysISO(c, view === "week" ? 7 : 1));
      } else if (e.key.toLowerCase() === "t") {
        setCursor(isoOf(new Date()));
      } else if (e.key === "1") {
        setView("day");
      } else if (e.key === "2") {
        setView("week");
      } else if (e.key === "3") {
        setView("cov");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, isZen]);

  /* ---------------- MÉTODOS DE DOMÍNIO ---------------- */
  const simMapFor = useCallback(
    (dateISO: string) => {
      return sim && sim.date === dateISO ? sim.entries : null;
    },
    [sim],
  );

  const getOverride = useCallback(
    (dateISO: string, agentId: string): Override | null => {
      let ov = meta.overrides[dateISO]?.[agentId] || null;
      if (sim && sim.date === dateISO && sim.entries[agentId]) {
        ov = sim.entries[agentId];
      }
      return ov;
    },
    [meta.overrides, sim],
  );

  const setOverride = useCallback(
    (dateISO: string, agentId: string, ov: Override | null) => {
      if (sim && sim.date === dateISO) {
        setSim((curr) => {
          if (!curr) return null;
          const nextEntries = { ...curr.entries };
          if (ov) nextEntries[agentId] = ov;
          else delete nextEntries[agentId];
          return { ...curr, entries: nextEntries };
        });
        return;
      }
      const nextOverrides = { ...meta.overrides };
      if (!nextOverrides[dateISO]) nextOverrides[dateISO] = {};
      else nextOverrides[dateISO] = { ...nextOverrides[dateISO] };

      if (ov) nextOverrides[dateISO][agentId] = ov;
      else delete nextOverrides[dateISO][agentId];

      if (Object.keys(nextOverrides[dateISO]).length === 0) {
        delete nextOverrides[dateISO];
      }
      saveMeta({ ...meta, overrides: nextOverrides });
    },
    [sim, meta, saveMeta],
  );

  // Cache de alta performance para entradas e cobertura do dia
  const entriesCache = useRef<Map<string, DayEntry[]>>(new Map());
  const covCache = useRef<Map<string, number[]>>(new Map());

  // Invalida cache quando a equipe, overrides ou simulação mudam
  useEffect(() => {
    entriesCache.current.clear();
    covCache.current.clear();
  }, [agents, meta.overrides, sim]);

  // Calcula entradas do dia para cada operador com base na Gestão de Escalas e exceções
  const getDayEntries = useCallback(
    (dateISO: string, simMap?: Record<string, Override> | null): DayEntry[] => {
      const cacheKey = `${dateISO}|${simMap ? JSON.stringify(simMap) : ""}`;
      const cached = entriesCache.current.get(cacheKey);
      if (cached) return cached;

      const wd = weekdayOf(dateISO);
      const dayName = WEEKDAY_TO_DAY[wd];

      const res = agents.map((a) => {
        let ov = meta.overrides[dateISO]?.[a.id] || null;
        let fromSim = false;
        if (simMap && simMap[a.id]) {
          ov = simMap[a.id];
          fromSim = true;
        }

        // Horários base configurados na Gestão de Escala para este dia da semana
        const daySched = a.daySchedules?.[dayName];
        let works = daySched ? daySched.works : a.workdays.includes(wd);
        let absence: OverrideKind | null = null;
        let shift: [string, string] = daySched?.shift
          ? [daySched.shift[0], daySched.shift[1]]
          : [a.shift[0], a.shift[1]];
        let pause: [string, string] | null = daySched?.pause
          ? [daySched.pause[0], daySched.pause[1]]
          : a.pause
            ? [a.pause[0], a.pause[1]]
            : null;

        // Aplicação de exceções (Falta, Atestado, Férias, Extra, Ajuste)
        if (ov) {
          if (ov.kind === "falta" || ov.kind === "atestado" || ov.kind === "ferias") {
            works = false;
            absence = ov.kind;
          } else if (ov.kind === "extra") {
            works = true;
            absence = null;
            if (ov.shift) shift = [ov.shift[0], ov.shift[1]];
            if (ov.pause !== undefined) pause = ov.pause ? [ov.pause[0], ov.pause[1]] : null;
          } else if (ov.kind === "ajuste") {
            if (works) {
              if (ov.shift) shift = [ov.shift[0], ov.shift[1]];
              if (ov.pause !== undefined) pause = ov.pause ? [ov.pause[0], ov.pause[1]] : null;
            }
          }
        }

        let span: [number, number] | null = null;
        let pauseSpan: [number, number] | null = null;
        let externoSpans: [number, number][] | undefined = undefined;
        const externos = daySched?.externos;

        if (works) {
          span = mapSpan(shift[0], shift[1]);
          if (pause) pauseSpan = mapPauseInShift(shift[0], pause[0], pause[1]);
          if (externos && externos.length > 0) {
            externoSpans = externos.map((ext) => mapPauseInShift(shift[0], ext[0], ext[1]));
          }
        }

        return {
          agent: a,
          works,
          absence,
          shift,
          pause,
          externos,
          span,
          pauseSpan,
          externoSpans,
          exception: !!ov,
          fromSim,
          kind: ov ? ov.kind : null,
          note: ov?.note || "",
        };
      });

      entriesCache.current.set(cacheKey, res);
      return res;
    },
    [agents, meta.overrides],
  );

  const getCoverage = useCallback(
    (dateISO: string, simMap?: Record<string, Override> | null): number[] => {
      const cacheKey = `${dateISO}|${simMap ? JSON.stringify(simMap) : ""}`;
      const cached = covCache.current.get(cacheKey);
      if (cached) return cached;

      const cov = new Array(TL_LEN).fill(0);
      for (const e of getDayEntries(dateISO, simMap)) {
        if (!e.works || !e.span) continue;
        const [s, en] = clipSpan(e.span);
        for (let t = s; t < en; t++) cov[t]++;
        if (e.pauseSpan) {
          const [ps, pe] = clipSpan(e.pauseSpan);
          for (let t = ps; t < pe; t++) cov[t]--;
        }
        if (e.externoSpans) {
          for (const extSpan of e.externoSpans) {
            const [exs, exe] = clipSpan(extSpan);
            for (let t = exs; t < exe; t++) cov[t]--;
          }
        }
      }
      covCache.current.set(cacheKey, cov);
      return cov;
    },
    [getDayEntries],
  );

  const runsOf = (cov: number[]) => {
    const r: { t0: number; t1: number; v: number }[] = [];
    let i = 0;
    while (i < cov.length) {
      let j = i;
      while (j < cov.length && cov[j] === cov[i]) j++;
      r.push({ t0: i, t1: j, v: cov[i] });
      i = j;
    }
    return r;
  };

  const covClass = useCallback(
    (v: number, t: number, dateISO: string) => {
      const reqMin = getExpectedMinCoverage(dateISO, t, meta.settings.minCoverage);
      const raw = TL0 + t;
      const [opS, opE] = opWindow(dateISO);
      if (raw < opS || raw >= opE) return "closed";
      if (v <= 0) return "zero";
      if (v < reqMin) return "low";
      if (v === reqMin) return "edge";
      return "ok";
    },
    [meta.settings.minCoverage],
  );

  const criticalRanges = useCallback(
    (dateISO: string, simMap?: Record<string, Override> | null) => {
      const cov = getCoverage(dateISO, simMap);
      const [opS, opE] = opWindow(dateISO);
      const min = meta.settings.minCoverage;
      const out: { t0: number; t1: number; v: number }[] = [];
      let t = opS - TL0;
      const end = opE - TL0;
      while (t < end) {
        const reqMin = getExpectedMinCoverage(dateISO, t, min);
        if (cov[t] < reqMin) {
          let j = t;
          while (j < end && cov[j] === cov[t] && cov[j] < getExpectedMinCoverage(dateISO, j, min))
            j++;
          out.push({ t0: t, t1: j, v: cov[t] });
          t = j;
        } else t++;
      }
      return out;
    },
    [getCoverage, meta.settings.minCoverage],
  );

  const pauseOverlapRanges = useCallback(
    (dateISO: string, simMap?: Record<string, Override> | null) => {
      const es = getDayEntries(dateISO, simMap).filter((e) => e.works && e.pauseSpan);
      const p = new Array(TL_LEN).fill(0);
      for (const e of es) {
        if (!e.pauseSpan) continue;
        const [a, b] = clipSpan(e.pauseSpan);
        for (let t = a; t < b; t++) p[t]++;
      }
      const out: { t0: number; t1: number; v: number }[] = [];
      let t = 0;
      while (t < TL_LEN) {
        if (p[t] >= 3) {
          let j = t;
          while (j < TL_LEN && p[j] >= 3) j++;
          out.push({ t0: t, t1: j, v: p[t] });
          t = j;
        } else t++;
      }
      return out;
    },
    [getDayEntries],
  );

  const dayStats = useCallback(
    (dateISO: string, simMap?: Record<string, Override> | null) => {
      const cov = getCoverage(dateISO, simMap);
      const [opS, opE] = opWindow(dateISO);
      let peak = 0;
      let peakT = -1;
      let mn = Infinity;
      for (let t = opS - TL0; t < opE - TL0; t++) {
        if (cov[t] > peak) {
          peak = cov[t];
          peakT = t;
        }
        if (cov[t] < mn) mn = cov[t];
      }
      if (mn === Infinity) mn = 0;
      return { peak, peakT, min: mn, crit: criticalRanges(dateISO, simMap).length };
    },
    [getCoverage, criticalRanges],
  );

  // Faixa Ao Vivo
  const liveInfo = useMemo(() => {
    const now = currentTime;
    const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const tISO = isoOf(now);
    const yISO = addDaysISO(tISO, -1);
    const isOvernight = nowMin < TL0;
    const opDayISO = isOvernight ? yISO : tISO;
    const currentTInOpDay = isOvernight ? nowMin + 1440 - TL0 : nowMin - TL0;

    const workingList: { e: DayEntry; carry: boolean }[] = [];
    const pausedList: { e: DayEntry; carry: boolean }[] = [];

    for (const e of getDayEntries(opDayISO, null)) {
      if (!e.works || !e.span) continue;
      const [s, en] = e.span;
      if (currentTInOpDay >= s && currentTInOpDay < en) {
        const isPaused =
          e.pauseSpan && currentTInOpDay >= e.pauseSpan[0] && currentTInOpDay < e.pauseSpan[1];
        if (isPaused) {
          pausedList.push({ e, carry: isOvernight });
        } else {
          workingList.push({ e, carry: isOvernight });
        }
      }
    }

    const ev: { t: number; kind: "entrada" | "pausa" | "saida"; a: string }[] = [];
    for (const e of getDayEntries(opDayISO, null)) {
      if (!e.works || !e.span) continue;
      const [s, en] = e.span;
      ev.push({ t: s, kind: "entrada", a: e.agent.name });
      ev.push({ t: en, kind: "saida", a: e.agent.name });
      if (e.pauseSpan) {
        ev.push({ t: e.pauseSpan[0], kind: "pausa", a: e.agent.name });
      }
    }
    const fut = ev.filter((x) => x.t > currentTInOpDay).sort((a, b) => a.t - b.t);

    return {
      nowRaw: currentTInOpDay,
      tISO,
      workingList,
      pausedList,
      working: workingList.length,
      paused: pausedList,
      todayCount: getDayEntries(opDayISO, null).filter((e) => e.works).length,
      next: {
        entrada: fut.find((x) => x.kind === "entrada"),
        pausa: fut.find((x) => x.kind === "pausa"),
        saida: fut.find((x) => x.kind === "saida"),
      },
    };
  }, [currentTime, getDayEntries]);

  // Alertas
  const alerts = useMemo(() => {
    const out: { sev: "c" | "w" | "i"; msg: string; when: string }[] = [];
    const now = currentTime;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const tISO = isoOf(now);
    const yISO = addDaysISO(tISO, -1);
    const isOvernight = nowMin < TL0;
    const opDayISO = isOvernight ? yISO : tISO;
    const currentTInOpDay = isOvernight ? nowMin + 1440 - TL0 : nowMin - TL0;
    const min = meta.settings.minCoverage;

    for (const r of criticalRanges(opDayISO, null)) {
      const rng = `${fmtHM(TL0 + r.t0)}–${fmtHM(TL0 + r.t1)}`;
      const reqMin = getExpectedMinCoverage(opDayISO, r.t0, min);
      if (r.v === 0) out.push({ sev: "c", msg: `Sem nenhum agente ${rng}`, when: rng });
      else out.push({ sev: "w", msg: `Cobertura baixa (${r.v}/${reqMin}) ${rng}`, when: rng });
    }
    for (const r of pauseOverlapRanges(opDayISO, null)) {
      out.push({
        sev: "w",
        msg: `${r.v} pausas simultâneas ${fmtHM(TL0 + r.t0)}–${fmtHM(TL0 + r.t1)}`,
        when: fmtHM(TL0 + r.t0),
      });
    }
    const ev: { t: number; txt: string }[] = [];
    for (const e of getDayEntries(opDayISO, null)) {
      if (!e.works || !e.span) continue;
      const [s, en] = e.span;
      const n = e.agent.name;
      ev.push({ t: s, txt: `${n} entra no turno` });
      ev.push({ t: en, txt: `${n} encerra o turno` });
      if (e.pauseSpan) {
        ev.push({ t: e.pauseSpan[0], txt: `${n} inicia pausa` });
        ev.push({ t: e.pauseSpan[1], txt: `${n} encerra a pausa` });
      }
    }
    for (const x of ev) {
      const d = x.t - currentTInOpDay;
      if (d > 0 && d <= 15) {
        out.push({
          sev: "i",
          msg: `${x.txt} às ${fmtHM(TL0 + x.t)} (em ${Math.round(d)} min)`,
          when: fmtHM(TL0 + x.t),
        });
      }
    }
    const ord = { c: 0, w: 1, i: 2 };
    out.sort((a, b) => ord[a.sev] - ord[b.sev]);
    return out.slice(0, 20);
  }, [currentTime, meta.settings.minCoverage, criticalRanges, pauseOverlapRanges, getDayEntries]);

  // Sugestões de pausa inteligentes e alinhadas à operação real
  const pauseSuggestions = useMemo(() => {
    const min = meta.settings.minCoverage;
    const [opS, opE] = opWindow(cursor);
    const smap = simMapFor(cursor);
    const entries = getDayEntries(cursor, smap);
    const working = entries.filter((e) => e.works && e.pauseSpan && e.span);
    const cov = getCoverage(cursor, smap);
    const sug: {
      agentId: string;
      name: string;
      from: [string, string];
      to: [string, string];
      score: number;
      txt: string;
    }[] = [];
    const dismissed = new Set(meta.dismissed[cursor] || []);
    const inOp = (t: number) => {
      const r = TL0 + t;
      return r >= opS && r < opE;
    };
    let bd = 0;
    let curMin = Infinity;
    for (let t = 0; t < TL_LEN; t++) {
      if (inOp(t)) {
        const reqMin = getExpectedMinCoverage(cursor, t, min);
        if (cov[t] < reqMin) bd += reqMin - cov[t];
        if (cov[t] < curMin) curMin = cov[t];
      }
    }
    if (curMin === Infinity) curMin = 0;

    // Apenas pausas oficiais configuradas (horas cheias :00, sem horários quebrados)
    const validPauseStarts = PAUSE_PRESETS.map((p) => toMin(p[0]) - TL0);

    for (const e of working) {
      if (!e.span || !e.pauseSpan) continue;
      const [ps] = e.pauseSpan;
      const [ss, se] = e.span;

      const key = `${e.agent.id}|${toHHMM(TL0 + ps)}`;
      if (
        dismissed.has(key) ||
        dismissed.has(`${e.agent.id}|applied`) ||
        dismissed.has(e.agent.id)
      ) {
        continue;
      }

      // Regras de Intervalo Intrajornada (CLT & Operação):
      // 1. Não pode pausar no início do turno (mínimo de 180 min / 3h de trabalho prévio)
      // 2. Não pode pausar no fim do turno (mínimo de 120 min / 2h de trabalho restante)
      const minPauseStart = ss + 180;
      const maxPauseStart = se - 180;

      if (maxPauseStart <= minPauseStart) continue;

      let best: {
        score: number;
        imp: number;
        newMin: number;
        a: number;
        b: number;
        freedStart: string;
        freedEnd: string;
      } | null = null;

      for (const a of validPauseStarts) {
        if (a < minPauseStart || a > maxPauseStart) continue;
        if (a === ps) continue;
        const b = a + 60;

        let imp = 0;
        let newMin = Infinity;
        let nu = 0;
        for (let t = 0; t < TL_LEN; t++) {
          if (!inOp(t)) continue;
          const reqMin = getExpectedMinCoverage(cursor, t, min);
          let v = cov[t];
          if (t >= ps && t < ps + 60) v++; // liberou a pausa original
          if (t >= a && t < b) v--; // ocupou o novo horário
          if (v < reqMin) imp += reqMin - v;
          if (v < newMin) newMin = v;
          nu++;
        }
        if (nu === 0) continue;
        // Só sugere mover pausa se reduz o déficit real do dia ou se eleva a cobertura mínima sem piorar o déficit
        const improvesDeficit = bd > 0 && imp < bd;
        const improvesMinimum = newMin > curMin && imp <= bd;
        if (improvesDeficit || improvesMinimum) {
          const score = (bd - imp) * 1000 + (newMin - curMin);
          if (!best || score > best.score) {
            best = {
              score,
              imp,
              newMin,
              a,
              b,
              freedStart: toHHMM(TL0 + ps),
              freedEnd: toHHMM(TL0 + ps + 60),
            };
          }
        }
      }

      if (best) {
        const key = `${e.agent.id}|${toHHMM(TL0 + ps)}`;
        if (
          dismissed.has(key) ||
          dismissed.has(`${e.agent.id}|applied`) ||
          dismissed.has(e.agent.id)
        ) {
          continue;
        }

        const txt =
          bd > 0 && best.imp < bd
            ? `libera o operador das ${best.freedStart} às ${best.freedEnd} onde há sobrecarga — reduzindo o déficit de ${bd} para ${best.imp} min abaixo da cobertura esperada.`
            : `reforça o período das ${best.freedStart} às ${best.freedEnd} elevando a cobertura mínima para ${Math.min(best.newMin, 99)} pessoa(s).`;

        sug.push({
          agentId: e.agent.id,
          name: e.agent.name,
          from: [toHHMM(TL0 + ps), toHHMM(TL0 + ps + 60)],
          to: [toHHMM(TL0 + best.a), toHHMM(TL0 + best.b)],
          score: best.score,
          txt,
        });
      }
    }
    sug.sort((x, y) => y.score - x.score);
    return sug.slice(0, 3);
  }, [cursor, meta.settings.minCoverage, meta.dismissed, simMapFor, getDayEntries, getCoverage]);

  /* ---------------- MÃO-NA-MASSA: RENDERIZADORES ---------------- */
  const pct = (t: number) => ((t / TL_LEN) * 100).toFixed(4) + "%";
  const midPos = pct(1440 - TL0);
  const [opS, opE] = opWindow(cursor);
  const closedW = TL_LEN - (opE - TL0);

  // Linha "Agora"
  const nowIndicatorLeft = useMemo(() => {
    const now = currentTime;
    const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const tISO = isoOf(now);
    const yISO = addDaysISO(tISO, -1);

    let tInTl: number | null = null;
    if (cursor === tISO && nowMin >= TL0) {
      tInTl = nowMin - TL0;
    } else if (cursor === yISO && nowMin < TL0) {
      tInTl = nowMin + 1440 - TL0;
    }

    if (tInTl === null || tInTl < 0 || tInTl > TL_LEN) return null;
    return `calc(var(--labelW) + (var(--hourW) * 21) * ${(tInTl / TL_LEN).toFixed(5)})`;
  }, [currentTime, cursor]);

  return (
    <div className={`escalaops-root theme-${currentTheme} ${isZen ? "zen" : ""}`}>
      {/* Aviso se não houver agentes na Gestão de Escala */}
      {agents.length === 0 && (
        <div
          style={{
            background: "rgba(232, 193, 90, 0.12)",
            borderBottom: "1px solid rgba(232, 193, 90, 0.3)",
            padding: "10px 20px",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span>
            ⚠️ <b>Nenhum operador configurado na Gestão de Escalas.</b> Os horários desta tela são
            obtidos diretamente da Gestão de Escalas. Cadastre a equipe em Gestão de Escalas para
            visualizar os turnos e pausas aqui.
          </span>
          <Link to="/escala" className="btn sm acc" style={{ textDecoration: "none" }}>
            Abrir Gestão de Escalas
          </Link>
        </div>
      )}

      {/* ============================= APPBAR ============================= */}
      <header className="appbar">
        <div className="brand">
          <div className="mark">
            <svg width="20" height="20" viewBox="0 0 32 32">
              <rect x="4" y="6" width="15" height="5" rx="2.5" fill="#3fd9b2" />
              <rect x="9" y="13.5" width="19" height="5" rx="2.5" fill="#5a9dff" />
              <rect x="4" y="21" width="11" height="5" rx="2.5" fill="#e8c15a" />
            </svg>
          </div>
          <div>
            <h1>
              {pageTitle ? (
                pageTitle
              ) : (
                <>
                  Escala<em>Ops</em>
                </>
              )}
            </h1>
            <small>{defaultIncludeSimulated ? "previsão · ia + clt" : "operação · suporte"}</small>
          </div>
        </div>

        <nav className="seg">
          <button className={view === "day" ? "on" : ""} onClick={() => setView("day")}>
            Dia
          </button>
          <button className={view === "week" ? "on" : ""} onClick={() => setView("week")}>
            Semana
          </button>
          <button className={view === "cov" ? "on" : ""} onClick={() => setView("cov")}>
            Cobertura
          </button>
        </nav>

        <div className="datenav">
          <button
            className="navbtn"
            onClick={() => setCursor((c) => addDaysISO(c, view === "week" ? -7 : -1))}
            title="Anterior (←)"
          >
            ‹
          </button>
          <div className="datebox" title="Clique para escolher uma data">
            {view === "week" ? (
              <>
                <b>{`${fmtBR(mondayOf(cursor))} – ${fmtBR(addDaysISO(mondayOf(cursor), 6))}`}</b>
                <span>{`semana · ${parseISO(mondayOf(cursor)).getDate()} ${MONTHS_S[parseISO(mondayOf(cursor)).getMonth()]} → ${parseISO(addDaysISO(mondayOf(cursor), 6)).getDate()} ${MONTHS_S[parseISO(addDaysISO(mondayOf(cursor), 6)).getMonth()]}`}</span>
              </>
            ) : (
              <>
                <b>{`${WD_MED[weekdayOf(cursor)].toUpperCase()} · ${String(parseISO(cursor).getDate()).padStart(2, "0")} ${MONTHS_S[parseISO(cursor).getMonth()].toUpperCase()}`}</b>
                <span>{fmtDateLong(cursor)}</span>
              </>
            )}
            <input
              type="date"
              value={cursor}
              onChange={(e) => e.target.value && setCursor(e.target.value)}
            />
          </div>
          <button
            className="navbtn"
            onClick={() => setCursor((c) => addDaysISO(c, view === "week" ? 7 : 1))}
            title="Próximo (→)"
          >
            ›
          </button>
          {cursor !== isoOf(new Date()) && (
            <button className="btn sm ghost" onClick={() => setCursor(isoOf(new Date()))}>
              Hoje
            </button>
          )}
        </div>

        <div className="spacer" />

        <RealtimeClock />

        <button className="iconbtn" onClick={() => setIsBellOpen((prev) => !prev)} title="Alertas">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          {alerts.filter((a) => a.sev !== "i").length > 0 && (
            <span className={`badge ${alerts.some((a) => a.sev === "c") ? "" : "w"}`}>
              {alerts.filter((a) => a.sev !== "i").length}
            </span>
          )}
        </button>

        <button className="btn" onClick={() => setActiveDrawer("team")}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          Equipe ({agents.length})
        </button>

        {/* Alternador CLT Oficial vs Prova Real (Simulado) */}
        {newHires.filter((h) => h.active).length > 0 && (
          <button
            className={`btn sm ${includeSimulated ? "acc" : ""}`}
            onClick={() => {
              const next = !includeSimulated;
              setIncludeSimulated(next);
              triggerToast(
                next
                  ? `Modo Prova Real ativado (+${newHires.filter((h) => h.active).length} contratações simuladas inclusas).`
                  : "Modo Oficial CLT ativo (apenas quadro atual).",
              );
            }}
            title="Alternar entre escala oficial CLT e inclusão das contratações simuladas da Prova Real"
            style={{
              borderColor: includeSimulated ? "#10b981" : undefined,
              color: includeSimulated ? "#10b981" : undefined,
            }}
          >
            {includeSimulated ? (
              <>
                <span style={{ fontSize: 13 }}>◆</span> Prova Real (+
                {newHires.filter((h) => h.active).length})
              </>
            ) : (
              <>
                <span style={{ fontSize: 13 }}>◇</span> CLT Atual
              </>
            )}
          </button>
        )}

        <button
          className="iconbtn"
          onClick={() => setActiveDrawer("menu")}
          title="Configurações e backup"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="4" y1="7" x2="20" y2="7" />
            <circle cx="9" cy="7" r="2.2" fill="var(--panel2)" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <circle cx="15" cy="12" r="2.2" fill="var(--panel2)" />
            <line x1="4" y1="17" x2="20" y2="17" />
            <circle cx="7" cy="17" r="2.2" fill="var(--panel2)" />
          </svg>
        </button>
      </header>

      {/* ============================= FAIXA AO VIVO ============================= */}
      <div className="live-strip">
        <div className="ls-block">
          <b className="acc">{liveInfo.working}</b>
          <span>trabalhando agora</span>
        </div>
        <div className="ls-block">
          <b className={liveInfo.pausedList.length ? "warn" : ""}>{liveInfo.pausedList.length}</b>
          <span>em pausa</span>
        </div>
        <div className="ls-block">
          <b>{liveInfo.todayCount}</b>
          <span>em escala hoje</span>
        </div>
        <div className="ls-div" />
        <div className="ls-group">
          <span className="micro">Trabalhando</span>
          <div className="chips">
            {liveInfo.workingList.map((x, idx) => (
              <span key={idx} className="chip">
                <span className="dot" style={{ background: x.e.agent.color }} />
                {x.e.agent.name}
                {x.carry ? " · ontem" : ""}
              </span>
            ))}
            {liveInfo.workingList.length === 0 && <span className="chip none">ninguém</span>}
          </div>
        </div>
        <div className="ls-group">
          <span className="micro">Em pausa</span>
          <div className="chips">
            {liveInfo.pausedList.map((x, idx) => (
              <span key={idx} className="chip pau">
                <span className="dot" style={{ background: x.e.agent.color }} />
                {x.e.agent.name}
                {x.e.pauseSpan && (
                  <span className="mono" style={{ color: "var(--dim)", marginLeft: 4 }}>
                    até {fmtHM(TL0 + x.e.pauseSpan[1] - (x.carry ? 1440 : 0))}
                  </span>
                )}
              </span>
            ))}
            {liveInfo.pausedList.length === 0 && <span className="chip none">ninguém</span>}
          </div>
        </div>
        <div className="ls-group">
          <span className="micro">A seguir</span>
          <div className="chips">
            {liveInfo.next.entrada && (
              <span className="chip ev">
                <b>{fmtHM(TL0 + liveInfo.next.entrada.t)}</b> entrada · {liveInfo.next.entrada.a}
              </span>
            )}
            {liveInfo.next.pausa && (
              <span className="chip ev">
                <b>{fmtHM(TL0 + liveInfo.next.pausa.t)}</b> pausa · {liveInfo.next.pausa.a}
              </span>
            )}
            {liveInfo.next.saida && (
              <span className="chip ev">
                <b>{fmtHM(TL0 + liveInfo.next.saida.t)}</b> saída · {liveInfo.next.saida.a}
              </span>
            )}
            {!liveInfo.next.entrada && !liveInfo.next.pausa && !liveInfo.next.saida && (
              <span className="chip none">sem eventos hoje</span>
            )}
          </div>
        </div>
      </div>

      {/* ============================= CONTEÚDO / VISÕES ============================= */}
      <main className="ops-main">
        {/* ==================== VISÃO DIA ==================== */}
        {view === "day" && (
          <section>
            {(() => {
              const isToday = cursor === isoOf(new Date());
              const smap = simMapFor(cursor);
              const entries = getDayEntries(cursor, smap);
              const working = entries
                .filter((e) => e.works)
                .sort(
                  (a, b) =>
                    (a.span ? a.span[0] : 0) - (b.span ? b.span[0] : 0) ||
                    a.agent.name.localeCompare(b.agent.name),
                );
              const off = entries
                .filter((e) => !e.works)
                .sort((a, b) => a.agent.name.localeCompare(b.agent.name));
              const st = dayStats(cursor, smap);
              const min = meta.settings.minCoverage;
              const excCount = Object.keys(meta.overrides[cursor] || {}).length;
              const cov = getCoverage(cursor, smap);
              const runs = runsOf(cov);

              const rowHtml = (e: DayEntry) => {
                const a = e.agent;
                const timeLbl = `${e.shift[0]}–${e.shift[1]}`;
                const [s, en] = e.span || [0, 0];
                const wPct = ((en - s) / TL_LEN) * 100;
                const showT = wPct > 9;

                let tooltip = `<b>${a.name}</b><br><span class="mono">${timeLbl} · ${fmtDur(en - s)}</span><br>${e.pause ? `Pausa <span class="mono">${e.pause[0]}–${e.pause[1]}</span>` : "Sem pausa"}${e.externos && e.externos.length > 0 ? `<br><span style="color:#008AD4;font-weight:600">Demanda Externa (Offchat): ${e.externos.map((x) => `${x[0]}–${x[1]}`).join(", ")}</span>` : ""}${e.note ? `<br><i>${e.note}</i>` : ""}`;
                if (e.fromSim) tooltip += '<br><b style="color:var(--info)">◆ Em simulação</b>';

                return (
                  <div key={a.id} className={`tl-row ${e.works ? "" : "off"}`}>
                    <div
                      className="tl-label"
                      onClick={() =>
                        setActiveModal({ type: "day", agentId: a.id, dateISO: cursor })
                      }
                      title="Clique para editar situação neste dia"
                    >
                      <span className="dot" style={{ background: a.color, color: a.color }} />
                      <span className="nm">
                        <b>{a.name}</b>
                        <span>
                          {e.works
                            ? `${timeLbl} · ⏸ ${e.pause ? e.pause[0] : "—"}`
                            : (KIND_LABEL[e.absence || ""] || "Folga").toLowerCase()}
                        </span>
                      </span>
                      {e.fromSim ? (
                        <span className="mk sim">◆ sim</span>
                      ) : a.isSimulated ? (
                        <span
                          className="mk"
                          style={{
                            background: "rgba(16, 185, 129, 0.18)",
                            color: "#10b981",
                            borderColor: "rgba(16, 185, 129, 0.35)",
                            fontWeight: 700,
                          }}
                        >
                          ✨ IA
                        </span>
                      ) : e.exception ? (
                        <span className="mk">▲ exceção</span>
                      ) : null}
                    </div>

                    <div className="tl-track">
                      <div className="midline" style={{ left: midPos }} />
                      {e.works && e.span ? (
                        <div
                          className={`bar ${e.fromSim ? "fromsim" : ""}`}
                          style={
                            {
                              left: pct(s),
                              width: `${wPct.toFixed(4)}%`,
                              ["--c" as string]: a.color,
                            } as React.CSSProperties
                          }
                          onMouseEnter={(ev) =>
                            setTip({ html: tooltip, x: ev.clientX, y: ev.clientY })
                          }
                          onMouseMove={(ev) =>
                            setTip((curr) =>
                              curr ? { ...curr, x: ev.clientX, y: ev.clientY } : null,
                            )
                          }
                          onMouseLeave={() => setTip(null)}
                          onClick={() =>
                            setActiveModal({ type: "day", agentId: a.id, dateISO: cursor })
                          }
                        >
                          {showT && <span className="t0">{e.shift[0]}</span>}
                          {e.pauseSpan && (
                            <div
                              className="pause"
                              style={{
                                left: `${(((e.pauseSpan[0] - s) / (en - s)) * 100).toFixed(3)}%`,
                                width: `${(((e.pauseSpan[1] - e.pauseSpan[0]) / (en - s)) * 100).toFixed(3)}%`,
                              }}
                              title={`Pausa ${e.pause ? e.pause[0] + "–" + e.pause[1] : ""}`}
                            />
                          )}
                          {e.externoSpans &&
                            e.externoSpans.map(([ex0, ex1], idx) => {
                              const exLeft = `${(((ex0 - s) / (en - s)) * 100).toFixed(3)}%`;
                              const exWidth = `${(((ex1 - ex0) / (en - s)) * 100).toFixed(3)}%`;
                              const exRange = e.externos?.[idx];
                              const rangeLbl = exRange ? `${exRange[0]}–${exRange[1]}` : "";
                              return (
                                <div
                                  key={idx}
                                  className="externo"
                                  style={{ left: exLeft, width: exWidth }}
                                  title={`Demanda Externa (Offchat): ${rangeLbl}`}
                                >
                                  <span className="externo-lbl">Offchat</span>
                                </div>
                              );
                            })}
                          {showT && <span className="t1">{e.shift[1]}</span>}
                        </div>
                      ) : e.absence ? (
                        <span className={`abs ${e.absence}`} style={{ left: pct(60) }}>
                          ✕ {KIND_LABEL[e.absence]}
                        </span>
                      ) : (
                        <span className="folga-tag" style={{ left: pct(60) }}>
                          folga
                        </span>
                      )}
                      <div
                        className="closed-shade"
                        style={{ left: pct(opE - TL0), width: pct(closedW) }}
                        title="Fora do horário de funcionamento"
                      />
                    </div>
                  </div>
                );
              };

              return (
                <>
                  <div className="vhead">
                    <div>
                      <h2>{WD_LONG[weekdayOf(cursor)].replace("-feira", "")}</h2>
                      <div className="sub">{fmtDateLong(cursor)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {isToday && <span className="tag today">● hoje</span>}
                      {excCount > 0 && <span className="tag exc">▲ {excCount} exceção(ões)</span>}
                      {smap && <span className="tag sim">◆ simulação</span>}
                    </div>
                    <div className="stats">
                      <div className="mini-stat">
                        <b>{working.length}</b>
                        <span>em escala</span>
                      </div>
                      <div className="mini-stat">
                        <b>{st.peak}</b>
                        <span>pico{st.peakT >= 0 ? ` às ${fmtHM(TL0 + st.peakT)}` : ""}</span>
                      </div>
                      <div className="mini-stat">
                        <b style={{ color: st.crit > 0 ? "var(--bad)" : "var(--ok)" }}>{st.min}</b>
                        <span>
                          mínimo{" "}
                          {[0, 1, 2, 6].includes(weekdayOf(cursor))
                            ? "(reduzido 1–2)"
                            : `(meta ${min})`}
                        </span>
                      </div>
                      <div className="mini-stat">
                        <b style={{ color: st.crit ? "var(--bad)" : "var(--ok)" }}>{st.crit}</b>
                        <span>janelas &lt; mín</span>
                      </div>
                    </div>
                  </div>

                  <div className="tl-toolbar">
                    <button
                      className={`btn ${sim ? "on" : ""}`}
                      onClick={() => setActiveDrawer("sim")}
                    >
                      ⚡ Simular “e se…”
                    </button>
                    <button className="btn ghost" onClick={() => setIsZen((z) => !z)}>
                      ⛶ {isZen ? "Sair do modo quadro" : "Modo quadro"}
                    </button>
                    <span className="hint" style={{ margin: "0 0 0 auto" }}>
                      horários sincronizados com Gestão de Escalas · clique no agente para registrar
                      exceções
                    </span>
                  </div>

                  <div className="tl-scroll">
                    <div className="tl">
                      {/* Régua */}
                      <div className="tl-ruler">
                        <div className="rlabel">Operador</div>
                        <div className="ruler-track">
                          {Array.from({ length: 21 }).map((_, h) => {
                            const raw = TL0 + h * 60;
                            const isMid = raw === 1440;
                            return (
                              <div
                                key={h}
                                className={`h ${isMid ? "mid" : ""}`}
                                style={{ left: pct(h * 60), width: "var(--hourW)" }}
                              >
                                {toHHMM(raw)}
                                {isMid && <span className="d1">+1 DIA</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Linhas de operadores em trabalho */}
                      {working.map(rowHtml)}

                      {/* Divisor de folgas e ausências */}
                      {off.length > 0 && (
                        <>
                          <div className="tl-divider">
                            <div>Folgas e ausências · {off.length}</div>
                            <div />
                          </div>
                          {off.map(rowHtml)}
                        </>
                      )}

                      {/* Linha da faixa de cobertura */}
                      <div className="covstrip-row" onClick={() => setView("cov")}>
                        <div className="lbl">
                          Cobertura{" "}
                          <span
                            className="micro"
                            style={{ letterSpacing: 0, textTransform: "none" }}
                          >
                            {[0, 1, 2, 6].includes(weekdayOf(cursor))
                              ? "(time reduzido · mín 1–2)"
                              : `(mín ${min})`}
                          </span>
                        </div>
                        <div className="covstrip" style={{ position: "relative" }}>
                          {runs.map((r, idx) => {
                            const cls = covClass(r.v, r.t0, cursor);
                            const w = r.t1 - r.t0;
                            const reqMin = getExpectedMinCoverage(cursor, r.t0, min);
                            return (
                              <div
                                key={idx}
                                className={`covcell ${cls}`}
                                style={{
                                  left: pct(r.t0),
                                  width: `calc(${((w / TL_LEN) * 100).toFixed(4)}% - 2px)`,
                                }}
                                onMouseEnter={(ev) =>
                                  setTip({
                                    html: `${fmtHM(TL0 + r.t0)}–${fmtHM(TL0 + r.t1)} · <b>${r.v} pessoa(s)</b>${reqMin < min ? ` (mínimo esperado: ${reqMin})` : ""}${cls === "closed" ? " · fora do funcionamento" : ""}`,
                                    x: ev.clientX,
                                    y: ev.clientY,
                                  })
                                }
                                onMouseMove={(ev) =>
                                  setTip((curr) =>
                                    curr ? { ...curr, x: ev.clientX, y: ev.clientY } : null,
                                  )
                                }
                                onMouseLeave={() => setTip(null)}
                              >
                                {w >= 45 ? r.v : ""}
                              </div>
                            );
                          })}
                          <div
                            className="closed-shade"
                            style={{ left: pct(opE - TL0), width: pct(closedW) }}
                          />
                          <div
                            className="midline"
                            style={{
                              position: "absolute",
                              top: 0,
                              bottom: 0,
                              left: midPos,
                              borderLeft: "1px dashed rgba(255,107,107,.4)",
                            }}
                          />
                        </div>
                      </div>

                      {/* Linha Vermelha Agora */}
                      {nowIndicatorLeft && (
                        <div className="nowline" style={{ left: nowIndicatorLeft }} />
                      )}
                    </div>
                  </div>

                  <div className="legend">
                    <span>
                      <i style={{ background: "var(--ok)" }} />
                      acima do mínimo
                    </span>
                    <span>
                      <i style={{ background: "var(--warn)" }} />
                      no limite ({min})
                    </span>
                    <span>
                      <i style={{ background: "var(--bad)" }} />
                      abaixo
                    </span>
                    <span>
                      <i style={{ background: "var(--zero)" }} />
                      sem ninguém
                    </span>
                    <span>
                      <i style={{ background: "var(--closed)" }} />
                      fora do funcionamento
                    </span>
                    <span>
                      <i
                        style={{
                          background:
                            "repeating-linear-gradient(45deg,rgba(9,12,17,.9) 0 3px,rgba(9,12,17,.5) 3px 6px)",
                          border: "1px solid var(--line2)",
                        }}
                      />
                      pausa (não conta)
                    </span>
                    <span>
                      <i style={{ background: "#008AD4", border: "1px solid rgba(0,0,0,0.4)" }} />
                      demanda externa (offchat)
                    </span>
                    <span style={{ marginLeft: "auto" }} className="mono">
                      funcionamento: {toHHMM(opS)}–{toHHMM(opE)}
                      {opE > 1440 ? " (+1d)" : ""}
                    </span>
                  </div>

                  {/* Sugestões de pausa */}
                  {pauseSuggestions.length > 0 && (
                    <div className="sugg">
                      <header>
                        <span className="glyph">◈</span>
                        <b>Sugestões de pausa</b>
                        <span className="micro" style={{ marginLeft: 6 }}>
                          análise automática do dia
                        </span>
                      </header>
                      {pauseSuggestions.map((s, i) => (
                        <div key={i} className="item">
                          <p>
                            Mover a pausa de <b>{s.name}</b> de{" "}
                            <span className="mono">
                              {s.from[0]}–{s.from[1]}
                            </span>{" "}
                            para{" "}
                            <span className="mono">
                              {s.to[0]}–{s.to[1]}
                            </span>{" "}
                            — {s.txt}
                          </p>
                          <button
                            className="btn sm acc"
                            onClick={() => {
                              const ov = getOverride(cursor, s.agentId);
                              if (ov && ["falta", "atestado", "ferias"].includes(ov.kind)) {
                                triggerToast(
                                  "Não é possível ajustar pausa de uma ausência.",
                                  "err",
                                );
                                return;
                              }
                              const next: Override = ov ? { ...ov } : { kind: "ajuste" };
                              next.pause = s.to;

                              // Atualiza overrides com a pausa ajustada
                              const nextOverrides = { ...meta.overrides };
                              if (!nextOverrides[cursor]) nextOverrides[cursor] = {};
                              else nextOverrides[cursor] = { ...nextOverrides[cursor] };
                              nextOverrides[cursor][s.agentId] = next;

                              // Remove imediatamente para que a informação suma na hora
                              const nextDismissed = { ...meta.dismissed };
                              if (!nextDismissed[cursor]) nextDismissed[cursor] = [];
                              const toDismiss = [
                                `${s.agentId}|${s.from[0]}`,
                                `${s.agentId}|${s.to[0]}`,
                                `${s.agentId}|applied`,
                                s.agentId,
                                ...pauseSuggestions.map((x) => `${x.agentId}|${x.from[0]}`),
                                ...pauseSuggestions.map((x) => x.agentId),
                              ];
                              nextDismissed[cursor] = Array.from(
                                new Set([...nextDismissed[cursor], ...toDismiss]),
                              );

                              saveMeta({
                                ...meta,
                                overrides: nextOverrides,
                                dismissed: nextDismissed,
                              });

                              // Sincroniza diretamente na escala oficial
                              const agentObj = agents.find((a) => a.id === s.agentId);
                              const dayName = WEEKDAY_TO_DAY[weekdayOf(cursor)];
                              const daySched = agentObj?.daySchedules?.[dayName];
                              syncScheduleToContext(
                                s.agentId,
                                dayName,
                                next,
                                daySched?.shift || agentObj?.shift || ["08:00", "17:00"],
                                s.to,
                              );

                              triggerToast(
                                `Pausa de ${s.name} movida para ${s.to[0]}–${s.to[1]} em ${fmtDateShort(cursor)}.`,
                              );
                            }}
                          >
                            Aplicar no dia
                          </button>
                          <button
                            className="btn sm ghost"
                            onClick={() => {
                              const nextDismissed = { ...meta.dismissed };
                              if (!nextDismissed[cursor]) nextDismissed[cursor] = [];
                              nextDismissed[cursor] = Array.from(
                                new Set([
                                  ...nextDismissed[cursor],
                                  `${s.agentId}|${s.from[0]}`,
                                  `${s.agentId}|${s.to[0]}`,
                                  s.agentId,
                                ]),
                              );
                              saveMeta({ ...meta, dismissed: nextDismissed });
                            }}
                          >
                            Ignorar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </section>
        )}

        {/* ==================== VISÃO SEMANA ==================== */}
        {view === "week" && (
          <section>
            {(() => {
              const mon = mondayOf(cursor);
              const days = [...Array(7)].map((_, i) => addDaysISO(mon, i));
              const todayISO = isoOf(new Date());

              return (
                <>
                  <div className="vhead">
                    <div>
                      <h2>Semana</h2>
                      <div className="sub">
                        {fmtBR(mon)} a {fmtBR(addDaysISO(mon, 6))} · {parseISO(mon).getDate()}{" "}
                        {MONTHS[parseISO(mon).getMonth()]}
                      </div>
                    </div>
                    <div className="stats">
                      <div className="mini-stat">
                        <b>{agents.length}</b>
                        <span>operadores</span>
                      </div>
                      <div className="mini-stat">
                        <b>
                          {days.reduce(
                            (s, d) => s + getDayEntries(d, null).filter((e) => e.works).length,
                            0,
                          )}
                        </b>
                        <span>turnos na semana</span>
                      </div>
                    </div>
                  </div>

                  <div className="wk-scroll">
                    <div className="wk">
                      <div className="corner">Operador</div>
                      {days.map((d) => {
                        const c = getDayEntries(d, null).filter((e) => e.works).length;
                        const dd = parseISO(d);
                        return (
                          <div
                            key={d}
                            className={`hd ${d === todayISO ? "tcol" : ""}`}
                            onClick={() => {
                              setCursor(d);
                              setView("day");
                            }}
                            title="Clique para ir para a timeline deste dia"
                          >
                            <b>
                              {WD_MED[dd.getDay()].toUpperCase()}{" "}
                              {String(dd.getDate()).padStart(2, "0")}
                            </b>
                            <span>{MONTHS_S[dd.getMonth()]}</span>
                            <br />
                            <span className="cnt">{c} em escala</span>
                          </div>
                        );
                      })}

                      {agents.map((a) => (
                        <React.Fragment key={a.id}>
                          <div className="aname">
                            <span className="dot" style={{ background: a.color }} />
                            <span className="truncate">{a.name}</span>
                            {a.isSimulated && (
                              <span
                                style={{
                                  fontSize: "9px",
                                  fontWeight: 700,
                                  color: "#10b981",
                                  background: "rgba(16, 185, 129, 0.15)",
                                  padding: "1px 4px",
                                  borderRadius: "4px",
                                  marginLeft: "4px",
                                  flexShrink: 0,
                                }}
                              >
                                IA
                              </span>
                            )}
                          </div>
                          {days.map((d) => {
                            const e = getDayEntries(d, null).find((x) => x.agent.id === a.id);
                            if (!e) return <div key={d} className="cell" />;

                            return (
                              <div
                                key={d}
                                className={`cell ${d === todayISO ? "tcol" : ""}`}
                                onClick={() =>
                                  setActiveModal({ type: "day", agentId: a.id, dateISO: d })
                                }
                                title="Clique para registrar exceção neste dia"
                              >
                                {e.works ? (
                                  <span
                                    className={`wshift ${e.exception ? "hasexc" : ""} ${e.fromSim ? "fromsim" : ""}`}
                                    style={{ ["--c" as string]: a.color } as React.CSSProperties}
                                  >
                                    {e.shift[0].slice(0, 5)}–{e.shift[1].slice(0, 5)}
                                  </span>
                                ) : e.absence ? (
                                  <span className={`wabs ${e.absence}`}>
                                    {KIND_LABEL[e.absence].slice(0, 6).toUpperCase()}
                                  </span>
                                ) : (
                                  <span className="wfolga">folga</span>
                                )}
                              </div>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  <div className="hint">
                    Clique em uma célula para registrar exceção · clique no cabeçalho do dia para
                    abrir a timeline correspondente.
                  </div>
                </>
              );
            })()}
          </section>
        )}

        {/* ==================== VISÃO COBERTURA ==================== */}
        {view === "cov" && (
          <section>
            {(() => {
              const smap = simMapFor(cursor);
              const st = dayStats(cursor, smap);
              const min = meta.settings.minCoverage;
              const crits = criticalRanges(cursor, smap);
              const [opS, opE] = opWindow(cursor);
              const cov = getCoverage(cursor, smap);

              let deficitMins = 0;
              for (let t = 0; t < TL_LEN; t++) {
                if (cov[t] < realDemandInfo.demand[t]) deficitMins++;
              }
              const realDeficitHours = (deficitMins / 60).toFixed(1);

              let deltaSummary = null;
              if (smap) {
                const stO = dayStats(cursor, null);
                deltaSummary = (
                  <div className="sim-delta">
                    ◆ <b>Simulação ativa</b> — cobertura mínima: oficial <b>{stO.min}</b> →
                    simulação{" "}
                    <b
                      style={{
                        color:
                          st.min < stO.min
                            ? "var(--bad)"
                            : st.min > stO.min
                              ? "var(--ok)"
                              : "inherit",
                      }}
                    >
                      {st.min}
                    </b>{" "}
                    · pico: oficial <b>{stO.peak}</b> → simulação <b>{st.peak}</b>
                  </div>
                );
              }

              return (
                <>
                  <div className="vhead">
                    <div>
                      <h2>Cobertura</h2>
                      <div className="sub">{fmtDateLong(cursor)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {smap && <span className="tag sim">◆ simulação</span>}
                    </div>
                    <div className="stats">
                      <div className="mini-stat">
                        <b>{st.peak}</b>
                        <span>
                          pico escalado{st.peakT >= 0 ? ` às ${fmtHM(TL0 + st.peakT)}` : ""}
                        </span>
                      </div>
                      <div className="mini-stat">
                        <b style={{ color: "#38bdf8" }}>{realDemandInfo.peakDemand}</b>
                        <span>demanda pico ({Math.round(realDemandInfo.peakVol)} cham.)</span>
                      </div>
                      <div className="mini-stat">
                        <b style={{ color: st.crit > 0 ? "var(--bad)" : "var(--ok)" }}>{st.min}</b>
                        <span>
                          mínimo{" "}
                          {[0, 1, 2, 6].includes(weekdayOf(cursor)) ? "(reduzido 1–2)" : "escalado"}
                        </span>
                      </div>
                      <div className="mini-stat">
                        <b
                          style={{
                            color: Number(realDeficitHours) > 0 ? "var(--bad)" : "var(--ok)",
                          }}
                        >
                          {realDeficitHours}h
                        </b>
                        <span>em déficit real</span>
                      </div>
                    </div>
                  </div>

                  <div className="tl-toolbar">
                    <button
                      className={`btn ${sim ? "on" : ""}`}
                      onClick={() => setActiveDrawer("sim")}
                    >
                      ⚡ Simular “e se…”
                    </button>
                    <div className="legend" style={{ margin: "0 0 0 auto" }}>
                      <span>
                        <i style={{ background: "#38bdf8", height: 3, borderRadius: 2 }} />
                        demanda real dimensionada
                      </span>
                      <span>
                        <i style={{ background: "var(--ok)" }} />
                        &gt; mínimo
                      </span>
                      <span>
                        <i style={{ background: "var(--warn)" }} />= mínimo
                      </span>
                      <span>
                        <i style={{ background: "var(--bad)" }} />
                        &lt; mínimo
                      </span>
                      <span>
                        <i style={{ background: "var(--zero)" }} />
                        zero
                      </span>
                      {smap && (
                        <span>
                          <i
                            style={{
                              background: "none",
                              border: "1.5px dashed var(--mut)",
                            }}
                          />
                          oficial (sem simulação)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="cov-panel">
                    <div className="cov-chart-wrap">
                      <CoverageChart
                        dateISO={cursor}
                        simMap={smap}
                        minCoverage={min}
                        demandCurve={realDemandInfo.demand}
                        volumeCurve={realDemandInfo.volumes}
                        getCoverage={getCoverage}
                        getDayEntries={getDayEntries}
                        covClass={covClass}
                        onHoverTip={setTip}
                      />
                    </div>

                    {deltaSummary}

                    <div className="cov-critical">
                      {crits.length > 0 ? (
                        crits.map((r, i) => {
                          const reqMin = getExpectedMinCoverage(cursor, r.t0, min);
                          return (
                            <div key={i} className={`crit-item ${r.v === 0 ? "zero" : ""}`}>
                              <span style={{ fontSize: 15 }}>{r.v === 0 ? "⛔" : "⚠"}</span>
                              <b>
                                {fmtHM(TL0 + r.t0)}–{fmtHM(TL0 + r.t1)}
                              </b>{" "}
                              ·{" "}
                              {r.v === 0
                                ? "nenhum agente disponível"
                                : `${r.v} de ${reqMin} disponível(is)`}
                            </div>
                          );
                        })
                      ) : (
                        <div className="crit-ok">
                          ✓ Nenhum período abaixo do mínimo (
                          {[0, 1, 2, 6].includes(weekdayOf(cursor)) ? "1–2" : min}) dentro do
                          horário de funcionamento ({toHHMM(opS)}–{toHHMM(opE)}
                          {opE > 1440 ? " +1d" : ""}).
                        </div>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </section>
        )}
      </main>

      {/* ============================= SIMULATION BANNER ============================= */}
      {sim && (
        <div className="sim-banner">
          <span className="t">
            ⚡ <b>Simulação ativa</b> · {fmtDateShort(sim.date)} · {Object.keys(sim.entries).length}{" "}
            alteração(ões) — nada foi salvo na escala oficial
          </span>
          <button className="btn sm" onClick={() => setActiveDrawer("sim")}>
            Editar cenários
          </button>
          <button
            className="btn sm acc"
            onClick={() => {
              const d = sim.date;
              const nextOverrides = { ...meta.overrides };
              if (!nextOverrides[d]) nextOverrides[d] = {};
              Object.assign(nextOverrides[d], sim.entries);
              saveMeta({ ...meta, overrides: nextOverrides });
              setSim(null);
              triggerToast(`Simulação aplicada à escala de ${fmtDateShort(d)}.`);
            }}
          >
            Aplicar ao dia
          </button>
          <button
            className="btn sm danger"
            onClick={() => {
              setSim(null);
              triggerToast("Simulação descartada.", "warn");
            }}
          >
            Descartar
          </button>
        </div>
      )}

      {/* Botão de sair do modo Zen */}
      {isZen && (
        <button
          className="btn zen-exit-btn"
          style={{ position: "fixed", top: 14, right: 16, zIndex: 100 }}
          onClick={() => setIsZen(false)}
        >
          ✕ Sair do modo quadro (Esc)
        </button>
      )}

      {/* ============================= POPUP SINO (ALERTAS) ============================= */}
      {isBellOpen && (
        <div className="bell-pop">
          <header>
            <b>Alertas de hoje</b>
            <span className="micro">{alerts.length} item(ns)</span>
          </header>
          {alerts.length > 0 ? (
            alerts.map((a, idx) => (
              <div key={idx} className={`alert-item ${a.sev}`}>
                <span className="dot" />
                <span>{a.msg}</span>
                <time>{a.when}</time>
              </div>
            ))
          ) : (
            <div className="bell-empty">✓ Tudo certo por aqui — nenhuma pendência agora.</div>
          )}
        </div>
      )}

      {/* ============================= GAVETAS (DRAWERS) ============================= */}
      {activeDrawer && (
        <div
          className="ov drawerov"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveDrawer(null);
          }}
        >
          <div className="drawer">
            {/* GAVETA DA EQUIPE */}
            {activeDrawer === "team" && (
              <>
                <div className="dhead">
                  <h3>Equipe · {agents.length} agentes</h3>
                  <button
                    className="btn sm acc"
                    style={{ marginLeft: "auto", marginRight: 8 }}
                    onClick={() => setActiveModal({ type: "agent" })}
                  >
                    + Adicionar
                  </button>
                  <button className="btn sm ghost x" onClick={() => setActiveDrawer(null)}>
                    ✕
                  </button>
                </div>
                <div className="dbody">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "var(--panel2)",
                      border: "1px solid var(--line2)",
                      fontSize: 12,
                    }}
                  >
                    <span>Incluir contratados simulados:</span>
                    <button
                      className={`btn sm ${includeSimulated ? "acc" : "ghost"}`}
                      onClick={() => setIncludeSimulated((v) => !v)}
                    >
                      {includeSimulated ? "Sim" : "Não"}
                    </button>
                  </div>

                  {agents.map((a) => (
                    <div key={a.id} className="agent-row">
                      <span className="dot" style={{ background: a.color }} />
                      <div className="ainfo">
                        <b>{a.name}</b>
                        <span>
                          {a.shift[0]}–{a.shift[1]}
                          {a.pause ? ` · ⏸ ${a.pause[0]}–${a.pause[1]}` : " · sem pausa"}
                        </span>
                        <span className="wd">
                          {[1, 2, 3, 4, 5, 6, 0]
                            .filter((d) => a.workdays.includes(d))
                            .map((d) => WD_MED[d])
                            .join(" · ") || "Sem escala configurada"}
                        </span>
                      </div>
                      <button
                        className="btn sm ghost"
                        onClick={() => setActiveModal({ type: "agent", agentId: a.id })}
                        title="Editar"
                        style={{ fontSize: 13, padding: "4px 8px" }}
                      >
                        ✎
                      </button>
                    </div>
                  ))}
                  <div className="hint">
                    A escala padrão é editada aqui. Alterações de um dia específico são feitas
                    clicando no agente na timeline ou na semana.
                  </div>
                </div>
              </>
            )}

            {/* GAVETA DE CONFIGURAÇÕES / BACKUP */}
            {activeDrawer === "menu" && (
              <>
                <div className="dhead">
                  <h3>Configurações & backup</h3>
                  <button
                    className="btn sm ghost x"
                    style={{ marginLeft: "auto" }}
                    onClick={() => setActiveDrawer(null)}
                  >
                    ✕
                  </button>
                </div>
                <div className="dbody">
                  <div className="mrow">
                    <div>
                      <div className="k">Cobertura mínima</div>
                      <div className="d">meta usada nas cores e alertas</div>
                    </div>
                    <div className="stepper">
                      <button
                        onClick={() =>
                          saveMeta({
                            ...meta,
                            settings: {
                              ...meta.settings,
                              minCoverage: Math.max(1, meta.settings.minCoverage - 1),
                            },
                          })
                        }
                      >
                        −
                      </button>
                      <b>{meta.settings.minCoverage}</b>
                      <button
                        onClick={() =>
                          saveMeta({
                            ...meta,
                            settings: {
                              ...meta.settings,
                              minCoverage: Math.min(12, meta.settings.minCoverage + 1),
                            },
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="mrow">
                    <div>
                      <div className="k">Exportar exceções locais</div>
                      <div className="d">backup das exceções e configurações em JSON</div>
                    </div>
                    <button
                      className="btn sm"
                      onClick={() => {
                        const data = {
                          app: "EscalaOps",
                          version: 1,
                          exportedAt: new Date().toISOString(),
                          overrides: meta.overrides,
                          settings: meta.settings,
                          dismissed: meta.dismissed,
                        };
                        const blob = new Blob([JSON.stringify(data, null, 2)], {
                          type: "application/json",
                        });
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = `escalaops-backup-${isoOf(new Date())}.json`;
                        a.click();
                        URL.revokeObjectURL(a.href);
                        triggerToast("Backup exportado com sucesso.");
                      }}
                    >
                      Baixar .json
                    </button>
                  </div>

                  <div className="mrow">
                    <div>
                      <div className="k">Importar exceções locais</div>
                      <div className="d">restaura configurações e exceções salvas</div>
                    </div>
                    <label className="btn sm" style={{ cursor: "pointer" }}>
                      Escolher arquivo…
                      <input
                        type="file"
                        accept=".json,application/json"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const rd = new FileReader();
                          rd.onload = () => {
                            try {
                              const d = JSON.parse(rd.result as string);
                              saveMeta({
                                overrides: d.overrides || {},
                                settings: Object.assign({ minCoverage: 2 }, d.settings),
                                dismissed: d.dismissed || {},
                                agentColors: d.agentColors || {},
                              });
                              setSim(null);
                              setActiveDrawer(null);
                              triggerToast("Backup importado com sucesso!");
                            } catch {
                              triggerToast("Arquivo inválido — nada foi alterado.", "err");
                            }
                          };
                          rd.readAsText(file);
                        }}
                      />
                    </label>
                  </div>

                  <div className="mrow">
                    <div>
                      <div className="k">Limpar exceções locais</div>
                      <div className="d">apaga todas as faltas e trocas salvas na escala teste</div>
                    </div>
                    <button
                      className="btn sm danger"
                      onClick={() => setActiveModal({ type: "restore-confirm" })}
                    >
                      Limpar
                    </button>
                  </div>

                  <div className="mrow" style={{ borderBottom: "none" }}>
                    <div>
                      <div className="k">Atalhos</div>
                      <div className="d" style={{ marginTop: 6, lineHeight: 2 }}>
                        <kbd>←</kbd> <kbd>→</kbd> navegar dias · <kbd>T</kbd> hoje · <kbd>1</kbd>
                        <kbd>2</kbd>
                        <kbd>3</kbd> alternar visões · <kbd>Esc</kbd> fechar modais
                      </div>
                    </div>
                  </div>

                  <div className="hint">
                    A base dos operadores é sincronizada em tempo real com a Gestão de Escalas.
                  </div>
                </div>
              </>
            )}

            {/* GAVETA DO SIMULADOR */}
            {activeDrawer === "sim" && (
              <SimulationDrawerContent
                cursor={cursor}
                sim={sim}
                agents={agents}
                setSim={setSim}
                closeDrawer={() => setActiveDrawer(null)}
                triggerToast={triggerToast}
                saveMeta={(nextOverrides) => saveMeta({ ...meta, overrides: nextOverrides })}
                overrides={meta.overrides}
              />
            )}
          </div>
        </div>
      )}

      {/* ============================= MODAIS ============================= */}
      {activeModal && (
        <div
          className="ov"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveModal(null);
          }}
        >
          <div className="modal">
            {/* MODAL EDITOR DE DIA */}
            {activeModal.type === "day" && (
              <DayEditorModalContent
                agentId={activeModal.agentId}
                dateISO={activeModal.dateISO}
                agents={agents}
                sim={sim}
                getOverride={getOverride}
                setOverride={setOverride}
                closeModal={() => setActiveModal(null)}
                triggerToast={triggerToast}
                onSyncSchedule={syncScheduleToContext}
              />
            )}

            {/* MODAL NOVO OU EDITAR AGENTE */}
            {activeModal.type === "agent" && (
              <AgentEditorModalContent
                agent={
                  activeModal.agentId ? agents.find((a) => a.id === activeModal.agentId) : null
                }
                onSave={handleSaveAgent}
                onAskDelete={(agentId) => setActiveModal({ type: "delete-agent-confirm", agentId })}
                closeModal={() => setActiveModal(null)}
              />
            )}

            {/* CONFIRMAÇÃO DE EXCLUSÃO DE AGENTE */}
            {activeModal.type === "delete-agent-confirm" &&
              (() => {
                const agentToDelete = agents.find((a) => a.id === activeModal.agentId);
                return (
                  <>
                    <div className="mhead">
                      <div>
                        <h3>Excluir {agentToDelete?.name || "este agente"}?</h3>
                        <div className="sub">
                          as exceções registradas desse agente também serão removidas
                        </div>
                      </div>
                      <button className="btn sm ghost x" onClick={() => setActiveModal(null)}>
                        ✕
                      </button>
                    </div>
                    <div className="mfoot">
                      <span className="spacer" />
                      <button className="btn ghost" onClick={() => setActiveModal(null)}>
                        Cancelar
                      </button>
                      <button
                        className="btn danger"
                        onClick={() => handleConfirmDelete(activeModal.agentId)}
                      >
                        Sim, excluir
                      </button>
                    </div>
                  </>
                );
              })()}

            {/* CONFIRMAÇÃO DE LIMPEZA DE EXCEÇÕES */}
            {activeModal.type === "restore-confirm" && (
              <>
                <div className="mhead">
                  <div>
                    <h3>Limpar exceções registradas?</h3>
                    <div className="sub">
                      isso apagará todas as faltas, atestados e ajustes pontuais salvos na escala
                      teste
                    </div>
                  </div>
                  <button className="btn sm ghost x" onClick={() => setActiveModal(null)}>
                    ✕
                  </button>
                </div>
                <div className="mfoot">
                  <span className="spacer" />
                  <button className="btn ghost" onClick={() => setActiveModal(null)}>
                    Cancelar
                  </button>
                  <button
                    className="btn danger"
                    onClick={() => {
                      saveMeta({ ...meta, overrides: {}, dismissed: {} });
                      setSim(null);
                      setActiveModal(null);
                      setActiveDrawer(null);
                      triggerToast("Exceções limpas com sucesso.");
                    }}
                  >
                    Sim, limpar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ============================= TOASTS ============================= */}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type === "ok" ? "" : t.type}`}>
            <span>{t.msg}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action?.fn();
                  setToasts((prev) => prev.filter((item) => item.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ============================= TOOLTIP FLUTUANTE ============================= */}
      {tip && (
        <div
          className="ops-tip"
          style={{ left: tip.x + 14, top: tip.y + 16 }}
          dangerouslySetInnerHTML={{ __html: tip.html }}
        />
      )}
    </div>
  );
}

/* =========================================================================
   SUB-COMPONENTES: MODAIS E GAVETAS
   ========================================================================= */

function DayEditorModalContent({
  agentId,
  dateISO,
  agents,
  sim,
  getOverride,
  setOverride,
  closeModal,
  triggerToast,
  onSyncSchedule,
}: {
  agentId: string;
  dateISO: string;
  agents: Agent[];
  sim: { date: string; entries: Record<string, Override> } | null;
  getOverride: (date: string, id: string) => Override | null;
  setOverride: (date: string, id: string, ov: Override | null) => void;
  closeModal: () => void;
  triggerToast: (msg: string, type?: "ok" | "warn" | "err") => void;
  onSyncSchedule?: (
    agentId: string,
    day: Day,
    ov: Override | null,
    baseShift: [string, string],
    basePause?: [string, string] | null,
  ) => void;
}) {
  const agent = agents.find((a) => a.id === agentId);
  const ov = getOverride(dateISO, agentId);
  const inSim = sim && sim.date === dateISO;

  const wd = weekdayOf(dateISO);
  const dayName = WEEKDAY_TO_DAY[wd];
  const daySched = agent?.daySchedules?.[dayName];
  const worksBase = daySched ? daySched.works : (agent?.workdays.includes(wd) ?? false);
  const baseShift = daySched?.shift || agent?.shift || ["08:00", "17:00"];
  const basePause = daySched?.pause !== undefined ? daySched.pause : agent?.pause;

  const [sit, setSit] = useState<OverrideKind | "padrao">(() => {
    if (!ov) return "padrao";
    return ["falta", "atestado", "ferias"].includes(ov.kind)
      ? ov.kind
      : ov.kind === "extra"
        ? "extra"
        : "padrao";
  });

  const [shiftChoice, setShiftChoice] = useState<string>(() => {
    if (ov && ov.shift) {
      const match = SHIFT_PRESETS.find((p) => p[0] === ov.shift?.[0] && p[1] === ov.shift?.[1]);
      return match ? `${match[0]}|${match[1]}` : "custom";
    }
    return "padrao";
  });
  const [sc1, setSc1] = useState(ov?.shift ? ov.shift[0] : baseShift[0]);
  const [sc2, setSc2] = useState(ov?.shift ? ov.shift[1] : baseShift[1]);

  const [pauseChoice, setPauseChoice] = useState<string>(() => {
    if (ov && ov.pause !== undefined) {
      if (ov.pause === null) return "none";
      const match = PAUSE_PRESETS.find((p) => p[0] === ov.pause?.[0] && p[1] === ov.pause?.[1]);
      return match ? `${match[0]}|${match[1]}` : "custom";
    }
    return "padrao";
  });
  const [pc1, setPc1] = useState(ov?.pause ? ov.pause[0] : basePause?.[0] || "12:00");
  const [pc2, setPc2] = useState(ov?.pause ? ov.pause[1] : basePause?.[1] || "13:00");

  const [note, setNote] = useState(ov?.note || "");
  const [err, setErr] = useState("");

  if (!agent) return null;

  const isAbsent = ["falta", "atestado", "ferias"].includes(sit);

  const handleSave = () => {
    let shift: [string, string] | null = null;
    let pause: [string, string] | null | undefined = undefined;

    if (!isAbsent) {
      if (shiftChoice === "padrao") shift = null;
      else if (shiftChoice === "custom") shift = [sc1, sc2];
      else {
        const parts = shiftChoice.split("|");
        shift = [parts[0], parts[1]];
      }

      if (pauseChoice === "padrao") pause = undefined;
      else if (pauseChoice === "none") pause = null;
      else if (pauseChoice === "custom") pause = [pc1, pc2];
      else {
        const parts = pauseChoice.split("|");
        pause = [parts[0], parts[1]];
      }

      const sh = shift || baseShift;
      const pa = pause === undefined ? basePause : pause;
      const s = toMin(sh[0]);
      let e = toMin(sh[1]);
      if (e <= s) e += 1440;
      if (e - s < 60) {
        setErr("O turno deve durar pelo menos 1 hora.");
        return;
      }
      if (pa) {
        let ps = toMin(pa[0]);
        let pe = toMin(pa[1]);
        if (ps < s) ps += 1440;
        if (pe <= ps) pe += 1440;
        if (ps < s || pe > e) {
          setErr("A pausa deve ficar dentro do turno.");
          return;
        }
      }
    }

    let nextOv: Override | null = null;
    if (isAbsent) {
      nextOv = { kind: sit as OverrideKind, note: note.trim() };
    } else if (sit === "extra") {
      nextOv = { kind: "extra", shift, pause, note: note.trim() };
    } else if (shift || pause !== undefined) {
      nextOv = { kind: "ajuste", shift, pause, note: note.trim() };
    } else if (!worksBase && sit === "padrao") {
      nextOv = null;
    }

    if (nextOv && note.trim()) nextOv.note = note.trim();

    setOverride(dateISO, agentId, nextOv);
    if (!inSim && onSyncSchedule) {
      onSyncSchedule(agentId, dayName, nextOv, baseShift, basePause || null);
    }
    closeModal();
    triggerToast(
      inSim
        ? "Cenário adicionado à simulação."
        : nextOv
          ? `Exceção salva e sincronizada com a escala oficial (${dayName}).`
          : "Dia restaurado para a escala padrão.",
      inSim ? "warn" : "ok",
    );
  };

  return (
    <>
      <div className="mhead">
        <div>
          <h3>
            {agent.name} · {fmtDateShort(dateISO)}
          </h3>
          <div className="sub">
            {fmtDateLong(dateISO)}{" "}
            {inSim ? (
              <span style={{ color: "var(--info)" }}>· editando a SIMULAÇÃO</span>
            ) : (
              "· alteração vale só para este dia"
            )}
          </div>
        </div>
        <button className="btn sm ghost x" onClick={closeModal}>
          ✕
        </button>
      </div>

      <div className="mbody">
        <div className="info-strip">
          Escala configurada ({dayName}):{" "}
          <span className="mono">
            {worksBase
              ? `${baseShift[0]}–${baseShift[1]} · pausa ${basePause ? basePause[0] + "–" + basePause[1] : "sem"}`
              : `folga (${WD_MED[weekdayOf(dateISO)]})`}
          </span>
          {ov && !inSim && (
            <>
              <br />▲ Já existe exceção registrada neste dia.
            </>
          )}
        </div>

        <div className="field">
          <label>Situação neste dia</label>
          <div className="radios">
            {[
              ["padrao", worksBase ? "Padrão (trabalha)" : "Padrão (folga)"],
              ["falta", "Falta"],
              ["atestado", "Atestado"],
              ["ferias", "Férias"],
              ["extra", "Trabalhar (cobertura/extra)"],
            ].map(([val, label]) => (
              <label
                key={val}
                className={`${sit === val ? "on" : ""} ${["falta", "atestado"].includes(val) ? "danger" : ""}`}
                onClick={() => setSit(val as OverrideKind | "padrao")}
              >
                {label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ opacity: isAbsent ? 0.35 : 1, pointerEvents: isAbsent ? "none" : "auto" }}>
          <div className="frow">
            <div className="field">
              <label>Turno</label>
              <select value={shiftChoice} onChange={(e) => setShiftChoice(e.target.value)}>
                <option value="padrao">
                  Padrão da escala ({baseShift[0]}–{baseShift[1]})
                </option>
                {SHIFT_PRESETS.map((p) => (
                  <option key={`${p[0]}|${p[1]}`} value={`${p[0]}|${p[1]}`}>
                    {p[0]} – {p[1]}
                  </option>
                ))}
                <option value="custom">Personalizado…</option>
              </select>
              {shiftChoice === "custom" && (
                <div className="frow" style={{ marginTop: 8 }}>
                  <input type="time" value={sc1} onChange={(e) => setSc1(e.target.value)} />
                  <input type="time" value={sc2} onChange={(e) => setSc2(e.target.value)} />
                </div>
              )}
            </div>

            <div className="field">
              <label>Pausa</label>
              <select value={pauseChoice} onChange={(e) => setPauseChoice(e.target.value)}>
                <option value="padrao">
                  Padrão da escala ({basePause ? `${basePause[0]}–${basePause[1]}` : "sem"})
                </option>
                <option value="none">Sem pausa</option>
                {PAUSE_PRESETS.map((p) => (
                  <option key={`${p[0]}|${p[1]}`} value={`${p[0]}|${p[1]}`}>
                    {p[0]} – {p[1]}
                  </option>
                ))}
                <option value="custom">Personalizado…</option>
              </select>
              {pauseChoice === "custom" && (
                <div className="frow" style={{ marginTop: 8 }}>
                  <input type="time" value={pc1} onChange={(e) => setPc1(e.target.value)} />
                  <input type="time" value={pc2} onChange={(e) => setPc2(e.target.value)} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="field">
          <label>Observação (opcional)</label>
          <input
            type="text"
            maxLength={120}
            placeholder="ex.: troca de turno autorizada"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {err && <div className="err">{err}</div>}
      </div>

      <div className="mfoot">
        {ov && (
          <button
            className="btn danger sm"
            onClick={() => {
              setOverride(dateISO, agentId, null);
              if (!inSim && onSyncSchedule) {
                onSyncSchedule(agentId, dayName, null, baseShift, basePause || null);
              }
              closeModal();
              triggerToast("Exceção removida — dia volta à escala padrão e sincronizado.", "warn");
            }}
          >
            Remover exceção
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" onClick={closeModal}>
          Cancelar
        </button>
        <button className="btn acc" onClick={handleSave}>
          Salvar
        </button>
      </div>
    </>
  );
}

function SimulationDrawerContent({
  cursor,
  sim,
  agents,
  setSim,
  closeDrawer,
  triggerToast,
  saveMeta,
  overrides,
}: {
  cursor: string;
  sim: { date: string; entries: Record<string, Override> } | null;
  agents: Agent[];
  setSim: React.Dispatch<
    React.SetStateAction<{ date: string; entries: Record<string, Override> } | null>
  >;
  closeDrawer: () => void;
  triggerToast: (msg: string, type?: "ok" | "warn" | "err") => void;
  saveMeta: (overrides: Record<string, Record<string, Override>>) => void;
  overrides: Record<string, Record<string, Override>>;
}) {
  const activeSim = sim || { date: cursor, entries: {} };
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.id || "");
  const [scenarioAction, setScenarioAction] = useState("falta");
  const [shiftVal, setShiftVal] = useState(`${SHIFT_PRESETS[0][0]}|${SHIFT_PRESETS[0][1]}`);
  const [pauseVal, setPauseVal] = useState(`${PAUSE_PRESETS[0][0]}|${PAUSE_PRESETS[0][1]}`);

  const activeEntries = Object.entries(activeSim.entries);

  const handleAddScenario = () => {
    const id = selectedAgent;
    const cur = activeSim.entries[id] || { kind: "ajuste" };
    const nextEntries = { ...activeSim.entries };

    if (scenarioAction === "reset") {
      delete nextEntries[id];
    } else if (scenarioAction === "falta") {
      nextEntries[id] = { kind: "falta" };
    } else if (scenarioAction === "extra") {
      nextEntries[id] = { kind: "extra", shift: cur.shift || null };
    } else if (scenarioAction === "shift") {
      const v = shiftVal.split("|") as [string, string];
      nextEntries[id] = {
        kind: cur.kind === "extra" ? "extra" : "ajuste",
        shift: v,
        pause: cur.pause,
      };
    } else if (scenarioAction === "pause") {
      const pause = pauseVal === "none" ? null : (pauseVal.split("|") as [string, string]);
      nextEntries[id] = {
        kind: cur.kind === "extra" ? "extra" : "ajuste",
        shift: cur.shift || null,
        pause,
      };
    }

    setSim({ date: cursor, entries: nextEntries });
    triggerToast("Simulação atualizada — confira a cobertura.", "warn");
  };

  const handleApply = () => {
    const d = activeSim.date;
    const nextOverrides = { ...overrides };
    if (!nextOverrides[d]) nextOverrides[d] = {};
    Object.assign(nextOverrides[d], activeSim.entries);
    saveMeta(nextOverrides);
    setSim(null);
    closeDrawer();
    triggerToast(`Simulação aplicada à escala de ${fmtDateShort(d)}.`);
  };

  const handleDiscard = () => {
    setSim(null);
    closeDrawer();
    triggerToast("Simulação descartada.", "warn");
  };

  return (
    <>
      <div className="dhead">
        <h3>⚡ Simulador “e se…”</h3>
        <button className="btn sm ghost x" style={{ marginLeft: "auto" }} onClick={closeDrawer}>
          ✕
        </button>
      </div>

      <div className="dbody">
        <div className="info-strip">
          Teste cenários para <b className="mono">{fmtDateShort(cursor)}</b> sem alterar a escala
          oficial. A cobertura é recalculada na hora (veja a linha tracejada no gráfico de
          cobertura).
        </div>

        <div className="field">
          <label>Operador</label>
          <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Cenário</label>
          <select value={scenarioAction} onChange={(e) => setScenarioAction(e.target.value)}>
            <option value="falta">Faltar neste dia</option>
            <option value="extra">Trabalhar neste dia (cobertura)</option>
            <option value="shift">Trocar o turno</option>
            <option value="pause">Mover a pausa</option>
            <option value="reset">Desfazer alteração desse operador</option>
          </select>
        </div>

        {scenarioAction === "shift" && (
          <div className="field">
            <label>Novo turno</label>
            <select value={shiftVal} onChange={(e) => setShiftVal(e.target.value)}>
              {SHIFT_PRESETS.map((p) => (
                <option key={`${p[0]}|${p[1]}`} value={`${p[0]}|${p[1]}`}>
                  {p[0]} – {p[1]}
                </option>
              ))}
            </select>
          </div>
        )}

        {scenarioAction === "pause" && (
          <div className="field">
            <label>Nova pausa</label>
            <select value={pauseVal} onChange={(e) => setPauseVal(e.target.value)}>
              <option value="none">Sem pausa</option>
              {PAUSE_PRESETS.map((p) => (
                <option key={`${p[0]}|${p[1]}`} value={`${p[0]}|${p[1]}`}>
                  {p[0]} – {p[1]}
                </option>
              ))}
            </select>
          </div>
        )}

        <button className="btn acc" onClick={handleAddScenario}>
          Adicionar à simulação
        </button>

        <div className="field" style={{ marginTop: 10 }}>
          <label>Cenários ativos ({activeEntries.length})</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {activeEntries.length > 0 ? (
              activeEntries.map(([id, ov]) => {
                const a = agents.find((x) => x.id === id);
                let desc = KIND_LABEL[ov.kind] || "";
                if (ov.kind === "extra") desc = "trabalha (extra)";
                if (ov.shift) desc += ` · turno ${ov.shift[0]}–${ov.shift[1]}`;
                if (ov.pause !== undefined)
                  desc += ov.pause ? ` · pausa ${ov.pause[0]}–${ov.pause[1]}` : " · sem pausa";

                return (
                  <div key={id} className="agent-row">
                    <span className="dot" style={{ background: a?.color || "#888" }} />
                    <div className="ainfo">
                      <b>{a?.name || "?"}</b>
                      <span>{desc}</span>
                    </div>
                    <button
                      className="btn sm ghost"
                      onClick={() => {
                        const nextEntries = { ...activeSim.entries };
                        delete nextEntries[id];
                        setSim({ date: cursor, entries: nextEntries });
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="empty-note">nenhum cenário ainda</div>
            )}
          </div>
        </div>

        <div className="frow" style={{ marginTop: 10 }}>
          <button
            className="btn acc"
            style={{ flex: 1 }}
            disabled={activeEntries.length === 0}
            onClick={handleApply}
          >
            Aplicar ao dia
          </button>
          <button
            className="btn danger"
            style={{ flex: 1 }}
            disabled={activeEntries.length === 0}
            onClick={handleDiscard}
          >
            Descartar tudo
          </button>
        </div>
      </div>
    </>
  );
}

/* =========================================================================
   SUBCOMPONENTE: Relógio Digital em Tempo Real (isolado para performance)
   ========================================================================= */
const RealtimeClock = React.memo(function RealtimeClock() {
  // null no primeiro render: o horário do servidor nunca bate com o do
  // cliente, e renderizar `new Date()` no SSR causa hydration mismatch.
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setTime(new Date());
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const hh = time ? String(time.getHours()).padStart(2, "0") : "--";
  const mm = time ? String(time.getMinutes()).padStart(2, "0") : "--";
  const ss = time ? String(time.getSeconds()).padStart(2, "0") : "--";

  return (
    <div className="clock">
      <span className="tick" />
      <span>{`${hh}:${mm}:${ss}`}</span>
    </div>
  );
});

/* =========================================================================
   GRÁFICO DE COBERTURA INTERATIVO (SVG)
   ========================================================================= */

function CoverageChart({
  dateISO,
  simMap,
  minCoverage,
  demandCurve,
  volumeCurve,
  getCoverage,
  getDayEntries,
  covClass,
  onHoverTip,
}: {
  dateISO: string;
  simMap: Record<string, Override> | null;
  minCoverage: number;
  demandCurve?: number[];
  volumeCurve?: number[];
  getCoverage: (date: string, simMap?: Record<string, Override> | null) => number[];
  getDayEntries: (date: string, simMap?: Record<string, Override> | null) => DayEntry[];
  covClass: (v: number, t: number, date: string) => string;
  onHoverTip: (tip: { html: string; x: number; y: number } | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [guideX, setGuideX] = useState<number | null>(null);

  const cov = useMemo(() => getCoverage(dateISO, simMap), [dateISO, simMap, getCoverage]);
  const covOff = useMemo(
    () => (simMap ? getCoverage(dateISO, null) : null),
    [dateISO, simMap, getCoverage],
  );

  const [, opE] = opWindow(dateISO);
  const W = 920;
  const padL = 34;
  const padB = 26;
  const padT = 12;
  const plotW = W - padL - 10;
  const plotH = 200;
  const ppm = plotW / TL_LEN;

  const maxV = Math.max(...cov, ...(covOff || [0]), minCoverage, ...(demandCurve || [0])) + 2;
  const y = (v: number) => padT + plotH - (v / maxV) * plotH;

  const runsOf = (arr: number[]) => {
    const r: { t0: number; t1: number; v: number }[] = [];
    let i = 0;
    while (i < arr.length) {
      let j = i;
      while (j < arr.length && arr[j] === arr[i]) j++;
      r.push({ t0: i, t1: j, v: arr[i] });
      i = j;
    }
    return r;
  };

  const runs = useMemo(() => runsOf(cov), [cov]);
  const runsOff = useMemo(() => (covOff ? runsOf(covOff) : []), [covOff]);

  const demandRuns = useMemo(() => {
    if (!demandCurve || demandCurve.length === 0) return [];
    const r: { t0: number; t1: number; v: number }[] = [];
    let i = 0;
    while (i < demandCurve.length) {
      let j = i;
      while (j < demandCurve.length && demandCurve[j] === demandCurve[i]) j++;
      r.push({ t0: i, t1: j, v: demandCurve[i] });
      i = j;
    }
    return r;
  }, [demandCurve]);

  const fills: Record<string, string> = {
    ok: "rgba(76,197,126,.85)",
    edge: "rgba(232,193,90,.88)",
    low: "rgba(239,83,80,.88)",
    zero: "rgba(179,39,31,.95)",
    closed: "rgba(57,66,79,.7)",
  };

  const handleMouseMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const svgEl = ev.currentTarget;
    const rc = svgEl.getBoundingClientRect();
    const mx = ev.clientX - rc.left - padL;
    const t = Math.max(0, Math.min(TL_LEN - 1, Math.floor(mx / ppm)));
    setGuideX(padL + t * ppm);

    const es = getDayEntries(dateISO, simMap);
    const avail: string[] = [];
    const pau: string[] = [];
    const ext: string[] = [];
    for (const e of es) {
      if (!e.works || !e.span) continue;
      if (t >= e.span[0] && t < e.span[1]) {
        if (e.pauseSpan && t >= e.pauseSpan[0] && t < e.pauseSpan[1]) {
          pau.push(e.agent.name);
        } else if (e.externoSpans?.some((sp) => t >= sp[0] && t < sp[1])) {
          ext.push(e.agent.name);
        } else {
          avail.push(e.agent.name);
        }
      }
    }
    const v = cov[t];
    const dVal = demandCurve ? demandCurve[t] || 0 : 0;
    const volVal = volumeCurve ? volumeCurve[t] || 0 : 0;
    const diff = v - dVal;
    const cls = covClass(v, t, dateISO);
    const statusColor =
      cls === "ok"
        ? "var(--ok)"
        : cls === "edge"
          ? "var(--warn)"
          : cls === "closed"
            ? "var(--dim)"
            : "var(--bad)";

    const html = `<b>${fmtHM(TL0 + t)}</b> · <b style="color:${statusColor}">${v} disponível(is) no chat</b>${cls === "closed" ? ' <span class="mono">· fora do funcionamento</span>' : ""}<br>
      <span style="color:#38bdf8;font-weight:600">Demanda Real: ${dVal} analista(s) (${volVal.toFixed(1)} chamados/bloco)</span>
      · ${diff >= 0 ? `<b style="color:var(--ok)">+${diff} superávit</b>` : `<b style="color:var(--bad)">${diff} DÉFICIT REAL</b>`}<br>
      ${avail.length ? `<span class="mono">disponíveis (chat): ${avail.join(", ")}</span>` : ""}${pau.length ? `<br><span class="mono" style="color:var(--warn)">em pausa: ${pau.join(", ")}</span>` : ""}${ext.length ? `<br><span class="mono" style="color:#008AD4;font-weight:600">demanda externa: ${ext.join(", ")}</span>` : ""}`;

    onHoverTip({ html, x: ev.clientX, y: ev.clientY });
  };

  return (
    <div ref={containerRef}>
      <svg
        width={W}
        height={plotH + padT + padB}
        style={{ fontFamily: "IBM Plex Mono, monospace" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          setGuideX(null);
          onHoverTip(null);
        }}
      >
        {/* Linhas de grade horizontais e números Y */}
        {Array.from({ length: maxV + 1 }).map((_, v) => (
          <React.Fragment key={v}>
            <line x1={padL} y1={y(v)} x2={W - 10} y2={y(v)} stroke="var(--line2)" strokeWidth="1" />
            <text x={padL - 7} y={y(v) + 3.5} fill="var(--dim)" fontSize="10" textAnchor="end">
              {v}
            </text>
          </React.Fragment>
        ))}

        {/* Linha tracejada do oficial caso simulação ativa */}
        {runsOff.map((r, i) => {
          const xPos = padL + r.t0 * ppm;
          const w = (r.t1 - r.t0) * ppm;
          const h = y(0) - y(r.v);
          return (
            <rect
              key={i}
              x={xPos + 0.5}
              y={y(0) - h}
              width={Math.max(0.8, w - 1)}
              height={h}
              fill="none"
              stroke="var(--mut)"
              strokeDasharray="3 3"
              rx="1.5"
            />
          );
        })}

        {/* Barras de cobertura efetiva */}
        {runs.map((r, i) => {
          const xPos = padL + r.t0 * ppm;
          const w = (r.t1 - r.t0) * ppm;
          const h = y(0) - y(r.v);
          const cls = covClass(r.v, r.t0, dateISO);
          return (
            <rect
              key={i}
              x={xPos + 0.5}
              y={y(0) - h}
              width={Math.max(0.8, w - 1)}
              height={h}
              fill={fills[cls] || fills.ok}
              rx="1.5"
            />
          );
        })}

        {/* Curva de Demanda Real Dimensionada (Chamados / TMA Erlang) */}
        {demandRuns.map((r, i) => {
          const x0 = padL + r.t0 * ppm;
          const w = (r.t1 - r.t0) * ppm;
          const yVal = y(r.v);
          return (
            <React.Fragment key={`dem-${i}`}>
              <line
                x1={x0}
                y1={yVal}
                x2={x0 + w}
                y2={yVal}
                stroke="#38bdf8"
                strokeWidth="2.5"
                strokeDasharray={r.v === 0 ? "2 3" : undefined}
                opacity={r.v === 0 ? 0.35 : 1}
              />
              {i < demandRuns.length - 1 && (
                <line
                  x1={x0 + w}
                  y1={yVal}
                  x2={x0 + w}
                  y2={y(demandRuns[i + 1].v)}
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                  opacity={0.8}
                />
              )}
            </React.Fragment>
          );
        })}

        {/* Linha de cobertura mínima */}
        <line
          x1={padL}
          y1={y(minCoverage)}
          x2={W - 10}
          y2={y(minCoverage)}
          stroke="var(--warn)"
          strokeDasharray="6 4"
          strokeWidth="1.4"
        />
        <text x={W - 12} y={y(minCoverage) - 5} fill="var(--warn)" fontSize="10" textAnchor="end">
          mínimo {minCoverage}
        </text>

        {/* Linha de fechamento */}
        <line
          x1={padL + (opE - TL0) * ppm}
          y1={padT}
          x2={padL + (opE - TL0) * ppm}
          y2={y(0)}
          stroke="var(--dim)"
          strokeDasharray="2 4"
        />
        <text x={padL + (opE - TL0) * ppm + 4} y={padT + 9} fill="var(--dim)" fontSize="9.5">
          fecha {toHHMM(opE)}
        </text>

        {/* Meia-noite */}
        <line
          x1={padL + (1440 - TL0) * ppm}
          y1={padT}
          x2={padL + (1440 - TL0) * ppm}
          y2={y(0)}
          stroke="var(--now)"
          strokeDasharray="3 4"
        />

        {/* Eixo X com horários */}
        {Array.from({ length: 22 }).map((_, h) => {
          const raw = TL0 + h * 60;
          const xPos = padL + h * 60 * ppm;
          const isMid = raw === 1440;
          return (
            <text
              key={h}
              x={xPos + 3}
              y={plotH + padT + 16}
              fill={isMid ? "var(--now)" : "var(--dim)"}
              fontSize="10"
            >
              {toHHMM(raw)}
            </text>
          );
        })}

        {/* Guia vertical no hover */}
        {guideX !== null && (
          <line x1={guideX} y1={padT} x2={guideX} y2={y(0)} stroke="var(--text)" strokeWidth="1" />
        )}
      </svg>
    </div>
  );
}

/* =========================================================================
   SUBCOMPONENTE: Modal de Novo / Editar Agente (idêntico ao escala.html)
   ========================================================================= */
function AgentEditorModalContent({
  agent,
  onSave,
  onAskDelete,
  closeModal,
}: {
  agent?: Agent | null;
  onSave: (data: {
    id?: string;
    name: string;
    color: string;
    workdays: number[];
    shift: [string, string];
    pause: [string, string] | null;
  }) => void;
  onAskDelete: (agentId: string) => void;
  closeModal: () => void;
}) {
  const isNew = !agent;
  const [name, setName] = useState(agent?.name || "");
  const [color, setColor] = useState(agent?.color || PALETTE[0]);
  const [workdays, setWorkdays] = useState<number[]>(
    agent?.workdays && agent.workdays.length > 0 ? agent.workdays : [1, 2, 3, 4, 5],
  );

  // Turno: preset ou personalizado
  const initialShift = agent?.shift || ["07:00", "16:00"];
  const isShiftInPresets = SHIFT_PRESETS.some(
    (p) => p[0] === initialShift[0] && p[1] === initialShift[1],
  );
  const [shiftPreset, setShiftPreset] = useState<string>(
    isShiftInPresets ? `${initialShift[0]}|${initialShift[1]}` : "custom",
  );
  const [customShiftStart, setCustomShiftStart] = useState(initialShift[0]);
  const [customShiftEnd, setCustomShiftEnd] = useState(initialShift[1]);

  // Pausa: sem pausa, preset ou personalizado
  const initialPause = agent?.pause;
  const isPauseInPresets =
    initialPause && PAUSE_PRESETS.some((p) => p[0] === initialPause[0] && p[1] === initialPause[1]);
  const [pausePreset, setPausePreset] = useState<string>(
    !initialPause ? "none" : isPauseInPresets ? `${initialPause[0]}|${initialPause[1]}` : "custom",
  );
  const [customPauseStart, setCustomPauseStart] = useState(initialPause?.[0] || "12:00");
  const [customPauseEnd, setCustomPauseEnd] = useState(initialPause?.[1] || "13:00");

  const [error, setError] = useState<string | null>(null);

  const toggleDay = (dayNum: number) => {
    setWorkdays((prev) =>
      prev.includes(dayNum) ? prev.filter((d) => d !== dayNum) : [...prev, dayNum],
    );
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Informe um nome.");
      return;
    }
    if (workdays.length === 0) {
      setError("Selecione pelo menos um dia trabalhado.");
      return;
    }

    let finalShift: [string, string];
    if (shiftPreset === "custom") {
      finalShift = [customShiftStart || "08:00", customShiftEnd || "17:00"];
    } else {
      const [s, e] = shiftPreset.split("|");
      finalShift = [s, e];
    }

    let finalPause: [string, string] | null = null;
    if (pausePreset === "none") {
      finalPause = null;
    } else if (pausePreset === "custom") {
      finalPause = [customPauseStart || "12:00", customPauseEnd || "13:00"];
    } else {
      const [ps, pe] = pausePreset.split("|");
      finalPause = [ps, pe];
    }

    const validationErr = validateShiftAndPause(finalShift, finalPause);
    if (validationErr) {
      setError(validationErr);
      return;
    }

    onSave({
      id: agent?.id,
      name: trimmedName,
      color,
      workdays,
      shift: finalShift,
      pause: finalPause,
    });
  };

  return (
    <>
      <div className="mhead">
        <div>
          <h3>{isNew ? "Novo agente" : "Editar agente"}</h3>
          <div className="sub">
            {isNew ? "defina dias, turno, pausa e cor" : "alterações valem para a escala padrão"}
          </div>
        </div>
        <button className="btn sm ghost x" onClick={closeModal}>
          ✕
        </button>
      </div>

      <div className="mbody">
        <div className="field">
          <label>NOME</label>
          <input
            type="text"
            maxLength={40}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="Nome do agente"
            autoFocus
          />
        </div>

        <div className="field">
          <label>COR NA TIMELINE</label>
          <div className="swatches">
            {PALETTE.map((c) => (
              <span
                key={c}
                className={`sw ${c === color ? "on" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{
                width: 30,
                height: 27,
                padding: 1,
                borderRadius: 7,
                cursor: "pointer",
                border: "1px solid var(--line2)",
                background: "var(--panel2)",
              }}
              title="Cor personalizada"
            />
          </div>
        </div>

        <div className="field">
          <label>DIAS TRABALHADOS</label>
          <div className="daychips">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <button
                key={d}
                type="button"
                className={workdays.includes(d) ? "on" : ""}
                onClick={() => {
                  toggleDay(d);
                  setError(null);
                }}
              >
                {WD_MED[d]}
              </button>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 5 }}>
            os demais dias viram folga automaticamente
          </div>
        </div>

        <div className="frow">
          <div className="field">
            <label>TURNO</label>
            <select
              value={shiftPreset}
              onChange={(e) => {
                setShiftPreset(e.target.value);
                setError(null);
              }}
            >
              {SHIFT_PRESETS.map((p) => (
                <option key={`${p[0]}|${p[1]}`} value={`${p[0]}|${p[1]}`}>
                  {p[0]} – {p[1]}
                </option>
              ))}
              <option value="custom">Personalizado…</option>
            </select>
            {shiftPreset === "custom" && (
              <div className="frow" style={{ marginTop: 8 }}>
                <input
                  type="time"
                  value={customShiftStart}
                  onChange={(e) => setCustomShiftStart(e.target.value)}
                />
                <input
                  type="time"
                  value={customShiftEnd}
                  onChange={(e) => setCustomShiftEnd(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="field">
            <label>PAUSA (1H)</label>
            <select
              value={pausePreset}
              onChange={(e) => {
                setPausePreset(e.target.value);
                setError(null);
              }}
            >
              <option value="none">Sem pausa</option>
              {PAUSE_PRESETS.map((p) => (
                <option key={`${p[0]}|${p[1]}`} value={`${p[0]}|${p[1]}`}>
                  {p[0]} – {p[1]}
                </option>
              ))}
              <option value="custom">Personalizado…</option>
            </select>
            {pausePreset === "custom" && (
              <div className="frow" style={{ marginTop: 8 }}>
                <input
                  type="time"
                  value={customPauseStart}
                  onChange={(e) => setCustomPauseStart(e.target.value)}
                />
                <input
                  type="time"
                  value={customPauseEnd}
                  onChange={(e) => setCustomPauseEnd(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="err" style={{ display: "block" }}>
            {error}
          </div>
        )}
      </div>

      <div className="mfoot">
        {!isNew && (
          <button className="btn danger sm" type="button" onClick={() => onAskDelete(agent.id)}>
            Excluir agente
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" type="button" onClick={closeModal}>
          Cancelar
        </button>
        <button className="btn acc" type="button" onClick={handleSave}>
          Salvar agente
        </button>
      </div>
    </>
  );
}
