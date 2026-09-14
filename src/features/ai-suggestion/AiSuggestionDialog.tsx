import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calculator, Wand2, AlertTriangle, Sparkles, Check, RefreshCw } from "lucide-react";

import { AiAgentSuggestion } from "@/lib/ai-suggestion";

type Props = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  meta: { cached: boolean; attempts: number; model: string } | null;
  currentMonth: string;
  validationErrors: { rule: number; agent?: string; message: string }[];
  agents: AiAgentSuggestion[];
  result: { success: boolean; message: string } | null;
  justification: string;
  onApply: () => void;
  isReadOnly: boolean;
  onForceRefresh?: () => void;
  isLoading?: boolean;
};

export function AiSuggestionDialog({
  isOpen,
  onOpenChange,
  meta,
  currentMonth,
  validationErrors,
  agents,
  result,
  justification,
  onApply,
  isReadOnly,
  onForceRefresh,
  isLoading,
}: Props) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            {meta?.model?.includes("math") ? (
              <Calculator className="h-4 w-4 text-blue-600 animate-pulse" />
            ) : (
              <Wand2 className="h-4 w-4 text-emerald-600 animate-pulse" />
            )}
            {meta?.model?.includes("math") ? "Otimização Matemática · " : "Sugestão de IA · "}
            {currentMonth}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            {meta
              ? `${meta.model} · ${meta.cached ? "recuperado do cache" : `${meta.attempts} tentativa(s)`}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {validationErrors.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1">
            <div className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              Validação 5x2: {validationErrors.length} aviso(s)
            </div>
            <ul className="list-disc pl-5 text-amber-700/90 dark:text-amber-400/90 space-y-0.5">
              {validationErrors.slice(0, 5).map((e, i) => (
                <li key={i}>
                  <span className="font-medium">
                    Regra {e.rule}
                    {e.agent ? ` · ${e.agent}` : ""}:
                  </span>{" "}
                  {e.message}
                </li>
              ))}
              {validationErrors.length > 5 && (
                <li className="text-muted-foreground">+{validationErrors.length - 5} aviso(s)…</li>
              )}
            </ul>
          </div>
        )}

        {result && !result.success && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-400">
            {result.message}
          </div>
        )}

        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {agents.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Nenhum agente sugerido.</p>
          )}
          {agents.map((a, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border bg-muted/20 p-2.5 text-xs border-border"
            >
              <span className="font-mono font-bold text-foreground min-w-[70px]">{a.agente}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                {a.inicio}–{a.fim}
              </span>
              <div className="flex flex-wrap gap-1">
                {a.dias_trabalho.map((d: string) => (
                  <span
                    key={d}
                    className="rounded-md border bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                  >
                    {d}
                  </span>
                ))}
              </div>
              <span className="text-xs text-muted-foreground ml-auto">
                folga: {a.folga.join("+")}
              </span>
            </div>
          ))}
        </div>

        {justification && (
          <div className="mt-4 border-t pt-4">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-foreground">
              {meta?.model?.includes("math") ? (
                <Calculator className="h-4 w-4 text-blue-600 animate-pulse" />
              ) : (
                <Sparkles className="h-4 w-4 text-emerald-600 animate-pulse" />
              )}
              {meta?.model?.includes("math")
                ? "Detalhamento Matemático"
                : "Análise e Justificativa da IA"}
            </h4>
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-line leading-relaxed max-h-48 overflow-y-auto pr-1 border-border">
              {justification}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between items-center w-full">
          <div>
            {meta?.cached && onForceRefresh && !meta.model?.includes("math") && (
              <button
                type="button"
                onClick={onForceRefresh}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Ignorar cache de 24h e gerar nova consulta à IA"
              >
                <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
                Recalcular (ignorar cache)
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent border-border cursor-pointer"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={agents.length === 0 || isReadOnly}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" />
              Aplicar à Simulação
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
