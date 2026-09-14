# Relatório de Bugs — Dimensionamento Care

Data: 2026-09-10

## Resultados da verificação automática

| Verificação | Resultado |
| --- | --- |
| `npm run test` | 18 arquivos, 111 testes **passam** |
| `npm run typecheck` | limpo |
| `npm run lint` | **falha — 68 erros prettier** (não conclui em 10min no `eslint .`) |

---

## HIGH — verificado manualmente

### 1. `updateTeamAgentName` renomeia só metade

- **Local:** `src/context/DimensionamentoContext.tsx:240-258`
- **Uso ativo:** `src/components/EscalaTeamManager.tsx:326`

`oldName` é capturado via side-effect **dentro** do updater de `setTeamAgents`:

```ts
let oldName = "";
setTeamAgents((prev) =>
  prev.map((agent) => {
    if (agent.id === agentId) {
      oldName = agent.name; // side-effect no updater
      return { ...agent, name: newName };
    }
    return agent;
  }),
);
if (oldName) { /* renomeia capacity agent */ }
```

O updater não executa síncrono (roda no próximo render; 2x em StrictMode). `oldName` ainda é `""` quando chega no `if (oldName)`, então o agente de capacity **nunca é renomeado**.

**Consequência:** o `matchAgentName` quebra e o agente cai no fallback `DEFAULT_MEDIA_TRI = 750`, corrompendo o cálculo de capacidade.

**Correção sugerida:** ler o nome antes do `setTeamAgents`:

```ts
const target = teamAgents.find((a) => a.id === agentId);
const oldName = target?.name ?? "";
setTeamAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, name: newName } : a)));
if (oldName) {
  setCapacityAgents((prev) => prev.map((ca) => (matchAgentName(ca.name, oldName) ? { ...ca, name: newName } : ca)));
}
```

---

### 2. Rotas `/api/*` sem chave de API

- **Local:** `src/server.ts:113` (`/api/sync-from-freshchat`) e `:164` (`/api/ai-suggestion`)
- Também afeta `/api/math-suggestion` (`:212`), porém com impacto menor (CPU, sem token pago).

Apenas `/api/sync-capacity` tem `hasValidApiKey`. As demais têm somente `isCrossSite`, que **libera requisições sem `Origin`** (curl, scripts, n8n mal configurado).

**Consequência:** um cliente sem origem pode:
- queimar tokens pagos Freshchat/HubSpot e chaves de IA (NVIDIA/DeepSeek/OpenRouter);
- escrever no Supabase via `SERVICE_ROLE_KEY` (bypassa RLS).

**Observação:** o design atual documenta que só `sync-capacity` é "sensível". Ainda assim é uma porta aberta — qualquer rota nova deve passar pelas mesmas guards (`src/lib/api-guards.ts`).

---

## MEDIUM — verificado manualmente

### 3. `parseLooseNumber` corrompe milhar pt-BR

- **Local:** `src/features/calculadora-anual/engine/number-input.ts:20-30`

`"6.800"` (6800, separador de milhar pt-BR) é interpretado como decimal `.` → `6.8`.

**Consequência:** campo inteiro da calculadora-anual colapsa ~1000× ao editar (ex.: 6800 clientes vira 6,8 → 7).

---

### 4. Vazamento de dados na troca de mês

- **Local:** `src/hooks/useSupabasePersistence.ts:211-223`

Os setters são guardados por `if (escalaRes.data)` / `if (paramsRes.data)`. Se o mês de destino não tem linha em `escala_equipe` / `parametros_operacionais` (`maybeSingle` → `null`), os setters **não rodam** e os valores do mês anterior vazam:

- `teamAgents`, `capacityAgents` (sem fallback);
- `tmaFactors`, `simultaneous`, `scenarios`, `newHires` (sem fallback).

`volumes` tem fallback (`?? seed.helpdeskVolumes`), os demais não.

**Consequência:** agentes do mês anterior aparecem no mês novo e são auto-salvos no mês errado.

---

### 5. `updateTmaFactor` é caminho morto

- **Local:** `src/context/DimensionamentoContext.tsx:196-202` + `:426-438`

A edição manual de TMA persiste em `tma_factors`, mas o cálculo usa `computeDynamicTmaFactors` (derivado do `mediaTri` dos agentes de capacity). O `tmaFactors` exposto no context (`:557`) é o **computado**, não o editado.

- Nenhum componente chama `updateTmaFactor`.
- O estado manual só é lido/escrito em `useSupabasePersistence` (`tma_factors` no banco), nunca nos cálculos.

**Consequência:** se reativarem o editor de TMA, ele não terá efeito. Estado morto persistido sem função.

---

### 6. `npm run lint` quebrado

- 68 erros `prettier/prettier`, maioria de line ending (`Insert ␍`) — arquivos LF/CRLF mistos.
- Erros reais de formatação: `src/components/TimeGridSheet.tsx:399,402` e `src/lib/operating-hours.ts:30`.
- `eslint .` (full) não termina em 10min — varre a árvore inteira (não ignora dirs fora de `src`, ex.: `graphify-out`, `tmp`, `scratch`).

**Causa provável:** `.prettierrc` com `endOfLine: "auto"` + `.gitattributes` `* text=auto` produz checkout com final de linha inconsistente no Windows.

**Correção sugerida:** fixar `endOfLine` (ex.: `"lf"`) e rodar `npm run format`, ou ignorar diretórios não-fonte no `eslint.config.js`.

---

## MEDIUM/LOW — reportado por subagente (revisão automatizada, não re-verificado a fundo)

### calculadora-anual (`src/features/calculadora-anual/engine/`)

- **`calculator.ts:274`** — modo `"antecipado"` não desloca início de contratação; resultado idêntico ao modo normal.
- **`calculator.ts:263`** — turnover não aplicado ao headcount inicial (`hcEffective` semeado a 100%).
- **`calculator.ts:317/348`** — double-ceil: `agentsNeeded = ceil(...)` + `gap = ceil(agentsNeeded - hcEffective)` gera gap espúrio de 1 para déficit sub-1 FTE.
- **`capacity.ts:19-22`** — `maxConcurrentAgents` fixo em 1; subestima férias com equipe grande.
- **`turnover.ts:76,103`** — `Math.min(monthlyRate, 50)` silencia turno >50% sem aviso.
- **`turnover.ts:17-22`** — modo automático ignora período; trimestral/semestral viram headcount mensal fracionado.
- **`demand.ts:28`** — piso linear `max(current*0.1, …)` impede crescimento negativo alcançar meta menor.
- **`timeline.ts:4,20`** — `MONTH_LIMIT=24` trunca períodos longos silenciosamente.

### Integrações server-only (`src/lib/api/`)

- **`freshchat.server.ts:311`** — `RENAME_MAP[lc(fullName)]` nunca casa (keys mistas); rename case-insensitive não dispara.
- **`freshchat.server.ts:284`** — `EXCLUDE_NAMES` sem normalize; variantes com acento de "Maya Santos" não excluídas → volume de bot vaza.
- **`hubspot.server.ts:112-127`** — `countTickets` retorna 0 silencioso em erro não-429; volume subestimado.
- **`hubspot.server.ts:47`** — owners `limit=500` sem paginação; >500 owners truncados.
- **`error-capture.ts:4-26`** — singleton global `lastCapturedError` compartilhado entre requests concorrentes; atribuição de stack errada.
- **`sync-capacity.server.ts:115-116`** — valida só `typeof mediaTri === "number"`; `NaN`/`Infinity` passam e viram `null` no JSONB.

### Solver (`src/lib/optimization/solver.ts`)

- **`:176`** — comentário afirma 194.580 combinações; real P=36 → C(39,4)=82.251.
- **`:249`** — `bestScore.toFixed(2)` imprime `"Infinity"` se nenhuma combinação passa regra 6/7 (e retorna `success:true` com zero agentes).
- **`:39-43`** — `timeToIndex` sem clamp; `row.start` fora de faixa (ex.: `"24:00"`) → escrita OOB no `Float64Array` silenciosa.

---

## Sem bugs encontrados

- `src/lib/time.ts`, `src/lib/operating-hours.ts` (lógica de horário/turno overnight).
- `src/lib/agents.ts` (normalização/nome).
- `src/lib/optimization/solver.ts` — sem loop infinito (residual decresce estritamente), sem divisão por zero.
- `src/lib/api/*.server.ts` — sem SQL injection (tudo via `.eq()`/`.upsert` parametrizado).
- `src/context/types.ts`, `src/context/useInitialData.ts`.

---

## Prioridade sugerida de correção

1. **#1** — bug funcional ativo, corrompe capacidade ao renomear agente.
2. **#2** — exposição de tokens pagos / escrita service-role.
3. **#6** — lint quebrado (bloqueia CI).
4. **#3** — corrupção de entrada numérica na calculadora-anual.
5. **#4** — vazamento de estado entre meses.
6. Demais, conforme capacidade.
