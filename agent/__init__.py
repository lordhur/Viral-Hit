"""Viral Hit local-first production agent."""

__version__ = "0.1.0"

from .recap import RecapAgent, RecapOptions, RecapReceipt
from .providers import LLMConfig, ProviderError, config_from_env

__all__ = [
    "LLMConfig",
    "ProviderError",
    "RecapAgent",
    "RecapOptions",
    "RecapReceipt",
    "config_from_env",
    "__version__",
]
