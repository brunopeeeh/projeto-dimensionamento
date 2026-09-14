import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleSyncCapacity } from "./lib/api/sync-capacity.server";
import type { SyncCapacityBody } from "./lib/api/sync-capacity.server";
import { runFreshchatSync } from "./lib/api/freshchat.server";
import type { FreshchatSyncResult } from "./lib/api/freshchat.server";
import { runAiSuggestion } from "./lib/api/ai-agent.server";
import type { AiSuggestionRequest, AiSuggestionResponse } from "./lib/api/ai-agent.server";
import { runMathSuggestion } from "./lib/optimization/solver";
import { hasValidApiKey, isCrossSite, isUnkeyedNonBrowserRequest } from "./lib/api-guards";
import { getHubspot10MinVolume, listExportedVolumes } from "./lib/api/hubspot-volume.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Sem cabeçalhos CORS: a UI chama estes endpoints por URL relativa (mesma
// origem) e o n8n chama server-to-server, onde CORS não se aplica. O `*`
// anterior liberava qualquer site do browser a queimar as chaves de IA e a
// escrever no Supabase via SERVICE_ROLE_KEY.
const API_HEADERS = {
  "content-type": "application/json",
};

// Handle custom API routes before delegating to TanStack Start SSR
async function handleApiRoutes(request: Request): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/")) {
    if (isCrossSite(request, url)) {
      return new Response(JSON.stringify({ success: false, error: "Origem não permitida." }), {
        status: 403,
        headers: API_HEADERS,
      });
    }

    // Requisições sem `Origin` (curl, scripts, n8n mal configurado) precisam da
    // chave, senão queimam tokens pagos e escrevem no Supabase via service role.
    if (request.method !== "OPTIONS" && isUnkeyedNonBrowserRequest(request)) {
      return new Response(
        JSON.stringify({ success: false, error: "Não autorizado: x-api-key ausente ou inválida." }),
        { status: 401, headers: API_HEADERS },
      );
    }

    // /api/sync-capacity só é chamada pelo n8n (a UI usa /api/sync-from-freshchat,
    // que invoca handleSyncCapacity internamente). Escreve com service role.
    if (
      url.pathname === "/api/sync-capacity" &&
      request.method !== "OPTIONS" &&
      !hasValidApiKey(request)
    ) {
      return new Response(
        JSON.stringify({ success: false, error: "Não autorizado: x-api-key ausente ou inválida." }),
        { status: 401, headers: API_HEADERS },
      );
    }
  }

  // POST /api/sync-capacity — manually invoked or proxied from /api/sync-from-freshchat
  if (url.pathname === "/api/sync-capacity") {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: API_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Method not allowed. Use POST." }),
        { status: 405, headers: API_HEADERS },
      );
    }

    try {
      const body = (await request.json()) as SyncCapacityBody;
      const result = await handleSyncCapacity(body);
      return new Response(JSON.stringify(result.data), {
        status: result.status,
        headers: API_HEADERS,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao processar requisição.";
      return new Response(JSON.stringify({ success: false, error: message }), {
        status: 400,
        headers: API_HEADERS,
      });
    }
  }

  // POST /api/sync-from-freshchat — called by the /capacidade UI button.
  // Triggers an end-to-end Freshchat → Supabase sync for the given month.
  if (url.pathname === "/api/sync-from-freshchat") {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: API_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Method not allowed. Use POST.",
          month: "",
          agents_synced: 0,
          agents_added_to_team: [],
          agents_removed_from_team: [],
          total_team_agents: 0,
          error: "METHOD_NOT_ALLOWED",
        }),
        { status: 405, headers: API_HEADERS },
      );
    }

    try {
      const body = (await request.json()) as { month?: string; teamAgentNames?: string[] };
      const result: FreshchatSyncResult = await runFreshchatSync({
        month: body.month || "",
        teamAgentNames: Array.isArray(body.teamAgentNames) ? body.teamAgentNames : [],
      });
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: API_HEADERS,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao sincronizar com Freshchat.";
      const errorBody: FreshchatSyncResult = {
        success: false,
        message: `Falha no sync: ${message}`,
        month: "",
        agents_synced: 0,
        agents_added_to_team: [],
        agents_removed_from_team: [],
        total_team_agents: 0,
        error: message,
      };
      return new Response(JSON.stringify(errorBody), {
        status: 500,
        headers: API_HEADERS,
      });
    }
  }

  // GET /api/hubspot-volume-files — lista arquivos exportados disponíveis em storage/exports/
  if (url.pathname === "/api/hubspot-volume-files") {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: API_HEADERS });
    }

    try {
      const files = listExportedVolumes();
      return new Response(JSON.stringify({ success: true, files }), {
        status: 200,
        headers: API_HEADERS,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao listar arquivos.";
      return new Response(JSON.stringify({ success: false, error: message, files: [] }), {
        status: 500,
        headers: API_HEADERS,
      });
    }
  }

  // POST /api/hubspot-volume — busca tickets do HubSpot e gera médias por faixas de 10 minutos
  if (url.pathname === "/api/hubspot-volume") {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: API_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Method not allowed. Use POST." }),
        { status: 405, headers: API_HEADERS },
      );
    }

    try {
      const body = (await request.json()) as {
        startDate?: string;
        endDate?: string;
        divisor?: number;
        fileName?: string;
        forceApi?: boolean;
      };

      if (!body.startDate || !body.endDate) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Parâmetros 'startDate' e 'endDate' (YYYY-MM-DD) são obrigatórios.",
          }),
          { status: 400, headers: API_HEADERS },
        );
      }

      const result = await getHubspot10MinVolume({
        startDate: body.startDate,
        endDate: body.endDate,
        divisor: body.divisor,
        fileName: body.fileName,
        forceApi: body.forceApi,
      });

      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: API_HEADERS,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao processar requisição.";
      return new Response(JSON.stringify({ success: false, error: message }), {
        status: 500,
        headers: API_HEADERS,
      });
    }
  }

  // POST /api/ai-suggestion — OpenRouter-powered hiring suggestions
  if (url.pathname === "/api/ai-suggestion") {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: API_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Method not allowed. Use POST.",
          month: "",
          cached: false,
          attempts: 0,
          agents: [],
          model: "",
          generatedAt: new Date().toISOString(),
        } satisfies AiSuggestionResponse),
        { status: 405, headers: API_HEADERS },
      );
    }

    try {
      const body = (await request.json()) as AiSuggestionRequest;
      const result = await runAiSuggestion(body);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 422,
        headers: API_HEADERS,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao gerar sugestão.";
      const errorBody: AiSuggestionResponse = {
        success: false,
        message: `Falha: ${message}`,
        month: "",
        cached: false,
        attempts: 0,
        agents: [],
        model: "",
        generatedAt: new Date().toISOString(),
      };
      return new Response(JSON.stringify(errorBody), {
        status: 500,
        headers: API_HEADERS,
      });
    }
  }

  // POST /api/math-suggestion — Mathematical Optimization (Operations Research)
  if (url.pathname === "/api/math-suggestion") {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: API_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Method not allowed. Use POST.",
          month: "",
          cached: false,
          attempts: 0,
          agents: [],
          model: "",
          generatedAt: new Date().toISOString(),
        } satisfies AiSuggestionResponse),
        { status: 405, headers: API_HEADERS },
      );
    }

    try {
      const body = (await request.json()) as AiSuggestionRequest;
      const result = runMathSuggestion(body); // Synchronous
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: API_HEADERS,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao gerar otimização matemática.";
      const errorBody: AiSuggestionResponse = {
        success: false,
        message: `Falha: ${message}`,
        month: "",
        cached: false,
        attempts: 0,
        agents: [],
        model: "",
        generatedAt: new Date().toISOString(),
      };
      return new Response(JSON.stringify(errorBody), {
        status: 500,
        headers: API_HEADERS,
      });
    }
  }

  return null; // Not an API route — delegate to TanStack Start
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Check custom API routes first
      const apiResponse = await handleApiRoutes(request);
      if (apiResponse) return apiResponse;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
