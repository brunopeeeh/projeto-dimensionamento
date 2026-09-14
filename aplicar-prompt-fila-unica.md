# Aplicar prompt de fila única

## Objetivo

Deixar inequívoco para o agente de IA que a defasagem recebida já representa a fila única consolidada de Helpdesk.

## Tarefas

- [x] Adicionar testes para o contexto de fila única e para a interpretação dos déficits.
- [x] Atualizar os prompts de sistema e de usuário sem alterar o contrato JSON existente.
- [x] Executar testes direcionados, suíte completa, lint, typecheck e build.

## Concluído quando

- [x] O prompt proíbe separar canais e contar Care IA ou Yooga Suporte como contratações.
- [x] O prompt define `0` como ausência de déficit e valores positivos como agentes humanos faltantes.
- [x] Todas as validações relevantes passam.
