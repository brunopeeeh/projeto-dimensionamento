# Helpdesk: migração e cobertura noturna

## Objetivo

Consolidar provisoriamente Freshchat e HubSpot até 21/09/2026, preservar capacities manuais e aplicar a cobertura noturna fixa do Helpdesk.

## Tarefas

- [x] Centralizar a janela operacional e a regra de um agente fixo na madrugada. → Testes de segunda, terça e sábado aprovados.
- [x] Atualizar cálculo, sugestões e visualização para não dimensionar contratações na cobertura fixa. → Déficit normal e noturno verificados.
- [x] Preservar Care IA e Yooga Suporte em sincronizações. → Merge com valores previamente manuais verificado.
- [x] Tornar explícita no prompt de IA a última faixa de contratação, 15:00–00:00. → Conteúdo verificado por teste.
- [x] Atualizar a documentação Helpdesk e executar testes, lint, tipos e build. → Validações de código aprovadas.

## Concluído quando

- [x] A madrugada exige exatamente um agente nas janelas definidas, sem recomendar nova contratação.
- [x] O sync mantém os dois capacities manuais já existentes.
