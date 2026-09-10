import { createLazyFileRoute } from "@tanstack/react-router";
import { TimeGridSheet } from "@/components/TimeGridSheet";
import { useDimensionamento } from "@/context/DimensionamentoContext";

export const Route = createLazyFileRoute("/helpdesk")({
  component: HelpdeskComponent,
});

function HelpdeskComponent() {
  const { currentMonth } = useDimensionamento();

  return (
    <div>
      <div className="mb-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {currentMonth}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Helpdesk</h1>
      </div>
      <TimeGridSheet
        mode="helpdesk"
        title="Volume × Capacity - Helpdesk"
        subtitle="Edite o Volume para ver Resultado e déficit atualizarem. Fila única — sem transbordo entre canais."
      />
    </div>
  );
}
