import json

import pandas as pd

import config
from hubspot.client import HubSpotClient
from hubspot.tickets import buscar_tickets
from metrics.tma import enriquecer_tma
from .transformer import aplicar_owners, montar_dataframe, preparar_datas


def extrair(
    data_inicio: str, data_fim: str, campo_periodo: str = "fechado", token: str | None = None
) -> pd.DataFrame:
    client = HubSpotClient(token)

    tickets_raw, owners_id_to_name = buscar_tickets(client, data_inicio, data_fim, campo_periodo)
    if not tickets_raw:
        return pd.DataFrame()

    # RAW antes de qualquer transformação: se o parser quebrar, reprocessa
    # sem precisar chamar a API de novo.
    config.RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw_path = config.RAW_DIR / f"tickets_{campo_periodo}_{data_inicio}_a_{data_fim}.json"
    raw_path.write_text(json.dumps(tickets_raw, ensure_ascii=False), encoding="utf-8")
    print(f"RAW salvo em: {raw_path}")

    df = montar_dataframe(tickets_raw)
    df = aplicar_owners(df, owners_id_to_name)
    df = preparar_datas(df)
    df = enriquecer_tma(df)

    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    processed_path = config.PROCESSED_DIR / f"tickets_{campo_periodo}_{data_inicio}_a_{data_fim}.parquet"
    try:
        df.to_parquet(processed_path, engine="pyarrow", index=False)
        print(f"Processado salvo em: {processed_path}")
    except Exception:
        pass

    return df
