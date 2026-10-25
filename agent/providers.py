"""Small, dependency-free LLM provider adapters used by the Viral Hit agent.

Only text and structured JSON travel through this module. Source media stays local.
Credentials are read from the environment, never included in logs or exceptions.
"""

from __future__ import annotations

from dataclasses import dataclass
from email.utils import parsedate_to_datetime
import json
import os
import random
import re
import socket
import time
from typing import Any, Mapping
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_TIMEOUT_SECONDS = 240.0
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
PROVIDERS = ("builtin", "openai", "openai-compatible", "anthropic", "gemini", "mimo", "ollama")


class ProviderError(RuntimeError):
    """An actionable provider failure with credentials already redacted."""


@dataclass(frozen=True)
class LLMConfig:
    provider: str
    model: str
    api_key: str = ""
    base_url: str = ""
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    @property
    def public(self) -> dict[str, Any]:
        """A credential-free receipt fragment."""
        return {"provider": self.provider, "model": self.model, "base_url": self.base_url}


def _first(env: Mapping[str, str], *names: str) -> str:
    for name in names:
        value = env.get(name, "").strip()
        if value:
            return value
    return ""


def _local_base_url(url: str) -> bool:
    try:
        host = (urllib.parse.urlparse(url).hostname or "").lower()
        return host in {"localhost", "127.0.0.1", "::1", "0.0.0.0"} or host.endswith(".local")
    except ValueError:
        return False


def config_from_env(env: Mapping[str, str] | None = None, *, require_model: bool = True) -> LLMConfig:
    """Resolve unified Viral Hit settings with explicit legacy fallbacks.

    VIRALHIT_LLM_* always wins. HOTCLIP_LLM_* is accepted so an existing clipping
    setup can be reused. Provider-specific keys are only used with their provider.
    """
    source = os.environ if env is None else env
    provider = _first(source, "VIRALHIT_LLM_PROVIDER").lower() or "builtin"
    aliases = {"custom": "openai-compatible", "compatible": "openai-compatible", "google": "gemini", "local": "ollama"}
    provider = aliases.get(provider, provider)
    if provider not in PROVIDERS:
        raise ProviderError(f"Unsupported LLM provider {provider!r}; choose one of: {', '.join(PROVIDERS)}")

    key_names = {
        "builtin": (),
        "openai": ("VIRALHIT_LLM_API_KEY", "OPENAI_API_KEY"),
        "anthropic": ("VIRALHIT_LLM_API_KEY", "ANTHROPIC_API_KEY"),
        "gemini": ("VIRALHIT_LLM_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"),
        "mimo": ("VIRALHIT_LLM_API_KEY", "MIMO_API_KEY"),
        "openai-compatible": ("VIRALHIT_LLM_API_KEY", "HOTCLIP_LLM_API_KEY"),
        "ollama": ("VIRALHIT_LLM_API_KEY", "HOTCLIP_LLM_API_KEY"),
    }
    api_key = _first(source, *key_names[provider])
    base_url = _first(source, "VIRALHIT_LLM_BASE_URL", "HOTCLIP_LLM_BASE_URL")
    if not base_url:
        base_url = {
            "builtin": "builtin://local-free",
            "openai": "https://api.openai.com/v1",
            "openai-compatible": "",
            "anthropic": "https://api.anthropic.com",
            "gemini": "https://generativelanguage.googleapis.com/v1beta",
            "mimo": "https://api.xiaomimimo.com/v1",
            "ollama": "http://127.0.0.1:11434/v1",
        }[provider]
    base_url = base_url.rstrip("/")
    model = _first(source, "VIRALHIT_LLM_MODEL", "HOTCLIP_LLM_MODEL")
    if provider == "builtin":
        base_url = "builtin://local-free"
        model = "regles-locales"
        api_key = ""
    if require_model and not model:
        raise ProviderError("VIRALHIT_LLM_MODEL est requis pour ce fournisseur ; utilisez builtin ou configurez un modèle Ollama local")
    if provider == "openai-compatible" and not base_url:
        raise ProviderError("VIRALHIT_LLM_BASE_URL is required for the openai-compatible provider")
    if not api_key and provider not in {"builtin", "ollama", "openai-compatible"}:
        raise ProviderError(f"An API key is required for {provider}; set VIRALHIT_LLM_API_KEY in the environment")
    if not api_key and provider == "openai-compatible" and not _local_base_url(base_url):
        raise ProviderError("VIRALHIT_LLM_API_KEY is required for a remote OpenAI-compatible endpoint")

    raw_timeout = _first(source, "VIRALHIT_LLM_TIMEOUT_SECONDS")
    try:
        timeout = float(raw_timeout) if raw_timeout else DEFAULT_TIMEOUT_SECONDS
    except ValueError as exc:
        raise ProviderError("VIRALHIT_LLM_TIMEOUT_SECONDS must be a number") from exc
    if not 1 <= timeout <= 1800:
        raise ProviderError("VIRALHIT_LLM_TIMEOUT_SECONDS must be between 1 and 1800")
    return LLMConfig(provider, model, api_key, base_url, timeout)


def _redact(text: str, secret: str) -> str:
    safe = text
    if secret:
        safe = safe.replace(secret, "[redacted]")
    safe = re.sub(r"Bearer\s+[^\s\"'<>]+", "Bearer [redacted]", safe, flags=re.I)
    safe = re.sub(r"((?:api[_-]?key|key)=)[^\s&\"']+", r"\1[redacted]", safe, flags=re.I)
    return safe[:1200]


def _retry_delay(response: urllib.error.HTTPError, attempt: int) -> float:
    value = response.headers.get("Retry-After", "").strip()
    if re.fullmatch(r"\d+(?:\.\d+)?", value):
        return min(5.0, max(0.0, float(value)))
    if value:
        try:
            target = parsedate_to_datetime(value).timestamp()
            return min(5.0, max(0.0, target - time.time()))
        except (TypeError, ValueError, OverflowError):
            pass
    return min(5.0, (2**attempt) + random.random() * 0.15)


def _post_json(config: LLMConfig, url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    request_headers = {"Content-Type": "application/json", "Accept": "application/json", **headers}
    last_error = ""
    for attempt in range(3):
        request = urllib.request.Request(url, data=body, headers=request_headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=config.timeout_seconds) as response:
                declared = int(response.headers.get("Content-Length", "0") or 0)
                if declared > MAX_RESPONSE_BYTES:
                    raise ProviderError("LLM response exceeded the 4 MiB safety limit")
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise ProviderError("LLM response exceeded the 4 MiB safety limit")
                try:
                    parsed = json.loads(raw.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise ProviderError("LLM endpoint returned a non-JSON response") from exc
                if not isinstance(parsed, dict):
                    raise ProviderError("LLM endpoint returned an unexpected JSON shape")
                return parsed
        except urllib.error.HTTPError as exc:
            raw = exc.read(64 * 1024).decode("utf-8", errors="replace")
            try:
                detail = json.loads(raw)
                message = detail.get("error", detail)
                if isinstance(message, dict):
                    message = message.get("message", message)
                detail_text = str(message)
            except (json.JSONDecodeError, AttributeError):
                detail_text = raw
            last_error = f"HTTP {exc.code}: {_redact(detail_text, config.api_key)}"
            retryable = exc.code in {429, 503} and not re.search(r"quota|billing|balance|欠费|余额", raw, re.I)
            if retryable and attempt < 2:
                time.sleep(_retry_delay(exc, attempt))
                continue
            raise ProviderError(f"LLM request failed ({last_error})") from None
        except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
            last_error = _redact(str(exc), config.api_key)
            if attempt < 2:
                time.sleep(min(3.0, 2**attempt))
                continue
            raise ProviderError(f"Cannot reach the LLM endpoint: {last_error}") from None
    raise ProviderError(last_error or "LLM request failed")


def _openai_text(data: dict[str, Any]) -> str:
    try:
        choice = data["choices"][0]
        message = choice.get("message", {})
        content = message.get("content")
        if isinstance(content, list):
            return "".join(str(part.get("text", "")) for part in content if isinstance(part, dict)).strip()
        if isinstance(content, str) and content.strip():
            return content.strip()
        # Some compatible gateways place a completed response in reasoning_content.
        reasoning = message.get("reasoning_content") or message.get("reasoning")
        if isinstance(reasoning, str) and choice.get("finish_reason") != "length":
            return reasoning.strip()
        if isinstance(choice.get("text"), str):
            return choice["text"].strip()
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        raise ProviderError("LLM response does not contain a chat completion") from exc
    raise ProviderError("LLM returned empty content; use a non-reasoning/instruct model or increase its output budget")


def _complete_openai(config: LLMConfig, system: str, user: str, max_tokens: int) -> str:
    endpoint = config.base_url if config.base_url.endswith("/chat/completions") else f"{config.base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {config.api_key}"} if config.api_key else {}
    data = _post_json(config, endpoint, {
        "model": config.model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.4,
        "max_tokens": max_tokens,
        "stream": False,
    }, headers)
    return _openai_text(data)


def _complete_anthropic(config: LLMConfig, system: str, user: str, max_tokens: int) -> str:
    if config.base_url.endswith("/v1"):
        endpoint = f"{config.base_url}/messages"
    elif config.base_url.endswith("/messages"):
        endpoint = config.base_url
    else:
        endpoint = f"{config.base_url}/v1/messages"
    data = _post_json(config, endpoint, {
        "model": config.model,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        "temperature": 0.4,
        "max_tokens": max_tokens,
    }, {"x-api-key": config.api_key, "anthropic-version": "2023-06-01"})
    content = data.get("content")
    if isinstance(content, list):
        text = "".join(str(part.get("text", "")) for part in content if isinstance(part, dict) and part.get("type") == "text").strip()
        if text:
            return text
    raise ProviderError("Anthropic returned no text content")


def _complete_gemini(config: LLMConfig, system: str, user: str, max_tokens: int) -> str:
    model = urllib.parse.quote(config.model.removeprefix("models/"), safe="")
    endpoint = f"{config.base_url}/models/{model}:generateContent"
    data = _post_json(config, endpoint, {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": max_tokens, "responseMimeType": "application/json"},
    }, {"x-goog-api-key": config.api_key})
    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(str(part.get("text", "")) for part in parts).strip()
    except (KeyError, IndexError, TypeError) as exc:
        feedback = data.get("promptFeedback", {})
        raise ProviderError(f"Gemini returned no usable content {feedback}") from exc
    if not text:
        raise ProviderError("Gemini returned empty content")
    return text


def complete(config: LLMConfig, system: str, user: str, *, max_tokens: int = 8192) -> str:
    """Generate one text response through the selected provider."""
    if not 256 <= max_tokens <= 32768:
        raise ValueError("max_tokens must be between 256 and 32768")
    if config.provider == "builtin":
        raise ProviderError("Le moteur intégré gratuit couvre la détection de clips. Pour un récap créatif, configurez Ollama localement ; aucun service payant ne sera contacté automatiquement.")
    if config.provider == "anthropic":
        return _complete_anthropic(config, system, user, max_tokens)
    if config.provider == "gemini":
        return _complete_gemini(config, system, user, max_tokens)
    return _complete_openai(config, system, user, max_tokens)


def extract_json(text: str) -> Any:
    """Parse a JSON response, tolerating Markdown fences but not trailing prose."""
    stripped = text.strip()
    fence = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", stripped, flags=re.S | re.I)
    if fence:
        stripped = fence.group(1).strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        # Last resort: select the widest balanced-looking outer JSON value.
        starts = [pos for pos in (stripped.find("{"), stripped.find("[")) if pos >= 0]
        if not starts:
            raise ProviderError("LLM response did not contain JSON")
        start = min(starts)
        end = max(stripped.rfind("}"), stripped.rfind("]"))
        if end <= start:
            raise ProviderError("LLM response contained incomplete JSON")
        try:
            return json.loads(stripped[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ProviderError(f"LLM response contained invalid JSON: {exc.msg}") from exc


def complete_json(config: LLMConfig, system: str, user: str, *, max_tokens: int = 8192, attempts: int = 2) -> Any:
    """Generate JSON with one bounded retry for malformed model output."""
    last: Exception | None = None
    for attempt in range(max(1, min(3, attempts))):
        prompt = user if attempt == 0 else f"{user}\n\nYour previous response was not valid JSON. Return only the corrected JSON value."
        raw = complete(config, system, prompt, max_tokens=max_tokens)
        try:
            return extract_json(raw)
        except ProviderError as exc:
            last = exc
    raise last or ProviderError("Could not obtain JSON from the LLM")
