import { Link } from "@tanstack/react-router";
import {
  Users,
  Headphones,
  ClipboardCheck,
  BarChart3,
  Calendar,
  CalendarCheck,
  CalendarRange,
  FlaskConical,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";

export const NAVIGATION_ITEMS = [
  { to: "/painel", label: "Painel", icon: BarChart3 },
  { to: "/escala", label: "Gestão de Escalas", icon: Calendar },
  { to: "/previsao-escala", label: "Previsão da Escala", icon: CalendarCheck },
  { to: "/capacidade", label: "Capacity por Agente", icon: Users },
  { to: "/helpdesk", label: "Helpdesk", icon: Headphones },
  { to: "/contratacoes", label: "Prova Real", icon: ClipboardCheck },
  { to: "/simulador", label: "Simulador de Cenários", icon: FlaskConical },
  { to: "/calculadora-anual", label: "Calculadora Anual", icon: CalendarRange },
] as const;

type SidebarProps = {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
};

export function Sidebar({
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
}: SidebarProps) {
  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm sm:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-card transition-all duration-300 ease-in-out sm:sticky sm:top-[61px] sm:h-[calc(100vh-61px)] ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0"
        } ${isCollapsed ? "sm:w-[72px]" : "sm:w-64"} w-64`}
      >
        <div className="flex h-14 items-center justify-between px-4 sm:hidden border-b">
          <span className="font-semibold text-foreground">Menu</span>
          <button
            onClick={onCloseMobile}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1.5 p-3 overflow-y-auto overflow-x-hidden">
          {NAVIGATION_ITEMS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={() => isMobileOpen && onCloseMobile()}
              activeProps={{ className: "bg-primary text-primary-foreground shadow-sm" }}
              activeOptions={{ exact: true }}
              className={`flex w-full items-center justify-start gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground ${
                isCollapsed ? "sm:justify-center sm:px-0" : ""
              }`}
              title={isCollapsed ? label : undefined}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span
                className={`truncate transition-opacity duration-200 ${
                  isCollapsed ? "sm:opacity-0 sm:w-0 sm:hidden" : "opacity-100"
                }`}
              >
                {label}
              </span>
            </Link>
          ))}
        </nav>

        <div className="border-t p-3 hidden sm:block">
          <button
            onClick={onToggleCollapse}
            className="flex w-full items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title={isCollapsed ? "Expandir menu" : "Recolher menu"}
          >
            {isCollapsed ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <ChevronLeft className="h-5 w-5" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
