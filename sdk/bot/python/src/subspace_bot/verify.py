"""HTTP interactions: check signatures and build response bodies."""

from __future__ import annotations

import re
import time
from typing import Any, Union

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .types import Reply

MAX_AGE_SECONDS = 300


_DIGITS = re.compile(r"[0-9]{1,20}")

# Encodings of the small-order Ed25519 points (libsodium's blocklist, sign bit ignored). A public
# key or signature R among them lets one signature pass for any message, so both are refused.
_SMALL_ORDER = [
    bytes.fromhex(h)
    for h in (
        "0000000000000000000000000000000000000000000000000000000000000000",
        "0100000000000000000000000000000000000000000000000000000000000000",
        "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
        "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
        "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
        "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
        "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    )
]


def _small_order(point: bytes) -> bool:
    normalized = point[:31] + bytes([point[31] & 0x7F])
    return normalized in _SMALL_ORDER


def verify_interaction(
    raw_body: Union[str, bytes],
    signature: str | None,
    timestamp: str | None,
    public_key_hex: str,
) -> bool:
    """Check that an HTTP interaction really came from Subspace.

    Pass the raw request body exactly as received, the ``X-Signature-Ed25519`` and
    ``X-Signature-Timestamp`` headers, and your application's public key (hex). The signed
    message is the timestamp followed by the raw body. Requests older (or newer) than five
    minutes are refused.
    """
    # ASCII digits only: str.isdigit() also accepts digits int() rejects (e.g. "²").
    if not signature or not timestamp or not _DIGITS.fullmatch(timestamp):
        return False
    if abs(time.time() - int(timestamp)) > MAX_AGE_SECONDS:
        return False
    try:
        key = bytes.fromhex(public_key_hex)
        sig = bytes.fromhex(signature)
        if len(key) != 32 or len(sig) != 64 or _small_order(key) or _small_order(sig[:32]):
            return False
        body = raw_body if isinstance(raw_body, bytes) else raw_body.encode("utf-8")
        Ed25519PublicKey.from_public_bytes(key).verify(sig, timestamp.encode("ascii") + body)
        return True
    except (InvalidSignature, ValueError):
        return False


def _reply_data(reply: Union[Reply, str, dict[str, Any]]) -> dict[str, Any]:
    return {"content": reply} if isinstance(reply, str) else dict(reply)


def respond_with(reply: Union[Reply, str, dict[str, Any]]) -> dict[str, Any]:
    """The body of an HTTP interaction response that answers right away (type 4)."""
    return {"type": 4, "data": _reply_data(reply)}


def defer_with(*, ephemeral: bool | None = None) -> dict[str, Any]:
    """The body of an HTTP interaction response that defers (type 5): follow up within 15 minutes."""
    return {"type": 5, "data": {} if ephemeral is None else {"ephemeral": ephemeral}}
