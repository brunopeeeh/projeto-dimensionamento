import re

import pandas as pd

from config import PROPERTY_MAP


def _extrair_nome_cliente(ref) -> str:
    if not isinstance(ref, str):
        return "-"
    match = re.search(r"Ticket #\d+\s*-\s*(.+?)(?:\s*-\s*\d+)?$", ref)
    if match:
        return match.group(1).strip()
    return ref.strip()


def montar_dataframe(tickets_raw: list) -> pd.DataFrame:
    linhas = []
    for t in tickets_raw:
        props = t.get("properties", {})
        linha = {chave: props.get(valor, "-") for chave, valor in PROPERTY_MAP.items()}
        linhas.append(linha)

    df = pd.DataFrame(linhas)
    if df.empty:
        return df

    df = df.fillna("-")
    df["motivo"] = df["motivo"].replace("", "-")
    df["area"] = df["area"].replace("", "-")
    df["nome_cliente"] = df["referencia"].apply(_extrair_nome_cliente)
    return df


def preparar_datas(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["criado_em_dt"] = pd.to_datetime(df["criado_em"], errors="coerce")
    df["fechado_em_dt"] = pd.to_datetime(df["fechado_em"], errors="coerce")
    return df


def aplicar_owners(df: pd.DataFrame, owners_id_to_name: dict) -> pd.DataFrame:
    df = df.copy()
    df["titular_ticket"] = df["titular_ticket"].map(owners_id_to_name).fillna(df["titular_ticket"])
    return df


def extrair_ids_numericos(serie: pd.Series) -> set:
    """Extrai o número do ticket de strings como 'Ticket #4723253261...'."""
    ids = set()
    for valor in serie.dropna().astype(str):
        match = re.search(r"(\d{5,})", valor)
        if match:
            ids.add(match.group(1))
    return ids
