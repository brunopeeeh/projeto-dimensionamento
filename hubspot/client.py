import threading
import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

import config


class RateLimiter:
    """Controlador de taxa (rate limiter) thread-safe baseado em intervalo mínimo."""

    def __init__(self, max_per_second: float = 8.5):
        self.interval = 1.0 / max_per_second if max_per_second > 0 else 0
        self.lock = threading.Lock()
        self.last_call = 0.0

    def wait(self):
        if self.interval <= 0:
            return
        with self.lock:
            agora = time.monotonic()
            decorrido = agora - self.last_call
            if decorrido < self.interval:
                time.sleep(self.interval - decorrido)
            self.last_call = time.monotonic()


def get_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=2,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "OPTIONS", "POST"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


class HubSpotClient:
    """Cliente HTTP fino pra API do HubSpot: sessão única, retry, rate limit seguro e throttle da Search API."""

    def __init__(self, token: str | None = None, max_req_per_sec: float = 8.5):
        self.session = get_session()
        self._token = token or config.HUBSPOT_TOKEN
        self._last_search_ts = 0.0
        self.rate_limiter = RateLimiter(max_per_second=max_req_per_sec)

    def _headers(self, **extra) -> dict:
        headers = {"Authorization": f"Bearer {self._token}"}
        headers.update(extra)
        return headers

    def _verificar_resposta(self, resp: requests.Response) -> None:
        if resp.status_code == 401:
            raise RuntimeError(
                "Token inválido ou sem permissão. Verifique o escopo do app privado do HubSpot."
            )
        resp.raise_for_status()

    def get(self, path: str, params: dict | None = None, timeout: int = 30, max_retries: int = 5) -> dict:
        tentativas = 0
        while True:
            if self.rate_limiter:
                self.rate_limiter.wait()
            resp = self.session.get(
                f"{config.BASE_URL}{path}", headers=self._headers(), params=params, timeout=timeout
            )
            if resp.status_code == 429:
                tentativas += 1
                if tentativas > max_retries:
                    raise RuntimeError("Limite de requisições do HubSpot excedido após múltiplas tentativas.")
                espera = int(resp.headers.get("Retry-After", 5 * tentativas))
                print(f"\n⚠️ [Rate Limit 429] Aguardando {espera}s antes de retentar ({tentativas}/{max_retries})...")
                time.sleep(espera + 0.5)
                continue
            self._verificar_resposta(resp)
            return resp.json()

    def post(self, path: str, json_body: dict | None = None, timeout: int = 30, max_retries: int = 5) -> dict:
        tentativas = 0
        while True:
            if self.rate_limiter:
                self.rate_limiter.wait()
            resp = self.session.post(
                f"{config.BASE_URL}{path}",
                headers=self._headers(**{"Content-Type": "application/json"}),
                json=json_body,
                timeout=timeout,
            )
            if resp.status_code == 429:
                tentativas += 1
                if tentativas > max_retries:
                    raise RuntimeError("Limite de requisições do HubSpot excedido após múltiplas tentativas.")
                espera = int(resp.headers.get("Retry-After", 5 * tentativas))
                print(f"\n⚠️ [Rate Limit 429] Aguardando {espera}s antes de retentar ({tentativas}/{max_retries})...")
                time.sleep(espera + 0.5)
                continue
            self._verificar_resposta(resp)
            return resp.json()

    def search(self, object_type: str, payload: dict, timeout: int = 30) -> dict:
        """Único ponto que fala com a Search API — aplica throttle de 4 req/s
        (limite compartilhado na conta inteira entre todos os object types de busca,
        confirmado na doc oficial do HubSpot)."""
        espera = config.SEARCH_THROTTLE_SEGUNDOS - (time.monotonic() - self._last_search_ts)
        if espera > 0:
            time.sleep(espera)
        path = f"/crm/objects/{config.HUBSPOT_API_VERSION}/{object_type}/search"
        resultado = self.post(path, json_body=payload, timeout=timeout)
        self._last_search_ts = time.monotonic()
        return resultado

