"""Decode only the assistant message from incomplete streamed JSON."""

import json

JSON_ESCAPE_CHARACTERS = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
}


def top_level_json_string_value_start(content: str, field_name: str) -> int | None:
    """Find a top-level string field without matching text inside nested values."""

    depth = 0
    index = 0
    while index < len(content):
        character = content[index]
        if character == "{":
            depth += 1
            index += 1
            continue
        if character == "}":
            depth = max(0, depth - 1)
            index += 1
            continue
        if character != '"':
            index += 1
            continue

        string_start = index
        index += 1
        escaped = False
        while index < len(content):
            character = content[index]
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                break
            index += 1
        if index >= len(content):
            return None

        string_end = index + 1
        if depth == 1:
            after_string = string_end
            while after_string < len(content) and content[after_string].isspace():
                after_string += 1
            if after_string < len(content) and content[after_string] == ":":
                try:
                    key = json.loads(content[string_start:string_end])
                except json.JSONDecodeError:
                    return None
                if key == field_name:
                    value_start = after_string + 1
                    while value_start < len(content) and content[value_start].isspace():
                        value_start += 1
                    if value_start < len(content) and content[value_start] == '"':
                        return value_start + 1
                    return None
        index = string_end
    return None


def assistant_message_prefix_from_json(content: str) -> str:
    """Decode the complete prefix of assistant_message from partial JSON."""

    value_start = top_level_json_string_value_start(content, "assistant_message")
    if value_start is None:
        return ""

    decoded: list[str] = []
    index = value_start
    while index < len(content):
        character = content[index]
        if character == '"':
            break
        if character != "\\":
            decoded.append(character)
            index += 1
            continue

        if index + 1 >= len(content):
            break
        escape = content[index + 1]
        if escape in JSON_ESCAPE_CHARACTERS:
            decoded.append(JSON_ESCAPE_CHARACTERS[escape])
            index += 2
            continue
        if escape != "u" or index + 6 > len(content):
            break

        hexadecimal = content[index + 2 : index + 6]
        try:
            code_point = int(hexadecimal, 16)
        except ValueError:
            break
        index += 6

        # Wait for the low surrogate before exposing a split Unicode character.
        if 0xD800 <= code_point <= 0xDBFF:
            if index + 6 > len(content) or content[index : index + 2] != "\\u":
                break
            try:
                low_surrogate = int(content[index + 2 : index + 6], 16)
            except ValueError:
                break
            if not 0xDC00 <= low_surrogate <= 0xDFFF:
                break
            code_point = 0x10000 + ((code_point - 0xD800) << 10) + (low_surrogate - 0xDC00)
            index += 6
        elif 0xDC00 <= code_point <= 0xDFFF:
            break
        decoded.append(chr(code_point))

    return "".join(decoded)
