"""Security tests for verify_interaction: Ed25519 over timestamp + raw body, hex signature and key.

There is no request-parsing helper in the SDK: callers pass the X-Signature-Ed25519 and
X-Signature-Timestamp header values themselves, so "missing header" means None or "" here.
"""

import time

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from subspace_bot import verify_interaction

# Order of the Ed25519 base point (RFC 8032).
L = 2**252 + 27742317777372353535851937790883648493
IDENTITY = "01" + "00" * 31  # the neutral point, encoded: small order (order 1)

KEY = Ed25519PrivateKey.generate()
OTHER = Ed25519PrivateKey.generate()
PUB = KEY.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex()
OTHER_PUB = OTHER.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex()
BODY = '{"type":2,"id":"1","data":{"name":"ping"}}'


def now() -> str:
    return str(int(time.time()))


def sign(ts: str, body: str, key: Ed25519PrivateKey = KEY) -> str:
    return key.sign((ts + body).encode()).hex()


@pytest.fixture()
def good() -> tuple[str, str]:
    ts = now()
    return ts, sign(ts, BODY)


def refused(*args: object) -> bool:
    """True when verification fails closed with False (not True, not an exception)."""
    return verify_interaction(*args) is False  # type: ignore[arg-type]


# ---- baseline and tampering ------------------------------------------------------------


def test_valid_signature_passes(good: tuple[str, str]) -> None:
    ts, sig = good
    assert verify_interaction(BODY, sig, ts, PUB) is True
    assert verify_interaction(BODY.encode(), sig, ts, PUB) is True


def test_tampered_body(good: tuple[str, str]) -> None:
    ts, sig = good
    assert refused(BODY.replace("ping", "pong"), sig, ts, PUB)
    assert refused(BODY + " ", sig, ts, PUB)
    assert refused(BODY[:-1], sig, ts, PUB)
    assert refused("", sig, ts, PUB)


def test_tampered_timestamp(good: tuple[str, str]) -> None:
    ts, sig = good
    assert refused(BODY, sig, str(int(ts) - 1), PUB)
    assert refused(BODY, sig, "0" + ts, PUB)  # same number, different signed bytes


def test_moving_bytes_between_timestamp_and_body(good: tuple[str, str]) -> None:
    # timestamp+body is a plain concatenation, so moving a leading digit of the body onto the
    # timestamp keeps the signed bytes identical. Only the freshness window stops it: the longer
    # timestamp is ~10x in the future.
    ts, _ = good
    sig = sign(ts, "7" + BODY)
    assert verify_interaction("7" + BODY, sig, ts, PUB) is True
    assert refused(BODY, sig, ts + "7", PUB)


def test_signature_of_a_different_message(good: tuple[str, str]) -> None:
    ts, _ = good
    assert refused(BODY, sign(ts, '{"type":1}'), ts, PUB)
    assert refused(BODY, sign(ts, BODY, OTHER), ts, PUB)
    assert refused(BODY, sign(ts, BODY), ts, OTHER_PUB)


# ---- signature encoding ------------------------------------------------------------------


@pytest.mark.parametrize("n_bytes", [0, 1, 32, 63, 65, 128])
def test_wrong_length_signature(good: tuple[str, str], n_bytes: int) -> None:
    ts, sig = good
    padded = (sig * 3)[: n_bytes * 2]
    assert refused(BODY, padded, ts, PUB)


@pytest.mark.parametrize(
    "mangle",
    [
        lambda s: "zz",
        lambda s: "zz" + s[2:],
        lambda s: s[:-1],  # odd length
        lambda s: s + "0",  # odd length
        lambda s: "0x" + s[2:],
        lambda s: "0x" + s,
        lambda s: s[:64] + "-" + s[65:],
        lambda s: "٠" * 128,  # non-ASCII digits
    ],
    ids=["zz", "zz-prefix", "odd-short", "odd-long", "0x-same-length", "0x-prefix", "dash", "arabic-digits"],
)
def test_non_hex_signature(good: tuple[str, str], mangle) -> None:  # type: ignore[no-untyped-def]
    ts, sig = good
    assert refused(BODY, mangle(sig), ts, PUB)


def test_uppercase_hex_signature_is_accepted(good: tuple[str, str]) -> None:
    # Behaviour note: bytes.fromhex is case-insensitive, so uppercase hex verifies too.
    ts, sig = good
    assert verify_interaction(BODY, sig.upper(), ts, PUB) is True


def test_whitespace_in_signature_is_tolerated(good: tuple[str, str]) -> None:
    # Behaviour note: bytes.fromhex skips ASCII whitespace, so a padded or spaced-out header still
    # verifies. Not a forgery (the bytes are the same signature), but it differs from the JS and
    # Java SDKs, which refuse it.
    ts, sig = good
    assert verify_interaction(BODY, " " + sig + "\n", ts, PUB) is True
    assert verify_interaction(BODY, " ".join(sig[i : i + 2] for i in range(0, 128, 2)), ts, PUB) is True


# ---- public key ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key",
    ["", "00", PUB[:-2], PUB + "00", PUB[:-1], "zz" * 32, "0x" + PUB[2:], "not hex", "00" * 32],
    ids=["empty", "1-byte", "31-bytes", "33-bytes", "odd", "zz", "0x", "words", "zero-key"],
)
def test_bad_public_key(good: tuple[str, str], key: str) -> None:
    ts, sig = good
    assert refused(BODY, sig, ts, key)


# ---- empty / missing values ------------------------------------------------------------------


def test_empty_values(good: tuple[str, str]) -> None:
    ts, sig = good
    assert refused(BODY, "", ts, PUB)
    assert refused(BODY, sig, "", PUB)
    assert refused(BODY, sig, ts, "")
    assert refused("", "", "", "")


def test_missing_headers_are_refused(good: tuple[str, str]) -> None:
    # e.g. request.headers.get("X-Signature-Ed25519") is None when the header is absent.
    ts, sig = good
    assert refused(BODY, None, ts, PUB)
    assert refused(BODY, sig, None, PUB)
    assert refused(BODY, None, None, PUB)


@pytest.mark.parametrize("args", [(None, "sig", "ts", PUB), ("{}", "s", "1", None)], ids=["body", "key"])
def test_none_for_developer_supplied_values_fails_closed(good: tuple[str, str], args: tuple) -> None:  # type: ignore[type-arg]
    # raw_body and public_key_hex are typed as non-optional; None must at least never verify.
    ts, sig = good
    body, _, _, key = args
    try:
        result = verify_interaction(body, sig, ts, key)  # type: ignore[arg-type]
    except (TypeError, AttributeError):
        return  # fails closed by raising; acceptable for an out-of-contract argument
    assert result is False


# ---- timestamp freshness (implemented: 300 s either way) --------------------------------------


def test_stale_and_future_timestamps_are_refused() -> None:
    for delta in (-301, 301, -86400, 10**9):
        ts = str(int(time.time()) + delta)
        assert refused(BODY, sign(ts, BODY), ts, PUB), delta
    for delta in (-200, 200):
        ts = str(int(time.time()) + delta)
        assert verify_interaction(BODY, sign(ts, BODY), ts, PUB) is True


@pytest.mark.parametrize("ts", ["abc", "-1", "+1", "1.5", "1e9", " 1", "١٧٠٠"], ids=str)
def test_non_numeric_timestamps_are_refused(ts: str) -> None:
    assert refused(BODY, sign(ts, BODY), ts, PUB)


# Regression: superscript digits ("²") and over-long digit strings used to make int() raise
# ValueError outside the try block; verify.py now accepts only 1-20 ASCII digits.
@pytest.mark.parametrize("ts", ["²", "9" * 5000], ids=["superscript", "5000-digits"])
def test_odd_digit_timestamps_return_false_not_raise(good: tuple[str, str], ts: str) -> None:
    _, sig = good
    assert refused(BODY, sig, ts, PUB)


# ---- malleability and small-order points --------------------------------------------------------


def test_non_canonical_s_is_refused(good: tuple[str, str]) -> None:
    ts, sig_hex = good
    sig = bytes.fromhex(sig_hex)
    s = int.from_bytes(sig[32:], "little")
    assert s < L
    malleated = sig[:32] + (s + L).to_bytes(32, "little")
    assert refused(BODY, malleated.hex(), ts, PUB)
    # S = L exactly, and S with the top bits set, are out of range too.
    assert refused(BODY, (sig[:32] + L.to_bytes(32, "little")).hex(), ts, PUB)
    assert refused(BODY, (sig[:32] + b"\xff" * 32).hex(), ts, PUB)


def test_all_zero_signature_is_refused(good: tuple[str, str]) -> None:
    ts, _ = good
    assert refused(BODY, "00" * 64, ts, PUB)
    assert refused(BODY, "ff" * 64, ts, PUB)


def test_identity_r_with_real_key_is_refused(good: tuple[str, str]) -> None:
    ts, _ = good
    assert refused(BODY, IDENTITY + "00" * 32, ts, PUB)


# SECURITY BUG: the verifier accepts the small-order identity point as a public key. With
# A = identity, R = identity and S = 0 the equation [S]B = R + [k]A holds for every message, so
# anyone can "sign" anything for that key. Only exploitable if the configured public key is
# attacker-influenced or misconfigured, but RFC 8032 cofactor-safe verifiers should refuse
# small-order A. Fix: reject keys (and R values) in the small-order set before verifying.
# Fixed (was a security bug): an identity public key accepted a forged signature.
@pytest.mark.parametrize("body", [BODY, "anything at all"], ids=["body", "other"])
def test_small_order_public_key_is_refused(body: str) -> None:
    ts = now()
    assert refused(body, IDENTITY + "00" * 32, ts, IDENTITY)
