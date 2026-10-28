package click.subspace.bot;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * A Subspace Frequency bot: the REST API, the real-time gateway, and slash-command interactions.
 * Only the JDK is needed (Java 17+).
 *
 * <pre>{@code
 * SubspaceBot bot = new SubspaceBot(System.getenv("BOT_TOKEN"), "https://subspace.click");
 * bot.registerCommands(List.of(Command.of("ping", "Check the bot is alive"))).join();
 * bot.onInteraction(i -> { if (i.commandName().equals("ping")) i.reply("Pong!"); });
 * bot.onMessage(m -> { if (m.content().equals("!hello")) bot.send(m.channelType(), m.channelId(), "Hi!"); });
 * bot.connect().join();
 * bot.closed().join(); // keep running until disconnect()
 * }</pre>
 *
 * <p>Calls return {@link CompletableFuture}s; {@code join()} them for blocking code. Event handlers
 * run one at a time, in order, on the bot's own event thread (not the socket's), so a handler may
 * block on {@code join()}. Event names match the JavaScript SDK: ready, message, messageUpdate,
 * messageDelete, interaction, dispatch, close, error.
 */
public final class SubspaceBot implements AutoCloseable {
    private static final Logger LOG = Logger.getLogger("click.subspace.bot");
    /** How long the bot waits before reconnecting after the gateway connection drops. */
    static volatile long reconnectDelayMillis = 2000;

    private final String token;
    private final String baseUrl;
    private final String gatewayUrl;
    private final HttpClient http;

    private final List<Consumer<Map<String, Object>>> onReady = new CopyOnWriteArrayList<>();
    private final List<Consumer<Message>> onMessage = new CopyOnWriteArrayList<>();
    private final List<Consumer<Map<String, Object>>> onMessageUpdate = new CopyOnWriteArrayList<>();
    private final List<Consumer<Map<String, Object>>> onMessageDelete = new CopyOnWriteArrayList<>();
    private final List<Consumer<Interaction>> onInteraction = new CopyOnWriteArrayList<>();
    private final List<BiConsumer<String, Object>> onDispatch = new CopyOnWriteArrayList<>();
    private final List<BiConsumer<Integer, String>> onClose = new CopyOnWriteArrayList<>();
    private final List<Consumer<Throwable>> onError = new CopyOnWriteArrayList<>();

    private final ExecutorService events = Executors.newSingleThreadExecutor(daemon("subspace-bot-events"));
    private final ScheduledExecutorService timers = Executors.newSingleThreadScheduledExecutor(daemon("subspace-bot-timers"));

    private final Object lock = new Object();
    private volatile Map<String, Object> user;
    private WebSocket ws;
    private int generation;
    private ScheduledFuture<?> heartbeat;
    private CompletableFuture<Void> sendChain = CompletableFuture.completedFuture(null);
    private CompletableFuture<Void> ready;
    private CompletableFuture<Void> closed = CompletableFuture.completedFuture(null);
    private volatile boolean closing;

    public SubspaceBot(String token, String baseUrl) {
        this(token, baseUrl, null);
    }

    /**
     * @param token      the bot token
     * @param baseUrl    the instance, e.g. {@code https://subspace.click}
     * @param gatewayUrl the gateway's WebSocket URL; null for {@code <baseUrl>/gateway}
     */
    public SubspaceBot(String token, String baseUrl, String gatewayUrl) {
        this(token, baseUrl, gatewayUrl, HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(15)).build());
    }

    public SubspaceBot(String token, String baseUrl, String gatewayUrl, HttpClient http) {
        this.token = Objects.requireNonNull(token, "token");
        this.baseUrl = Objects.requireNonNull(baseUrl, "baseUrl").replaceAll("/+$", "");
        this.gatewayUrl = gatewayUrl != null ? gatewayUrl : this.baseUrl.replaceFirst("^http", "ws") + "/gateway";
        this.http = Objects.requireNonNull(http, "http");
    }

    private static java.util.concurrent.ThreadFactory daemon(String name) {
        return r -> {
            Thread t = new Thread(r, name);
            t.setDaemon(true);
            return t;
        };
    }

    // ---- events ---------------------------------------------------------------------------

    /** {@code ready}: connected; the READY payload. */
    public SubspaceBot onReady(Consumer<Map<String, Object>> handler) { onReady.add(handler); return this; }
    /** {@code message}: a new transmission in a beacon the bot is in. */
    public SubspaceBot onMessage(Consumer<Message> handler) { onMessage.add(handler); return this; }
    /** {@code messageUpdate}: an edited transmission. */
    public SubspaceBot onMessageUpdate(Consumer<Map<String, Object>> handler) { onMessageUpdate.add(handler); return this; }
    /** {@code messageDelete}: the TRANSMISSION_DELETE payload. */
    public SubspaceBot onMessageDelete(Consumer<Map<String, Object>> handler) { onMessageDelete.add(handler); return this; }
    /** {@code interaction}: someone used one of the bot's commands. */
    public SubspaceBot onInteraction(Consumer<Interaction> handler) { onInteraction.add(handler); return this; }
    /** {@code dispatch}: every gateway event, as (type, data). */
    public SubspaceBot onDispatch(BiConsumer<String, Object> handler) { onDispatch.add(handler); return this; }
    /** {@code close}: the gateway connection closed, as (code, reason). */
    public SubspaceBot onClose(BiConsumer<Integer, String> handler) { onClose.add(handler); return this; }
    /** {@code error}: a connection problem, or an exception thrown by a handler. */
    public SubspaceBot onError(Consumer<Throwable> handler) { onError.add(handler); return this; }

    private <T> void emit(List<Consumer<T>> handlers, T value) {
        for (Consumer<T> h : handlers) {
            events.execute(() -> {
                try {
                    h.accept(value);
                } catch (Throwable t) {
                    handlerFailed(t);
                }
            });
        }
    }

    private <A, B> void emit2(List<BiConsumer<A, B>> handlers, A a, B b) {
        for (BiConsumer<A, B> h : handlers) {
            events.execute(() -> {
                try {
                    h.accept(a, b);
                } catch (Throwable t) {
                    handlerFailed(t);
                }
            });
        }
    }

    private void handlerFailed(Throwable t) {
        emitError(t);
    }

    private void emitError(Throwable t) {
        Throwable err = unwrap(t);
        if (onError.isEmpty()) {
            LOG.log(Level.WARNING, "Subspace bot error", err);
            return;
        }
        for (Consumer<Throwable> h : onError) {
            events.execute(() -> {
                try {
                    h.accept(err);
                } catch (Throwable inner) {
                    LOG.log(Level.WARNING, "Error handler failed", inner);
                }
            });
        }
    }

    static Throwable unwrap(Throwable t) {
        while ((t instanceof CompletionException || t instanceof ExecutionException) && t.getCause() != null) t = t.getCause();
        return t;
    }

    // ---- REST -----------------------------------------------------------------------------

    /** A REST call as the bot. */
    public CompletableFuture<Object> rest(String method, String path, Object body) {
        return rest(method, path, body, true);
    }

    /**
     * A REST call under {@code /api/v1}. {@code asBot} false for the interaction endpoints, where the
     * URL's token is the credential. Resolves to the parsed JSON (a Map, usually), or null for 204;
     * fails with {@link SubspaceApiError} for an error answer.
     */
    public CompletableFuture<Object> rest(String method, String path, Object body, boolean asBot) {
        HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/v1" + path)).timeout(Duration.ofSeconds(30));
        if (asBot) req.header("Authorization", "Bot " + token);
        if (body != null) {
            req.header("Content-Type", "application/json");
            req.method(method, HttpRequest.BodyPublishers.ofString(Json.write(body), StandardCharsets.UTF_8));
        } else {
            req.method(method, HttpRequest.BodyPublishers.noBody());
        }
        return http.sendAsync(req.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).thenApply(res -> {
            if (res.statusCode() == 204) return null;
            Object data;
            try {
                data = res.body() == null || res.body().isEmpty() ? new LinkedHashMap<String, Object>() : Json.parse(res.body());
            } catch (Json.JsonException e) {
                data = new LinkedHashMap<String, Object>();
            }
            if (res.statusCode() >= 400) {
                String error = Json.str(data, "error");
                throw new SubspaceApiError(error != null ? error : "HTTP " + res.statusCode(), res.statusCode(), Json.str(data, "code"));
            }
            return data;
        });
    }

    /** Who the bot is: {@code {id, username, appId, beaconIds}}. Also kept for {@link #user()}. */
    public CompletableFuture<Map<String, Object>> me() {
        return rest("GET", "/bots/@me", null).thenApply(r -> {
            Map<String, Object> bot = Json.obj(r, "bot");
            this.user = bot;
            return bot;
        });
    }

    /** The bot, once connected or after {@link #me()}; otherwise null. */
    public Map<String, Object> user() {
        return user;
    }

    /** Post text in a relay or thread the bot can see. Resolves to the transmission. */
    public CompletableFuture<Map<String, Object>> send(String channelType, String channelId, String content) {
        return send(channelType, channelId, (Object) Reply.of(content));
    }

    /** Post a {@link Reply} (content, embeds, replyTo) or a {@code Map} in the API's shape. */
    public CompletableFuture<Map<String, Object>> send(String channelType, String channelId, Object message) {
        Object body = message instanceof String ? Reply.of((String) message) : message;
        return rest("POST", "/channels/" + channelType + "/" + channelId + "/transmissions", body).thenApply(r -> Json.obj(r, "transmission"));
    }

    public CompletableFuture<Object> edit(String transmissionId, String content) {
        return rest("PATCH", "/transmissions/" + transmissionId, Map.of("content", content));
    }

    public CompletableFuture<Object> delete(String transmissionId) {
        return rest("DELETE", "/transmissions/" + transmissionId, null);
    }

    public CompletableFuture<Object> react(String transmissionId, String emoji) {
        String e = URLEncoder.encode(emoji, StandardCharsets.UTF_8).replace("+", "%20");
        return rest("PUT", "/transmissions/" + transmissionId + "/reactions/" + e + "/@me", null);
    }

    /** Replace the bot's global commands. Items are {@link Command}s or Maps. Resolves to them with ids. */
    public CompletableFuture<List<Map<String, Object>>> registerCommands(List<?> commands) {
        return registerCommands(commands, null);
    }

    /** Replace the bot's commands in one beacon (or globally when {@code beaconId} is null). */
    @SuppressWarnings("unchecked")
    public CompletableFuture<List<Map<String, Object>>> registerCommands(List<?> commands, String beaconId) {
        CompletableFuture<Map<String, Object>> who = user != null ? CompletableFuture.completedFuture(user) : me();
        return who.thenCompose(bot -> {
            String appId = Json.str(bot, "appId");
            String path = beaconId != null ? "/applications/" + appId + "/beacons/" + beaconId + "/commands" : "/applications/" + appId + "/commands";
            return rest("PUT", path, new ArrayList<Object>(commands));
        }).thenApply(r -> {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Object c : Json.list(r, "commands")) out.add((Map<String, Object>) c);
            return out;
        });
    }

    static Object replyBody(Object reply) {
        if (reply instanceof String) return Reply.of((String) reply).toJson();
        if (reply instanceof Json.JsonValue) return ((Json.JsonValue) reply).toJson();
        if (reply instanceof Map) return reply;
        throw new IllegalArgumentException("A reply is a String, a Reply or a Map");
    }

    // ---- gateway --------------------------------------------------------------------------

    /**
     * Connect to the gateway. Resolves once READY arrives; fails with {@link SubspaceApiError}
     * ({@code INVALID_BOT_TOKEN}) if the gateway refuses the token. After that the bot reconnects
     * on its own until {@link #disconnect()}.
     */
    public CompletableFuture<Void> connect() {
        CompletableFuture<Void> r = new CompletableFuture<>();
        CompletableFuture<Map<String, Object>> who = user != null ? CompletableFuture.completedFuture(user) : me();
        who.whenComplete((bot, err) -> {
            if (err != null) {
                r.completeExceptionally(unwrap(err));
                return;
            }
            synchronized (lock) {
                closing = false;
                ready = r;
                if (closed.isDone()) closed = new CompletableFuture<>();
            }
            open();
        });
        return r;
    }

    /** Completes when the bot has stopped for good: after {@link #disconnect()} or a refused token. */
    public CompletableFuture<Void> closed() {
        synchronized (lock) {
            return closed;
        }
    }

    private void open() {
        final int gen;
        synchronized (lock) {
            if (closing) return;
            gen = ++generation;
        }
        http.newWebSocketBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .buildAsync(URI.create(gatewayUrl), new GatewayListener(gen))
            .whenComplete((socket, err) -> {
                if (err != null) {
                    emitError(err);
                    onSocketGone(gen, 1006, String.valueOf(unwrap(err).getMessage()));
                }
            });
    }

    private final class GatewayListener implements WebSocket.Listener {
        private final int gen;
        private StringBuilder text = new StringBuilder();

        GatewayListener(int gen) {
            this.gen = gen;
        }

        @Override
        public void onOpen(WebSocket socket) {
            synchronized (lock) {
                if (gen == generation) {
                    ws = socket;
                    sendChain = CompletableFuture.completedFuture(null);
                }
            }
            socket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket socket, CharSequence data, boolean last) {
            text.append(data);
            if (last) {
                String full = text.toString();
                text = new StringBuilder();
                try {
                    onPayload(gen, socket, full);
                } catch (RuntimeException e) {
                    emitError(e);
                }
            }
            socket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onBinary(WebSocket socket, java.nio.ByteBuffer data, boolean last) {
            socket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket socket, int statusCode, String reason) {
            onSocketGone(gen, statusCode, reason == null ? "" : reason);
            return null;
        }

        @Override
        public void onError(WebSocket socket, Throwable error) {
            emitError(error);
            onSocketGone(gen, 1006, String.valueOf(error.getMessage()));
        }
    }

    private void onPayload(int gen, WebSocket socket, String raw) {
        Map<String, Object> msg;
        try {
            msg = Json.parseObject(raw);
        } catch (Json.JsonException e) {
            return;
        }
        long op = Json.num(msg, "op", -1);
        if (op == 10) {
            long every = Json.num(Json.obj(msg, "d"), "heartbeat_interval", 30_000);
            synchronized (lock) {
                if (gen != generation) return;
                if (heartbeat != null) heartbeat.cancel(false);
                heartbeat = timers.scheduleAtFixedRate(() -> sendRaw(gen, "{\"op\":1}"), every, every, TimeUnit.MILLISECONDS);
            }
            Map<String, Object> identify = new LinkedHashMap<>();
            identify.put("op", 2);
            identify.put("d", Map.of("token", "Bot " + token));
            sendRaw(gen, Json.write(identify));
            return;
        }
        if (op != 0) return;
        String t = Json.str(msg, "t");
        Object dRaw = msg.get("d");
        Map<String, Object> d = dRaw instanceof Map ? Json.obj(msg, "d") : new LinkedHashMap<>();
        if ("READY".equals(t)) {
            emit(onReady, d);
            CompletableFuture<Void> r;
            synchronized (lock) {
                r = ready;
            }
            if (r != null) r.complete(null);
        } else if ("TRANSMISSION_CREATE".equals(t) && Json.obj(d, "transmission") != null) {
            Map<String, Object> m = new LinkedHashMap<>(Json.obj(d, "transmission"));
            m.put("channelType", d.get("channelType"));
            m.put("channelId", d.get("channelId"));
            emit(onMessage, new Message(m));
        } else if ("TRANSMISSION_UPDATE".equals(t) && Json.obj(d, "transmission") != null) {
            emit(onMessageUpdate, Json.obj(d, "transmission"));
        } else if ("TRANSMISSION_DELETE".equals(t)) {
            emit(onMessageDelete, d);
        } else if ("INTERACTION_CREATE".equals(t)) {
            emit(onInteraction, new Interaction(this, d));
        }
        emit2(onDispatch, t, dRaw);
    }

    /** Sends one text frame; the JDK WebSocket allows only one outstanding send, so sends are chained. */
    private void sendRaw(int gen, String text) {
        synchronized (lock) {
            if (gen != generation || ws == null || ws.isOutputClosed()) return;
            WebSocket socket = ws;
            sendChain = sendChain.handle((x, e) -> null).thenCompose(x -> socket.sendText(text, true)).thenApply(x -> null);
        }
    }

    private void onSocketGone(int gen, int code, String reason) {
        CompletableFuture<Void> r;
        CompletableFuture<Void> c;
        boolean stop;
        synchronized (lock) {
            if (gen != generation) return;
            generation++; // later callbacks from this socket are ignored
            if (heartbeat != null) heartbeat.cancel(false);
            heartbeat = null;
            ws = null;
            r = ready;
            c = closed;
            stop = closing || code == 4003;
        }
        emit2(onClose, code, reason);
        if (code == 4003) {
            SubspaceApiError err = new SubspaceApiError("Invalid bot token", 401, "INVALID_BOT_TOKEN");
            if (r != null && !r.isDone()) r.completeExceptionally(err);
            else emitError(err);
        } else if (!stop) {
            // Reconnect; a first connect() still waiting for READY settles with the new connection.
            timers.schedule(this::open, reconnectDelayMillis, TimeUnit.MILLISECONDS);
            return;
        } else if (r != null) {
            r.complete(null);
        }
        c.complete(null);
    }

    /** Close the gateway connection and stop reconnecting. Completes once it has closed. */
    public CompletableFuture<Void> disconnect() {
        WebSocket socket;
        CompletableFuture<Void> c;
        int gen;
        synchronized (lock) {
            closing = true;
            if (heartbeat != null) heartbeat.cancel(false);
            heartbeat = null;
            socket = ws;
            c = closed;
            gen = generation;
        }
        if (socket == null) {
            c.complete(null);
            return c;
        }
        socket.sendClose(WebSocket.NORMAL_CLOSURE, "").whenComplete((x, err) -> {
            if (err != null) onSocketGone(gen, 1006, String.valueOf(err.getMessage()));
        });
        // If the server never answers the close, give up waiting after a few seconds.
        timers.schedule(() -> {
            if (!c.isDone()) {
                socket.abort();
                onSocketGone(gen, 1006, "close timed out");
            }
        }, 5, TimeUnit.SECONDS);
        return c;
    }

    /** Disconnect, wait for it (up to 10 s), and stop the bot's threads. */
    @Override
    public void close() {
        try {
            disconnect().get(10, TimeUnit.SECONDS);
        } catch (Exception ignored) {
            // closing anyway
        }
        events.shutdown();
        try {
            events.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        timers.shutdownNow();
    }
}
