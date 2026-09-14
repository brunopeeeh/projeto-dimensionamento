from datetime import timedelta

from dateutil import parser as date_parser
from dateutil import tz

import config
from .client import HubSpotClient
from .owners import buscar_owner_ids
from .pipelines import buscar_pipeline_com_estagios

BRAZIL_TZ = tz.gettz("America/Sao_Paulo")


def _dividir_janela(data_inicio: str, data_fim: str) -> tuple[tuple[str, str], tuple[str, str]]:
    """Parte o período ao meio (usado quando uma janela estoura o limite de 10k da Search API)."""
    d_ini = date_parser.parse(data_inicio).date()
    d_fim = date_parser.parse(data_fim).date()
    meio = d_ini + (d_fim - d_ini) // 2
    return (data_inicio, meio.isoformat()), ((meio + timedelta(days=1)).isoformat(), data_fim)


def buscar_tickets(
    client: HubSpotClient, data_inicio: str, data_fim: str, campo_periodo: str = "fechado"
) -> tuple[list, dict]:
    """Busca tickets no período, pipeline e owners configurados.

    campo_periodo: "criado" (createdate) ou "fechado" (closed_date) — resolve a
    ambiguidade encontrada no dataset (tickets criados fora do mês aparecendo
    num relatório filtrado por fechamento).
    """
    propriedade_data = config.CAMPO_PERIODO_MAP[campo_periodo]

    dt_inicio = date_parser.parse(data_inicio + " 00:00:00").replace(tzinfo=BRAZIL_TZ)
    dt_fim = date_parser.parse(data_fim + " 23:59:59").replace(tzinfo=BRAZIL_TZ)
    dt_inicio_ms = int(dt_inicio.timestamp() * 1000)
    dt_fim_ms = int(dt_fim.timestamp() * 1000)

    print(f"Janela de busca ({campo_periodo}, UTC): {dt_inicio.astimezone(tz.UTC)} até {dt_fim.astimezone(tz.UTC)}")
    print("Resolvendo pipeline...")
    pipeline_id, estagios_id_to_label = buscar_pipeline_com_estagios(
        client, config.PIPELINE_NOME, pipeline_id=config.PIPELINE_ID
    )

    print("Resolvendo proprietários (owners)...")
    owners_map, owners_id_to_name = buscar_owner_ids(client, config.PROPRIETARIOS_NOMES)
    owner_ids = list(owners_map.values())
    if not owner_ids:
        raise ValueError("Nenhum owner foi resolvido. Verifique PROPRIETARIOS_NOMES.")

    filtros = [
        {"propertyName": "hs_pipeline", "operator": "EQ", "value": pipeline_id},
        {"propertyName": propriedade_data, "operator": "GTE", "value": dt_inicio_ms},
        {"propertyName": propriedade_data, "operator": "LTE", "value": dt_fim_ms},
        {"propertyName": "hubspot_owner_id", "operator": "IN", "values": owner_ids},
    ]
    payload = {
        "filterGroups": [{"filters": filtros}],
        "properties": list(config.PROPERTY_MAP.values()),
        "limit": config.SEARCH_PAGE_LIMIT,
        "sorts": [{"propertyName": propriedade_data, "direction": "DESCENDING"}],
    }

    todos_tickets, after, pagina, total_api = [], None, 1, 0
    while True:
        if after:
            payload["after"] = after
        data = client.search("tickets", payload)

        resultados = data.get("results", [])
        for ticket in resultados:
            estagio_id = ticket.get("properties", {}).get("hs_pipeline_stage")
            if estagio_id in estagios_id_to_label:
                ticket["properties"]["hs_pipeline_stage"] = estagios_id_to_label[estagio_id]
        todos_tickets.extend(resultados)

        total_api = data.get("total", 0)
        print(f"  Página {pagina}: {len(resultados)} tickets (total acumulado: {len(todos_tickets)})")

        paging = data.get("paging")
        if paging and paging.get("next"):
            after = paging["next"]["after"]
            pagina += 1
            if total_api > config.SEARCH_MAX_TOTAL and len(todos_tickets) >= config.SEARCH_MAX_TOTAL:
                print(
                    f"⚠️  {total_api} tickets no período > limite de {config.SEARCH_MAX_TOTAL} da Search API. "
                    "Dividindo a janela em duas metades..."
                )
                janela1, janela2 = _dividir_janela(data_inicio, data_fim)
                t1, _ = buscar_tickets(client, *janela1, campo_periodo=campo_periodo)
                t2, _ = buscar_tickets(client, *janela2, campo_periodo=campo_periodo)
                return t1 + t2, owners_id_to_name
        else:
            break

    return todos_tickets, owners_id_to_name
