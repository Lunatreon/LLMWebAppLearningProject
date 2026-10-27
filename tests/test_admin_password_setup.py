"""Keep administrator password hashes literal when passed through Compose."""

import json
import shutil
import subprocess

import pytest

from scripts.set_admin_password import replace_setting


@pytest.mark.skipif(not shutil.which("docker"), reason="Docker CLI required")
def test_admin_hash_survives_compose_interpolation(tmp_path):
    password_hash = "pbkdf2_sha256$600000$exampleSalt$exampleDigest"
    env_file = tmp_path / "admin.env"
    env_file.write_text(
        replace_setting('ADMIN_PASSWORD_HASH="old"\n', "ADMIN_PASSWORD_HASH", password_hash),
        encoding="utf-8",
    )
    compose_file = tmp_path / "compose.yml"
    compose_file.write_text(
        "services:\n  backend:\n    image: example\n    env_file:\n      - admin.env\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [
            "docker",
            "compose",
            "--env-file",
            str(env_file),
            "-f",
            str(compose_file),
            "config",
            "--format",
            "json",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    config = json.loads(result.stdout)
    # `compose config` escapes literal dollars for reusable Compose output.
    rendered = config["services"]["backend"]["environment"]["ADMIN_PASSWORD_HASH"]
    assert rendered.replace("$$", "$") == password_hash
