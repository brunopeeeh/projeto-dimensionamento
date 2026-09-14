"""
CHAMADOS POR CICLO DE ATENDIMENTO (Padrão Databricks — HubSpot Help Desk)
========================================================================
No HubSpot Help Desk, um ticket pode ser aberto, encerrado e reaberto
múltiplas vezes. Por isso:
  - Quantidade de threads != Quantidade de chamados.
  - Um CHAMADO é cada ciclo completo de abertura (OPEN) -> fechamento (CLOSED).
  - Identificador único: SHA-256(thread_id + opened_at) (support_request_id).

Lógica de Atribuição do Responsável (3 Prioridades do Databricks):
  1. Usuário que gerou o evento CLOSED (se agente/Maya, prefixo A-).
  2. Último agente que enviou mensagem antes do fechamento (quando fechado por sistema S-hubspot).
  3. AssignedTo do evento ASSIGNMENT ou primeiro agente que interagiu no ciclo.

Canais padrão de atendimento do Databricks:
  - 1583825086
  - 3405228652
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import time

from dateutil import parser as date_parser
from dateutil import tz
import pandas as pd

import config
from .client import HubSpotClient
from .owners import _listar_owners
from .tickets import buscar_tickets

BRAZIL_TZ = tz.gettz("America/Sao_Paulo")
THREADS_CACHE_DIR = config.RAW_DIR / "threads_cache"
CANAIS_DATABRICKS_PADRAO = {"1583825086", "3405228652"}


def _mapear_agentes(client: HubSpotClient, nomes: list) -> tuple[dict, dict]:
    """Mapeia owners do HubSpot:
    ({owner_id: nome}, {'A-<userId>': nome}).
    """
    owners = _listar_owners(client, archived=False) + _listar_owners(client, archived=True)
    alvo = set(nomes)
    por_owner, por_actor = {}, {}
    for o in owners:
        nome = f"{o.get('firstName', '')} {o.get('lastName', '')}".strip()
        if nome not in alvo:
            continue
        por_owner[o["id"]] = nome
        user_id = o.get("userId") or o.get("userIdIncludingInactive")
        if user_id:
            por_actor[f"A-{user_id}"] = nome
    faltando = alvo - set(por_owner.values())
    if faltando:
        print(f"⚠️  Owners não encontrados (verifique grafia exata): {sorted(faltando)}")
    return por_owner, por_actor


def _obter_mapeamento_threads(client: HubSpotClient, data_inicio: str, data_fim: str) -> dict:
    """Retorna {ticket_id: {'thread_id': ..., 'channel_id': ...}} mapeando os tickets fechados
    no período para suas threads no HubSpot.
    """
    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    cache_map_file = config.PROCESSED_DIR / f"tickets_threads_map_{data_inicio}_a_{data_fim}.json"

    if cache_map_file.exists():
        try:
            with open(cache_map_file, "r", encoding="utf-8") as f:
                thread_map = json.load(f)
            print(f"✅ Mapeamento de threads carregado do cache local: {len(thread_map)} tickets.")
            return thread_map
        except Exception:
            pass

    # Carregar do arquivo raw existente ou buscar tickets fechados
    raw_tickets_file = config.RAW_DIR / f"tickets_fechado_{data_inicio}_a_{data_fim}.json"
    if raw_tickets_file.exists():
        with open(raw_tickets_file, "r", encoding="utf-8") as f:
            tickets_raw = json.load(f)
        print(f"Lendo {len(tickets_raw)} tickets fechados do arquivo raw local...")
    else:
        tickets_raw, _ = buscar_tickets(client, data_inicio, data_fim, campo_periodo="fechado")
        if not tickets_raw:
            return {}

    tids = [t["id"] for t in tickets_raw]
    print(f"Mapeando {len(tids)} tickets para threads no HubSpot (em lotes de 100)...")

    thread_map = {}
    batch_size = 100
    for i in range(0, len(tids), batch_size):
        lote = tids[i : i + batch_size]
        res = client.post(
            f"/crm/objects/{config.HUBSPOT_API_VERSION}/tickets/batch/read",
            {
                "properties": [
                    "hs_conversations_originating_thread_id",
                    "hs_originating_channel_instance_id",
                ],
                "inputs": [{"id": t} for t in lote],
            },
        )
        for r in res.get("results", []):
            th = r.get("properties", {}).get("hs_conversations_originating_thread_id")
            ch = r.get("properties", {}).get("hs_originating_channel_instance_id")
            thread_map[r["id"]] = {"thread_id": th, "channel_id": ch}

        if (i // batch_size) % 20 == 0 or i + batch_size >= len(tids):
            print(f"    ...{min(i + batch_size, len(tids))}/{len(tids)} tickets mapeados")

    with open(cache_map_file, "w", encoding="utf-8") as f:
        json.dump(thread_map, f)
    print(f"✅ Mapeamento salvo em: {cache_map_file}")
    return thread_map


def _baixar_thread_mensagens(client: HubSpotClient, thread_id: str) -> list:
    """Busca as mensagens de uma thread com cache persistente em disco."""
    THREADS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cfile = THREADS_CACHE_DIR / f"{thread_id}.json"
    if cfile.exists():
        try:
            with open(cfile, "r", encoding="utf-8") as f:
                msgs = json.load(f)
                if isinstance(msgs, list):
                    return msgs
        except Exception:
            pass

    mensagens, after = [], None
    while True:
        params = {"limit": 100}
        if after:
            params["after"] = after
        data = client.get(
            f"/conversations/v3/conversations/threads/{thread_id}/messages", params=params
        )
        mensagens.extend(data.get("results", []))
        paging = data.get("paging")
        if not (paging and paging.get("next")):
            break
        after = paging["next"]["after"]

    with open(cfile, "w", encoding="utf-8") as f:
        json.dump(mensagens, f)
    return mensagens


def _ciclos(mensagens: list, thread_id: str) -> list:
    """Extrai ciclos de chamado (OPEN -> CLOSED) conforme regras do Databricks:
    1. Cada ciclo completo entre abertura e fechamento conta como 1 chamado.
    2. Identificação do responsável (3 níveis de prioridade):
       - Prioridade 1: Usuário que gerou o evento de fechamento (se agente/Maya, prefixo A-).
       - Prioridade 2: Último agente (prefixo A-) que enviou mensagem antes do fechamento.
       - Prioridade 3: Ator de ASSIGNMENT ou primeiro agente que enviou mensagem no ciclo.
    """
    mensagens_ordenadas = sorted(mensagens, key=lambda x: x.get("createdAt", ""))
    ciclos = []

    aberto_em = None
    ultimo_assigned = None
    mensagens_agentes = []

    for m in mensagens_ordenadas:
        tipo = m.get("type")
        criado_por = m.get("createdBy") or ""
        criado_em = m.get("createdAt")

        if tipo == "ASSIGNMENT":
            assigned = m.get("assignedTo")
            if assigned and str(assigned).startswith("A-"):
                ultimo_assigned = assigned

        elif tipo == "MESSAGE":
            if not aberto_em:
                aberto_em = criado_em
            if criado_por.startswith("A-"):
                mensagens_agentes.append(criado_por)

        elif tipo == "THREAD_STATUS_CHANGE":
            status = m.get("newStatus")
            if status == "OPEN":
                aberto_em = criado_em
                mensagens_agentes = []
            elif status == "CLOSED":
                if not aberto_em and not mensagens_agentes:
                    # Ignora fechamento consecutivo duplicado sem mensagens intermediárias
                    continue

                fechado_em = criado_em
                aberto = aberto_em or fechado_em

                # Prioridade 1: Usuário que gerou o evento CLOSED (se agente/Maya com prefixo A-)
                responsavel = None
                if criado_por.startswith("A-"):
                    responsavel = criado_por

                # Prioridade 2: Último agente que enviou mensagem antes do fechamento
                if not responsavel and mensagens_agentes:
                    responsavel = mensagens_agentes[-1]

                # Prioridade 3: Ator atribuído via ASSIGNMENT ou primeiro agente que enviou mensagem
                if not responsavel:
                    responsavel = ultimo_assigned or (
                        mensagens_agentes[0] if mensagens_agentes else None
                    )

                # Se ainda nulo, registra como o criador ou Sem Atendente
                if not responsavel:
                    responsavel = criado_por or "Sem Atendente"

                # ID determinístico do ciclo (estilo SHA2(thread_id + opened_at) do Databricks)
                support_request_id = hashlib.sha256(
                    f"{thread_id}_{aberto}".encode("utf-8")
                ).hexdigest()[:16]

                ciclos.append({
                    "support_request_id": support_request_id,
                    "aberto_em": aberto,
                    "fechado_em": fechado_em,
                    "responsavel_id": responsavel,
                })

                aberto_em = None
                mensagens_agentes = []

    return ciclos


def buscar_chamados(
    client: HubSpotClient,
    data_inicio: str,
    data_fim: str,
    nomes: list | None = None,
    max_workers: int = 6,
    apenas_canais_databricks: bool = False,
) -> pd.DataFrame:
    """Busca os chamados (ciclos OPEN->CLOSED das threads) aplicando as regras do Databricks.
    Protegido por rate-limiting thread-safe seguro e cache persistente em disco.
    """
    nomes = nomes or config.PROPRIETARIOS_NOMES
    ini = date_parser.parse(data_inicio + " 00:00:00").replace(tzinfo=BRAZIL_TZ)
    fim = date_parser.parse(data_fim + " 23:59:59").replace(tzinfo=BRAZIL_TZ)

    por_owner, por_actor = _mapear_agentes(client, nomes)
    if not por_owner:
        raise ValueError("Nenhum agente resolvido. Verifique PROPRIETARIOS_NOMES.")

    print(f"\n[1/3] Obtendo mapeamento de tickets para threads ({data_inicio} a {data_fim})...")
    thread_map = _obter_mapeamento_threads(client, data_inicio, data_fim)

    # Coletar threads únicas válidas
    threads_para_processar = {}
    for tid, info in thread_map.items():
        th_id = info.get("thread_id") if isinstance(info, dict) else info
        ch_id = info.get("channel_id") if isinstance(info, dict) else None
        if not th_id:
            continue
        if apenas_canais_databricks and str(ch_id) not in CANAIS_DATABRICKS_PADRAO:
            continue
        threads_para_processar[str(th_id)] = {"ticket_id": tid, "canal_id": ch_id}

    total_threads = len(threads_para_processar)
    THREADS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ja_em_cache = len(list(THREADS_CACHE_DIR.glob("*.json")))

    print(f"\n[2/3] Sincronizando mensagens de {total_threads} threads...")
    print(f"      Threads em cache: {ja_em_cache} | Workers: {max_workers} | Rate limiter: {client.rate_limiter.interval:.3f}s")

    threads_lista = list(threads_para_processar.items())
    linhas = []
    concluidos = 0
    checkpoint_interval = 500
    config.EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    caminho_checkpoint = config.EXPORTS_DIR / f"chamados_{data_inicio}_a_{data_fim}_checkpoint.csv"

    t0 = time.time()

    def processar_thread(item):
        th_id, meta = item
        try:
            msgs = _baixar_thread_mensagens(client, th_id)
            ciclos_th = _ciclos(msgs, th_id)
            return th_id, meta, ciclos_th, True, None
        except Exception as err:
            return th_id, meta, [], False, str(err)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(processar_thread, item): item for item in threads_lista}
        for future in as_completed(futures):
            th_id, meta, ciclos_th, ok, err = future.result()
            concluidos += 1
            if ok:
                for c in ciclos_th:
                    linhas.append({
                        "support_request_id": c["support_request_id"],
                        "ticket_id": meta["ticket_id"],
                        "thread_id": th_id,
                        "canal_id": meta["canal_id"],
                        "responsavel_id": c["responsavel_id"],
                        "atendente": por_actor.get(c["responsavel_id"], c["responsavel_id"]),
                        "aberto_em": c["aberto_em"],
                        "fechado_em": c["fechado_em"],
                    })

            # Progresso e estimativa
            if concluidos % 100 == 0 or concluidos == total_threads:
                tempo = time.time() - t0
                taxa = concluidos / tempo if tempo > 0 else 0
                restantes = total_threads - concluidos
                eta_s = restantes / taxa if taxa > 0 else 0
                eta_min = int(eta_s // 60)
                eta_sec = int(eta_s % 60)
                print(
                    f"    [{concluidos:>5}/{total_threads}] ({taxa:.1f} th/s) | "
                    f"Ciclos: {len(linhas):>5} | ETA: {eta_min:02d}m{eta_sec:02d}s"
                )

            # Checkpoint a cada 500 threads
            if concluidos % checkpoint_interval == 0 and linhas:
                df_cp = pd.DataFrame(linhas)
                df_cp.to_csv(caminho_checkpoint, index=False)

    print(f"\n[3/3] Filtrando e formatando chamados...")
    if not linhas:
        print("Nenhum ciclo de chamado encontrado.")
        return pd.DataFrame()

    df = pd.DataFrame(linhas)

    # Converter datas para horário de Brasília
    for col in ("aberto_em", "fechado_em"):
        df[col] = pd.to_datetime(df[col], utc=True, format="ISO8601").dt.tz_convert(BRAZIL_TZ)

    # Filtro idêntico ao Databricks: fechado_em dentro do período
    df = df[(df["fechado_em"] >= ini) & (df["fechado_em"] <= fim)].copy()

    # Filtro de time / atendentes de suporte cadastrados
    df_suporte = df[df["atendente"].isin(por_actor.values())].copy()
    if df_suporte.empty:
        df_suporte = df

    df_final = df_suporte.sort_values("fechado_em").reset_index(drop=True)

    caminho_csv = config.EXPORTS_DIR / f"chamados_{data_inicio}_a_{data_fim}.csv"
    df_final.to_csv(caminho_csv, index=False)
    print(f"✅ {len(df_final)} chamados (ciclos) extraídos e salvos em: {caminho_csv}")

    # Remover checkpoint ao finalizar com sucesso
    if caminho_checkpoint.exists():
        try:
            caminho_checkpoint.unlink()
        except Exception:
            pass

    return df_final
