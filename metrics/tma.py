import pandas as pd


def enriquecer_tma(df: pd.DataFrame) -> pd.DataFrame:
    """Calcula tempo_resolucao_horas (TMA): fechado - atribuído, fallback pra criado."""
    df = df.copy()

    if "data_atribuicao" in df.columns:
        df["atribuido_em_dt"] = pd.to_datetime(df["data_atribuicao"], errors="coerce")
        inicio_atendimento = df["atribuido_em_dt"].fillna(df["criado_em_dt"])
    else:
        inicio_atendimento = df["criado_em_dt"]

    df["tempo_resolucao_horas"] = (df["fechado_em_dt"] - inicio_atendimento).dt.total_seconds() / 3600.0
    df["tempo_resolucao_horas"] = df["tempo_resolucao_horas"].clip(lower=0).round(4)
    df = df.drop(columns=["criado_em_dt", "fechado_em_dt", "atribuido_em_dt"], errors="ignore")
    return df
