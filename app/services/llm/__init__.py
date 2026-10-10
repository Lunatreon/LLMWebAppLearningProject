"""LLM entry points. Provider details live in the corresponding submodules."""

from app.services.llm.providers.factory import get_chat_llm_client, get_topic_llm_client
from app.services.llm.tasks.journal import analyse_journal_text
from app.services.llm.providers.ollama import warm_ollama_model
from app.services.llm.types import ChatLLMClient, ChatLLMResult, TopicLLMClient, TopicLLMResult

__all__ = [
    "analyse_journal_text",
    "get_chat_llm_client",
    "get_topic_llm_client",
    "warm_ollama_model",
    "ChatLLMClient",
    "ChatLLMResult",
    "TopicLLMClient",
    "TopicLLMResult",
]
