import ExcelJS from "exceljs";
import { capacityPerAgent } from "@/lib/calculations";
import { isAiAgent, isSupportAgent } from "@/lib/agents";
import {
  FIXED_OVERNIGHT_AGENTS,
  hasFixedOvernightCoverage,
  isHelpdeskOpen,
} from "@/lib/operating-hours";
import { toBlock20, isTimeInShift, getLunchEndTime } from "@/lib/time";
import type { Day, TeamAgent, CapacityAgent, NewAgentHire } from "@/context/types";

export type ExportDimensionamentoData = {
  month: string;
  timeBlocks: string[];
  days: readonly Day[];
  helpdeskVolumes: Record<string, Record<Day, number>>;
  teamAgents: TeamAgent[];
  capacityAgents: CapacityAgent[];
  dynamicTmaFactors: Record<Day, number>;
  simultaneous: number;
  newHires: NewAgentHire[];
};

function excelRoundUp(val: number): number {
  if (val === 0) return 0;
  return val > 0 ? Math.ceil(val) : Math.floor(val);
}

const SECTION_STYLES = {
  volume: {
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE2E8F0" } },
    font: { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF1E293B" } },
  },
  capRaw: {
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE0F2FE" } },
    font: { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF0369A1" } },
  },
  capRounded: {
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFBAE6FD" } },
    font: { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF0284C7" } },
  },
  resultado: {
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFEF3C7" } },
    font: { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFB45309" } },
  },
  faltam10: {
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFEE2E2" } },
    font: { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFB91C1C" } },
  },
  time: {
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF1F5F9" } },
    font: { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF475569" } },
  },
  thinBorder: {
    top: { style: "thin" as const, color: { argb: "FFE2E8F0" } },
    left: { style: "thin" as const, color: { argb: "FFE2E8F0" } },
    bottom: { style: "thin" as const, color: { argb: "FFE2E8F0" } },
    right: { style: "thin" as const, color: { argb: "FFE2E8F0" } },
  },
};

/**
 * Monta o Workbook do Excel com 3 abas estruturadas e fórmulas nativas:
 * 1. Capacity (Analistas, médias e fórmulas de resolvidos)
 * 2. Helpdesk (Fila Única - Grid com 144 blocos e fórmulas de amarração)
 * 3. Prova Real (Simulado com novos contratados aplicados)
 */
export async function buildDimensionamentoWorkbook(
  data: ExportDimensionamentoData,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Yooga Dimensionamento";
  workbook.lastModifiedBy = "Yooga Dimensionamento";
  workbook.created = new Date();
  workbook.modified = new Date();

  // -------------------------------------------------------------
  // ABA 1: CAPACITY
  // -------------------------------------------------------------
  const wsCap = workbook.addWorksheet("Capacity", {
    views: [{ showGridLines: true }],
  });

  wsCap.columns = [
    { header: "Team Member", key: "name", width: 26 },
    { header: "Media/Tri", key: "mediaTri", width: 14 },
    { header: "Media/Mês", key: "mediaMes", width: 14 },
    { header: "Resolvidos/Dia", key: "resDia", width: 16 },
    { header: "Resolvidos/Hora", key: "resHora", width: 16 },
    { header: "Resolvidos/20Min", key: "res20", width: 16 },
    { header: "Resolvidos/10Min", key: "res10", width: 16 },
  ];

  // Header styling
  const capHeaderRow = wsCap.getRow(1);
  capHeaderRow.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  capHeaderRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" },
  };
  capHeaderRow.alignment = { vertical: "middle", horizontal: "center" };
  capHeaderRow.height = 26;

  // Insert Capacity Agents
  data.capacityAgents.forEach((agent, i) => {
    const r = i + 2;
    const mediaTri = Number(agent.mediaTri) || 0;
    const daysPerMonth = 20;
    const hoursPerDay = 8;
    const resolvedPerDay = mediaTri / 3 / daysPerMonth;
    const resolvedPerHour = resolvedPerDay / hoursPerDay;
    const row = wsCap.addRow({
      name: agent.name,
      mediaTri,
      mediaMes: { formula: `B${r}/3`, result: Math.round((mediaTri / 3) * 100) / 100 },
      resDia: { formula: `C${r}/${daysPerMonth}`, result: resolvedPerDay },
      resHora: {
        formula: `D${r}/${hoursPerDay}`,
        result: resolvedPerHour,
      },
      res20: {
        formula: `E${r}/3`,
        result: resolvedPerHour / 3,
      },
      res10: {
        formula: `E${r}/6`,
        result: resolvedPerHour / 6,
      },
    });

    row.font = { name: "Segoe UI", size: 9 };
    row.alignment = { vertical: "middle" };
    row.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    row.getCell(2).numFmt = "#,##0.00";
    row.getCell(3).numFmt = "#,##0.00";
    row.getCell(4).numFmt = "#,##0.0000";
    row.getCell(5).numFmt = "#,##0.00";
    row.getCell(6).numFmt = "#,##0.00";
    row.getCell(7).numFmt = "#,##0.00";

    for (let c = 1; c <= 7; c++) {
      row.getCell(c).border = SECTION_STYLES.thinBorder;
    }
  });

  // Tabela de Fator Dinâmico Diário
  const factorStartRow = data.capacityAgents.length + 4;
  wsCap.getCell(`A${factorStartRow}`).value = "Fator TMA Diário por Agente (10 min)";
  wsCap.getCell(`A${factorStartRow}`).font = {
    name: "Segoe UI",
    size: 10,
    bold: true,
    color: { argb: "FF0F172A" },
  };

  const factorHeaderRow = wsCap.getRow(factorStartRow + 1);
  factorHeaderRow.getCell(1).value = "Dia da Semana";
  factorHeaderRow.getCell(2).value = "Fator Unitário";
  factorHeaderRow.font = { name: "Segoe UI", size: 9, bold: true };
  factorHeaderRow.fill = SECTION_STYLES.capRaw.fill;

  data.days.forEach((day, dIdx) => {
    const r = factorStartRow + 2 + dIdx;
    const factorRow = wsCap.getRow(r);
    factorRow.getCell(1).value = day;
    factorRow.getCell(2).value = data.dynamicTmaFactors[day] ?? 1.5;
    factorRow.getCell(2).numFmt = "0.00";
    factorRow.font = { name: "Segoe UI", size: 9 };
    factorRow.getCell(1).border = SECTION_STYLES.thinBorder;
    factorRow.getCell(2).border = SECTION_STYLES.thinBorder;
  });

  // -------------------------------------------------------------
  // HELPER PARA MONTAR GRADE (HELPDESK E PROVA REAL)
  // -------------------------------------------------------------
  const populateGridSheet = (sheetName: string, includeNewHires: boolean) => {
    const ws = workbook.addWorksheet(sheetName, {
      views: [{ showGridLines: true, state: "frozen", ySplit: 1, xSplit: 1 }],
    });

    // O fator diário já contém o volume de Yooga Suporte. A grade
    // multiplica esse fator somente pelos humanos online na faixa da escala.
    const humanTeamAgents = data.teamAgents.filter(
      (agent) => !isAiAgent(agent.name) && !isSupportAgent(agent.name),
    );

    const headers: string[] = [
      "Hora",
      ...data.days.map((d) => `Volume - ${d}`),
      "", // Sep
      "Hora",
      ...data.days.map((d) => `Capacity - ${d}`),
      "", // Sep
      "Hora",
      ...data.days.map((d) => `Capacity Arredondado - ${d}`),
      "", // Sep
      "Hora",
      ...data.days.map((d) => `Resultado - ${d}`),
      "", // Sep
      "Hora",
      ...data.days.map((d) => `Agentes que Faltam - ${d}`),
    ];

    ws.addRow(headers);
    const headRow = ws.getRow(1);
    headRow.height = 28;

    // Apply specific styles to each block of columns
    // A: Hora (1)
    // B-H: Volume (2-8)
    // I: Empty (9)
    // J: Hora (10)
    // K-Q: Capacity (11-17)
    // R: Empty (18)
    // S: Hora (19)
    // T-Z: Cap Arredondado (20-26)
    // AA: Empty (27)
    // AB: Hora (28)
    // AC-AI: Resultado (29-35)
    // AJ: Empty (36)
    // AK: Hora (37)
    // AL-AR: Faltam 10 (38-44)

    const colWidths: Record<number, number> = {
      1: 10,
      9: 4,
      10: 10,
      18: 4,
      19: 10,
      27: 4,
      28: 10,
      36: 4,
      37: 10,
    };

    for (let c = 1; c <= headers.length; c++) {
      const cell = headRow.getCell(c);
      cell.border = SECTION_STYLES.thinBorder;
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };

      if ([1, 10, 19, 28, 37].includes(c)) {
        cell.fill = SECTION_STYLES.time.fill;
        cell.font = SECTION_STYLES.time.font;
      } else if (c >= 2 && c <= 8) {
        cell.fill = SECTION_STYLES.volume.fill;
        cell.font = SECTION_STYLES.volume.font;
      } else if (c >= 11 && c <= 17) {
        cell.fill = SECTION_STYLES.capRaw.fill;
        cell.font = SECTION_STYLES.capRaw.font;
      } else if (c >= 20 && c <= 26) {
        cell.fill = SECTION_STYLES.capRounded.fill;
        cell.font = SECTION_STYLES.capRounded.font;
      } else if (c >= 29 && c <= 35) {
        cell.fill = SECTION_STYLES.resultado.fill;
        cell.font = SECTION_STYLES.resultado.font;
      } else if (c >= 38 && c <= 44) {
        cell.fill = SECTION_STYLES.faltam10.fill;
        cell.font = SECTION_STYLES.faltam10.font;
      }

      ws.getColumn(c).width = colWidths[c] ?? 14;
    }

    const volColLetters = ["B", "C", "D", "E", "F", "G", "H"];
    const capColLetters = ["K", "L", "M", "N", "O", "P", "Q"];
    const capRColLetters = ["T", "U", "V", "W", "X", "Y", "Z"];
    const resColLetters = ["AC", "AD", "AE", "AF", "AG", "AH", "AI"];
    const faltamColLetters = ["AL", "AM", "AN", "AO", "AP", "AQ", "AR"];

    // Populate rows for the configured operating window.
    data.timeBlocks.forEach((time, tIdx) => {
      const r = tIdx + 2;
      const time20 = toBlock20(time);
      const rowVals: unknown[] = [];

      // Col 1: Hora
      rowVals[0] = time;

      // Cols 2-8: Volume
      data.days.forEach((day, dIdx) => {
        rowVals[1 + dIdx] = isHelpdeskOpen(day, time)
          ? Number(data.helpdeskVolumes[time]?.[day] ?? 0)
          : 0;
      });

      // Col 9: Empty
      rowVals[8] = "";

      // Col 10: Hora
      rowVals[9] = time;

      // Cols 11-17: Capacity Bruto
      const agentsByDay: number[] = [];
      data.days.forEach((day, dIdx) => {
        if (!isHelpdeskOpen(day, time)) {
          agentsByDay[dIdx] = 0;
          rowVals[10 + dIdx] = 0;
          return;
        }

        const perAgent = capacityPerAgent(data.dynamicTmaFactors[day] ?? 1.5, data.simultaneous);

        // Active scheduled team agents
        let agentsCount = humanTeamAgents.reduce((cnt, agent) => {
          if (agent.active && agent.schedules[day]) {
            const st = agent.schedules[day]!.intervals[time20] || "folga";
            if (st === "trabalhando") return cnt + 1;
          }
          return cnt;
        }, 0);

        // Include new hires if in Prova Real
        if (includeNewHires) {
          const hiresCount = data.newHires.reduce((cnt, hire) => {
            if (hire.active) {
              if (hire.schedules && hire.schedules[day]) {
                const st = hire.schedules[day]!.intervals[time20] || "folga";
                if (st === "trabalhando") return cnt + 1;
                return cnt;
              }
              if (hire.days.includes(day)) {
                const inShift = isTimeInShift(time, hire.start_time, hire.end_time);
                const inLunch =
                  hire.lunch_start_time &&
                  isTimeInShift(
                    time,
                    hire.lunch_start_time,
                    getLunchEndTime(hire.lunch_start_time),
                  );
                if (inShift && !inLunch) return cnt + 1;
              }
            }
            return cnt;
          }, 0);
          agentsCount += hiresCount;
        }

        const capRaw = Math.round(agentsCount * perAgent * 10000) / 10000;
        agentsByDay[dIdx] = agentsCount;
        rowVals[10 + dIdx] = capRaw;
      });

      // Col 18: Empty
      rowVals[17] = "";

      // Col 19: Hora
      rowVals[18] = time;

      // Cols 20-26: Capacity Arredondado com FÓRMULA =ROUNDUP(Col_Cap, 0)
      data.days.forEach((_, dIdx) => {
        const targetLetter = capColLetters[dIdx];
        const capVal = Number(rowVals[10 + dIdx]) || 0;
        rowVals[19 + dIdx] = {
          formula: `ROUNDUP(${targetLetter}${r},0)`,
          result: Math.ceil(capVal),
        };
      });

      // Col 27: Empty
      rowVals[26] = "";

      // Col 28: Hora
      rowVals[27] = time;

      // Cols 29-35: Resultado = capacidade total arredondada - volume bruto.
      data.days.forEach((_, dIdx) => {
        const capRLetter = capRColLetters[dIdx];
        const volLetter = volColLetters[dIdx];
        const capVal = Math.ceil(Number(rowVals[10 + dIdx]) || 0);
        const volVal = Number(rowVals[1 + dIdx]) || 0;
        rowVals[28 + dIdx] = {
          formula: `${capRLetter}${r}-${volLetter}${r}`,
          result: Math.round((capVal - volVal) * 100) / 100,
        };
      });

      // Col 36: Empty
      rowVals[35] = "";

      // Col 37: Hora
      rowVals[36] = time;

      // Cols 38-44: Faltam com FÓRMULA =ROUNDUP(Resultado / -capacidade por agente, 0).
      // Divide pela MESMA capacidade unitária que gerou a coluna Capacity — é o
      // que faz "contratar N agentes" zerar de fato o déficit da linha.
      data.days.forEach((day, dIdx) => {
        if (!isHelpdeskOpen(day, time)) {
          rowVals[37 + dIdx] = 0;
          return;
        }

        if (hasFixedOvernightCoverage(day, time)) {
          rowVals[37 + dIdx] = FIXED_OVERNIGHT_AGENTS - agentsByDay[dIdx];
          return;
        }

        const resLetter = resColLetters[dIdx];
        const perAgent = capacityPerAgent(data.dynamicTmaFactors[day] ?? 1.5, data.simultaneous);
        const capVal = Math.ceil(Number(rowVals[10 + dIdx]) || 0);
        const volVal = Number(rowVals[1 + dIdx]) || 0;
        const resVal = capVal - volVal;
        rowVals[37 + dIdx] = {
          formula: `ROUNDUP(${resLetter}${r}/-${perAgent.toFixed(4)},0)`,
          result: excelRoundUp(resVal / -perAgent),
        };
      });

      const addedRow = ws.addRow(rowVals);
      addedRow.font = { name: "Segoe UI", size: 9 };
      addedRow.alignment = { vertical: "middle" };

      // Number formatting & styling per section
      for (let c = 1; c <= headers.length; c++) {
        const cell = addedRow.getCell(c);
        if ([1, 10, 19, 28, 37].includes(c)) {
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.font = { name: "Segoe UI", size: 8, color: { argb: "FF64748B" } };
        } else if (c >= 2 && c <= 8) {
          cell.numFmt = "0.00";
        } else if (c >= 11 && c <= 17) {
          cell.numFmt = "0.00";
        } else if (c >= 20 && c <= 26) {
          cell.numFmt = "0";
          cell.font = { name: "Segoe UI", size: 9, bold: true };
        } else if (c >= 29 && c <= 35) {
          cell.numFmt = "0.00";
          // Cell highlight: green for surplus, red for deficit
          const resObj = rowVals[c - 1] as { result?: number } | number;
          const num = typeof resObj === "object" ? (resObj.result ?? 0) : Number(resObj) || 0;
          if (num > 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F4EA" } };
            cell.font = { name: "Segoe UI", size: 9, bold: true, color: { argb: "FF137333" } };
          } else if (num < 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE8E6" } };
            cell.font = { name: "Segoe UI", size: 9, bold: true, color: { argb: "FFC5221F" } };
          }
        } else if (c >= 38 && c <= 44) {
          cell.numFmt = "0";
          const fObj = rowVals[c - 1] as { result?: number } | number;
          const num = typeof fObj === "object" ? (fObj.result ?? 0) : Number(fObj) || 0;
          if (num > 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE8E6" } };
            cell.font = { name: "Segoe UI", size: 9, bold: true, color: { argb: "FFC5221F" } };
          } else if (num < 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F4EA" } };
            cell.font = { name: "Segoe UI", size: 9, bold: true, color: { argb: "FF137333" } };
          }
        }

        if (headers[c - 1] !== "") {
          cell.border = SECTION_STYLES.thinBorder;
        }
      }
    });

    // Rodapé de Totais (Linha 146)
    const totRowIndex = data.timeBlocks.length + 2;
    const totVals: unknown[] = [];
    totVals[0] = "TOTAL";

    // Soma Volume
    data.days.forEach((_, dIdx) => {
      const colLet = volColLetters[dIdx];
      totVals[1 + dIdx] = { formula: `SUM(${colLet}2:${colLet}${totRowIndex - 1})` };
    });

    totVals[8] = "";
    totVals[9] = "TOTAL";

    // Soma Capacity Bruto
    data.days.forEach((_, dIdx) => {
      const colLet = capColLetters[dIdx];
      totVals[10 + dIdx] = { formula: `SUM(${colLet}2:${colLet}${totRowIndex - 1})` };
    });

    totVals[17] = "";
    totVals[18] = "TOTAL";

    // Soma Capacity Arredondado
    data.days.forEach((_, dIdx) => {
      const colLet = capRColLetters[dIdx];
      totVals[19 + dIdx] = { formula: `SUM(${colLet}2:${colLet}${totRowIndex - 1})` };
    });

    totVals[26] = "";
    totVals[27] = "TOTAL";

    // Soma Resultado
    data.days.forEach((_, dIdx) => {
      const colLet = resColLetters[dIdx];
      totVals[28 + dIdx] = { formula: `SUM(${colLet}2:${colLet}${totRowIndex - 1})` };
    });

    totVals[35] = "";
    totVals[36] = "TOTAL";

    // Soma Faltantes (Apenas positivos > 0)
    data.days.forEach((_, dIdx) => {
      const colLet = faltamColLetters[dIdx];
      totVals[37 + dIdx] = { formula: `SUMIF(${colLet}2:${colLet}${totRowIndex - 1},">0")` };
    });

    const totRow = ws.addRow(totVals);
    totRow.font = { name: "Segoe UI", size: 10, bold: true };
    totRow.height = 24;
    for (let c = 1; c <= headers.length; c++) {
      const cell = totRow.getCell(c);
      cell.border = {
        top: { style: "double", color: { argb: "FF0F172A" } },
        bottom: { style: "double", color: { argb: "FF0F172A" } },
      };
      if (c >= 2 && c <= 8) cell.numFmt = "0.00";
      if (c >= 11 && c <= 17) cell.numFmt = "0.00";
      if (c >= 20 && c <= 26) cell.numFmt = "0";
      if (c >= 29 && c <= 35) cell.numFmt = "0.00";
      if (c >= 38 && c <= 44) cell.numFmt = "0";
    }
  };

  // -------------------------------------------------------------
  // ABA 2: HELPDESK (FILA ÚNICA)
  // -------------------------------------------------------------
  populateGridSheet("Helpdesk", false);

  // -------------------------------------------------------------
  // ABA 3: PROVA REAL (SIMULADO)
  // -------------------------------------------------------------
  populateGridSheet("Prova Real", true);

  return workbook;
}

/**
 * Dispara o download imediato do arquivo .xlsx no navegador
 */
export async function downloadDimensionamentoExcel(
  data: ExportDimensionamentoData,
  filename?: string,
): Promise<void> {
  const workbook = await buildDimensionamentoWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const cleanMonth = data.month.replace(/[/\\]/g, "-");
  anchor.href = url;
  anchor.download = filename || `Dimensionamento_${cleanMonth}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}
