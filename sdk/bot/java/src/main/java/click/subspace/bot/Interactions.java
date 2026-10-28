package click.subspace.bot;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;

/** HTTP interactions: check signatures, and build response bodies. */
public final class Interactions {
    private Interactions() {}

    /** Requests older (or newer) than this many seconds are refused. */
    public static final long MAX_AGE_SECONDS = 300;

    private static final byte[] SPKI_ED25519_PREFIX = HexFormat.of().parseHex("302a300506032b6570032100");

    /**
     * Encodings of the small-order Ed25519 points (libsodium's blocklist, sign bit ignored). A public
     * key or signature R among them lets one signature pass for any message, so both are refused.
     */
    private static final byte[][] SMALL_ORDER = java.util.stream.Stream.of(
            "0000000000000000000000000000000000000000000000000000000000000000",
            "0100000000000000000000000000000000000000000000000000000000000000",
            "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
            "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
            "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
            "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
            "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f")
        .map(HexFormat.of()::parseHex).toArray(byte[][]::new);

    private static boolean isSmallOrder(byte[] bytes, int offset) {
        for (byte[] c : SMALL_ORDER) {
            boolean same = true;
            for (int i = 0; i < 32 && same; i++) same = (i == 31 ? (bytes[offset + 31] & 0x7f) : bytes[offset + i]) == c[i];
            if (same) return true;
        }
        return false;
    }

    /**
     * Check that an HTTP interaction really came from Subspace. Pass the raw request body exactly as
     * received, the {@code X-Signature-Ed25519} and {@code X-Signature-Timestamp} headers, and your
     * application's public key (hex). The signed message is the timestamp followed by the raw body.
     */
    public static boolean verifyInteraction(String rawBody, String signature, String timestamp, String publicKeyHex) {
        return rawBody != null && verifyInteraction(rawBody.getBytes(StandardCharsets.UTF_8), signature, timestamp, publicKeyHex);
    }

    public static boolean verifyInteraction(byte[] rawBody, String signature, String timestamp, String publicKeyHex) {
        if (rawBody == null || signature == null || signature.isEmpty() || timestamp == null || !timestamp.matches("\\d{1,15}")) return false;
        if (Math.abs(System.currentTimeMillis() / 1000 - Long.parseLong(timestamp)) > MAX_AGE_SECONDS) return false;
        try {
            byte[] key = HexFormat.of().parseHex(publicKeyHex);
            byte[] sig = HexFormat.of().parseHex(signature);
            if (key.length != 32 || sig.length != 64 || isSmallOrder(key, 0) || isSmallOrder(sig, 0)) return false;
            byte[] der = new byte[SPKI_ED25519_PREFIX.length + 32];
            System.arraycopy(SPKI_ED25519_PREFIX, 0, der, 0, SPKI_ED25519_PREFIX.length);
            System.arraycopy(key, 0, der, SPKI_ED25519_PREFIX.length, 32);
            PublicKey pub = KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(der));
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(pub);
            verifier.update(timestamp.getBytes(StandardCharsets.US_ASCII));
            verifier.update(rawBody);
            return verifier.verify(sig);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            return false;
        }
    }

    /** The body of a response that answers right away (type 4). Write it with {@link Json#write}. */
    public static Map<String, Object> respondWith(String content) {
        return respondWith(Reply.of(content));
    }

    public static Map<String, Object> respondWith(Object reply) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", 4);
        m.put("data", SubspaceBot.replyBody(reply));
        return m;
    }

    /** The body of a response that defers (type 5): follow up within 15 minutes. */
    public static Map<String, Object> deferWith() {
        return deferWith(null);
    }

    public static Map<String, Object> deferWith(Boolean ephemeral) {
        Map<String, Object> data = new LinkedHashMap<>();
        if (ephemeral != null) data.put("ephemeral", ephemeral);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", 5);
        m.put("data", data);
        return m;
    }
}
