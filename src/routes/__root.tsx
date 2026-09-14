// SEO static analysis helper: <title name="description" property="og:title
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SiteNav } from "@/components/SiteNav";
import { Sidebar } from "@/components/Sidebar";
import { DimensionamentoProvider, useDimensionamento } from "../context/DimensionamentoContext";
import { ThemeProvider } from "../context/ThemeContext";
import { Toaster } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div role="heading" aria-level={1} className="text-7xl font-bold">
          404
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Página não encontrada.</p>
        <a
          href="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Voltar ao início
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div role="heading" aria-level={1} className="text-3xl font-bold text-destructive">
          Erro de Aplicação
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Ocorreu um erro inesperado ao carregar o aplicativo.
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <button
            onClick={() => reset()}
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Início
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Dimensionamento Care" },
      { name: "description", content: "Painel interativo de dimensionamento de capacity do Care." },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning={true}>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.classList.add('dark');`,
          }}
        />
      </head>
      <body suppressHydrationWarning={true}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <DimensionamentoProvider>
          <RootLayoutContent />
        </DimensionamentoProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function RootLayoutContent() {
  const { isLoading, isResetConfirmOpen, setIsResetConfirmOpen, executeResetAll } =
    useDimensionamento();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    if (!isLoading && !hasLoadedOnce) {
      setHasLoadedOnce(true);
    }
  }, [isLoading, hasLoadedOnce]);

  useEffect(() => {
    setIsMounted(true);
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") {
      setIsSidebarCollapsed(true);
    }
  }, []);

  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    if (isMounted) {
      localStorage.setItem("sidebar-collapsed", String(isSidebarCollapsed));
    }
  }, [isSidebarCollapsed, isMounted]);

  return (
    <div className="flex flex-col min-h-screen bg-background relative">
      <SiteNav onOpenMobile={() => setIsMobileOpen(true)} />
      <Toaster />

      <Dialog open={isResetConfirmOpen} onOpenChange={setIsResetConfirmOpen}>
        <DialogContent className="max-w-md bg-card border border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Restaurar Valores Padrão?</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Esta ação substituirá todos os volumes, capacidades, fatores TMA e parâmetros pelos
              valores originais da semente. Não é possível desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button
              onClick={() => setIsResetConfirmOpen(false)}
              className="inline-flex items-center rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent border-border cursor-pointer"
            >
              Cancelar
            </button>
            <button
              onClick={executeResetAll}
              className="inline-flex items-center rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive/90 cursor-pointer"
            >
              Confirmar e Restaurar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-1">
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          isMobileOpen={isMobileOpen}
          onCloseMobile={() => setIsMobileOpen(false)}
        />
        <main className="flex-1 flex flex-col min-w-0 transition-all duration-300">
          {hasLoadedOnce && isLoading && (
            <div className="h-0.5 w-full bg-primary/20 overflow-hidden">
              <div className="h-full bg-primary animate-pulse w-full" />
            </div>
          )}
          <div className="w-full mx-auto max-w-[1400px] px-4 py-6 sm:py-8">
            <Outlet />
          </div>
        </main>
      </div>

      {!hasLoadedOnce && isLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2.5 p-5 bg-card border border-border shadow-2xl rounded-xl animate-in zoom-in-95 duration-200">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Inicializando sistema...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
