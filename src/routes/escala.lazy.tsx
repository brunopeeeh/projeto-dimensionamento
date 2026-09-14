import { useState } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";
import { EscalaTeamManager } from "@/components/EscalaTeamManager";
import { EscalaOps } from "@/components/escala-ops/EscalaOps";

export const Route = createLazyFileRoute("/escala")({
  component: EscalaPage,
});

function EscalaPage() {
  const [viewMode, setViewMode] = useState<"timeline" | "grid">(() => {
    try {
      return (localStorage.getItem("escala_preferred_view") as "timeline" | "grid") || "timeline";
    } catch {
      return "timeline";
    }
  });

  const handleModeChange = (mode: "timeline" | "grid") => {
    setViewMode(mode);
    try {
      localStorage.setItem("escala_preferred_view", mode);
    } catch {
      // Ignora erro se localStorage estiver inacessível
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Gestão de Escalas</h1>
          <p className="text-sm text-muted-foreground">
            {viewMode === "timeline"
              ? "Linha do tempo contínua, status ao vivo da equipe e curva de demanda real."
              : "Grade matricial de intervalos de 20 minutos e alocação de turnos por dia."}
          </p>
        </div>

        {/* Seletor Segmentado Unificado */}
        <div className="inline-flex p-1 bg-muted/60 rounded-lg border border-border/50 self-start sm:self-auto">
          <button
            onClick={() => handleModeChange("timeline")}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${
              viewMode === "timeline"
                ? "bg-background text-foreground shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>📅</span>
            <span>Timeline Semanal</span>
          </button>
          <button
            onClick={() => handleModeChange("grid")}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${
              viewMode === "grid"
                ? "bg-background text-foreground shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>📊</span>
            <span>Grade 20 Min</span>
          </button>
        </div>
      </div>

      {viewMode === "timeline" ? (
        <div className="w-full">
          <EscalaOps />
        </div>
      ) : (
        <EscalaTeamManager />
      )}
    </div>
  );
}
