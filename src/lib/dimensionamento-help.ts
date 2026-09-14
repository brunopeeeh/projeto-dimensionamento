export const HELP_CATEGORIES = [
  "Fundamentos",
  "Painel",
  "Escala e contratações",
  "Dados e operação",
  "Modelos em teste",
] as const;

export type HelpCategory = (typeof HELP_CATEGORIES)[number];

export type HelpItem = {
  id: string;
  category: HelpCategory;
  question: string;
  shortAnswer: string;
  details: readonly string[];
  formula?: string;
  keywords?: readonly string[];
};

export const DIMENSIONAMENTO_HELP_ITEMS: readonly HelpItem[] = [
  {
    id: "capacity",
    category: "Fundamentos",
    question: "O que é Capacity?",
    shortAnswer:
      "É a estimativa de quantos atendimentos a equipe consegue absorver em uma faixa de 10 minutos.",
    details: [
      "O sistema parte da produtividade histórica dos agentes e considera somente pessoas humanas marcadas como trabalhando naquela faixa da escala.",
      "Yooga Suporte representa uma posição agregada no divisor. A Care IA pode ser ativada ou desativada facilmente (via seletor ou deixando o volume zerado), calculando com a base humana de 20 dias e 8h sem ocupar assento no divisor.",
      "A capacidade usada na comparação com o volume é arredondada para cima.",
    ],
    formula: "Capacity da faixa = agentes humanos online × capacidade de um agente",
    keywords: ["capacidade", "produtividade", "atendimentos"],
  },
  {
    id: "capacity-agent",
    category: "Fundamentos",
    question: "Como é calculada a capacidade de um agente?",
    shortAnswer:
      "O fator histórico do dia é ajustado pela quantidade configurada de atendimentos simultâneos.",
    details: [
      "O fator diário representa quantos chamados um agente resolve, em média, a cada 10 minutos. Ele é obtido a partir das médias trimestrais cadastradas na tela de Capacity.",
      "A configuração de simultaneidade usa três atendimentos como referência. Alterar esse valor aumenta ou reduz proporcionalmente a capacidade estimada.",
    ],
    formula: "Capacidade por agente = fator diário × (simultâneos configurados ÷ 3)",
    keywords: ["media tri", "média trimestral", "simultaneidade", "fator"],
  },
  {
    id: "tma",
    category: "Fundamentos",
    question: "O que é TMA e como ele afeta o dimensionamento?",
    shortAnswer:
      "TMA é o tempo médio de atendimento. Quanto maior ele for, menor tende a ser a capacidade da equipe.",
    details: [
      "Um atendimento mais demorado ocupa o agente por mais tempo e reduz a quantidade de conversas que podem ser absorvidas no período.",
      "Durante a migração de plataforma, o TMA operacional de referência é 20 minutos. Como o dado observado está temporariamente elevado, ele não deve substituir automaticamente a referência sem validação.",
    ],
    keywords: ["tempo médio", "20 minutos", "migracao", "migração"],
  },
  {
    id: "volume",
    category: "Fundamentos",
    question: "O que representa o Volume?",
    shortAnswer:
      "É a quantidade média de atendimentos que chegam ao Helpdesk em cada faixa de 10 minutos.",
    details: [
      "O volume é organizado por horário e dia da semana para preservar os picos que uma média diária esconderia.",
      "Somente faixas dentro do horário de atendimento entram nos totais e nos indicadores de cobertura.",
    ],
    keywords: ["chamados", "demanda", "faixa", "dez minutos"],
  },
  {
    id: "simultaneous",
    category: "Fundamentos",
    question: "O que são atendimentos simultâneos?",
    shortAnswer:
      "É a quantidade de conversas que um agente pode conduzir ao mesmo tempo sem perder qualidade.",
    details: [
      "Essa configuração ajusta a capacidade por agente. Ela não altera a quantidade de pessoas presentes na escala.",
      "Aumentar o número apenas para melhorar o resultado do painel pode superestimar a operação; a configuração deve refletir a prática real do time.",
    ],
    keywords: ["simultaneidade", "conversas", "chats"],
  },
  {
    id: "resultado",
    category: "Painel",
    question: "O que significa Resultado?",
    shortAnswer: "É a diferença entre a capacidade disponível e o volume previsto na mesma faixa.",
    details: [
      "Resultado positivo indica sobra de capacidade. Resultado negativo indica que a demanda é maior que a capacidade naquele horário.",
      "Uma sobra em outro horário não compensa um déficit, porque os clientes chegam em momentos diferentes.",
    ],
    formula: "Resultado = Capacity arredondado − Volume",
    keywords: ["sobra", "déficit", "deficit", "diferença"],
  },
  {
    id: "missing-agents",
    category: "Painel",
    question: "Como é calculado o número de agentes que faltam?",
    shortAnswer:
      "O déficit de chamados é convertido em pessoas usando a mesma capacidade unitária aplicada ao restante do cálculo.",
    details: [
      "Quando o resultado é negativo, o sistema divide essa falta pela capacidade de um agente e arredonda para cima.",
      "Um valor positivo representa falta de pessoas. Um valor negativo aponta capacidade equivalente a agentes excedentes naquela faixa.",
    ],
    formula: "Agentes que faltam = arredondar para cima (déficit ÷ capacidade por agente)",
    keywords: ["faltam", "defasagem", "contratar", "déficit"],
  },
  {
    id: "coverage",
    category: "Painel",
    question: "O que é a cobertura estimada do volume?",
    shortAnswer:
      "É o percentual da demanda semanal que a capacidade atual consegue atender no horário correto.",
    details: [
      "O indicador soma os chamados cobertos em cada faixa de 10 minutos e compara com o volume total válido da semana.",
      "A madrugada com cobertura fixa não gera contratação por demanda, e faixas fechadas ficam fora do cálculo.",
    ],
    keywords: ["percentual", "kpi", "indicador", "atendido"],
  },
  {
    id: "maximum-gap",
    category: "Painel",
    question: "O que é o pico máximo de defasagem?",
    shortAnswer:
      "É o maior número de agentes faltantes encontrado simultaneamente em uma faixa da semana.",
    details: [
      "Ele ajuda a localizar o pior gargalo, mostrando o dia e o horário em que ele acontece.",
      "O pico é uma fotografia de um intervalo; a recomendação total de agentes também considera a possibilidade de uma mesma pessoa cobrir vários intervalos do turno.",
    ],
    keywords: ["pico", "gargalo", "máximo"],
  },
  {
    id: "current-vs-real-proof",
    category: "Painel",
    question: "Qual é a diferença entre a fila atual e a Prova Real?",
    shortAnswer:
      "A fila atual usa somente a equipe vigente; a Prova Real acrescenta as contratações simuladas.",
    details: [
      "A simulação permite confirmar se os novos horários realmente reduzem os gargalos antes de alterar a escala oficial.",
      "Ativar ou desativar uma contratação simulada muda apenas o cenário projetado.",
    ],
    keywords: ["prova real", "simulação", "simulacao", "cenário"],
  },
  {
    id: "schedule-status",
    category: "Escala e contratações",
    question: "Quais estados da escala contam como atendimento?",
    shortAnswer: "Somente o estado “trabalhando” gera capacidade na faixa.",
    details: [
      "Pausa, almoço, atividade externa e folga não contam como disponibilidade para atender o Helpdesk naquele momento.",
      "Um agente inativo também fica completamente fora do cálculo, mesmo que possua horários cadastrados.",
    ],
    keywords: ["trabalhando", "pausa", "almoço", "externo", "folga"],
  },
  {
    id: "recommended-agents",
    category: "Escala e contratações",
    question: "Como o sistema recomenda novas contratações?",
    shortAnswer:
      "Ele procura combinações de turnos 5x2 que cubram o maior número possível de déficits.",
    details: [
      "A recomendação matemática considera jornadas de 9 horas com 1 hora de almoço e prioriza a cobertura dos horários mais críticos.",
      "A contratação mensal continua limitada pela regra operacional, mas o painel pode mostrar quando ainda restariam faixas descobertas.",
    ],
    keywords: ["recomendados", "otimização", "otimizacao", "turnos", "5x2"],
  },
  {
    id: "last-shift",
    category: "Escala e contratações",
    question: "Qual é o último horário permitido para novas contratações?",
    shortAnswer: "O último turno permitido para novas contratações é das 15:00 às 00:00.",
    details: [
      "A cobertura depois da meia-noite pertence à posição fixa da escala existente e não deve criar recomendações de contratação.",
      "Por isso, a análise automática e as sugestões da IA ignoram a madrugada ao montar novos turnos.",
    ],
    keywords: ["15:00", "00:00", "último turno", "madrugada"],
  },
  {
    id: "overnight",
    category: "Escala e contratações",
    question: "Como funciona a cobertura da madrugada?",
    shortAnswer:
      "A madrugada possui uma única posição fixa, cobrada pela escala e não pelo volume calculado.",
    details: [
      "De terça a sábado, o atendimento vai até 03:00 e exige exatamente uma pessoa entre 00:00 e 03:00. Domingo e segunda vão até 01:00 e exigem uma pessoa entre 00:00 e 01:00.",
      "O turno de referência é 18:00–03:00, realizado pela Maria Luiza. O sistema sinaliza a posição, mas não cadastra a pessoa automaticamente.",
    ],
    keywords: ["noturno", "madrugada", "Maria Luiza", "03:00", "01:00"],
  },
  {
    id: "helpdesk-unified",
    category: "Dados e operação",
    question: "Por que existe apenas uma fila de Helpdesk?",
    shortAnswer:
      "Os canais foram unificados para representar a operação atual sem a antiga prioridade entre Webchat e WhatsApp.",
    details: [
      "Durante a migração, os dados humanos de Freshchat e HubSpot permanecem consolidados sem deduplicação automática.",
      "A consolidação continuará ativa até existir confirmação operacional para encerrá-la; não há corte automático por data.",
    ],
    keywords: ["fila única", "freshchat", "hubspot", "whatsapp", "webchat", "migração"],
  },
  {
    id: "manual-capacity",
    category: "Dados e operação",
    question: "Como funciona o preenchimento de Care IA e Yooga Suporte?",
    shortAnswer:
      "Eles são gerenciados na tela de Capacity por Agente, com persistência automática e opção de ativar/desativar a Care IA.",
    details: [
      "Yooga Suporte representa a retaguarda humana e entra no volume e no divisor de assentos.",
      "A Care IA pode ser ativada ou desativada com 1 clique (ou zerada) para simular o dimensionamento com ou sem a automação. Seu cálculo usa a jornada padrão (20 dias e 8h), somando no volume sem ocupar vaga no divisor.",
    ],
    keywords: ["care ia", "yooga suporte", "manual", "sincronização", "toggle"],
  },
  {
    id: "ten-twenty-minutes",
    category: "Dados e operação",
    question: "Por que o volume usa 10 minutos e a escala usa blocos de 20 minutos?",
    shortAnswer:
      "O volume mantém maior precisão, enquanto a escala usa uma grade mais simples de editar.",
    details: [
      "Cada faixa de 10 minutos consulta o bloco de 20 minutos correspondente da escala. Assim, 10:00 e 10:10 usam o estado cadastrado em 10:00; 10:20 e 10:30 usam 10:20.",
      "Isso reduz o trabalho de manutenção sem perder os picos curtos da demanda.",
    ],
    keywords: ["10 minutos", "20 minutos", "blocos", "intervalos"],
  },
  {
    id: "annual-calculator",
    category: "Dados e operação",
    question: "A Calculadora Anual altera o dimensionamento mensal?",
    shortAnswer: "Não. Ela permanece como uma projeção independente do fluxo operacional mensal.",
    details: [
      "O dimensionamento mensal usa volumes, escala, capacidade e contratações do período selecionado.",
      "Mudanças nesta central de dúvidas também não modificam dados ou resultados da Calculadora Anual.",
    ],
    keywords: ["anual", "projeção", "projecao", "mês"],
  },
  {
    id: "erlang-c",
    category: "Modelos em teste",
    question: "O que é Erlang C e como será usado?",
    shortAnswer:
      "É um modelo de filas que estima quantos agentes são necessários para atingir uma meta de tempo de resposta.",
    details: [
      "A primeira versão será apenas comparativa: ela não mudará o cálculo atual, a Prova Real ou as sugestões de contratação.",
      "O modelo usará inicialmente TMA manual de 20 minutos e precisará considerar a simultaneidade do chat. Os resultados deverão ser validados antes de orientar decisões.",
    ],
    keywords: ["erlang", "fila", "comparação", "comparacao", "modelo"],
  },
  {
    id: "sla",
    category: "Modelos em teste",
    question: "No Erlang C, o SLA considera resposta ou conclusão?",
    shortAnswer:
      "Considera o tempo até a primeira resposta humana, e não o tempo até a conclusão do atendimento.",
    details: [
      "A contagem começa quando a conversa entra na fila e termina quando um agente humano responde pela primeira vez. Respostas automáticas de robôs/bots não devem encerrar essa espera.",
      "O tempo até a conclusão continua sendo acompanhado separadamente como indicador de resolução.",
    ],
    keywords: ["sla", "respondido", "concluído", "concluido", "primeira resposta"],
  },
] as const;

export function normalizeHelpSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export function filterHelpItems(
  items: readonly HelpItem[],
  query: string,
  category: HelpCategory | "Todos",
): HelpItem[] {
  const normalizedQuery = normalizeHelpSearch(query);

  return items.filter((item) => {
    if (category !== "Todos" && item.category !== category) return false;
    if (!normalizedQuery) return true;

    const searchableContent = [
      item.question,
      item.shortAnswer,
      ...item.details,
      item.formula ?? "",
      ...(item.keywords ?? []),
    ].join(" ");

    return normalizeHelpSearch(searchableContent).includes(normalizedQuery);
  });
}
