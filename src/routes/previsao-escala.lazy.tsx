import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { useDimensionamento } from "@/context/DimensionamentoContext";
import { EscalaTeamManager } from "@/components/EscalaTeamManager";
import { Users, Sparkles, ArrowRight, AlertCircle, Settings2 } from "lucide-react";

export const Route = createLazyFileRoute("/previsao-escala")({
  component: PrevisaoEscalaPage,
});

function PrevisaoEscalaPage() {
  const teamAgents = useDimensionamento((s) => s.teamAgents);
  const newHires = useDimensionamento((s) => s.newHires);

  const activeCLT = teamAgents.filter((a) => a.active).length;
  const activeSimulated = newHires.filter((h) => h.active).length;
  const totalProjected = activeCLT + activeSimulated;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1">
            <span>Yooga Care · WFM</span>
            <span className="text-border">•</span>
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
              <Sparkles className="w-3.5 h-3.5" /> Previsão IA
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl text-foreground">
            Previsão da Escala
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Grade matricial de intervalos de 20 minutos com a equipe oficial CLT somada aos novos
            analistas recomendados pela IA com base no volume de chamados.
          </p>
        </div>

        <Link
          to="/contratacoes"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-muted/70 hover:bg-muted text-xs font-medium border border-border/50 text-foreground transition-all self-start sm:self-auto shadow-xs"
        >
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <span>Simulador de Contratações</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        </Link>
      </div>

      {/* KPI Cards: Resumo do Dimensionamento da Escala Futura */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-card p-4 text-card-foreground shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Headcount Projetado</span>
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight">{totalProjected}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {activeCLT} CLT base + {activeSimulated} novos IA
          </p>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-card-foreground shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              Novas Contratações (IA)
            </span>
            <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400">
            +{activeSimulated}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Alocados por turno conforme curva de chamados
          </p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-4 text-card-foreground shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Quadro CLT Vigente</span>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight">{activeCLT}</div>
          <p className="mt-1 text-xs text-muted-foreground">Analistas ativos na escala base</p>
        </div>
      </div>

      {/* Banner de Status / Guia de Contratações IA */}
      {activeSimulated > 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs text-emerald-900 dark:text-emerald-200">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="flex-1">
            <span className="font-semibold">Previsão Inteligente Ativa: </span>A grade de 20 minutos
            abaixo incorpora automaticamente os{" "}
            <span className="font-bold">{activeSimulated} novos analistas</span> calculados pelo
            motor de IA para absorver a demanda dos horários de pico. Eles estão sinalizados na
            grade com o prefixo{" "}
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">SIM</span>.
          </div>
          <Link
            to="/contratacoes"
            className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300 hover:underline shrink-0"
          >
            Ajustar no Simulador
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <span className="font-semibold">Nenhuma contratação simulada ativa: </span>A previsão
              está exibindo apenas a equipe CLT atual. Você pode gerar novos analistas
              automaticamente com base no volume de chamados na aba de Contratações.
            </div>
          </div>
          <Link
            to="/contratacoes"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 text-white dark:bg-amber-500 dark:text-neutral-950 font-semibold hover:opacity-90 shrink-0"
          >
            <span>Gerar Contratações IA</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* Grade Matricial de 20 Minutos com Equipe Oficial CLT + Analistas Simulados */}
      <EscalaTeamManager showSimulated={true} readOnlyCLT={true} />
    </div>
  );
}
