import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Day } from "@/context/DimensionamentoContext";
import { DaySelector } from "@/components/DaySelector";

type ChartPoint = {
  time: string;
  resultado: number;
  prResultado: number;
};

type Props = {
  chartData: ChartPoint[];
  chartDay: Day;
  isProvaReal: boolean;
  onChartDayChange: (day: Day) => void;
};

export function TimeGridChart({ chartData, chartDay, isProvaReal, onChartDayChange }: Props) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm border-border mt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-4 mb-5">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {isProvaReal
              ? `Resultado Prova Real - ${chartDay}`
              : `Resultado Helpdesk - ${chartDay}`}
          </h3>
          <p className="text-xs text-muted-foreground">
            Excedente ou déficit operacional medido em equivalência de analistas (Agentes).
          </p>
        </div>

        <DaySelector
          value={chartDay}
          onChange={(day) => {
            if (day !== "Todos") onChartDayChange(day);
          }}
          variant="compact"
        />
      </div>

      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="rgba(148, 163, 184, 0.12)"
            />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              interval={3}
              tick={{ fill: "rgba(148, 163, 184, 0.75)", fontSize: 10 }}
            />
            <YAxis
              domain={[-6, 6]}
              ticks={[-6, -4, -2, 0, 2, 4, 6]}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "rgba(148, 163, 184, 0.75)", fontSize: 10 }}
            />
            <Tooltip
              cursor={{ fill: "rgba(148, 163, 184, 0.05)" }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded-lg border bg-popover p-3 shadow-md border-border text-xs">
                      <p className="font-semibold text-foreground border-b border-border/40 pb-1 mb-1.5">
                        {payload[0].payload.time}
                      </p>
                      {payload.map((item) => {
                        const val = Number(item.value ?? 0);
                        const isPositive = val >= 0;
                        const colorClass = isPositive
                          ? "text-emerald-500 font-bold"
                          : "text-rose-500 font-bold";
                        return (
                          <div key={item.name} className="flex justify-between gap-6 py-0.5">
                            <span className="text-muted-foreground">{item.name}:</span>
                            <span className={colorClass}>
                              {isPositive ? `+${val.toFixed(2)}` : val.toFixed(2)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend
              iconSize={8}
              iconType="circle"
              wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
            />
            <ReferenceLine y={0} stroke="rgba(148, 163, 184, 0.45)" strokeWidth={1.5} />

            {isProvaReal ? (
              <Bar
                dataKey="prResultado"
                name="Resultado Prova Real"
                fill="#10b981"
                radius={[3, 3, 0, 0]}
              />
            ) : (
              <Bar
                dataKey="resultado"
                name="Resultado Helpdesk"
                fill="#3b82f6"
                radius={[3, 3, 0, 0]}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
