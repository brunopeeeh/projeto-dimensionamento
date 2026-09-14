import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as XLSX from "xlsx";
import type { Day } from "@/context/types";
import { DAYS } from "@/context/types";
import { generateOperatingTimeBlocks } from "@/lib/operating-hours";
import { matchAgentName } from "@/lib/agents";

const execFileAsync = promisify(execFile);

const HUBSPOT_API = "https://api.hubapi.com";
const PIPELINE_ID = "750895268"; // CXM - Atendimento
const SUPPORT_TEAM_ID = "7684604";
const SEARCH_PAGE_LIMIT = 100;
const SEARCH_MAX_TOTAL = 10000;
const SEARCH_THROTTLE_MS = 260; // ~4 req/s

export const DEFAULT_OWNER_NAMES = [
  "Maria Luiza Sarmento Murilo",
  "Andre Viana dos Santos Teixeira",
  "Julio Oliveira Monteiro",
  "Lucas Duarte",
  "Sabrina Pires",
  "Lucas Metskes Lascasas",
  "Rafael Marques dos Santos",
  "Guilherme Guimarães Vieira",
  "Jhorran Botoni Alves",
  "Igor Viturino de Oliveira Xavier",
  "Bruno Oliveira do Nascimento",
  "Sofia Luany",
  "Bryan Ladislau",
  "Brenda Patricio",
  "Isaias Neves de Souza Oliveira",
  "Yago Santos da Rosa",
  "Maya da Yooga",
  "Caio Fernandes",
  "Estevão Bastos Corrêa",
  "Eloah Andrade",
  "Leandro Vieira",
  "Yooga Tecnologia",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

export type HubspotTicketSearchItem = {
  id: string;
  properties?: {
    hubspot_owner_assigneddate?: string;
    closed_date?: string;
    hubspot_owner_id?: string;
  };
};

export type ExportedVolumeFileInfo = {
  fileName: string;
  startDate: string;
  endDate: string;
  label: string;
  type: "xlsx" | "csv" | "chamados";
  sizeBytes: number;
};

export type HubspotVolumeResult = {
  success: boolean;
  startDate: string;
  endDate: string;
  weeks: number;
  totalTickets: number;
  volumes: Record<string, Record<Day, number>>;
  source?: "export_xlsx" | "export_csv" | "chamados_csv" | "python_script" | "hubspot_api";
  fileName?: string;
  error?: string;
};

function formatDateBr(ymd: string): string {
  const parts = ymd.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return ymd;
}

/**
 * Converte timestamp (ms ou ISO) para chave de horário "HH:MM" (arredondado para baixo em 10min)
 * e dia da semana ("Segunda".."Domingo") no fuso de Brasília (America/Sao_Paulo).
 */
export function bucketTimestampToSaoPaulo(
  timestamp: number | string,
): { time: string; day: Day } | null {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return null;

  // Usa formatToParts no fuso America/Sao_Paulo
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });

  const parts = dtf.formatToParts(date);
  let hour = "";
  let minute = "";
  let weekday = "";

  for (const p of parts) {
    if (p.type === "hour") hour = p.value;
    if (p.type === "minute") minute = p.value;
    if (p.type === "weekday") weekday = p.value;
  }

  if (!hour || !minute || !weekday) return null;

  const mNum = parseInt(minute, 10);
  const flooredMin = Math.floor(mNum / 10) * 10;
  const timeKey = `${hour.padStart(2, "0")}:${String(flooredMin).padStart(2, "0")}`;

  const weekdayMap: Record<string, Day> = {
    Mon: "Segunda",
    Tue: "Terça",
    Wed: "Quarta",
    Thu: "Quinta",
    Fri: "Sexta",
    Sat: "Sábado",
    Sun: "Domingo",
  };

  const day = weekdayMap[weekday];
  if (!day) return null;

  return { time: timeKey, day };
}

/**
 * Agrupa lista de tickets por faixa de 10 minutos e dia da semana,
 * inicializando todas as faixas operacionais e dividindo pelo número de semanas.
 */
export function aggregateTicketsToVolumes(
  tickets: HubspotTicketSearchItem[],
  divisor: number,
  dateField: "closed_date" | "hubspot_owner_assigneddate" = "hubspot_owner_assigneddate",
): { volumes: Record<string, Record<Day, number>>; totalTickets: number } {
  const operatingBlocks = generateOperatingTimeBlocks(10);
  const volumes: Record<string, Record<Day, number>> = {};

  // Inicializa todas as faixas padrão com 0
  for (const block of operatingBlocks) {
    volumes[block] = {} as Record<Day, number>;
    for (const day of DAYS) {
      volumes[block][day] = 0;
    }
  }

  let totalTickets = 0;

  for (const ticket of tickets) {
    const rawDate = ticket.properties?.[dateField] || ticket.properties?.hubspot_owner_assigneddate;
    if (!rawDate) continue;

    const bucket = bucketTimestampToSaoPaulo(rawDate);
    if (!bucket) continue;

    const { time, day } = bucket;

    if (!volumes[time]) {
      volumes[time] = {} as Record<Day, number>;
      for (const d of DAYS) {
        volumes[time][d] = 0;
      }
    }

    volumes[time][day] = (volumes[time][day] || 0) + 1;
    totalTickets++;
  }

  // Divide pelo divisor (semanas) para obter a média semanal
  const safeDivisor = Math.max(1, divisor);
  for (const time of Object.keys(volumes)) {
    for (const day of DAYS) {
      const count = volumes[time][day] || 0;
      volumes[time][day] = Number((count / safeDivisor).toFixed(4));
    }
  }

  return { volumes, totalTickets };
}

/**
 * Lista relatórios oficiais e arquivos de chamados disponíveis na pasta storage/exports/.
 */
export function listExportedVolumes(): ExportedVolumeFileInfo[] {
  const exportsDir = path.join(process.cwd(), "storage", "exports");
  if (!fs.existsSync(exportsDir)) return [];

  const files = fs.readdirSync(exportsDir);
  const result: ExportedVolumeFileInfo[] = [];

  for (const file of files) {
    const fullPath = path.join(exportsDir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;

      // volume_10min_YYYY-MM-DD_a_YYYY-MM-DD.(xlsx|csv)
      const matchPivot = file.match(
        /^volume_10min_(\d{4}-\d{2}-\d{2})_a_(\d{4}-\d{2}-\d{2})\.(xlsx|csv)$/i,
      );
      if (matchPivot) {
        const [, startDate, endDate, ext] = matchPivot;
        result.push({
          fileName: file,
          startDate,
          endDate,
          label: `Volume 10min Databricks (${formatDateBr(startDate)} a ${formatDateBr(endDate)})`,
          type: ext.toLowerCase() as "xlsx" | "csv",
          sizeBytes: stat.size,
        });
        continue;
      }

      // volume_10min_consolidado_YYYY-MM-DD_a_YYYY-MM-DD.xlsx
      const matchConsolidado = file.match(
        /^volume_10min_consolidado_(\d{4}-\d{2}-\d{2})_a_(\d{4}-\d{2}-\d{2})\.xlsx$/i,
      );
      if (matchConsolidado) {
        const [, startDate, endDate] = matchConsolidado;
        result.push({
          fileName: file,
          startDate,
          endDate,
          label: `Consolidado Freshchat + HD (${formatDateBr(startDate)} a ${formatDateBr(endDate)})`,
          type: "xlsx",
          sizeBytes: stat.size,
        });
        continue;
      }

      // chamados_YYYY-MM-DD_a_YYYY-MM-DD.csv
      const matchChamados = file.match(
        /^chamados_(\d{4}-\d{2}-\d{2})_a_(\d{4}-\d{2}-\d{2})\.csv$/i,
      );
      if (matchChamados) {
        const [, startDate, endDate] = matchChamados;
        result.push({
          fileName: file,
          startDate,
          endDate,
          label: `Ciclos de Chamados Brutos (${formatDateBr(startDate)} a ${formatDateBr(endDate)})`,
          type: "chamados",
          sizeBytes: stat.size,
        });
      }
    } catch {
      // ignore individual file error
    }
  }

  // Ordena pelas datas mais recentes
  return result.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

/**
 * Lê diretamente uma matriz de volume 10min (xlsx ou csv) de storage/exports/,
 * calcula a média dividida pelo divisor de semanas e formata para o formato TimeGrid.
 */
export function loadVolumeFromPivotFile(
  filePath: string,
  divisor: number,
): { volumes: Record<string, Record<Day, number>>; totalTickets: number } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  const wb = XLSX.readFile(filePath);
  // Prioriza aba "Helpdesk (HubSpot)", depois "Sheet1" ou primeira aba
  const sheetName =
    wb.SheetNames.find((s) => s.toLowerCase().includes("helpdesk")) ||
    wb.SheetNames.find((s) => s.toLowerCase() === "sheet1") ||
    wb.SheetNames[0];

  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Planilha vazia ou sem abas legíveis: ${filePath}`);
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  if (rows.length === 0) {
    throw new Error(`Nenhum dado encontrado no arquivo: ${filePath}`);
  }

  const dayMap: Record<string, Day> = {
    seg: "Segunda",
    segunda: "Segunda",
    ter: "Terça",
    terça: "Terça",
    terca: "Terça",
    qua: "Quarta",
    quarta: "Quarta",
    qui: "Quinta",
    quinta: "Quinta",
    sex: "Sexta",
    sexta: "Sexta",
    sáb: "Sábado",
    sab: "Sábado",
    sábado: "Sábado",
    sabado: "Sábado",
    dom: "Domingo",
    domingo: "Domingo",
  };

  const headerRow = rows[0] || [];
  const dayCols: { day: Day; index: number }[] = [];
  headerRow.forEach((col, idx) => {
    if (col === null || col === undefined) return;
    const clean = String(col).trim().toLowerCase();
    if (dayMap[clean]) {
      dayCols.push({ day: dayMap[clean], index: idx });
    }
  });

  if (dayCols.length === 0) {
    throw new Error("Colunas dos dias da semana (seg, ter...) não foram encontradas no cabeçalho.");
  }

  const operatingBlocks = generateOperatingTimeBlocks(10);
  const volumes: Record<string, Record<Day, number>> = {};
  for (const block of operatingBlocks) {
    volumes[block] = {} as Record<Day, number>;
    for (const d of DAYS) {
      volumes[block][d] = 0;
    }
  }

  const safeDivisor = Math.max(1, divisor);
  let totalSum = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const rawTime = row[0];
    if (rawTime === null || rawTime === undefined) continue;

    const rawTimeStr = String(rawTime).trim();
    if (rawTimeStr.toLowerCase() === "total") continue;

    let timeKey = "";
    if (typeof rawTime === "number") {
      const totalMinutes = Math.round(rawTime * 24 * 60);
      const hh = Math.floor(totalMinutes / 60) % 24;
      const mm = totalMinutes % 60;
      timeKey = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    } else {
      const match = rawTimeStr.match(/^(\d{1,2}):(\d{2})/);
      if (match) {
        timeKey = `${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}`;
      }
    }

    if (!timeKey) continue;

    if (!volumes[timeKey]) {
      volumes[timeKey] = {} as Record<Day, number>;
      for (const d of DAYS) {
        volumes[timeKey][d] = 0;
      }
    }

    for (const { day, index } of dayCols) {
      const cellVal = row[index];
      const rawCount =
        typeof cellVal === "number"
          ? cellVal
          : Number(String(cellVal || 0).replace(",", ".")) || 0;
      totalSum += rawCount;
      volumes[timeKey][day] = Number((rawCount / safeDivisor).toFixed(4));
    }
  }

  return { volumes, totalTickets: totalSum };
}

/**
 * Lê chamados brutos em CSV (storage/exports/chamados_*.csv) agrupando por data de fechamento (padrão Databricks).
 */
export function loadVolumeFromChamadosCsv(
  filePath: string,
  divisor: number,
  column = "fechado_em",
): { volumes: Record<string, Record<Day, number>>; totalTickets: number } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/);
  if (lines.length <= 1) {
    return { volumes: {}, totalTickets: 0 };
  }

  const header = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
  let dateColIdx = header.indexOf(column);
  if (dateColIdx === -1) {
    dateColIdx = header.indexOf("fechado_em");
  }
  if (dateColIdx === -1) {
    dateColIdx = header.indexOf("aberto_em");
  }
  if (dateColIdx === -1) {
    throw new Error(`Coluna de data (${column}) não encontrada no CSV de chamados.`);
  }

  const operatingBlocks = generateOperatingTimeBlocks(10);
  const volumes: Record<string, Record<Day, number>> = {};
  for (const block of operatingBlocks) {
    volumes[block] = {} as Record<Day, number>;
    for (const d of DAYS) {
      volumes[block][d] = 0;
    }
  }

  let totalTickets = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(",");
    const dateVal = parts[dateColIdx]?.trim().replace(/^["']|["']$/g, "");
    if (!dateVal) continue;

    const bucket = bucketTimestampToSaoPaulo(dateVal);
    if (!bucket) continue;

    const { time, day } = bucket;
    if (!volumes[time]) {
      volumes[time] = {} as Record<Day, number>;
      for (const d of DAYS) volumes[time][d] = 0;
    }

    volumes[time][day] = (volumes[time][day] || 0) + 1;
    totalTickets++;
  }

  const safeDivisor = Math.max(1, divisor);
  for (const time of Object.keys(volumes)) {
    for (const d of DAYS) {
      volumes[time][d] = Number(((volumes[time][d] || 0) / safeDivisor).toFixed(4));
    }
  }

  return { volumes, totalTickets };
}

/**
 * Executa o script oficial volume_10min.py no ambiente local para extrair com total fidelidade ao Databricks.
 */
export async function runPythonVolumeExtraction(
  startDate: string,
  endDate: string,
  criterio = "fechamento",
): Promise<string> {
  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  const scriptPath = path.resolve(process.cwd(), "volume_10min.py");

  const { stdout, stderr } = await execFileAsync(
    pythonCmd,
    [scriptPath, "--inicio", startDate, "--fim", endDate, "--criterio", criterio],
    { cwd: process.cwd(), timeout: 240000 },
  );

  const xlsxPath = path.join(
    process.cwd(),
    "storage",
    "exports",
    `volume_10min_${startDate}_a_${endDate}.xlsx`,
  );
  const csvPath = path.join(
    process.cwd(),
    "storage",
    "exports",
    `volume_10min_${startDate}_a_${endDate}.csv`,
  );

  if (fs.existsSync(xlsxPath)) return xlsxPath;
  if (fs.existsSync(csvPath)) return csvPath;

  throw new Error(`Falha ao gerar relatório via Python. Stdout: ${stdout} | Stderr: ${stderr}`);
}

/**
 * Busca proprietários de suporte (ativos e arquivados) para incluir analistas históricos.
 */
async function getTargetOwnerIds(token: string): Promise<string[]> {
  const ownerIds = new Set<string>();

  for (const archived of [false, true]) {
    let after: string | undefined = undefined;
    while (true) {
      const url = new URL(`${HUBSPOT_API}/crm/v3/owners`);
      url.searchParams.set("limit", "100");
      url.searchParams.set("archived", String(archived));
      if (after) url.searchParams.set("after", after);

      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch(url.toString(), { headers: authHeaders(token) });
        if (res.status === 429) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        break;
      }

      if (!res || !res.ok) {
        console.warn(`[hubspot-volume] Falha ao listar owners (archived=${archived})`);
        break;
      }

      const data = (await res.json()) as {
        results?: Array<{
          id: string;
          firstName?: string;
          lastName?: string;
          teams?: Array<{ id: string | number }>;
        }>;
        paging?: { next?: { after?: string } };
      };

      for (const o of data.results || []) {
        const fullName = `${o.firstName || ""} ${o.lastName || ""}`.trim();
        const isInSupportTeam =
          Array.isArray(o.teams) && o.teams.some((team) => String(team.id) === SUPPORT_TEAM_ID);
        const matchesKnownName = DEFAULT_OWNER_NAMES.some((n) => matchAgentName(n, fullName));

        if (isInSupportTeam || matchesKnownName) {
          ownerIds.add(o.id);
        }
      }

      if (data.paging?.next?.after) {
        after = data.paging.next.after;
      } else {
        break;
      }
    }
  }

  return Array.from(ownerIds);
}

/**
 * Busca recursivamente tickets na Search API do HubSpot.
 */
async function searchTicketsRecursive(
  token: string,
  startMs: number,
  endMs: number,
  ownerIds: string[],
): Promise<HubspotTicketSearchItem[]> {
  const allTickets: HubspotTicketSearchItem[] = [];
  let after: string | undefined = undefined;
  let _page = 1;

  while (true) {
    const payload: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            { propertyName: "hs_pipeline", operator: "EQ", value: PIPELINE_ID },
            {
              propertyName: "closed_date",
              operator: "GTE",
              value: startMs,
            },
            {
              propertyName: "closed_date",
              operator: "LTE",
              value: endMs,
            },
            {
              propertyName: "hubspot_owner_id",
              operator: "IN",
              values: ownerIds,
            },
          ],
        },
      ],
      properties: ["closed_date", "hubspot_owner_assigneddate", "hubspot_owner_id"],
      limit: SEARCH_PAGE_LIMIT,
      sorts: [
        {
          propertyName: "closed_date",
          direction: "DESCENDING",
        },
      ],
    };

    if (after) {
      payload.after = after;
    }

    await sleep(SEARCH_THROTTLE_MS);

    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(`${HUBSPOT_API}/crm/v3/objects/tickets/search`, {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify(payload),
        });

        if (res.status === 429) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        break;
      } catch (err) {
        console.warn(`[hubspot-volume] Tentativa ${attempt + 1} falhou:`, err);
        await sleep(1000 * (attempt + 1));
      }
    }

    if (!res || !res.ok) {
      const errText = res ? await res.text() : "Sem resposta";
      console.error(`[hubspot-volume] tickets/search error ${res?.status}: ${errText}`);
      throw new Error(`Erro na Search API do HubSpot: ${res?.status ?? "conexão"}`);
    }

    const data = (await res.json()) as {
      total: number;
      results?: HubspotTicketSearchItem[];
      paging?: { next?: { after?: string } };
    };

    const results = data.results || [];
    allTickets.push(...results);

    const totalApi = data.total || 0;

    if (totalApi > SEARCH_MAX_TOTAL && allTickets.length >= SEARCH_MAX_TOTAL) {
      const midMs = Math.floor(startMs + (endMs - startMs) / 2);
      const firstHalf = await searchTicketsRecursive(token, startMs, midMs, ownerIds);
      const secondHalf = await searchTicketsRecursive(token, midMs + 1, endMs, ownerIds);
      return firstHalf.concat(secondHalf);
    }

    if (data.paging?.next?.after) {
      after = data.paging.next.after;
      _page++;
    } else {
      break;
    }
  }

  return allTickets;
}

/**
 * Ponto de entrada do serviço para buscar o volume de chamados por faixa de 10 minutos.
 * Dá prioridade total aos arquivos oficiais gerados em storage/exports/.
 */
export async function getHubspot10MinVolume(options: {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  divisor?: number;
  fileName?: string;
  forceApi?: boolean;
}): Promise<HubspotVolumeResult> {
  const exportsDir = path.join(process.cwd(), "storage", "exports");

  const startIso = `${options.startDate}T00:00:00-03:00`;
  const endIso = `${options.endDate}T23:59:59-03:00`;
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();

  if (isNaN(startMs) || isNaN(endMs) || startMs > endMs) {
    return {
      success: false,
      startDate: options.startDate,
      endDate: options.endDate,
      weeks: options.divisor || 13,
      totalTickets: 0,
      volumes: {},
      error: "Intervalo de datas inválido.",
    };
  }

  const diffDays = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)));
  const weeks =
    options.divisor && options.divisor > 0
      ? options.divisor
      : Math.max(1, Number((diffDays / 7).toFixed(1)));

  // 1. Se um arquivo específico foi requisitado
  if (options.fileName) {
    const specifiedPath = path.join(exportsDir, path.basename(options.fileName));
    if (fs.existsSync(specifiedPath)) {
      if (options.fileName.endsWith(".xlsx") || options.fileName.startsWith("volume_10min_")) {
        const { volumes, totalTickets } = loadVolumeFromPivotFile(specifiedPath, weeks);
        return {
          success: true,
          startDate: options.startDate,
          endDate: options.endDate,
          weeks,
          totalTickets,
          volumes,
          source: options.fileName.endsWith(".xlsx") ? "export_xlsx" : "export_csv",
          fileName: options.fileName,
        };
      } else if (options.fileName.startsWith("chamados_")) {
        const { volumes, totalTickets } = loadVolumeFromChamadosCsv(specifiedPath, weeks);
        return {
          success: true,
          startDate: options.startDate,
          endDate: options.endDate,
          weeks,
          totalTickets,
          volumes,
          source: "chamados_csv",
          fileName: options.fileName,
        };
      }
    }
  }

  // 2. Se não forçado pela API, checa se volume_10min_{start}_a_{end}.xlsx ou .csv já existe
  if (!options.forceApi) {
    const pivotXlsx = path.join(
      exportsDir,
      `volume_10min_${options.startDate}_a_${options.endDate}.xlsx`,
    );
    const pivotCsv = path.join(
      exportsDir,
      `volume_10min_${options.startDate}_a_${options.endDate}.csv`,
    );

    if (fs.existsSync(pivotXlsx)) {
      const { volumes, totalTickets } = loadVolumeFromPivotFile(pivotXlsx, weeks);
      return {
        success: true,
        startDate: options.startDate,
        endDate: options.endDate,
        weeks,
        totalTickets,
        volumes,
        source: "export_xlsx",
        fileName: path.basename(pivotXlsx),
      };
    }

    if (fs.existsSync(pivotCsv)) {
      const { volumes, totalTickets } = loadVolumeFromPivotFile(pivotCsv, weeks);
      return {
        success: true,
        startDate: options.startDate,
        endDate: options.endDate,
        weeks,
        totalTickets,
        volumes,
        source: "export_csv",
        fileName: path.basename(pivotCsv),
      };
    }

    // Checa se chamados_{start}_a_{end}.csv existe
    const chamadosCsv = path.join(
      exportsDir,
      `chamados_${options.startDate}_a_${options.endDate}.csv`,
    );
    if (fs.existsSync(chamadosCsv)) {
      const { volumes, totalTickets } = loadVolumeFromChamadosCsv(chamadosCsv, weeks);
      return {
        success: true,
        startDate: options.startDate,
        endDate: options.endDate,
        weeks,
        totalTickets,
        volumes,
        source: "chamados_csv",
        fileName: path.basename(chamadosCsv),
      };
    }
  }

  // 3. Tenta gerar via script Python oficial (volume_10min.py)
  try {
    const generatedPath = await runPythonVolumeExtraction(
      options.startDate,
      options.endDate,
      "fechamento",
    );
    const { volumes, totalTickets } = loadVolumeFromPivotFile(generatedPath, weeks);
    return {
      success: true,
      startDate: options.startDate,
      endDate: options.endDate,
      weeks,
      totalTickets,
      volumes,
      source: "python_script",
      fileName: path.basename(generatedPath),
    };
  } catch (pyErr) {
    console.warn(
      "[hubspot-volume] volume_10min.py não pôde ser executado diretamente, tentando fallback via API:",
      pyErr,
    );
  }

  // 4. Fallback: Search API do CRM com fechamento
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return {
      success: false,
      startDate: options.startDate,
      endDate: options.endDate,
      weeks,
      totalTickets: 0,
      volumes: {},
      error:
        "HUBSPOT_ACCESS_TOKEN não configurado no servidor (.env) e nenhum arquivo de exportação encontrado para o período.",
    };
  }

  try {
    const ownerIds = await getTargetOwnerIds(token);
    if (ownerIds.length === 0) {
      return {
        success: false,
        startDate: options.startDate,
        endDate: options.endDate,
        weeks,
        totalTickets: 0,
        volumes: {},
        error: "Nenhum proprietário do time de Suporte foi encontrado no HubSpot.",
      };
    }

    const tickets = await searchTicketsRecursive(token, startMs, endMs, ownerIds);
    const { volumes, totalTickets } = aggregateTicketsToVolumes(tickets, weeks, "closed_date");

    return {
      success: true,
      startDate: options.startDate,
      endDate: options.endDate,
      weeks,
      totalTickets,
      volumes,
      source: "hubspot_api",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido ao processar HubSpot.";
    console.error("[hubspot-volume] Erro:", err);
    return {
      success: false,
      startDate: options.startDate,
      endDate: options.endDate,
      weeks,
      totalTickets: 0,
      volumes: {},
      error: msg,
    };
  }
}
