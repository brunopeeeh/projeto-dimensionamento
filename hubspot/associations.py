import config
from .client import HubSpotClient


def _chunk(itens: list, tamanho: int):
    for i in range(0, len(itens), tamanho):
        yield itens[i:i + tamanho]


def batch_read_associations(
    client: HubSpotClient, from_object_type: str, to_object_type: str, object_ids: list
) -> dict:
    """Retorna {ticket_id: [company_id, ...]} via POST .../batch/read."""
    path = f"/crm/associations/{config.HUBSPOT_API_VERSION}/{from_object_type}/{to_object_type}/batch/read"
    resultado = {}
    for chunk in _chunk(object_ids, config.ASSOC_BATCH_CHUNK):
        data = client.post(path, json_body={"inputs": [{"id": i} for i in chunk]})
        for item in data.get("results", []):
            origem_id = item.get("from", {}).get("id")
            destinos = [
                d.get("toObjectId") or d.get("id")
                for d in item.get("to", [])
            ]
            if origem_id:
                resultado[origem_id] = [d for d in destinos if d]
    return resultado


def batch_read_objects(client: HubSpotClient, object_type: str, ids: list, properties: list) -> dict:
    """Retorna {object_id: {prop: valor}} via POST .../batch/read."""
    if not ids:
        return {}
    path = f"/crm/objects/{config.HUBSPOT_API_VERSION}/{object_type}/batch/read"
    resultado = {}
    for chunk in _chunk(ids, config.OBJECT_BATCH_CHUNK):
        data = client.post(path, json_body={"inputs": [{"id": i} for i in chunk], "properties": properties})
        for item in data.get("results", []):
            resultado[item["id"]] = item.get("properties", {})
    return resultado


def buscar_empresas_dos_tickets(client: HubSpotClient, ticket_ids: list) -> dict:
    """Retorna {ticket_id: nome_da_empresa}. Assume 1 empresa primária por ticket
    (cenário normal de suporte B2B) — pega a primeira associação quando há mais de uma.
    """
    if not ticket_ids:
        return {}
    assoc = batch_read_associations(client, "tickets", "companies", ticket_ids)
    company_ids = list({cids[0] for cids in assoc.values() if cids})
    empresas = batch_read_objects(client, "companies", company_ids, properties=["name"])
    return {
        ticket_id: empresas.get(cids[0], {}).get("name", "-") if cids else "-"
        for ticket_id, cids in assoc.items()
    }
