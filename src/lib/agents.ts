export const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");

// Identifica o agente de capacity que representa a IA (Care AI / "Maya dos
// Santos (IA)"). A IA é sempre marcada com "(IA)" no nome ou pelos aliases
// históricos "Care AI"/"Care IA".
export const isAiAgent = (name: string): boolean => {
  const n = normalizeName(name);
  return n === "careai" || n === "careia" || /\(\s*ia\s*\)/i.test(name);
};

// Identifica o agente de capacity do time de suporte interno (Yooga Suporte /
// Yooga Tecnologia + supervisores). Todo nome com "yooga" representa a posição
// agregada que entra no numerador e soma uma posição ao divisor do Capacity.
export const isSupportAgent = (name: string): boolean => {
  return normalizeName(name).includes("yooga");
};

export const matchAgentName = (capName: string, teamName: string) => {
  const capNorm = normalizeName(capName);
  const teamNorm = normalizeName(teamName);

  if (capNorm === "andreia" && teamNorm.includes("andrea")) return true;
  if (capNorm === "marlonsa" && teamNorm.includes("marlon")) return true;
  if (capNorm === "malu" && (teamNorm.includes("malu") || teamNorm.includes("marialuiza")))
    return true;
  if (capNorm === "romerio" && teamNorm.includes("romerio")) return true;
  if (capNorm === "brenda" && teamNorm.includes("brenda")) return true;
  if (capNorm === "rafael" && teamNorm.includes("rafael")) return true;
  if (capNorm === "bryan" && teamNorm.includes("bryan")) return true;
  if (capNorm === "julio" && teamNorm.includes("julio")) return true;

  return teamNorm.includes(capNorm) || capNorm.includes(teamNorm);
};

export type AgentVolume = { name: string; mediaTri: number; wasRenamed?: boolean };

/**
 * Soma volumes de duas plataformas (Freshchat + Helpdesk HubSpot) casando os
 * agentes por nome. Quem existe só em `extra` entra como linha nova, mantendo
 * o nome vindo de lá.
 */
export const mergeAgentVolumes = (base: AgentVolume[], extra: AgentVolume[]): AgentVolume[] => {
  const merged = base.map((agent) => ({ ...agent }));

  for (const item of extra) {
    const hit = merged.find((agent) => matchAgentName(agent.name, item.name));
    if (hit) hit.mediaTri += item.mediaTri;
    else merged.push({ ...item });
  }

  return merged;
};
