import { describe, it, expect } from "vitest";
import {
  competenciaOf,
  rowToOverride,
  overrideToRow,
  changedDates,
  type ExcecaoRow,
} from "./escala-excecoes";
import type { Override } from "./types";

describe("competenciaOf", () => {
  it("vira o dia 1 do mês", () => {
    expect(competenciaOf("2026-02-14")).toBe("2026-02-01");
    expect(competenciaOf("2026-12-31")).toBe("2026-12-01");
  });
});

describe("overrideToRow / rowToOverride", () => {
  const base: ExcecaoRow = {
    competencia: "2026-02-01",
    agente_id: "a_1",
    data: "2026-02-14",
    kind: "falta",
    shift_start: null,
    shift_end: null,
    pause_override: false,
    pause_start: null,
    pause_end: null,
    note: null,
  };

  it("roundtrip de falta simples", () => {
    expect(rowToOverride(base)).toEqual({ kind: "falta" });
  });

  it("preserva turno e nota", () => {
    const row: ExcecaoRow = {
      ...base,
      kind: "ajuste",
      shift_start: "10:00:00",
      shift_end: "19:00:00",
      note: "troca combinada",
    };
    expect(rowToOverride(row)).toEqual({
      kind: "ajuste",
      shift: ["10:00", "19:00"],
      note: "troca combinada",
    });
  });

  it("distingue pausa não alterada de pausa removida", () => {
    expect(rowToOverride({ ...base, pause_override: false })).toEqual({ kind: "falta" });
    expect(rowToOverride({ ...base, pause_override: true })).toEqual({
      kind: "falta",
      pause: null,
    });
    expect(
      rowToOverride({
        ...base,
        pause_override: true,
        pause_start: "12:00:00",
        pause_end: "13:00:00",
      }),
    ).toEqual({ kind: "falta", pause: ["12:00", "13:00"] });
  });

  it("grava pause_override=true quando a pausa é definida ou removida", () => {
    expect(overrideToRow("2026-02-14", "a_1", { kind: "extra", pause: null })).toMatchObject({
      competencia: "2026-02-01",
      pause_override: true,
      pause_start: null,
      pause_end: null,
    });
    expect(overrideToRow("2026-02-14", "a_1", { kind: "extra" })).toMatchObject({
      pause_override: false,
    });
    expect(
      overrideToRow("2026-02-14", "a_1", { kind: "extra", pause: ["12:00", "13:00"] }),
    ).toMatchObject({
      pause_override: true,
      pause_start: "12:00",
      pause_end: "13:00",
    });
  });
});

describe("changedDates", () => {
  const ov = (kind: Override["kind"]): Override => ({ kind });

  it("detecta data adicionada, alterada e removida", () => {
    const prev = { "2026-02-14": { a1: ov("falta") } };
    const next = {
      "2026-02-14": { a1: ov("atestado") },
      "2026-02-15": { a1: ov("extra") },
    };
    expect(changedDates(prev, next).sort()).toEqual(["2026-02-14", "2026-02-15"]);
    expect(changedDates(next, prev).sort()).toEqual(["2026-02-14", "2026-02-15"]);
  });

  it("não acusa mudança quando o conteúdo é igual (mesmo com ordem diferente)", () => {
    const a: Override = { kind: "ajuste", shift: ["10:00", "19:00"] };
    const b: Override = { kind: "ajuste", shift: ["10:00", "19:00"] };
    expect(changedDates({ d: { x: a } }, { d: { x: b } })).toEqual([]);
  });

  it("considera pausa undefined vs null como mudança", () => {
    expect(
      changedDates({ d: { x: { kind: "extra" } } }, { d: { x: { kind: "extra", pause: null } } }),
    ).toEqual(["d"]);
  });
});
