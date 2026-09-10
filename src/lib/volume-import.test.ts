import { describe, it, expect } from "vitest";
import { parseHubspotLongFormat } from "./volume-import";

const hubspotRows = [
  [
    "hubspot_support_requests__closed_at_10min",
    "hubspot_support_requests__weekday_name",
    "count(hubspot_support_requests__*)",
  ],
  [15, "08:00", "Friday"],
  [4, "08:00", "Monday"],
  [26, "08:10", "Friday"],
  [8, "08:10", "Monday"],
];

describe("parseHubspotLongFormat", () => {
  it("converte formato longo HubSpot (contagem/hora/dia em inglês) para largo", () => {
    const result = parseHubspotLongFormat(hubspotRows);

    expect(result).not.toBeNull();
    expect(result!["08:00"].Sexta).toBeCloseTo(15 / 13, 6);
    expect(result!["08:00"].Segunda).toBeCloseTo(4 / 13, 6);
    expect(result!["08:10"].Sexta).toBeCloseTo(26 / 13, 6);
    expect(result!["08:10"].Segunda).toBeCloseTo(8 / 13, 6);
  });

  it("retorna null para formato largo (sem coluna de dia em inglês)", () => {
    const wide = [
      ["hora", "seg", "ter", "qua"],
      ["08:00", 1, 2, 3],
      ["08:10", 4, 5, 6],
    ];
    expect(parseHubspotLongFormat(wide)).toBeNull();
  });

  it("retorna null para planilha vazia", () => {
    expect(parseHubspotLongFormat([[]])).toBeNull();
  });
});
