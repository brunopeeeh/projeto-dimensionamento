import { describe, it, expect } from "vitest";
import { buildDimensionamentoWorkbook } from "./export-excel";
import type { ExportDimensionamentoData } from "./export-excel";
import type { Day } from "@/context/types";

const mockDays: Day[] = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const mockTimeBlocks = ["08:00", "08:10", "08:20"];

const mockData: ExportDimensionamentoData = {
  month: "Fevereiro/2026",
  timeBlocks: mockTimeBlocks,
  days: mockDays,
  helpdeskVolumes: {
    "08:00": {
      Segunda: 2,
      Terça: 1,
      Quarta: 3,
      Quinta: 0,
      Sexta: 1,
      Sábado: 0,
      Domingo: 0,
    } as Record<Day, number>,
  },
  teamAgents: [
    {
      id: "a1",
      name: "Agente 1",
      active: true,
      schedules: {
        Segunda: { intervals: { "08:00": "trabalhando" } },
      },
    },
  ],
  capacityAgents: [
    {
      name: "Agente 1",
      mediaTri: 3000,
    },
    {
      name: "Care AI",
      mediaTri: 5000,
    },
    {
      name: "Yooga Suporte",
      mediaTri: 2880,
    },
  ],
  dynamicTmaFactors: {
    Segunda: 2.0,
    Terça: 1.8,
    Quarta: 1.5,
    Quinta: 1.7,
    Sexta: 1.6,
    Sábado: 1.4,
    Domingo: 1.4,
  } as Record<Day, number>,
  simultaneous: 3,
  newHires: [],
};

describe("export-excel", () => {
  it("builds an ExcelJS workbook with 3 worksheets", async () => {
    const workbook = await buildDimensionamentoWorkbook(mockData);
    expect(workbook.worksheets.length).toBe(3);

    const sheetNames = workbook.worksheets.map((ws) => ws.name);
    expect(sheetNames).toContain("Capacity");
    expect(sheetNames).toContain("Helpdesk");
    expect(sheetNames).toContain("Prova Real");
  });

  it("adds formula cells in Capacity sheet", async () => {
    const workbook = await buildDimensionamentoWorkbook(mockData);
    const wsCap = workbook.getWorksheet("Capacity")!;
    const row2 = wsCap.getRow(2); // First capacity agent (row 1 is header)

    expect(row2.getCell(1).value).toBe("Agente 1");
    expect(row2.getCell(2).value).toBe(3000);

    const mediaMesCell = row2.getCell(3).value as { formula: string };
    expect(mediaMesCell.formula).toBe("B2/3");

    const resDiaCell = row2.getCell(4).value as { formula: string };
    expect(resDiaCell.formula).toBe("C2/20");

    const careIaRow = wsCap.getRow(3);
    expect(careIaRow.getCell(4).value).toMatchObject({ formula: "C3/30" });
    expect(careIaRow.getCell(5).value).toMatchObject({ formula: "D3/24" });
    expect(careIaRow.getCell(7).value).toMatchObject({ result: 5000 / 3 / 30 / 24 / 6 });
  });

  it("adds formula cells in Helpdesk sheet", async () => {
    const workbook = await buildDimensionamentoWorkbook(mockData);
    const wsHelpdesk = workbook.getWorksheet("Helpdesk")!;
    const row2 = wsHelpdesk.getRow(2); // First time block (08:00)

    // Col 1 is Hora
    expect(row2.getCell(1).value).toBe("08:00");

    // Fator 2 já contém os volumes de humanos, Yooga e Care IA. A capacidade
    // da faixa multiplica somente o único humano online na escala.
    expect(row2.getCell(11).value).toBe(2);

    // Col 20 is Capacity Arredondado (Segunda) -> Formula pointing to Col 11 (K)
    const capRCell = row2.getCell(20).value as { formula: string };
    expect(capRCell.formula).toBe("ROUNDUP(K2,0)");

    // Col 29 compara a capacidade total arredondada com o volume bruto.
    const resCell = row2.getCell(29).value as { formula: string };
    expect(resCell.formula).toBe("T2-B2");

    // Col 38 = Agentes que Faltam (Segunda): divide pela capacidade unitária do
    // dia (fator 2 x simultaneous 3/3 = 2), a mesma que gerou a coluna Capacity.
    const faltamCell = row2.getCell(38).value as { formula: string };
    expect(faltamCell.formula).toBe("ROUNDUP(AC2/-2.0000,0)");
  });

  it("applies the overnight fixed-position and closed-hour rules in the export", async () => {
    const overnightData: ExportDimensionamentoData = {
      ...mockData,
      timeBlocks: ["01:00", "02:50"],
      helpdeskVolumes: {
        "01:00": {
          ...mockData.helpdeskVolumes["08:00"],
          Segunda: 99,
          Terça: 99,
        },
        "02:50": {
          ...mockData.helpdeskVolumes["08:00"],
          Segunda: 99,
          Terça: 99,
        },
      },
      teamAgents: [
        {
          ...mockData.teamAgents[0],
          schedules: {
            Segunda: { intervals: { "01:00": "trabalhando" } },
            Terça: { intervals: { "01:00": "trabalhando", "02:40": "trabalhando" } },
          },
        },
      ],
    };
    const workbook = await buildDimensionamentoWorkbook(overnightData);
    const sheet = workbook.getWorksheet("Helpdesk")!;

    // Segunda closes at 01:00: its 01:00 and 02:50 cells are excluded.
    expect(sheet.getRow(2).getCell(2).value).toBe(0);
    expect(sheet.getRow(2).getCell(38).value).toBe(0);
    expect(sheet.getRow(3).getCell(2).value).toBe(0);
    expect(sheet.getRow(3).getCell(38).value).toBe(0);

    // Terça stays open to 03:00, but the overnight position is fixed at one agent.
    expect(sheet.getRow(2).getCell(39).value).toBe(0);
    expect(sheet.getRow(3).getCell(39).value).toBe(0);
  });

  it("generates a valid xlsx binary buffer", async () => {
    const workbook = await buildDimensionamentoWorkbook(mockData);
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer).toBeDefined();
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });
});
