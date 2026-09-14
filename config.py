import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_URL = "https://api.hubapi.com"
HUBSPOT_TOKEN = os.environ.get("HUBSPOT_TOKEN") or os.environ.get("HUBSPOT_ACCESS_TOKEN", "COLE_SEU_TOKEN_AQUI")

# Endpoints de objeto (tickets/companies), search e associations migraram pra
# versionamento por data (confirmado na doc oficial em 2026-08). Pipelines e
# Owners continuam em /crm/v3/... fixo — não migraram, não usam essa variável.
HUBSPOT_API_VERSION = "2026-03"

# Mapeie: "nome que aparece no relatório" -> "internal name real da property no HubSpot"
PROPERTY_MAP = {
    "idi_cliente":     "idi",
    "referencia":      "subject",
    "criado_em":       "createdate",
    "fechado_em":      "closed_date",
    "data_atribuicao": "hubspot_owner_assigneddate",
    "titular_ticket":  "hubspot_owner_id",
    "status":          "hs_pipeline_stage",
    "ticket_id":       "hs_object_id",
    "motivo":          "contact_reason",
    "conclusao":       "conclusion_contact_reason",
    "area":            "ticket_area_contact_reason",
}

# Qual campo de data filtra o período do relatório (resolve a ambiguidade:
# "criado em julho" != "fechado em julho", achado real ao analisar o dataset).
CAMPO_PERIODO_MAP = {
    "criado": "createdate",
    "fechado": "closed_date",
    "atribuido": "hubspot_owner_assigneddate",  # usado por volume_10min.py
}

# Limites confirmados na doc oficial da Search API do HubSpot (2026-08):
SEARCH_PAGE_LIMIT = 200        # máximo por página (era 100 no script antigo)
SEARCH_MAX_TOTAL = 10000       # limite rígido por query; passar disso dá erro 400
SEARCH_THROTTLE_SEGUNDOS = 0.25  # 4 req/s, compartilhado na conta inteira entre todos os object types de busca

ASSOC_BATCH_CHUNK = 1000       # inputs por chamada de associations batch/read
OBJECT_BATCH_CHUNK = 100       # inputs por chamada de objects batch/read

# Outlier: cliente é considerado crítico se tickets_cliente > MEDIA + (DESVIO_MULTIPLICADOR * desvio_padrao)
DESVIO_MULTIPLICADOR = 2

# Filtros que replicam a view do HubSpot (pipeline + proprietário do ticket)
PIPELINE_NOME = "CXM - Atendimento"  # fallback só se PIPELINE_ID não resolver
PIPELINE_ID = "750895268"  # confirmado direto na conta — match por label é frágil (espaço no nome varia)

PROPRIETARIOS_NOMES = [
    "Maria Luiza Sarmento Murilo", "Andre Viana dos Santos Teixeira",
    "Julio Oliveira Monteiro", "Lucas Duarte", "Sabrina Pires",
    "Lucas Metskes Lascasas", "Rafael Marques dos Santos",
    "Guilherme Guimarães Vieira", "Jhorran Botoni Alves",
    "Igor Viturino de Oliveira Xavier","Bruno Oliveira do Nascimento",
    "Sofia Luany","Bryan Ladislau","Brenda Patricio","Isaias Neves de Souza Oliveira", "Yago Santos da Rosa", "Maya da Yooga", "Caio Fernandes", "Estevão Bastos Corrêa", "Eloah Andrade", "Leandro Vieira","Yooga Tecnologia"
]

# Colunas exigidas nos dashboards offline (regeneração a partir de CSV)
COLUNAS_DASHBOARD = {
    "criado_em", "fechado_em", "titular_ticket", "idi_cliente",
    "motivo", "conclusao", "area", "tempo_resolucao_horas",
}

# Base de URL do ticket no HubSpot (usada nos links da aba Auditoria)
HUBSPOT_PORTAL_ID = "21701426"
HUBSPOT_VIEW_ID = "388858217"
HUBSPOT_TICKET_URL = (
    f"https://app.hubspot.com/help-desk/{HUBSPOT_PORTAL_ID}/view/{HUBSPOT_VIEW_ID}/ticket"
)

# Faixas de SLA (horas) exibidas na aba "Visão Geral & SLAs"
SLA_HORAS = [24, 48, 72]

BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = BASE_DIR / "storage"
RAW_DIR = STORAGE_DIR / "raw"
PROCESSED_DIR = STORAGE_DIR / "processed"
EXPORTS_DIR = STORAGE_DIR / "exports"
TEMPLATES_DIR = BASE_DIR / "templates"
