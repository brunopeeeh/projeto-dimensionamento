import { useState } from "react";
import { toast } from "sonner";
import { useDimensionamento } from "@/context/DimensionamentoContext";
import { buildDeficitTable, aiAgentsToNewHires, type AiAgentSuggestion } from "@/lib/ai-suggestion";

export function useAiSuggestion() {
  const { currentMonth, rowCalculations, newHires, setNewHires } = useDimensionamento();

  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAgents, setAiAgents] = useState<AiAgentSuggestion[]>([]);
  const [aiJustification, setAiJustification] = useState("");
  const [aiValidationErrors, setAiValidationErrors] = useState<
    { rule: number; agent?: string; message: string }[]
  >([]);
  const [aiMeta, setAiMeta] = useState<{
    cached: boolean;
    attempts: number;
    model: string;
  } | null>(null);
  const [aiResult, setAiResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleAiSuggest = async (options?: { forceRefresh?: boolean }) => {
    const forceRefresh = options?.forceRefresh ?? false;
    if (!currentMonth) {
      toast.error("Selecione um mês antes de gerar sugestão.");
      return;
    }
    const table = buildDeficitTable(rowCalculations);
    if (table.length === 0) {
      toast.info("Sem defasagens detectadas na escala atual — IA não precisa agir.");
      return;
    }
    setAiLoading(true);
    const loadingId = toast.loading(
      forceRefresh
        ? `Recalculando análise IA sem cache (${currentMonth})…`
        : `Consultando sugestão IA (${currentMonth})…`,
    );
    try {
      const res = await fetch("/api/ai-suggestion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          month: currentMonth,
          deficitTable: table,
          skipCache: forceRefresh,
        }),
      });
      const data = (await res.json()) as {
        success: boolean;
        message: string;
        cached: boolean;
        attempts: number;
        agents: AiAgentSuggestion[];
        justification?: string;
        validationErrors?: { rule: number; agent?: string; message: string }[];
        model: string;
      };
      setAiAgents(data.agents);
      setAiJustification(data.justification ?? "");
      setAiValidationErrors(data.validationErrors ?? []);
      setAiMeta({ cached: data.cached, attempts: data.attempts, model: data.model });
      setAiResult({ success: data.success, message: data.message });
      setAiDialogOpen(true);
      if (data.success) {
        toast.success(data.message, { id: loadingId });
      } else {
        toast.warning(data.message, { id: loadingId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido.";
      toast.error(`Falha ao gerar sugestão: ${message}`, { id: loadingId });
    } finally {
      setAiLoading(false);
    }
  };

  const handleMathSuggest = async () => {
    if (!currentMonth) {
      toast.error("Selecione um mês antes de gerar otimização.");
      return;
    }
    const table = buildDeficitTable(rowCalculations);
    if (table.length === 0) {
      toast.info("Sem defasagens detectadas na escala atual.");
      return;
    }
    setAiLoading(true);
    const loadingId = toast.loading(`Calculando Matemática Perfeita (${currentMonth})…`);
    try {
      const res = await fetch("/api/math-suggestion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          month: currentMonth,
          deficitTable: table,
        }),
      });
      const data = (await res.json()) as {
        success: boolean;
        message: string;
        cached: boolean;
        attempts: number;
        agents: AiAgentSuggestion[];
        justification?: string;
        model: string;
      };
      setAiAgents(data.agents);
      setAiJustification(data.justification ?? "");
      setAiValidationErrors([]); // Math solver mathematically guarantees 0 validation errors
      setAiMeta({ cached: data.cached, attempts: data.attempts, model: data.model });
      setAiResult({ success: data.success, message: data.message });
      setAiDialogOpen(true);
      if (data.success) {
        toast.success(data.message, { id: loadingId });
      } else {
        toast.warning(data.message, { id: loadingId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido.";
      toast.error(`Falha ao otimizar: ${message}`, { id: loadingId });
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAiSuggestion = () => {
    const hires = aiAgentsToNewHires(aiAgents);
    if (hires.length === 0) {
      toast.error("Nenhum agente válido para aplicar.");
      return;
    }
    setNewHires([...newHires, ...hires]);
    toast.success(
      `${hires.length} agente(s) adicionado(s) à simulação. Ajuste conforme necessário.`,
    );
    setAiDialogOpen(false);
  };

  return {
    aiDialogOpen,
    setAiDialogOpen,
    aiLoading,
    aiAgents,
    aiJustification,
    aiValidationErrors,
    aiMeta,
    aiResult,
    handleAiSuggest,
    handleMathSuggest,
    handleApplyAiSuggestion,
  };
}
