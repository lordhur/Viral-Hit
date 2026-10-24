from __future__ import annotations

import io
import json
import unittest
from unittest.mock import patch
import urllib.error

from agent.providers import LLMConfig, ProviderError, complete, complete_json, config_from_env, extract_json


class FakeResponse:
    def __init__(self, value):
        self.raw = json.dumps(value).encode()
        self.headers = {"Content-Length": str(len(self.raw))}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, limit=-1):
        return self.raw[:limit] if limit >= 0 else self.raw


class ProviderTests(unittest.TestCase):
    def test_unified_environment_and_legacy_fallback(self):
        config = config_from_env({
            "VIRALHIT_LLM_PROVIDER": "anthropic",
            "VIRALHIT_LLM_MODEL": "model-a",
            "ANTHROPIC_API_KEY": "secret",
        })
        self.assertEqual((config.provider, config.model, config.api_key), ("anthropic", "model-a", "secret"))
        self.assertNotIn("secret", str(config.public))
        legacy = config_from_env({"HOTCLIP_LLM_BASE_URL": "http://127.0.0.1:11434/v1", "HOTCLIP_LLM_MODEL": "local"})
        self.assertEqual(legacy.base_url, "http://127.0.0.1:11434/v1")

    def test_remote_compatible_endpoint_requires_key(self):
        with self.assertRaisesRegex(ProviderError, "API_KEY"):
            config_from_env({"VIRALHIT_LLM_BASE_URL": "https://example.com/v1", "VIRALHIT_LLM_MODEL": "x"})

    @patch("agent.providers.urllib.request.urlopen")
    def test_openai_protocol(self, urlopen):
        urlopen.return_value = FakeResponse({"choices": [{"message": {"content": "{\"ok\":true}"}, "finish_reason": "stop"}]})
        config = LLMConfig("openai-compatible", "m", "secret", "https://example.com/v1")
        self.assertEqual(complete(config, "system", "user"), '{"ok":true}')
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://example.com/v1/chat/completions")
        self.assertEqual(request.headers["Authorization"], "Bearer secret")
        payload = json.loads(request.data)
        self.assertEqual(payload["messages"][0]["content"], "system")

    @patch("agent.providers.urllib.request.urlopen")
    def test_anthropic_protocol(self, urlopen):
        urlopen.return_value = FakeResponse({"content": [{"type": "thinking", "thinking": "hidden"}, {"type": "text", "text": "bonjour"}]})
        config = LLMConfig("anthropic", "m", "secret", "https://api.anthropic.com")
        self.assertEqual(complete(config, "system", "user"), "bonjour")
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.anthropic.com/v1/messages")
        self.assertEqual(request.headers["X-api-key"], "secret")
        self.assertEqual(json.loads(request.data)["system"], "system")

    @patch("agent.providers.urllib.request.urlopen")
    def test_gemini_protocol_and_json_extraction(self, urlopen):
        urlopen.return_value = FakeResponse({"candidates": [{"content": {"parts": [{"text": "```json\n{\"n\":1}\n```"}]}}]})
        config = LLMConfig("gemini", "models/m", "secret", "https://generativelanguage.googleapis.com/v1beta")
        self.assertEqual(complete_json(config, "system", "user"), {"n": 1})
        request = urlopen.call_args.args[0]
        self.assertTrue(request.full_url.endswith("/models/m:generateContent"))
        self.assertEqual(request.headers["X-goog-api-key"], "secret")

    def test_extract_json_rejects_prose(self):
        self.assertEqual(extract_json("prefix {\"ok\": true} suffix"), {"ok": True})
        with self.assertRaises(ProviderError):
            extract_json("not json")

    @patch("agent.providers.time.sleep", return_value=None)
    @patch("agent.providers.urllib.request.urlopen")
    def test_http_error_redacts_key(self, urlopen, _sleep):
        error = urllib.error.HTTPError("https://example.com", 401, "no", {}, io.BytesIO(b'{"error":{"message":"bad secret"}}'))
        urlopen.side_effect = error
        config = LLMConfig("openai-compatible", "m", "secret", "https://example.com/v1")
        with self.assertRaises(ProviderError) as caught:
            complete(config, "s", "u")
        self.assertNotIn("secret", str(caught.exception))
        self.assertIn("401", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
