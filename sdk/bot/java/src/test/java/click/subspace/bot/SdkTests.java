package click.subspace.bot;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

/**
 * The SDK's tests, with a minimal runner so no test framework has to be downloaded:
 * every public static void method whose name starts with "test" runs; exit code 1 on any failure.
 */
public final class SdkTests {
    public static void main(String[] args) throws Exception {
        int passed = 0;
        List<String> failed = new ArrayList<>();
        for (Method m : SdkTests.class.getDeclaredMethods()) {
            if (!m.getName().startsWith("test") || !Modifier.isStatic(m.getModifiers())) continue;
            long start = System.nanoTime();
            try {
                m.invoke(null);
                passed++;
                System.out.printf("  ok   %s (%d ms)%n", m.getName(), (System.nanoTime() - start) / 1_000_000);
            } catch (java.lang.reflect.InvocationTargetException e) {
                failed.add(m.getName());
                System.out.printf("  FAIL %s: %s%n", m.getName(), e.getCause());
                e.getCause().printStackTrace(System.out);
            }
        }
        System.out.printf("%d passed, %d failed%n", passed, failed.size());
        if (!failed.isEmpty()) System.exit(1);
    }

    // ---- helpers --------------------------------------------------------------------------

    static void check(boolean cond, String what) {
        if (!cond) throw new AssertionError(what);
    }

    static void eq(Object actual, Object expected) {
        // Through JSON and back: maps compare without order, and 4 equals 4L.
        Object a = Json.parse(Json.write(actual));
        Object e = Json.parse(Json.write(expected));
        if (!java.util.Objects.equals(a, e)) throw new AssertionError("expected " + Json.write(expected) + ", got " + Json.write(actual));
    }

    static void await(BooleanSupplier cond, String what) throws InterruptedException {
        long end = System.currentTimeMillis() + 5000;
        while (!cond.getAsBoolean()) {
            if (System.currentTimeMillis() > end) throw new AssertionError("timed out waiting for " + what);
            Thread.sleep(20);
        }
    }

    // RFC 8032, section 7.1, test 1.
    static final String RFC_SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    static final String RFC_PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

    static PrivateKey rfcPrivateKey() throws Exception {
        byte[] der = HexFormat.of().parseHex("302e020100300506032b657004220420" + RFC_SEED);
        return KeyFactory.getInstance("Ed25519").generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    static String sign(PrivateKey key, String message) throws Exception {
        Signature s = Signature.getInstance("Ed25519");
        s.initSign(key);
        s.update(message.getBytes(StandardCharsets.UTF_8));
        return HexFormat.of().formatHex(s.sign());
    }

    // ---- verifyInteraction ----------------------------------------------------------------

    public static void testRfc8032KeyPairSignsAsTheRfcSays() throws Exception {
        String sig = sign(rfcPrivateKey(), "");
        check(sig.startsWith("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"), "RFC 8032 signature of the empty message");
    }

    public static void testVerifyInteractionAcceptsGoodSignatures() throws Exception {
        String body = "{\"type\":2,\"id\":\"1\",\"data\":{\"name\":\"ping\"}}";
        String ts = String.valueOf(System.currentTimeMillis() / 1000);
        String sig = sign(rfcPrivateKey(), ts + body);
        check(Interactions.verifyInteraction(body, sig, ts, RFC_PUBLIC), "good signature (String)");
        check(Interactions.verifyInteraction(body.getBytes(StandardCharsets.UTF_8), sig, ts, RFC_PUBLIC), "good signature (bytes)");
        // A freshly generated JDK key pair too.
        KeyPair kp = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        byte[] spki = kp.getPublic().getEncoded();
        String pubHex = HexFormat.of().formatHex(spki, spki.length - 32, spki.length);
        check(Interactions.verifyInteraction(body, sign(kp.getPrivate(), ts + body), ts, pubHex), "generated key pair");
    }

    public static void testVerifyInteractionRefusesForgeriesAndBadInput() throws Exception {
        String body = "{\"type\":2}";
        String ts = String.valueOf(System.currentTimeMillis() / 1000);
        String sig = sign(rfcPrivateKey(), ts + body);
        check(!Interactions.verifyInteraction(body + " ", sig, ts, RFC_PUBLIC), "changed body");
        check(!Interactions.verifyInteraction(body, sig, String.valueOf(Long.parseLong(ts) + 1), RFC_PUBLIC), "changed timestamp");
        check(!Interactions.verifyInteraction(body, "zz", ts, RFC_PUBLIC), "not hex");
        check(!Interactions.verifyInteraction(body, sig.substring(2), ts, RFC_PUBLIC), "short signature");
        check(!Interactions.verifyInteraction(body, sig, ts, "00".repeat(32)), "wrong key");
        check(!Interactions.verifyInteraction(body, sig, ts, "nothex"), "bad key");
        check(!Interactions.verifyInteraction(body, null, ts, RFC_PUBLIC), "no signature");
        check(!Interactions.verifyInteraction(body, sig, "abc", RFC_PUBLIC), "bad timestamp");
        check(!Interactions.verifyInteraction((String) null, sig, ts, RFC_PUBLIC), "no body");
        String old = String.valueOf(System.currentTimeMillis() / 1000 - 301);
        check(!Interactions.verifyInteraction(body, sign(rfcPrivateKey(), old + body), old, RFC_PUBLIC), "too old");
    }

    // ---- verifyInteraction: security ---------------------------------------------------------
    // Ed25519 over timestamp + raw body; hex signature (X-Signature-Ed25519) and hex public key,
    // timestamp from X-Signature-Timestamp. There is no request-parsing helper: callers pass header
    // values, so a missing header is null or "".

    interface Check { void run() throws Exception; }

    /**
     * The runner has no expected-failure marker: this passes while {@code check} fails, and fails once
     * it starts passing, so a fix forces the test to become a normal one.
     */
    static void expectedFailure(String why, Check check) throws Exception {
        try {
            check.run();
        } catch (AssertionError e) {
            System.out.printf("       expected failure (%s): %s%n", why, e.getMessage());
            return;
        }
        throw new AssertionError("expected failure now passes, make it a normal test: " + why);
    }

    // Order of the Ed25519 base point (RFC 8032).
    static final java.math.BigInteger ED25519_L =
            java.math.BigInteger.ONE.shiftLeft(252).add(new java.math.BigInteger("27742317777372353535851937790883648493"));
    static final String IDENTITY_POINT = "01" + "00".repeat(31); // small order (order 1)
    static final String SEC_BODY = "{\"type\":2,\"id\":\"1\",\"data\":{\"name\":\"ping\"}}";

    static String nowTs() {
        return String.valueOf(System.currentTimeMillis() / 1000);
    }

    /** False, not true and not an exception. */
    static void refused(String what, String body, String sig, String ts, String key) {
        boolean r;
        try {
            r = Interactions.verifyInteraction(body, sig, ts, key);
        } catch (RuntimeException e) {
            throw new AssertionError(what + ": threw " + e);
        }
        check(!r, what + ": accepted");
    }

    static String withS(byte[] sig, java.math.BigInteger s) {
        byte[] out = sig.clone();
        for (int i = 0; i < 32; i++) {
            out[32 + i] = s.byteValue();
            s = s.shiftRight(8);
        }
        return HexFormat.of().formatHex(out);
    }

    public static void testSecurityBaselineAndTampering() throws Exception {
        String ts = nowTs();
        String sig = sign(rfcPrivateKey(), ts + SEC_BODY);
        check(Interactions.verifyInteraction(SEC_BODY, sig, ts, RFC_PUBLIC), "valid signature");
        refused("body changed", SEC_BODY.replace("ping", "pong"), sig, ts, RFC_PUBLIC);
        refused("body truncated", SEC_BODY.substring(1), sig, ts, RFC_PUBLIC);
        refused("empty body", "", sig, ts, RFC_PUBLIC);
        refused("ts - 1", SEC_BODY, sig, String.valueOf(Long.parseLong(ts) - 1), RFC_PUBLIC);
        refused("ts with leading zero", SEC_BODY, sig, "0" + ts, RFC_PUBLIC);
        refused("other message", SEC_BODY, sign(rfcPrivateKey(), ts + "{\"type\":1}"), ts, RFC_PUBLIC);
        KeyPair other = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        byte[] spki = other.getPublic().getEncoded();
        String otherPub = HexFormat.of().formatHex(spki, spki.length - 32, spki.length);
        refused("signed by another key", SEC_BODY, sign(other.getPrivate(), ts + SEC_BODY), ts, RFC_PUBLIC);
        refused("checked against another key", SEC_BODY, sig, ts, otherPub);
        // timestamp + body is a plain concatenation: shifting a digit from the body onto the
        // timestamp signs the same bytes; only the freshness window refuses it.
        String shifted = sign(rfcPrivateKey(), ts + "7" + SEC_BODY);
        check(Interactions.verifyInteraction("7" + SEC_BODY, shifted, ts, RFC_PUBLIC), "unshifted");
        refused("digit shifted onto timestamp", SEC_BODY, shifted, ts + "7", RFC_PUBLIC);
    }

    public static void testSecurityMalformedSignatures() throws Exception {
        String ts = nowTs();
        String sig = sign(rfcPrivateKey(), ts + SEC_BODY);
        for (int n : new int[] {0, 1, 32, 63, 65, 128}) refused(n + "-byte signature", SEC_BODY, sig.repeat(3).substring(0, n * 2), ts, RFC_PUBLIC);
        String[][] bad = {
            {"zz", "zz"}, {"zz prefix", "zz" + sig.substring(2)}, {"odd short", sig.substring(1)}, {"odd long", sig + "0"},
            {"0x same length", "0x" + sig.substring(2)}, {"0x prefix", "0x" + sig}, {"leading space", " " + sig},
            {"trailing newline", sig + "\n"}, {"dash", sig.substring(0, 64) + "-" + sig.substring(65)},
            {"arabic digits", "٠".repeat(128)}, {"fullwidth", "０".repeat(128)},
        };
        for (String[] b : bad) refused(b[0], SEC_BODY, b[1], ts, RFC_PUBLIC);
        // Behaviour note: HexFormat.parseHex is case-insensitive; same bytes, so not a forgery.
        check(Interactions.verifyInteraction(SEC_BODY, sig.toUpperCase(), ts, RFC_PUBLIC), "uppercase hex accepted");
    }

    public static void testSecurityMalformedPublicKeys() throws Exception {
        String ts = nowTs();
        String sig = sign(rfcPrivateKey(), ts + SEC_BODY);
        String k = RFC_PUBLIC;
        for (String key : new String[] {"", "00", k.substring(2), k + "00", k.substring(1), "zz".repeat(32), "0x" + k.substring(2), "not hex", " " + k, "00".repeat(32)}) {
            refused("key \"" + key + "\"", SEC_BODY, sig, ts, key);
        }
    }

    public static void testSecurityEmptyAndMissingValues() throws Exception {
        String ts = nowTs();
        String sig = sign(rfcPrivateKey(), ts + SEC_BODY);
        refused("empty signature", SEC_BODY, "", ts, RFC_PUBLIC);
        refused("empty timestamp", SEC_BODY, sig, "", RFC_PUBLIC);
        refused("empty key", SEC_BODY, sig, ts, "");
        refused("all empty", "", "", "", "");
        refused("missing signature header", SEC_BODY, null, ts, RFC_PUBLIC);
        refused("missing timestamp header", SEC_BODY, sig, null, RFC_PUBLIC);
        refused("both headers missing", SEC_BODY, null, null, RFC_PUBLIC);
        refused("null body", null, sig, ts, RFC_PUBLIC);
        check(!Interactions.verifyInteraction((byte[]) null, sig, ts, RFC_PUBLIC), "null byte[] body");
        // A null key (e.g. an unset environment variable) is developer-supplied, not attacker
        // input. It currently throws NullPointerException from HexFormat.parseHex: that fails
        // closed, so accept either false or the NPE, but never true.
        try {
            check(!Interactions.verifyInteraction(SEC_BODY, sig, ts, null), "null key accepted");
        } catch (NullPointerException expected) {
            // fails closed
        }
    }

    public static void testSecurityTimestampFreshness() throws Exception {
        long t = System.currentTimeMillis() / 1000;
        for (long d : new long[] {-301, 301, -86400, 1_000_000_000L}) {
            String ts = String.valueOf(t + d);
            refused("ts " + d, SEC_BODY, sign(rfcPrivateKey(), ts + SEC_BODY), ts, RFC_PUBLIC);
        }
        for (long d : new long[] {-200, 200}) {
            String ts = String.valueOf(t + d);
            check(Interactions.verifyInteraction(SEC_BODY, sign(rfcPrivateKey(), ts + SEC_BODY), ts, RFC_PUBLIC), "ts " + d + " accepted");
        }
        for (String ts : new String[] {"abc", "-1", "+1", "1.5", "1e9", " 1", ts(t) + "\n", "١٧", "²", "9".repeat(16), "9".repeat(5000)}) {
            refused("ts \"" + ts.substring(0, Math.min(12, ts.length())) + "\"", SEC_BODY, sign(rfcPrivateKey(), ts + SEC_BODY), ts, RFC_PUBLIC);
        }
    }

    static String ts(long t) {
        return String.valueOf(t);
    }

    public static void testSecurityNonCanonicalSAndZeroSignatures() throws Exception {
        String ts = nowTs();
        byte[] sig = HexFormat.of().parseHex(sign(rfcPrivateKey(), ts + SEC_BODY));
        byte[] le = new byte[32];
        for (int i = 0; i < 32; i++) le[31 - i] = sig[32 + i];
        java.math.BigInteger s = new java.math.BigInteger(1, le);
        check(s.compareTo(ED25519_L) < 0, "fresh signature has canonical S");
        refused("S + L", SEC_BODY, withS(sig, s.add(ED25519_L)), ts, RFC_PUBLIC);
        refused("S = L", SEC_BODY, withS(sig, ED25519_L), ts, RFC_PUBLIC);
        refused("S = 2^256 - 1", SEC_BODY, withS(sig, java.math.BigInteger.ONE.shiftLeft(256).subtract(java.math.BigInteger.ONE)), ts, RFC_PUBLIC);
        refused("all-zero signature", SEC_BODY, "00".repeat(64), ts, RFC_PUBLIC);
        refused("all-ff signature", SEC_BODY, "ff".repeat(64), ts, RFC_PUBLIC);
        refused("identity R, S = 0", SEC_BODY, IDENTITY_POINT + "00".repeat(32), ts, RFC_PUBLIC);
    }

    // Fixed (was a security bug): the JDK's verifier accepts the small-order identity point as a
    // public key (A = R = identity, S = 0 verifies anything); the SDK refuses small-order keys and R.
    public static void testSecuritySmallOrderPublicKeyIsRefused() throws Exception {
        String ts = nowTs();
        for (String body : new String[] {SEC_BODY, "anything at all"}) {
            refused("identity key, " + body, body, IDENTITY_POINT + "00".repeat(32), ts, IDENTITY_POINT);
        }
    }

    public static void testResponseBodies() {
        eq(Interactions.respondWith("hi"), Map.of("type", 4, "data", Map.of("content", "hi")));
        eq(Interactions.respondWith(Reply.of("x").ephemeral(true)), Json.parse("{\"type\":4,\"data\":{\"content\":\"x\",\"ephemeral\":true}}"));
        eq(Interactions.deferWith(), Json.parse("{\"type\":5,\"data\":{}}"));
        eq(Interactions.deferWith(true), Json.parse("{\"type\":5,\"data\":{\"ephemeral\":true}}"));
    }

    // ---- JSON -----------------------------------------------------------------------------

    public static void testJsonRoundTrip() {
        String text = "{\"a\":1,\"b\":-2.5e3,\"c\":\"q\\\"\\\\\\n\\u00e9\\ud83d\\ude00/\",\"d\":[true,false,null,{}],\"e\":[],\"big\":123456789012345678901234567890,\"id\":\"410148418031190017\"}";
        Map<String, Object> m = Json.parseObject(text);
        check(Long.valueOf(1).equals(m.get("a")), "integer as Long");
        check(Double.valueOf(-2500).equals(m.get("b")), "exponent as Double");
        check("q\"\\\n\u00e9\uD83D\uDE00/".equals(m.get("c")), "escapes");
        check(m.get("big") instanceof java.math.BigInteger, "big integer");
        check(((List<?>) m.get("d")).get(2) == null, "null in array");
        eq(Json.parse(Json.write(m)), m);
        check(Json.write("\u0001\u2028").equals("\"\\u0001\\u2028\""), "control characters escaped");
        eq(Command.of("roll", "Roll").option(Command.Option.integer("sides", "Sides").required(true).choice("d6", 6)).defaultMemberPermissions("8192"),
            Json.parse("{\"name\":\"roll\",\"description\":\"Roll\",\"options\":[{\"type\":\"integer\",\"name\":\"sides\",\"description\":\"Sides\",\"required\":true,\"choices\":[{\"name\":\"d6\",\"value\":6}]}],\"defaultMemberPermissions\":\"8192\"}"));
        eq(Reply.of("hi").embed(Embed.create().title("T").color(0x3b8ef2).field("a", "b", true).footer("f")),
            Json.parse("{\"content\":\"hi\",\"embeds\":[{\"title\":\"T\",\"color\":3903218,\"footer\":{\"text\":\"f\"},\"fields\":[{\"name\":\"a\",\"value\":\"b\",\"inline\":true}]}]}"));
        for (String bad : new String[] {"", "{", "[1,]", "{\"a\" 1}", "01", "\"\\x\"", "tru", "1 2", "{\"a\":1,}"}) {
            try {
                Json.parse(bad);
                throw new AssertionError("accepted bad JSON: " + bad);
            } catch (Json.JsonException expected) {
                // good
            }
        }
    }

    // ---- against a fake instance ----------------------------------------------------------

    static final class FakeRest implements AutoCloseable {
        final HttpServer server;
        final List<Map<String, Object>> calls = new CopyOnWriteArrayList<>();

        FakeRest() throws IOException {
            server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
            server.createContext("/api/v1/", ex -> {
                String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                String path = ex.getRequestURI().getRawPath();
                String auth = ex.getRequestHeaders().getFirst("Authorization");
                Map<String, Object> call = new LinkedHashMap<>();
                call.put("method", ex.getRequestMethod());
                call.put("path", path);
                call.put("auth", auth);
                call.put("body", body.isEmpty() ? null : Json.parse(body));
                calls.add(call);
                int status = 200;
                String out;
                if (path.equals("/api/v1/bots/@me")) {
                    if ("Bot good".equals(auth) || "Bot rest-only".equals(auth)) out = "{\"bot\":{\"id\":\"10\",\"username\":\"dice\",\"appId\":\"20\",\"beaconIds\":[\"30\"]}}";
                    else {
                        status = 401;
                        out = "{\"error\":\"Invalid bot token\",\"code\":\"INVALID_BOT_TOKEN\"}";
                    }
                } else if (path.equals("/api/v1/applications/20/commands") || path.equals("/api/v1/applications/20/beacons/30/commands")) {
                    List<Object> cmds = new ArrayList<>();
                    int n = path.contains("beacons") ? 200 : 100;
                    for (Object c : (List<?>) Json.parse(body)) {
                        Map<String, Object> withId = new LinkedHashMap<>();
                        withId.put("id", String.valueOf(n++));
                        withId.putAll(Json.obj(Map.of("c", c), "c"));
                        cmds.add(withId);
                    }
                    out = Json.write(Map.of("commands", cmds));
                } else if (path.equals("/api/v1/channels/relay/40/transmissions")) {
                    out = Json.write(Map.of("transmission", Map.of("id", "50", "content", Json.str(Json.parse(body), "content"))));
                } else if (path.startsWith("/api/v1/transmissions/") || path.startsWith("/api/v1/interactions/")) {
                    ex.sendResponseHeaders(204, -1);
                    ex.close();
                    return;
                } else {
                    status = 404;
                    out = "{\"error\":\"Not found\",\"code\":\"NOT_FOUND\"}";
                }
                byte[] bytes = out.getBytes(StandardCharsets.UTF_8);
                ex.getResponseHeaders().set("Content-Type", "application/json");
                ex.sendResponseHeaders(status, bytes.length);
                ex.getResponseBody().write(bytes);
                ex.close();
            });
            server.start();
        }

        String base() {
            return "http://127.0.0.1:" + server.getAddress().getPort();
        }

        List<Map<String, Object>> byPath(String p) {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> c : calls) if (p.equals(c.get("path"))) out.add(c);
            return out;
        }

        @Override
        public void close() {
            server.stop(0);
        }
    }

    public static void testRestCalls() throws Exception {
        try (FakeRest rest = new FakeRest(); SubspaceBot bot = new SubspaceBot("good", rest.base())) {
            Map<String, Object> me = bot.me().join();
            eq(me.get("appId"), "20");
            check(bot.user() == me, "user() kept");
            List<Map<String, Object>> cmds = bot.registerCommands(List.of(Command.of("roll", "Roll").option(Command.Option.integer("sides", "Sides")))).join();
            eq(cmds.get(0).get("id"), "100");
            eq(bot.registerCommands(List.of(Map.of("name", "x", "description", "y")), "30").join().get(0).get("id"), "200");
            eq(bot.send("relay", "40", "hello").join().get("content"), "hello");
            bot.send("relay", "40", Reply.of("reply").replyTo("50")).join();
            check(bot.edit("50", "edited").join() == null, "204 is null");
            bot.react("50", "\uD83D\uDC4D").join();
            bot.delete("50").join();
            try {
                bot.rest("GET", "/nowhere", null).join();
                throw new AssertionError("expected an error");
            } catch (CompletionException e) {
                SubspaceApiError err = (SubspaceApiError) e.getCause();
                eq(List.of(err.status(), err.code()), List.of(404, "NOT_FOUND"));
            }
            eq(rest.byPath("/api/v1/channels/relay/40/transmissions").get(1).get("body"), Map.of("content", "reply", "replyToId", "50"));
            for (Map<String, Object> c : rest.calls) eq(c.get("auth"), "Bot good");
            eq(rest.byPath("/api/v1/transmissions/50/reactions/%F0%9F%91%8D/@me").get(0).get("method"), "PUT");
            List<Object> methods = new ArrayList<>();
            for (Map<String, Object> c : rest.byPath("/api/v1/transmissions/50")) methods.add(c.get("method"));
            eq(methods, List.of("PATCH", "DELETE"));
        }
        try (FakeRest rest = new FakeRest(); SubspaceBot bad = new SubspaceBot("nope", rest.base())) {
            try {
                bad.me().join();
                throw new AssertionError("expected 401");
            } catch (CompletionException e) {
                eq(((SubspaceApiError) e.getCause()).code(), "INVALID_BOT_TOKEN");
            }
        }
    }

    public static void testGatewayRefusesBadTokenWith4003() throws Exception {
        try (FakeRest rest = new FakeRest(); FakeGateway gw = new FakeGateway("good", 30000); SubspaceBot bot = new SubspaceBot("rest-only", rest.base(), gw.url())) {
            List<Integer> closes = new CopyOnWriteArrayList<>();
            bot.onClose((code, reason) -> closes.add(code));
            try {
                bot.connect().get(5, TimeUnit.SECONDS);
                throw new AssertionError("expected a refused token");
            } catch (java.util.concurrent.ExecutionException e) {
                eq(((SubspaceApiError) e.getCause()).code(), "INVALID_BOT_TOKEN");
            }
            bot.closed().get(5, TimeUnit.SECONDS);
            await(() -> closes.equals(List.of(4003)), "close 4003");
            eq(gw.identifyTokens, List.of("Bot rest-only"));
        }
    }

    public static void testGatewayEventsAndInteractions() throws Exception {
        try (FakeRest rest = new FakeRest(); FakeGateway gw = new FakeGateway("good", 50); SubspaceBot bot = new SubspaceBot("good", rest.base(), gw.url())) {
            List<Map<String, Object>> readies = new CopyOnWriteArrayList<>();
            List<Message> messages = new CopyOnWriteArrayList<>();
            List<Map<String, Object>> updates = new CopyOnWriteArrayList<>();
            List<Map<String, Object>> deletes = new CopyOnWriteArrayList<>();
            List<String> dispatched = new CopyOnWriteArrayList<>();
            CountDownLatch answered = new CountDownLatch(1);
            List<Throwable> errors = new CopyOnWriteArrayList<>();
            bot.onReady(readies::add).onMessage(messages::add).onMessageUpdate(updates::add).onMessageDelete(deletes::add)
                .onDispatch((t, d) -> dispatched.add(t)).onError(errors::add);
            bot.onInteraction(i -> {
                try {
                    eq(i.commandName(), "roll");
                    eq(i.optionLong("sides"), 20);
                    check(i.option("missing") == null, "missing option is null");
                    eq(i.beaconId(), "30");
                    eq(i.channel(), Map.of("type", "relay", "id", "40"));
                    eq(i.user().get("username"), "sam");
                    // Handlers may block: they run on the bot's event thread.
                    i.defer(true).join();
                    i.followUp("Took a while").join();
                    i.editReply(Reply.of("changed")).join();
                    i.reply("Rolled 7").join();
                } finally {
                    answered.countDown();
                }
            });
            bot.connect().get(5, TimeUnit.SECONDS);
            eq(gw.identifyTokens, List.of("Bot good"));
            await(() -> readies.size() == 1, "ready event");
            eq(readies.get(0).get("session_id"), "s");

            FakeGateway.Conn conn = gw.conns.get(0);
            conn.sendText("{\"op\":0,\"t\":\"TRANSMISSION_CREATE\",\"d\":{\"channelType\":\"relay\",\"channelId\":\"40\",\"transmission\":{\"id\":\"51\",\"content\":\"!hello\",\"author\":{\"id\":\"7\",\"username\":\"sam\"}}}}");
            conn.sendText("{\"op\":0,\"t\":\"TRANSMISSION_UPDATE\",\"d\":{\"channelType\":\"relay\",\"channelId\":\"40\",\"transmission\":{\"id\":\"51\",\"content\":\"!hi\"}}}");
            conn.sendText("{\"op\":0,\"t\":\"TRANSMISSION_DELETE\",\"d\":{\"channelType\":\"relay\",\"channelId\":\"40\",\"transmissionId\":\"51\"}}");
            // A large frame (fragmented by the JDK's listener into several onText calls).
            conn.sendText("{\"op\":0,\"t\":\"BIG\",\"d\":{\"pad\":\"" + "x".repeat(200_000) + "\"}}");
            conn.sendText("{\"op\":0,\"t\":\"INTERACTION_CREATE\",\"d\":{\"type\":2,\"id\":\"60\",\"token\":\"itok\",\"applicationId\":\"20\",\"beaconId\":\"30\",\"channel\":{\"type\":\"relay\",\"id\":\"40\"},\"user\":{\"id\":\"7\",\"username\":\"sam\"},\"memberPermissions\":\"0\",\"data\":{\"id\":\"100\",\"name\":\"roll\",\"options\":[{\"name\":\"sides\",\"type\":\"integer\",\"value\":20}]}}}");
            check(answered.await(5, TimeUnit.SECONDS), "interaction answered");
            await(() -> gw.heartbeats.get() >= 2, "heartbeats");
            await(() -> dispatched.size() == 6, "dispatches");

            check(errors.isEmpty(), "no errors: " + errors);
            Message m = messages.get(0);
            eq(List.of(m.content(), m.channelType(), m.channelId(), m.authorUsername()), List.of("!hello", "relay", "40", "sam"));
            eq(updates.get(0).get("content"), "!hi");
            eq(deletes.get(0).get("transmissionId"), "51");
            eq(dispatched, List.of("READY", "TRANSMISSION_CREATE", "TRANSMISSION_UPDATE", "TRANSMISSION_DELETE", "BIG", "INTERACTION_CREATE"));

            List<Integer> closes = new CopyOnWriteArrayList<>();
            bot.onClose((code, reason) -> closes.add(code));
            bot.disconnect().get(5, TimeUnit.SECONDS);
            await(() -> closes.equals(List.of(1000)), "close event");
            await(() -> conn.clientCloseCode == 1000, "client sent close 1000");
            check(gw.conns.size() == 1, "did not reconnect after disconnect()");

            List<Object> callbackBodies = new ArrayList<>();
            for (Map<String, Object> c : rest.byPath("/api/v1/interactions/60/itok/callback")) {
                callbackBodies.add(c.get("body"));
                check(c.get("auth") == null, "interaction calls carry no bot token");
            }
            eq(callbackBodies, Json.parse("[{\"type\":5,\"data\":{\"ephemeral\":true}},{\"type\":4,\"data\":{\"content\":\"Rolled 7\"}}]"));
            eq(rest.byPath("/api/v1/interactions/60/itok/followup").get(0).get("body"), Map.of("content", "Took a while"));
            eq(rest.byPath("/api/v1/interactions/60/itok/original").get(0).get("method"), "PATCH");
        }
    }

    public static void testReconnectsAfterTheServerDropsIt() throws Exception {
        long before = SubspaceBot.reconnectDelayMillis;
        SubspaceBot.reconnectDelayMillis = 50;
        try (FakeRest rest = new FakeRest(); FakeGateway gw = new FakeGateway("good", 30000); SubspaceBot bot = new SubspaceBot("good", rest.base(), gw.url())) {
            List<Map<String, Object>> readies = new CopyOnWriteArrayList<>();
            bot.onReady(readies::add);
            bot.connect().get(5, TimeUnit.SECONDS);
            gw.conns.get(0).serverClose(1001);
            await(() -> readies.size() == 2, "second READY");
            eq(gw.identifyTokens.size(), 2);
            check(!bot.closed().isDone(), "still running");
        } finally {
            SubspaceBot.reconnectDelayMillis = before;
        }
    }

    public static void testHandlerExceptionsGoToOnError() throws Exception {
        try (FakeRest rest = new FakeRest(); FakeGateway gw = new FakeGateway("good", 30000); SubspaceBot bot = new SubspaceBot("good", rest.base(), gw.url())) {
            List<Throwable> errors = new CopyOnWriteArrayList<>();
            bot.onError(errors::add).onReady(d -> {
                throw new IllegalStateException("handler failed");
            });
            bot.connect().get(5, TimeUnit.SECONDS);
            await(() -> !errors.isEmpty(), "error event");
            check(errors.get(0) instanceof IllegalStateException, "the handler's exception");
        }
    }
}
