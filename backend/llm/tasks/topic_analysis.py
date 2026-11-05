"""Language-independent pacing for background map analysis."""

MIN_TOPIC_USER_MESSAGES = 3
TOPIC_ANALYSIS_INTERVAL = 3


def topic_analysis_due(chat_info: dict) -> bool:
    count = int(chat_info.get("message_count", 0))
    previous = int(chat_info.get("analysed_message_count", 0))
    # A failed request is retried through the explicit retry endpoint.
    if chat_info.get("analysis_status") == "error":
        return False
    return count >= MIN_TOPIC_USER_MESSAGES and count - previous >= TOPIC_ANALYSIS_INTERVAL
