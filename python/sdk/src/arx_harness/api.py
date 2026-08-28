from __future__ import annotations

import json
import shutil
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .client import HarnessClient, HarnessConfig
from .errors import SdkProtocolError
from .models import JsonObject, Notification


@dataclass(slots=True)
class ArxHarnessConfig:
    """Configuration for launching the local arx Harness SDK runtime.

    The runtime inherits the caller's environment by default, so existing
    PRIMARY_API_KEY and PRIMARY_BASE_URL settings keep working. Use ``env`` to
    intentionally override or inject variables for a subprocess.
    """

    provider: str = "primary"
    model: str = "primary-flash"
    max_tokens: int | None = None
    cwd: str | None = None
    runtime_cwd: str | None = None
    session_root: str | None = None
    cordis: str | None = None
    env: dict[str, str] = field(default_factory=dict)
    runtime_bin: str | None = None
    launch_args_override: tuple[str, ...] | None = None
    request_timeout_seconds: float | None = None
    shutdown_timeout_seconds: float | None = 1.0
    base_url: str | None = None
    api_key: str | None = None


@dataclass(slots=True)
class RunResult:
    session_id: str
    final_response: str
    finish_reason: str | None
    events: list[JsonObject]
    notifications: list[Notification]
    session_root: str | None = None


class ArxHarness:
    """Reusable synchronous SDK for running arx Harness agent turns.

    The runtime subprocess starts lazily and remains owned by this instance
    across calls to :meth:`run`. Use the instance as a context manager, or call
    :meth:`close` explicitly when finished, so the subprocess is always reaped.
    """

    def __init__(self, config: ArxHarnessConfig | None = None, **kwargs: object) -> None:
        if config is not None and kwargs:
            raise TypeError("pass either ArxHarnessConfig or keyword options, not both")
        self.config = config or ArxHarnessConfig(**kwargs)
        cwd = str(Path(self.config.cwd or Path.cwd()).resolve())
        runtime_cwd = str(Path(self.config.runtime_cwd).resolve()) if self.config.runtime_cwd is not None else cwd
        self._cwd = cwd
        env = dict(self.config.env)
        if self.config.session_root is not None:
            env["ARX_SESSION_ROOT"] = self.config.session_root
        if self.config.cordis is not None:
            env["ARX_CORDIS_CONFIG"] = self.config.cordis
        env["ARX_CWD"] = cwd
        if self.config.base_url is not None:
            env["PRIMARY_BASE_URL"] = self.config.base_url
        if self.config.api_key is not None:
            env["PRIMARY_API_KEY"] = self.config.api_key
        self._overlay_root: str | None = None
        overlay = self._write_route_overlay(env)
        if overlay is not None:
            env["ARX_CORDIS_CONFIG"] = overlay

        self._client = HarnessClient(
            HarnessConfig(
                runtime_bin=self.config.runtime_bin,
                launch_args_override=self.config.launch_args_override,
                cwd=runtime_cwd,
                env=env,
                request_timeout_seconds=self.config.request_timeout_seconds,
                shutdown_timeout_seconds=self.config.shutdown_timeout_seconds,
            )
        )
        self._initialized = False

    def __enter__(self) -> "ArxHarness":
        self.start()
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    @property
    def client(self) -> HarnessClient:
        return self._client

    def start(self) -> None:
        if self._initialized:
            return
        self._client.start()
        self._client.initialize(
            cwd=self._cwd,
            provider=self.config.provider,
            model=self.config.model,
            max_tokens=self.config.max_tokens,
        )
        self._initialized = True

    def close(self) -> None:
        self._client.close()
        self._initialized = False
        if self._overlay_root is not None:
            shutil.rmtree(self._overlay_root, ignore_errors=True)
            self._overlay_root = None

    def _write_route_overlay(self, env: dict[str, str]) -> str | None:
        """Compose ``base_url`` and ``model`` into the bundled zero-config tree.

        The bundled composition ships a placeholder endpoint and a fixed model
        list, because shipped configuration outranks the launching shell and so
        must not read either from the environment. A caller that named an
        endpoint states it explicitly, and the composition tier is where such a
        statement belongs, so the endpoint and the named model arrive as a
        patch layer over the bundled tree rather than as variables the runtime
        reads back. Returns the overlay path, or ``None`` when the launch is
        not a bundled zero-config one or named no endpoint to compose.
        """
        if self.config.base_url is None:
            return None
        uses_bundled_runtime = (
            self.config.launch_args_override is None
            and self.config.runtime_bin is None
            and self.config.cordis is None
        )
        if not uses_bundled_runtime or env.get("ARX_CORDIS_CONFIG"):
            return None
        try:
            from arx_harness_runtime import bundled_default_config_path
        except ImportError:
            # No bundled runtime installed, so there is no tree to overlay and
            # the launch will fail on its own terms with the install error.
            return None
        bundled = bundled_default_config_path()
        # A patch replaces an entry's `config` outright rather than merging into
        # it, so the route is restated in full. JSON is a YAML subset, which
        # keeps the quoting of `off` (a YAML 1.1 boolean) unambiguous.
        overlay = [
            {
                "id": "bundled",
                "name": "cordis:include",
                "config": {
                    "path": bundled.as_uri(),
                    "patches": [
                        {
                            "id": "llm-pi-ai",
                            "config": {
                                "providers": {
                                    self.config.provider: {
                                        "displayName": "Primary",
                                        "apiKeyEnv": "PRIMARY_API_KEY",
                                        "api": "openai-completions",
                                        "baseURL": self.config.base_url,
                                        "compat": {"maxTokensField": "max_tokens"},
                                        "models": [{"id": self.config.model}],
                                    }
                                }
                            },
                        }
                    ],
                },
            }
        ]
        self._overlay_root = tempfile.mkdtemp(prefix="arx-sdk-overlay-")
        path = Path(self._overlay_root) / "cordis.yml"
        path.write_text(json.dumps(overlay, indent=2), encoding="utf-8")
        return str(path)

    def start_session(self, session_id: str | None = None) -> "Session":
        self.start()
        return Session(self, session_id or f"session-{uuid.uuid4().hex}")

    def run(
        self,
        input: str | list[JsonObject],
        *,
        session_id: str | None = None,
        on_notification: Callable[[Notification], None] | None = None,
    ) -> RunResult:
        return self.start_session(session_id).run(input, on_notification=on_notification)


class Session:
    def __init__(self, harness: ArxHarness, session_id: str) -> None:
        self.harness = harness
        self.id = session_id

    def run(
        self,
        input: str | list[JsonObject],
        *,
        on_notification: Callable[[Notification], None] | None = None,
    ) -> RunResult:
        content_blocks = normalize_input(input)
        notifications: list[Notification] = []
        events: list[JsonObject] = []

        def collect(notification: Notification) -> None:
            notifications.append(notification)
            if on_notification is not None:
                on_notification(notification)
            if (
                notification.method == "session.event"
                and notification.payload.get("sessionId") == self.id
            ):
                event = notification.payload.get("event")
                if isinstance(event, dict):
                    events.append(event)

        with self.harness.client.subscribe_session_notifications(self.id) as subscription:
            message_id = self.harness.client.session_prompt(
                self.id,
                content_blocks,
                notification_subscription=subscription,
            )

            received = False
            while True:
                notification = subscription.next()
                if not received:
                    if not _is_inbox_receipt(notification, self.id, message_id):
                        continue
                    received = True
                collect(notification)
                if (
                    notification.method == "session.status"
                    and notification.payload.get("sessionId") == self.id
                    and notification.payload.get("status") == "idle"
                ):
                    break

        return RunResult(
            session_id=self.id,
            final_response=final_response(events),
            finish_reason=finish_reason(events),
            events=events,
            notifications=notifications,
            session_root=self.harness.config.session_root,
        )


def _is_inbox_receipt(notification: Notification, session_id: str, message_id: str) -> bool:
    if notification.method != "session.event" or notification.payload.get("sessionId") != session_id:
        return False
    event = notification.payload.get("event")
    if not isinstance(event, dict) or event.get("type") != "agent/inbox/spliced":
        return False
    data = event.get("data")
    inserted = data.get("inserted") if isinstance(data, dict) else None
    return isinstance(inserted, list) and any(
        isinstance(message, dict) and message.get("id") == message_id for message in inserted
    )


def normalize_input(input: str | list[JsonObject]) -> list[JsonObject]:
    if isinstance(input, str):
        return [{"type": "text", "text": input}]
    return input


def final_response(events: list[JsonObject]) -> str:
    for event in reversed(events):
        if event.get("type") != "assistant/message":
            continue
        data = event.get("data")
        if not isinstance(data, dict):
            continue
        message = data.get("message")
        content_owner = message if isinstance(message, dict) else data
        content = content_owner.get("content")
        if not isinstance(content, list):
            continue
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return "".join(parts)
    return ""


def finish_reason(events: list[JsonObject]) -> str | None:
    """Return the last turn-ending kind.

    The input must contain root-session events from one owned run interval.

    Raises:
        SdkProtocolError: The last ``turn/end`` has no string reason kind.
    """
    for event in reversed(events):
        if event.get("type") != "turn/end":
            continue
        data = event.get("data")
        reason = data.get("reason") if isinstance(data, dict) else None
        kind = reason.get("kind") if isinstance(reason, dict) else None
        if not isinstance(kind, str):
            raise SdkProtocolError("turn/end event requires a string data.reason.kind")
        return kind
    return None
