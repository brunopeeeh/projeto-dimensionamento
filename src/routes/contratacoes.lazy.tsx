import { createLazyFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useDimensionamento } from "@/context/DimensionamentoContext";
import { TimeGridSheet } from "@/components/TimeGridSheet";
import { Settings2 } from "lucide-react";
import { useAiSuggestion } from "@/features/ai-suggestion/useAiSuggestion";
import { AiSuggestionDialog } from "@/features/ai-suggestion/AiSuggestionDialog";
import { HireManagerDialog } from "@/features/contratacoes/HireManagerDialog";

export const Route = createLazyFileRoute("/contratacoes")({
  component: ContratacoesComponent,
});

function ContratacoesComponent() {
  const { currentMonth, newHires, isReadOnly } = useDimensionamento();
  const [isManagerOpen, setIsManagerOpen] = useState(false);

  const aiState = useAiSuggestion();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {currentMonth} · Simulador
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl text-foreground">
            Simular Escala - Prova Real
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Simule a contratação e horários de novos agentes para visualizar em tempo real a
            cobertura dos déficits.
          </p>
        </div>
        <button
          onClick={() => setIsManagerOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Settings2 className="h-4 w-4" />
          Gerenciar Contratações
          {newHires.length > 0 && (
            <span className="ml-1 rounded-full bg-primary-foreground/20 px-2 py-0.5 text-xs">
              {newHires.length}
            </span>
          )}
        </button>
      </div>

      <div className="space-y-4">
        {/* Full width TimeGridSheet */}
        <TimeGridSheet
          mode="provaReal"
          title="Volume × Capacity - Prova Real (Simulado)"
          subtitle="O capacity reflete a escala CLT atual somada às contratações ativas."
        />
      </div>

      <HireManagerDialog
        isManagerOpen={isManagerOpen}
        setIsManagerOpen={setIsManagerOpen}
        aiLoading={aiState.aiLoading}
        onMathSuggest={aiState.handleMathSuggest}
        onAiSuggest={aiState.handleAiSuggest}
      />

      <AiSuggestionDialog
        isOpen={aiState.aiDialogOpen}
        onOpenChange={aiState.setAiDialogOpen}
        meta={aiState.aiMeta}
        currentMonth={currentMonth}
        validationErrors={aiState.aiValidationErrors}
        agents={aiState.aiAgents}
        result={aiState.aiResult}
        justification={aiState.aiJustification}
        onApply={aiState.handleApplyAiSuggestion}
        isReadOnly={isReadOnly}
        onForceRefresh={() => aiState.handleAiSuggest({ forceRefresh: true })}
        isLoading={aiState.aiLoading}
      />
    </div>
  );
}
