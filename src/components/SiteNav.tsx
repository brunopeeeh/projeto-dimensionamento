import { useState, useEffect, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useDimensionamento, type SaveStatus } from "@/context/DimensionamentoContext";
import {
  Activity,
  Calendar,
  Plus,
  Loader2,
  Check,
  CloudOff,
  Menu,
  Eye,
  Lock,
  Unlock,
} from "lucide-react";

function SaveIndicator({ status }: { status: SaveStatus }) {
  const config = {
    saving: {
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      label: "Salvando...",
      className: "text-muted-foreground",
    },
    saved: {
      icon: <Check className="h-3 w-3" />,
      label: "Salvo",
      className: "text-emerald-600 dark:text-emerald-400",
    },
    error: {
      icon: <CloudOff className="h-3 w-3" />,
      label: "Erro ao salvar",
      className: "text-destructive",
    },
    idle: null,
  }[status];

  if (!config) return null;

  return (
    <div
      className={`flex items-center gap-1 border-l pl-2 ml-1 h-7 text-[11px] font-semibold select-none transition-colors ${config.className}`}
      title={status === "error" ? "Falha ao sincronizar com o servidor" : undefined}
      aria-live="polite"
    >
      {config.icon}
      <span className="hidden sm:inline">{config.label}</span>
    </div>
  );
}

type SiteNavProps = {
  onOpenMobile: () => void;
};

export function SiteNav({ onOpenMobile }: SiteNavProps) {
  const {
    currentMonth,
    availableMonths,
    isLoading,
    saveStatus,
    changeActiveMonth,
    createNewMonth,
    isReadOnly,
    setIsReadOnly,
  } = useDimensionamento();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newMonthName, setNewMonthName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [pendingMonthChange, setPendingMonthChange] = useState<string | null>(null);

  const closeModal = useCallback(() => {
    if (isCreating) return;
    setIsModalOpen(false);
    setNewMonthName("");
  }, [isCreating]);

  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isModalOpen, closeModal]);

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "ADD_NEW") {
      setIsModalOpen(true);
      return;
    }
    setPendingMonthChange(val);
  };

  const handleCreateMonth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMonthName.trim()) return;

    setIsCreating(true);
    try {
      await createNewMonth(newMonthName.trim());
      closeModal();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido.";
      console.error(err);
      toast.error(`Falha ao criar período: ${message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur-md">
        <div className="flex h-[61px] items-center px-4 w-full">
          <button
            onClick={onOpenMobile}
            className="mr-3 sm:hidden rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-2">
            <Link to="/painel" className="flex items-center gap-2 mr-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Activity className="h-4 w-4" />
              </div>
              <div className="leading-tight hidden sm:block">
                <div className="text-sm font-semibold text-foreground">Dimensionamento Care</div>
              </div>
            </Link>
            <div className="flex items-center gap-1.5 border-l pl-3 py-1">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground mr-0.5" aria-hidden="true" />
              <label htmlFor="month-select" className="sr-only">
                Selecionar mês de planejamento
              </label>
              <select
                id="month-select"
                value={currentMonth}
                onChange={handleMonthChange}
                disabled={isLoading}
                aria-label="Selecionar mês de planejamento"
                className="bg-muted/40 border border-border/80 rounded-md text-xs md:text-sm font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-ring/40 cursor-pointer hover:bg-muted/80 hover:text-foreground transition-all px-2 py-1 select-none"
              >
                {availableMonths.map((m) => (
                  <option key={m} value={m} className="bg-card text-foreground text-xs">
                    {m}
                  </option>
                ))}
                <option value="ADD_NEW" className="bg-card text-primary text-xs font-semibold">
                  + Adicionar Novo Mês
                </option>
              </select>
              {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />}
            </div>

            {isReadOnly ? (
              <div className="flex items-center gap-1 border-l pl-3 ml-1 h-7">
                <span className="text-[10px] uppercase font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-sm mr-1 tracking-wider hidden sm:inline-block">
                  Visualização
                </span>
                <button
                  onClick={() => setIsReadOnly(false)}
                  className="text-muted-foreground hover:text-amber-500 transition-colors"
                  title="Destrancar para Edição"
                >
                  <Lock className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 border-l pl-3 ml-1 h-7">
                <button
                  onClick={() => setIsReadOnly(true)}
                  className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                  title="Trancar Mês (Modo Visualização)"
                >
                  <Unlock className="h-4 w-4" />
                </button>
              </div>
            )}

            {!isLoading && saveStatus !== "idle" && <SaveIndicator status={saveStatus} />}
          </div>

          <div className="flex-1" />
        </div>
      </header>

      {pendingMonthChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Acessar Mês
            </h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Você está prestes a abrir o mês de <strong>{pendingMonthChange}</strong>. Como deseja
              acessá-lo?
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={() => {
                  setIsReadOnly(true);
                  changeActiveMonth(pendingMonthChange);
                  setPendingMonthChange(null);
                }}
                className="flex items-center gap-3 w-full rounded-lg border p-4 text-left hover:bg-accent transition-colors"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                  <Eye className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-sm">Somente Visualização</div>
                  <div className="text-xs text-muted-foreground">
                    Bloqueia edições acidentais (Recomendado).
                  </div>
                </div>
              </button>

              <button
                onClick={() => {
                  setIsReadOnly(false);
                  changeActiveMonth(pendingMonthChange);
                  setPendingMonthChange(null);
                }}
                className="flex items-center gap-3 w-full rounded-lg border p-4 text-left hover:bg-accent transition-colors"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                  <Unlock className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-sm">Modo Edição</div>
                  <div className="text-xs text-muted-foreground">
                    Permite alterar volumes, escalas e capacidades.
                  </div>
                </div>
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setPendingMonthChange(null)}
                className="rounded-md px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-month-title"
            className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="create-month-title"
              className="text-lg font-semibold text-foreground flex items-center gap-2"
            >
              <Calendar className="h-5 w-5 text-primary" aria-hidden="true" />
              Adicionar Novo Mês de Planejamento
            </h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Um novo período será criado. A escala de equipe e capacidades serão clonadas
              automaticamente do mês de <strong>{currentMonth}</strong>. Os volumes de chamados
              iniciarão zerados.
            </p>
            <form onSubmit={handleCreateMonth} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="new-month-name"
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5"
                >
                  Nome do Mês / Período
                </label>
                <input
                  id="new-month-name"
                  type="text"
                  required
                  placeholder="Ex: Março 2026, Abril 2026..."
                  value={newMonthName}
                  onChange={(e) => setNewMonthName(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  disabled={isCreating}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                  disabled={isCreating}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  disabled={isCreating || !newMonthName.trim()}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Criando...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Criar Período
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
