import path from "node:path";
import process from "node:process";
import { describe, it, expect } from "vitest";
import {
  bucketTimestampToSaoPaulo,
  aggregateTicketsToVolumes,
  loadVolumeFromPivotFile,
  listExportedVolumes,
  getHubspot10MinVolume,
  type HubspotTicketSearchItem,
} from "./hubspot-volume.server";

describe("bucketTimestampToSaoPaulo", () => {
  it("converte timestamp UTC para horário e dia correto em America/Sao_Paulo", () => {
    // 2026-09-14 15:34:00 UTC = 2026-09-14 12:34:00 em São Paulo (-3) -> Segunda-feira, faixa 12:30
    const ts = new Date("2026-09-14T15:34:00Z").getTime();
    const result = bucketTimestampToSaoPaulo(ts);

    expect(result).not.toBeNull();
    expect(result?.time).toBe("12:30");
    expect(result?.day).toBe("Segunda");
  });

  it("arredonda para baixo para o bloco de 10 minutos mais próximo", () => {
    // 2026-09-14 10:09:59 em SP -> 10:00
    const ts1 = new Date("2026-09-14T13:09:59Z").getTime();
    expect(bucketTimestampToSaoPaulo(ts1)?.time).toBe("10:00");

    // 2026-09-14 10:10:00 em SP -> 10:10
    const ts2 = new Date("2026-09-14T13:10:00Z").getTime();
    expect(bucketTimestampToSaoPaulo(ts2)?.time).toBe("10:10");

    // 2026-09-14 10:19:59 em SP -> 10:10
    const ts3 = new Date("2026-09-14T13:19:59Z").getTime();
    expect(bucketTimestampToSaoPaulo(ts3)?.time).toBe("10:10");
  });

  it("lida corretamente com a virada de meia-noite (madrugada)", () => {
    // Domingo 23:30 em SP -> 2026-09-14 02:30 UTC
    const domingoNoite = new Date("2026-09-14T02:30:00Z").getTime();
    const resDom = bucketTimestampToSaoPaulo(domingoNoite);
    expect(resDom?.day).toBe("Domingo");
    expect(resDom?.time).toBe("23:30");

    // Segunda 01:15 em SP -> 2026-09-14 04:15 UTC
    const segMadrugada = new Date("2026-09-14T04:15:00Z").getTime();
    const resSeg = bucketTimestampToSaoPaulo(segMadrugada);
    expect(resSeg?.day).toBe("Segunda");
    expect(resSeg?.time).toBe("01:10");
  });

  it("retorna null para timestamp inválido", () => {
    expect(bucketTimestampToSaoPaulo("invalid-date")).toBeNull();
  });
});

describe("aggregateTicketsToVolumes", () => {
  it("acumula contagem por faixa e divide pelo número de semanas", () => {
    const tickets: HubspotTicketSearchItem[] = [
      {
        id: "1",
        properties: {
          hubspot_owner_assigneddate: "2026-09-14T13:05:00Z", // Seg 10:00 em SP
        },
      },
      {
        id: "2",
        properties: {
          hubspot_owner_assigneddate: "2026-09-14T13:08:00Z", // Seg 10:00 em SP
        },
      },
      {
        id: "3",
        properties: {
          hubspot_owner_assigneddate: "2026-09-15T13:02:00Z", // Ter 10:00 em SP
        },
      },
    ];

    // Divisor de 2 semanas
    const { volumes, totalTickets } = aggregateTicketsToVolumes(tickets, 2);

    expect(totalTickets).toBe(3);
    // Seg 10:00: 2 chamados / 2 semanas = 1.0
    expect(volumes["10:00"]?.Segunda).toBe(1);
    // Ter 10:00: 1 chamado / 2 semanas = 0.5
    expect(volumes["10:00"]?.Terça).toBe(0.5);
    // Qua 10:00: 0 chamados
    expect(volumes["10:00"]?.Quarta).toBe(0);
  });
});

describe("loadVolumeFromPivotFile (Relatório Oficial Databricks)", () => {
  it("carrega e converte volume_10min_2026-06-15_a_2026-09-13.xlsx com exatidão", () => {
    const filePath = path.join(
      process.cwd(),
      "storage",
      "exports",
      "volume_10min_2026-06-15_a_2026-09-13.xlsx",
    );

    const { volumes, totalTickets } = loadVolumeFromPivotFile(filePath, 13);

    // Total de 25.272 chamados
    expect(totalTickets).toBe(25272);

    // 07:00:00 -> 1/13 = 0.0769 para Seg, Ter, Qui, Sáb
    expect(volumes["07:00"]?.Segunda).toBe(0.0769);
    expect(volumes["07:00"]?.Terça).toBe(0.0769);
    expect(volumes["07:00"]?.Quarta).toBe(0);
    expect(volumes["07:00"]?.Quinta).toBe(0.0769);
    expect(volumes["07:00"]?.Sexta).toBe(0);
    expect(volumes["07:00"]?.Sábado).toBe(0.0769);
    expect(volumes["07:00"]?.Domingo).toBe(0);

    // 07:40:00 -> Qua=24 (1.8462), Sex=6 (0.4615), Dom=3 (0.2308)
    expect(volumes["07:40"]?.Segunda).toBe(0.0769);
    expect(volumes["07:40"]?.Terça).toBe(0.1538);
    expect(volumes["07:40"]?.Quarta).toBe(1.8462);
    expect(volumes["07:40"]?.Quinta).toBe(0.0769);
    expect(volumes["07:40"]?.Sexta).toBe(0.4615);
    expect(volumes["07:40"]?.Sábado).toBe(0.0769);
    expect(volumes["07:40"]?.Domingo).toBe(0.2308);
  });
});

describe("listExportedVolumes", () => {
  it("encontra os arquivos existentes em storage/exports", () => {
    const list = listExportedVolumes();
    expect(list.length).toBeGreaterThan(0);

    const official = list.find((f) => f.fileName === "volume_10min_2026-06-15_a_2026-09-13.xlsx");
    expect(official).toBeDefined();
    expect(official?.startDate).toBe("2026-06-15");
    expect(official?.endDate).toBe("2026-09-13");
    expect(official?.type).toBe("xlsx");
  });
});

describe("getHubspot10MinVolume com prioridade local", () => {
  it("carrega automaticamente o arquivo oficial quando datas coincidem", async () => {
    const result = await getHubspot10MinVolume({
      startDate: "2026-06-15",
      endDate: "2026-09-13",
      divisor: 13,
    });

    expect(result.success).toBe(true);
    expect(result.source).toBe("export_xlsx");
    expect(result.fileName).toBe("volume_10min_2026-06-15_a_2026-09-13.xlsx");
    expect(result.totalTickets).toBe(25272);
    expect(result.volumes["07:00"]?.Segunda).toBe(0.0769);
    expect(result.volumes["07:40"]?.Quarta).toBe(1.8462);
  });
});
