import { describe, expect, it } from "vitest";
import {
  DIMENSIONAMENTO_HELP_ITEMS,
  filterHelpItems,
  normalizeHelpSearch,
} from "./dimensionamento-help";

describe("dimensionamento-help", () => {
  it("normaliza acentos e caixa para a busca", () => {
    expect(normalizeHelpSearch("  Contratação e Déficit  ")).toBe("contratacao e deficit");
  });

  it("encontra conteúdo por pergunta, resposta e palavra-chave", () => {
    expect(filterHelpItems(DIMENSIONAMENTO_HELP_ITEMS, "CAPACIDADE", "Todos")).not.toHaveLength(0);
    expect(filterHelpItems(DIMENSIONAMENTO_HELP_ITEMS, "Maria Luiza", "Todos")).toHaveLength(1);
    expect(filterHelpItems(DIMENSIONAMENTO_HELP_ITEMS, "WhatsApp", "Todos")).toHaveLength(1);
  });

  it("combina busca e categoria", () => {
    expect(filterHelpItems(DIMENSIONAMENTO_HELP_ITEMS, "SLA", "Modelos em teste")).toHaveLength(1);
    expect(filterHelpItems(DIMENSIONAMENTO_HELP_ITEMS, "SLA", "Painel")).toHaveLength(0);
  });

  it("retorna todos os itens da categoria quando a busca está vazia", () => {
    const items = filterHelpItems(DIMENSIONAMENTO_HELP_ITEMS, "", "Fundamentos");
    expect(items.every((item) => item.category === "Fundamentos")).toBe(true);
    expect(items).toHaveLength(5);
  });
});
