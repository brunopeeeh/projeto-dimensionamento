# Aba Tira-dúvidas

## Objetivo

Criar uma central de ajuda pesquisável, acessível pelo menu lateral, com explicações simples e detalhes de cálculo do dimensionamento.

## Tarefas

- [x] Modelar perguntas, categorias e busca sem acento → verificar com testes unitários.
- [x] Criar a rota `/tira-duvidas` com contexto atual e respostas expansíveis → verificar renderização e estados vazio/filtrado.
- [x] Adicionar a entrada ao menu lateral sem sobrescrever mudanças existentes → verificar navegação desktop e mobile.
- [x] Atualizar documentação do projeto → verificar links e descrição da funcionalidade.
- [x] Executar auditoria de acessibilidade, lint, tipos e testes da funcionalidade.

## Pronto quando

- [x] Usuários encontram dúvidas por texto ou categoria e conseguem abrir a explicação detalhada pelo teclado.
- [x] A aba usa dados atuais do mês apenas como exemplo, sem alterar cálculos ou persistência.

## Validação

- A busca e os filtros foram exercitados no navegador, inclusive com termo sem acento e URL compartilhável.
- Os arquivos da funcionalidade passaram no ESLint e os 4 testes unitários passaram.
- A checagem global de tipos está bloqueada por um `index` não utilizado em `EscalaSemanalTeste.tsx`, arquivo já modificado antes desta implementação.
