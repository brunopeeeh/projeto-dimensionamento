import { describe, it, expect } from "vitest";
import {
  findAiAgent,
  findSupportAgent,
  isHumanAgent,
  normalizeName,
  matchAgentName,
  mergeAgentVolumes,
} from "./agents";

describe("normalizeName", () => {
  it("lowercases, strips accents, and removes non-letters", () => {
    expect(normalizeName("Bruno Oliveira")).toBe("brunooliveira");
    expect(normalizeName("André")).toBe("andre");
    expect(normalizeName("Maria-Luiza 2")).toBe("marialuiza");
  });
});

describe("matchAgentName", () => {
  it("matches via substring in either direction", () => {
    expect(matchAgentName("Bruno", "Bruno Oliveira")).toBe(true);
    expect(matchAgentName("Bruno Oliveira", "Bruno")).toBe(true);
    expect(matchAgentName("Bruno", "Wagner")).toBe(false);
  });

  it("applies the documented special-cased aliases", () => {
    expect(matchAgentName("Andreia", "Andrea Souza")).toBe(true);
    expect(matchAgentName("Marlon SA", "Marlon Santos")).toBe(true);
    expect(matchAgentName("Malu", "Maria Luiza")).toBe(true);
    expect(matchAgentName("Malu", "Malu Costa")).toBe(true);
  });

  it("is accent- and case-insensitive", () => {
    expect(matchAgentName("JÚLIO", "julio cesar")).toBe(true);
  });
});

describe("isHumanAgent", () => {
  it("excludes every historical AI and support alias", () => {
    expect(isHumanAgent("Care IA")).toBe(false);
    expect(isHumanAgent("Care AI")).toBe(false);
    expect(isHumanAgent("Maya dos Santos (IA)")).toBe(false);
    expect(isHumanAgent("Yooga Suporte")).toBe(false);
    expect(isHumanAgent("Yooga Tecnologia")).toBe(false);
    expect(isHumanAgent("Sabrina")).toBe(true);
  });
});

describe("special capacity aliases", () => {
  const capacityAgents = [
    { name: "Care AI", mediaTri: 1 },
    { name: "Care IA", mediaTri: 2 },
    { name: "Yooga Tecnologia", mediaTri: 3 },
    { name: "Yooga Suporte", mediaTri: 4 },
  ];

  it("prefers the canonical Care IA row", () => {
    expect(findAiAgent(capacityAgents)?.mediaTri).toBe(2);
  });

  it("prefers the canonical Yooga Suporte row", () => {
    expect(findSupportAgent(capacityAgents)?.mediaTri).toBe(4);
  });
});

describe("mergeAgentVolumes", () => {
  it("sums Freshchat + HubSpot volumes for the same agent", () => {
    const merged = mergeAgentVolumes(
      [{ name: "Bruno Oliveira", mediaTri: 100 }],
      [{ name: "Bruno", mediaTri: 40 }],
    );

    expect(merged).toEqual([{ name: "Bruno Oliveira", mediaTri: 140 }]);
  });

  it("keeps agents that only exist on one platform", () => {
    const merged = mergeAgentVolumes(
      [{ name: "Bruno Oliveira", mediaTri: 100 }],
      [{ name: "Wagner Lima", mediaTri: 30 }],
    );

    expect(merged).toEqual([
      { name: "Bruno Oliveira", mediaTri: 100 },
      { name: "Wagner Lima", mediaTri: 30 },
    ]);
  });

  it("does not mutate the base array", () => {
    const base = [{ name: "Bruno Oliveira", mediaTri: 100 }];
    mergeAgentVolumes(base, [{ name: "Bruno", mediaTri: 40 }]);

    expect(base[0].mediaTri).toBe(100);
  });
});
