from .client import HubSpotClient


def buscar_pipeline_com_estagios(
    client: HubSpotClient, nome_pipeline: str, pipeline_id: str | None = None
) -> tuple[str, dict]:
    """Retorna (pipeline_id, {stage_id: stage_label}). Endpoint continua em v3 (não migrou pra data).

    Prefere buscar por pipeline_id quando informado: match por label é frágil
    (achado real — "CXM - Atendimento" no config != "CXM- Atendimento" na conta,
    diferença de espaço já quebrou a busca por nome)."""
    data = client.get("/crm/v3/pipelines/tickets")
    resultados = data.get("results", [])

    if pipeline_id:
        for p in resultados:
            if p["id"] == pipeline_id:
                return p["id"], {s["id"]: s["label"] for s in p.get("stages", [])}
        raise ValueError(
            f"Pipeline com id '{pipeline_id}' não encontrado. Rode --listar-pipelines para ver as opções."
        )

    for p in resultados:
        if p["label"].strip().lower() == nome_pipeline.strip().lower():
            estagios = {s["id"]: s["label"] for s in p.get("stages", [])}
            return p["id"], estagios
    raise ValueError(
        f"Pipeline '{nome_pipeline}' não encontrado. Rode --listar-pipelines para ver as opções."
    )


def listar_pipelines(client: HubSpotClient) -> None:
    data = client.get("/crm/v3/pipelines/tickets")
    print(f"\n{'ID':20} | LABEL")
    print("-" * 60)
    for p in data.get("results", []):
        print(f"{p['id']:20} | {p['label']}")
