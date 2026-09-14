# Evolução do Painel de Dimensionamento

## Objetivo

Transformar o painel em uma tela de análise gerencial que explique a situação da operação, destaque riscos por dia e horário e indique ações de escala ou contratação.

## Decisões já aprovadas

- “Agentes recomendados” exibirá a necessidade real calculada: se forem necessários 8, mostrará `8`, sem limitar ou trocar por `6+`.
- “Tamanho da equipe” contará apenas agentes humanos ativos; Care IA e Yooga Suporte aparecerão separadamente como composição de capacidade.
- “Cobertura Semanal (SLA)” será renomeada para “Cobertura estimada do volume”, com fórmula acessível na interface.
- Os gráficos Original e Prova Real usarão um único seletor e áreas de plotagem alinhadas.

## Hierarquia proposta

```text
[ Situação da semana | conclusão executiva | atualização dos dados ]
[ Cobertura ] [ Pico de falta ] [ Humanos ativos ] [ Agentes necessários ]
[ Heatmap de risco por dia/horário      | Faixas mais críticas ]
[ Helpdesk original                     | Prova Real simulada ]
[ Cobertura por dia | Composição da capacidade | Ações recomendadas ]
[ Qualidade dos dados e premissas do cálculo ]
```

## Plano de execução

- [x] **1. Corrigir a confiança dos indicadores** — filtrar apenas humanos no headcount, remover aliases especiais antigos do roster e deduplicar Care AI/Care IA. → Agosto/2026 validado com 10 humanos.
- [x] **2. Calcular a necessidade real de agentes** — substituir o retorno limitado a 6 por `{ quantidade, deficitResidual, viavel }`, continuando a estimativa até zerar o déficit ou comprovar inviabilidade pelas regras de escala. → Agosto/2026 calculado sem teto artificial e considerando a hora de almoço.
- [ ] **3. Criar um resumo executivo semanal** — gerar uma frase objetiva com cobertura, principal risco e ação prioritária, por exemplo: “Risco alto na terça às 17:20; priorize reforço entre 12:00 e 21:00”. → Verificar que o texto muda junto com mês, escala e simulação.
- [x] **4. Reorganizar os KPIs por decisão** — destacar cobertura, pico, humanos e necessidade real; incluir tooltips com fórmula, fonte e significado; apresentar o limite mensal de contratação como informação separada. → Indicadores e premissas disponíveis na própria tela.
- [ ] **5. Mostrar onde está o problema** — adicionar heatmap semanal e ranking das 5 faixas mais críticas com dia, horário, volume, capacidade, agentes online e agentes faltantes. → Verificar navegação da faixa crítica para o detalhe da escala.
- [x] **6. Melhorar a comparação Original × Prova Real** — usar seletor de dia único, mesma escala Y, cabeçalhos com altura fixa e alternância entre valores em chamados e equivalência de agentes. → Validado visualmente em desktop, 1024px e 768px.
- [ ] **7. Explicar a origem da capacidade** — apresentar humanos, Yooga Suporte e Care IA separadamente, deixando explícito que a IA não compõe headcount humano. → Verificar que a soma reproduz o capacity usado no cálculo.
- [ ] **8. Adicionar cobertura por dia e recomendações acionáveis** — mostrar cobertura diária, déficit acumulado, horários descobertos e sugestões de remanejamento antes de recomendar contratação. → Verificar que dias críticos não ficam escondidos pela média semanal.
- [ ] **9. Exibir qualidade e atualização dos dados** — informar última sincronização, origem Freshchat/HubSpot, valores manuais pendentes, agentes sem capacity, nomes duplicados e escalas incompletas. → Verificar estados normal, alerta, carregamento, vazio e erro.
- [ ] **10. Validar a entrega** — criar testes das fórmulas e seletores, testar responsividade/acessibilidade e executar suíte, lint, typecheck e build. → Verificar comparação visual em 1440px, 1024px e 768px.

## Prioridades

- **P0 — Correção:** tarefas 1, 2, 4 e 6.
- **P1 — Análise gerencial:** tarefas 3, 5, 7 e 8.
- **P2 — Confiança e acabamento:** tarefas 9 e 10.

## Concluído quando

- [ ] Um gestor identifica em menos de 30 segundos se existe falta, onde ela ocorre e quantas pessoas são realmente necessárias.
- [ ] Nenhum indicador mistura headcount humano com Care IA ou Yooga Suporte.
- [ ] Toda recomendação informa sua origem, premissas e déficit residual.
- [ ] Original e Prova Real podem ser comparados visualmente sem desalinhamento.
