import time

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from subspace_bot import defer_with, respond_with, verify_interaction

# RFC 8032, section 7.1, test 1.
SECRET = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
PUBLIC_HEX = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
KEY = Ed25519PrivateKey.from_private_bytes(SECRET)


def sign(ts: str, body: str) -> str:
    return KEY.sign((ts + body).encode()).hex()


def test_known_key_pair_matches_rfc_8032() -> None:
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    assert KEY.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex() == PUBLIC_HEX
    # The RFC's signature of the empty message.
    assert KEY.sign(b"").hex().startswith("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155")


def test_accepts_a_good_signature_str_and_bytes() -> None:
    body = '{"type":2,"id":"1","data":{"name":"ping"}}'
    ts = str(int(time.time()))
    sig = sign(ts, body)
    assert verify_interaction(body, sig, ts, PUBLIC_HEX)
    assert verify_interaction(body.encode(), sig, ts, PUBLIC_HEX)


def test_refuses_forgeries_and_bad_input() -> None:
    body = '{"type":2}'
    ts = str(int(time.time()))
    sig = sign(ts, body)
    assert not verify_interaction(body + " ", sig, ts, PUBLIC_HEX)
    assert not verify_interaction(body, sig, str(int(ts) + 1), PUBLIC_HEX)
    assert not verify_interaction(body, "zz", ts, PUBLIC_HEX)
    assert not verify_interaction(body, sig[:-2], ts, PUBLIC_HEX)
    assert not verify_interaction(body, sig, ts, "00" * 32)
    assert not verify_interaction(body, sig, ts, "not hex")
    assert not verify_interaction(body, "", ts, PUBLIC_HEX)
    assert not verify_interaction(body, None, ts, PUBLIC_HEX)
    assert not verify_interaction(body, sig, "abc", PUBLIC_HEX)


def test_refuses_stale_timestamps() -> None:
    body = "{}"
    old = str(int(time.time()) - 301)
    assert not verify_interaction(body, sign(old, body), old, PUBLIC_HEX)
    recent = str(int(time.time()) - 200)
    assert verify_interaction(body, sign(recent, body), recent, PUBLIC_HEX)


def test_response_bodies() -> None:
    assert respond_with("hi") == {"type": 4, "data": {"content": "hi"}}
    assert respond_with({"content": "x", "ephemeral": True, "embeds": [{"title": "T"}]}) == {
        "type": 4,
        "data": {"content": "x", "ephemeral": True, "embeds": [{"title": "T"}]},
    }
    assert defer_with() == {"type": 5, "data": {}}
    assert defer_with(ephemeral=True) == {"type": 5, "data": {"ephemeral": True}}
