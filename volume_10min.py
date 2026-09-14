"""
VOLUME DE CHAMADOS POR FAIXA DE 10 MINUTOS — HubSpot (Padrão Databricks)
=========================================================================
Gera a distribuição de chamados em blocos de 10 minutos por dia da semana.
Por padrão, reproduz o comportamento da query do Databricks:
  - Agrupa pela data/hora de FECHAMENTO real do chamado (closed_date / closed_at),
    horário de Brasília.
  - Evita distorções provocadas por automações e atribuições em lote no CRM.

Também suporta os critérios alternativos 'atribuicao' (legado, hubspot_owner_assigneddate)
e 'abertura' (createdate / aberto_em).

USO
---
# Modo padrão (fechamento, idêntico ao Databricks):
python volume_10min.py --inicio 2026-06-15 --fim 2026-09-13

# Modo por ciclos de conversa (Databricks support_requests):
python volume_10min.py --inicio 2026-07-01 --fim 2026-07-31 --por-chamado

# Critério específico:
python volume_10min.py --inicio 2026-07-01 --fim 2026-07-31 --criterio atribuicao

Gera em storage/exports/:
  volume_10min_INICIO_a_FIM.csv   (pivot cru com faixas x dias da semana)
  volume_10min_INICIO_a_FIM.xlsx  (pivot em formato Excel)
  volume_10min_INICIO_a_FIM.html  (dashboard heatmap standalone)
"""

import argparse
import sys

import pandas as pd

import config
from data import extractor
from hubspot import atribuicoes
from hubspot.client import HubSpotClient

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DIAS_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]
HORA_INICIO_EXPEDIENTE = 7  # atendimento começa 07:00, última faixa é 06:50 do dia seguinte
_faixas_meia_noite = [f"{h:02d}:{m:02d}:00" for h in range(24) for m in range(0, 60, 10)]
TODAS_FAIXAS = _faixas_meia_noite[HORA_INICIO_EXPEDIENTE * 6:] + _faixas_meia_noite[:HORA_INICIO_EXPEDIENTE * 6]

CRITERIO_FECHAMENTO = (
    "Contagem por data de fechamento do chamado (closed_date / closed_at), critério idêntico ao Databricks, horário de Brasília."
)
CRITERIO_ATRIBUICAO = (
    "Contagem por data de atribuição ao atendente (hubspot_owner_assigneddate), horário de Brasília."
)
CRITERIO_ABERTURA = (
    "Contagem por data de abertura do chamado (createdate / aberto_em), horário de Brasília."
)


def montar_pivot(df: pd.DataFrame, coluna_data: str = "fechado_em") -> pd.DataFrame:
    dt = pd.to_datetime(df[coluna_data], errors="coerce", utc=True).dropna()
    dt = dt.dt.tz_convert("America/Sao_Paulo")

    faixa = dt.dt.floor("10min").dt.strftime("%H:%M:%S")
    dia = dt.dt.weekday.map(dict(enumerate(DIAS_SEMANA)))

    pivot = pd.crosstab(faixa, dia)
    pivot = pivot.reindex(columns=DIAS_SEMANA, fill_value=0)
    pivot = pivot.reindex(index=TODAS_FAIXAS, fill_value=0)

    pivot["Total"] = pivot.sum(axis=1)
    pivot.loc["Total"] = pivot.sum(axis=0)
    return pivot.astype(int)


def gerar_html(pivot: pd.DataFrame, data_inicio: str, data_fim: str, caminho, criterio=CRITERIO_FECHAMENTO):
    maximo = pivot.drop(index="Total").drop(columns="Total").to_numpy().max() or 1

    def cor(v):
        if v == 0:
            return "#f4f4f4"
        intensidade = min(v / maximo, 1)
        return f"rgba(37,99,235,{0.12 + intensidade * 0.75:.2f})"

    linhas_html = []
    for idx, row in pivot.iterrows():
        total_row = idx == "Total"
        celulas = "".join(
            f'<td style="background:{"#e2e8f0" if total_row else cor(v)};'
            f'font-weight:{"700" if total_row else "400"}">{v}</td>'
            for v in row
        )
        linhas_html.append(f"<tr><th>{idx}</th>{celulas}</tr>")

    cabecalho = "".join(f"<th>{c}</th>" for c in pivot.columns)

    html = f"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Volume de Chamados por 10min — {data_inicio} a {data_fim}</title>
<style>
body{{font-family:system-ui,sans-serif;margin:24px;background:#fafafa;color:#111}}
h1{{font-size:18px;margin-bottom:4px}}
p{{color:#555;font-size:13px;margin-top:0}}
table{{border-collapse:collapse;font-size:12px}}
th,td{{border:1px solid #ddd;padding:4px 8px;text-align:center;min-width:36px}}
thead th{{background:#1e293b;color:#fff;position:sticky;top:0}}
tbody th{{background:#334155;color:#fff}}
</style></head><body>
<h1>Volume de chamados por faixa de 10min — {data_inicio} a {data_fim}</h1>
<p>{criterio}</p>
<table><thead><tr><th>Horário</th>{cabecalho}</tr></thead><tbody>{"".join(linhas_html)}</tbody></table>
</body></html>"""

    with open(caminho, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"\n✅ Dashboard de volume gerado: {caminho}")


def main():
    parser = argparse.ArgumentParser(description="Volume de chamados HubSpot por faixa de 10min")
    parser.add_argument("--inicio", required=True, help="Data início (YYYY-MM-DD)")
    parser.add_argument("--fim", required=True, help="Data fim (YYYY-MM-DD)")
    parser.add_argument(
        "--criterio",
        choices=["fechamento", "atribuicao", "abertura"],
        default="fechamento",
        help="Critério de data para o agrupamento: 'fechamento' (padrão, idêntico ao Databricks "
             "mar.closed_at / closed_date), 'atribuicao' (hubspot_owner_assigneddate) ou "
             "'abertura' (createdate / aberto_em).",
    )
    parser.add_argument(
        "--por-chamado",
        action="store_true",
        help="Conta ciclos OPEN->CLOSED da thread pelo critério escolhido (Databricks support_requests). "
             "Lento: varre as mensagens das threads com rate limit seguro.",
    )
    parser.add_argument(
        "--chamados",
        metavar="CSV",
        help="Reaproveita um chamados_*.csv já baixado (gerado por --por-chamado aqui ou no "
             "volume_periodo.py) em vez de bater na API de novo.",
    )
    parser.add_argument(
        "--taxa",
        type=float,
        default=8.5,
        help="Taxa máxima de requisições por segundo (padrão: 8.5 req/s, seguro contra rate limits da API).",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=6,
        help="Número de workers paralelos para processar threads (padrão: 6).",
    )
    parser.add_argument(
        "--todos-os-canais",
        action="store_true",
        help="Inclui todos os canais de threads (por padrão processa os canais de atendimento 1583825086 e 3405228652 do Databricks).",
    )
    parser.add_argument(
        "--forcar",
        action="store_true",
        help="Força re-extração mesmo que chamados_*.csv já exista.",
    )
    args = parser.parse_args()

    if config.HUBSPOT_TOKEN == "COLE_SEU_TOKEN_AQUI" and not args.chamados:
        print("❌ ERRO: configure HUBSPOT_TOKEN em .env.")
        sys.exit(1)

    # Definir mapeamento de acordo com o critério escolhido
    if args.criterio == "fechamento":
        campo_periodo = "fechado"
        coluna_ticket = "fechado_em"
        coluna_chamado = "fechado_em"
        criterio_texto = CRITERIO_FECHAMENTO
    elif args.criterio == "abertura":
        campo_periodo = "criado"
        coluna_ticket = "criado_em"
        coluna_chamado = "aberto_em"
        criterio_texto = CRITERIO_ABERTURA
    else:  # atribuicao
        campo_periodo = "atribuido"
        coluna_ticket = "data_atribuicao"
        coluna_chamado = "aberto_em"
        criterio_texto = CRITERIO_ATRIBUICAO

    arquivo_chamados_padrao = config.EXPORTS_DIR / f"chamados_{args.inicio}_a_{args.fim}.csv"

    if args.chamados:
        chamados = pd.read_csv(args.chamados)
        print(f"{len(chamados)} chamados lidos de {args.chamados} (sem chamadas à API)")
        coluna_usar = coluna_chamado if coluna_chamado in chamados.columns else chamados.columns[0]
        df = pd.DataFrame({"data_evento": chamados[coluna_usar]})
        coluna_pivot = "data_evento"
    elif args.por_chamado or (arquivo_chamados_padrao.exists() and not args.forcar):
        if arquivo_chamados_padrao.exists() and not args.forcar:
            chamados = pd.read_csv(arquivo_chamados_padrao)
            print(f"ℹ️ Arquivo de chamados Databricks encontrado: {arquivo_chamados_padrao}")
            print(f"   Carregando direto do disco ({len(chamados):,} chamados). Use --forcar para re-extrair da API.")
        else:
            client = HubSpotClient(max_req_per_sec=args.taxa)
            chamados = atribuicoes.buscar_chamados(
                client,
                args.inicio,
                args.fim,
                max_workers=args.workers,
                apenas_canais_databricks=not args.todos_os_canais,
            )
        if chamados.empty:
            print("Nenhum chamado no período. Verifique as datas e PROPRIETARIOS_NOMES.")
            return
        coluna_usar = coluna_chamado if coluna_chamado in chamados.columns else "fechado_em"
        df = pd.DataFrame({"data_evento": chamados[coluna_usar]})
        coluna_pivot = "data_evento"
    else:
        print("ℹ️ Modo tickets brutos do CRM (sem varredura de threads). Para ciclos de conversas (Databricks), use --por-chamado.")
        df = extractor.extrair(args.inicio, args.fim, campo_periodo=campo_periodo)
        if df.empty:
            print(f"Nenhum ticket encontrado no período ({campo_periodo}). Verifique as datas.")
            return
        coluna_pivot = coluna_ticket

    pivot = montar_pivot(df, coluna_data=coluna_pivot)

    config.EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    nome_base = f"volume_10min_{args.inicio}_a_{args.fim}"
    csv_path = config.EXPORTS_DIR / f"{nome_base}.csv"
    pivot.to_csv(csv_path)
    print(f"✅ Pivot CSV salvo em: {csv_path}")

    xlsx_path = config.EXPORTS_DIR / f"{nome_base}.xlsx"
    try:
        pivot.to_excel(xlsx_path)
        print(f"✅ Pivot Excel salvo em: {xlsx_path}")
    except Exception as e:
        print(f"ℹ️ (Aviso Excel: {e})")

    gerar_html(
        pivot, args.inicio, args.fim, config.EXPORTS_DIR / f"{nome_base}.html",
        criterio=criterio_texto,
    )


if __name__ == "__main__":
    main()
