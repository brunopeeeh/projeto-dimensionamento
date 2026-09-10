# Dimensionamento Care — Yooga

Sistema interno para planejar a escala de atendimento, comparar capacidade com demanda e simular contratações do time Care da Yooga.

## Objetivo

O painel transforma volume de atendimentos e a escala ativa em uma visão por faixa de 10 minutos. Assim, a operação consegue identificar gargalos, ajustar turnos e testar o efeito de novas contratações antes de aplicá-las na escala real.

## Como o dimensionamento funciona

- A fila de atendimento é única (Helpdesk).
- Os volumes e a capacidade dos agentes humanos são consolidados entre Freshchat e HubSpot durante a migração, sem deduplicação temporária.
- A escala calcula capacidade por agente conforme o fator diário de TMA e o limite de atendimentos simultâneos.
- A "Prova Real" permite simular admissões sem alterar a escala atual.
- A calculadora anual permanece independente deste fluxo.

## Regras operacionais atuais

Estas regras refletem a operação enquanto a migração para o Helpdesk estiver ativa. A consolidação só deve ser desativada após uma decisão operacional, independentemente de uma data prevista:

| Período | Atendimento | Regra de cobertura |
| --- | --- | --- |
| Terça a sábado | 07:00–03:00 | De 00:00 a 03:00, exatamente 1 agente na escala |
| Domingo e segunda | 07:00–01:00 | De 00:00 a 01:00, exatamente 1 agente na escala |

- O turno de referência da madrugada é **18:00–03:00**, realizado pela **Maria Luiza**.
- O sistema cobra a presença de uma pessoa na escala fixa; não adiciona automaticamente a Maria Luiza à agenda.
- Para novas contratações, o último turno permitido é **15:00–00:00**. A madrugada não entra como necessidade de contratação.
- Fora do horário de atendimento, volumes, capacidade e déficit são ignorados no cálculo e na exportação.

## Dados preenchidos manualmente

Enquanto a migração estiver em andamento, os valores de **Care IA** e **Yooga Suporte** são preenchidos manualmente na tela de capacidade. As sincronizações não substituem esses dois valores.

## Principais recursos

- **Painel operacional:** indicadores, volumes, capacidade e cobertura por faixa horária.
- **Gerenciador de escala:** cadastro de pessoas, turnos, pausas, almoço e folgas.
- **Prova Real:** simulação de novas contratações sobre a demanda consolidada.
- **Capacidade:** médias trimestrais, fatores de TMA por dia e sincronização dos dados disponíveis.
- **Exportação Excel:** reproduz a grade de volume, capacidade, resultado e agentes necessários com as mesmas regras do painel.

## Tecnologias

- React, TypeScript e Tailwind CSS
- TanStack Start, Vinxi e Vite
- Supabase (PostgreSQL e persistência das escalas)
- ExcelJS para exportação de planilhas

## Desenvolvimento

```bash
npm install
npm run dev
```

Validações disponíveis:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Para detalhes de regras e integrações, consulte [DOCUMENTACAO_DIMENSIONAMENTO_HELPDESK.md](./DOCUMENTACAO_DIMENSIONAMENTO_HELPDESK.md).
