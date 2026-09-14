from .client import HubSpotClient


def _listar_owners(client: HubSpotClient, archived: bool) -> list:
    owners = []
    after = None
    while True:
        params = {"limit": 100, "archived": str(archived).lower()}
        if after:
            params["after"] = after
        data = client.get("/crm/v3/owners", params=params)
        owners.extend(data.get("results", []))
        paging = data.get("paging")
        if paging and paging.get("next"):
            after = paging["next"]["after"]
        else:
            break
    return owners


def buscar_owner_ids(client: HubSpotClient, nomes: list) -> tuple[dict, dict]:
    """Retorna ({nome: owner_id}, {id: nome}).

    Inclui owners arquivados: a API não tem archived=any (confirmado na doc
    oficial), precisa duas chamadas pra achar agente que saiu da empresa mas
    tem ticket histórico no período.
    """
    owners = _listar_owners(client, archived=False) + _listar_owners(client, archived=True)

    mapa_nome_id, mapa_id_nome = {}, {}
    for o in owners:
        nome_completo = f"{o.get('firstName', '')} {o.get('lastName', '')}".strip()
        mapa_nome_id[nome_completo] = o["id"]
        mapa_id_nome[o["id"]] = nome_completo

    resultado, nao_encontrados = {}, []
    for nome in nomes:
        if nome in mapa_nome_id:
            resultado[nome] = mapa_nome_id[nome]
        else:
            nao_encontrados.append(nome)

    if nao_encontrados:
        print(f"⚠️  Owners não encontrados (verifique grafia exata): {nao_encontrados}")

    return resultado, mapa_id_nome
