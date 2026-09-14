# Capacity manual de Yooga Suporte e Care IA

## Objetivo

Garantir que toda sincronização grave Yooga Suporte e Care IA com capacity zero, independentemente dos nomes recebidos do Freshchat ou HubSpot.

## Tarefas

- [x] Isolar a montagem da lista sincronizada e excluir aliases de IA/Yooga → Verificado com teste unitário.
- [x] Acrescentar somente `Yooga Suporte` e `Care IA` com `mediaTri: 0` → Verificado na resposta da função pura.
- [x] Executar testes, lint direcionado, typecheck e build → Validações da alteração concluídas.

## Concluído quando

- [x] Nenhum volume automático de IA/Yooga chega ao Supabase pela sincronização.
- [x] Agentes humanos continuam somando Freshchat + HubSpot normalmente.
