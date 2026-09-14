import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CloudDownload,
  Loader2,
  Calendar,
  AlertCircle,
  FileSpreadsheet,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import type { Day } from "@/context/types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onVolumeLoaded: (volumes: Record<string, Record<Day, number>>) => void;
};

export type AvailableFile = {
  fileName: string;
  startDate: string;
  endDate: string;
  label: string;
  type: "xlsx" | "csv" | "chamados";
  sizeBytes: number;
};

// Formata Date para YYYY-MM-DD local
function formatDateYMD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function HubspotVolumeModal({ isOpen, onClose, onVolumeLoaded }: Props) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [divisor, setDivisor] = useState<number>(13);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [availableFiles, setAvailableFiles] = useState<AvailableFile[]>([]);
  const [forceApi, setForceApi] = useState(false);

  // Inicializa com 90 dias atrás até ontem
  const set90DaysPreset = () => {
    const end = new Date();
    end.setDate(end.getDate() - 1); // até ontem

    const start = new Date(end);
    start.setDate(start.getDate() - 90);

    setStartDate(formatDateYMD(start));
    setEndDate(formatDateYMD(end));
    setDivisor(13);
    setErrorMsg(null);
  };

  // Busca lista de relatórios já exportados na pasta storage/exports/
  useEffect(() => {
    if (!isOpen) return;

    fetch("/api/hubspot-volume-files")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.files)) {
          setAvailableFiles(data.files);

          // Se encontrar o arquivo mais recente ou padrão (ex: 2026-06-15 a 2026-09-13), pré-preenche
          const officialPivot = data.files.find(
            (f: AvailableFile) => f.type === "xlsx" && f.fileName.startsWith("volume_10min_2026"),
          );
          if (officialPivot) {
            setStartDate(officialPivot.startDate);
            setEndDate(officialPivot.endDate);
            setDivisor(13);
          } else {
            set90DaysPreset();
          }
        } else {
          set90DaysPreset();
        }
      })
      .catch(() => {
        set90DaysPreset();
      });
  }, [isOpen]);

  // Encontra arquivo que casa com as datas selecionadas
  const matchedFile = availableFiles.find(
    (f) =>
      (f.type === "xlsx" || f.type === "csv") &&
      f.startDate === startDate &&
      f.endDate === endDate &&
      f.fileName.startsWith("volume_10min_"),
  );

  // Atualiza semanas estimadas quando as datas mudam
  const handleDateChange = (newStart: string, newEnd: string) => {
    setStartDate(newStart);
    setEndDate(newEnd);
    if (newStart && newEnd) {
      const s = new Date(newStart).getTime();
      const e = new Date(newEnd).getTime();
      if (!isNaN(s) && !isNaN(e) && e >= s) {
        const days = Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)));
        const weeks = Math.max(1, Math.round(days / 7));
        setDivisor(weeks);
      }
    }
  };

  const handleSelectFile = (file: AvailableFile) => {
    setStartDate(file.startDate);
    setEndDate(file.endDate);
    const s = new Date(file.startDate).getTime();
    const e = new Date(file.endDate).getTime();
    if (!isNaN(s) && !isNaN(e) && e >= s) {
      const days = Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)));
      const weeks = Math.max(1, Math.round(days / 7));
      setDivisor(weeks);
    }
  };

  const handleSync = async () => {
    if (!startDate || !endDate) {
      setErrorMsg("Por favor, selecione as datas de início e fim.");
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      setErrorMsg("A data de início não pode ser posterior à data de fim.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const response = await fetch("/api/hubspot-volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          divisor,
          fileName: matchedFile?.fileName,
          forceApi,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Falha ao buscar dados da API do HubSpot.");
      }

      onVolumeLoaded(data.volumes);

      const sourceLabel =
        data.source === "export_xlsx" || data.source === "export_csv"
          ? `relatório oficial Databricks (${data.fileName || "arquivo"})`
          : data.source === "python_script"
            ? "extração Databricks gerada via script"
            : "HubSpot API";

      toast.success(
        `Volume importado com sucesso via ${sourceLabel}! ${data.totalTickets.toLocaleString("pt-BR")} chamados distribuídos em ${data.weeks} semanas.`,
      );
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Erro inesperado ao consultar o HubSpot.";
      setErrorMsg(message);
      toast.error(`Erro: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isLoading && !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary mb-1">
            <CloudDownload className="h-5 w-5" />
            <DialogTitle className="text-base font-semibold">
              Buscar Volume Direto do HubSpot
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Consulta os chamados do Helpdesk (padrão oficial Databricks com fechamento real e canais
            de atendimento), calcula a média semanal por bloco de 10 minutos.
          </DialogDescription>
        </DialogHeader>

        {errorMsg && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1">{errorMsg}</div>
          </div>
        )}

        <div className="space-y-4 py-2">
          {/* Relatório oficial disponível no disco */}
          {matchedFile && !forceApi && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs flex items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <div className="truncate">
                  <p className="font-semibold text-emerald-300">Relatório Databricks Encontrado</p>
                  <p className="text-[11px] text-emerald-400/80 truncate font-mono">
                    {matchedFile.fileName}
                  </p>
                </div>
              </div>
              <span className="shrink-0 text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                Instantâneo & 100% Preciso
              </span>
            </div>
          )}

          {/* Atalhos de relatórios já exportados */}
          {availableFiles.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
                Relatórios Oficiais Disponíveis no Projeto
              </label>
              <div className="flex flex-wrap gap-1.5">
                {availableFiles
                  .filter((f) => f.fileName.startsWith("volume_10min_"))
                  .slice(0, 3)
                  .map((f) => {
                    const isSelected = f.startDate === startDate && f.endDate === endDate;
                    return (
                      <button
                        key={f.fileName}
                        type="button"
                        onClick={() => handleSelectFile(f)}
                        disabled={isLoading}
                        className={`text-[11px] px-2.5 py-1 rounded-md border font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                          isSelected
                            ? "bg-primary/15 border-primary text-primary font-semibold"
                            : "bg-muted/40 border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                      >
                        <Calendar className="h-3 w-3 shrink-0" />
                        <span>
                          {f.startDate.slice(5)} a {f.endDate.slice(5)}
                        </span>
                        <span className="text-[9px] uppercase font-mono px-1 py-0.2 bg-background/80 rounded border">
                          {f.type}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-medium text-muted-foreground">Período de Extração</span>
            <button
              type="button"
              onClick={set90DaysPreset}
              disabled={isLoading}
              className="text-xs text-primary hover:underline font-medium flex items-center gap-1 cursor-pointer"
            >
              <Calendar className="h-3 w-3" />
              Últimos 90 dias
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Data Início</label>
              <input
                type="date"
                value={startDate}
                disabled={isLoading}
                onChange={(e) => handleDateChange(e.target.value, endDate)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Data Fim</label>
              <input
                type="date"
                value={endDate}
                disabled={isLoading}
                onChange={(e) => handleDateChange(startDate, e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Divisor de Semanas (para cálculo da média semanal)
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={divisor}
              disabled={isLoading}
              onChange={(e) => setDivisor(Math.max(1, Number(e.target.value) || 1))}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
            <p className="text-[11px] text-muted-foreground">
              O total de chamados em cada faixa de 10 min será dividido por este número (padrão: 13
              para trimestres).
            </p>
          </div>

          {/* Opção avançada de forçar re-extração da API */}
          <div className="pt-1">
            <label className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={forceApi}
                onChange={(e) => setForceApi(e.target.checked)}
                disabled={isLoading}
                className="rounded border-input text-primary focus:ring-primary h-3.5 w-3.5"
              />
              <span className="flex items-center gap-1">
                <RefreshCw className="h-3 w-3" />
                Forçar nova consulta direta da API (ignora arquivos locais em storage/exports)
              </span>
            </label>
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="w-full sm:w-auto px-4 py-2 text-xs rounded-md border bg-background hover:bg-accent text-muted-foreground font-medium transition-colors disabled:opacity-50 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={isLoading}
            className="w-full sm:w-auto px-4 py-2 text-xs rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-sm cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Processando dados...</span>
              </>
            ) : (
              <>
                <CloudDownload className="h-4 w-4" />
                <span>
                  {matchedFile && !forceApi
                    ? "Sincronizar (Relatório Oficial)"
                    : "Sincronizar Chamados"}
                </span>
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
