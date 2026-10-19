"""Read and atomically update the editable system prompts."""

from pathlib import Path

from app.core.config import settings

PROMPT_FILENAMES = {
    "chat": "chat_system.txt",
    "topic": "topic_system.txt",
}


class PromptConfigurationError(RuntimeError):
    """Raised when a required editable system-prompt file is unavailable."""


def prompt_file_path(kind: str) -> Path:
    filename = PROMPT_FILENAMES.get(kind)
    if filename is None:
        raise ValueError("Unknown prompt kind")
    configured = Path(settings.prompt_directory)
    directory = (
        configured if configured.is_absolute() else Path(__file__).resolve().parents[2] / configured
    )
    return directory / filename


def read_system_prompt(kind: str) -> str:
    path = prompt_file_path(kind)
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise PromptConfigurationError(
            f"The {kind} system prompt could not be read from {path}."
        ) from exc
    if not text:
        raise PromptConfigurationError(f"The {kind} system prompt file is empty: {path}.")
    return text


def write_system_prompt(kind: str, text: str) -> str:
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("Prompt text cannot be empty")
    path = prompt_file_path(kind)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(cleaned + "\n", encoding="utf-8")
    temporary_path.replace(path)
    return cleaned
