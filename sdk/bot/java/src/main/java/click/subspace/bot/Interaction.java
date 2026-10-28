package click.subspace.bot;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/** A slash command someone used: read its options, then answer within 3 seconds (or {@link #defer}). */
public final class Interaction {
    private final SubspaceBot bot;
    private final Map<String, Object> raw;

    public Interaction(SubspaceBot bot, Map<String, Object> raw) {
        this.bot = bot;
        this.raw = raw;
    }

    public String id() { return Json.str(raw, "id"); }
    public String token() { return Json.str(raw, "token"); }
    public String commandName() { return Json.str(Json.obj(raw, "data"), "name"); }
    /** {@code {id, username, displayName, avatarUrl}}. */
    public Map<String, Object> user() { return Json.obj(raw, "user"); }
    /** {@code {type, id}}: where the command was used. */
    public Map<String, Object> channel() { return Json.obj(raw, "channel"); }
    public String beaconId() { return Json.str(raw, "beaconId"); }
    public String applicationId() { return Json.str(raw, "applicationId"); }
    public Map<String, Object> raw() { return raw; }

    /** An option's value (String, Long, Double or Boolean), or null when it was not given. */
    public Object option(String name) {
        for (Object o : Json.list(Json.obj(raw, "data"), "options")) {
            if (o instanceof Map && name.equals(((Map<?, ?>) o).get("name"))) return ((Map<?, ?>) o).get("value");
        }
        return null;
    }

    public String optionString(String name) {
        Object v = option(name);
        return v == null ? null : v.toString();
    }

    public Long optionLong(String name) {
        Object v = option(name);
        return v instanceof Number ? ((Number) v).longValue() : null;
    }

    public Boolean optionBoolean(String name) {
        Object v = option(name);
        return v instanceof Boolean ? (Boolean) v : null;
    }

    private String path(String suffix) {
        return "/interactions/" + id() + "/" + token() + "/" + suffix;
    }

    /** Answer now. */
    public CompletableFuture<Object> reply(String content) {
        return reply(Reply.of(content));
    }

    /** Answer now: a {@link Reply} or a {@code Map} in the API's shape. */
    public CompletableFuture<Object> reply(Object reply) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", 4);
        body.put("data", SubspaceBot.replyBody(reply));
        return bot.rest("POST", path("callback"), body, false);
    }

    /** "Thinking...": the answer follows with {@link #followUp} (within 15 minutes). */
    public CompletableFuture<Object> defer() {
        return defer(null);
    }

    public CompletableFuture<Object> defer(Boolean ephemeral) {
        Map<String, Object> data = new LinkedHashMap<>();
        if (ephemeral != null) data.put("ephemeral", ephemeral);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", 5);
        body.put("data", data);
        return bot.rest("POST", path("callback"), body, false);
    }

    public CompletableFuture<Object> followUp(String content) {
        return followUp(Reply.of(content));
    }

    public CompletableFuture<Object> followUp(Object reply) {
        return bot.rest("POST", path("followup"), SubspaceBot.replyBody(reply), false);
    }

    public CompletableFuture<Object> editReply(String content) {
        return editReply(Reply.of(content));
    }

    public CompletableFuture<Object> editReply(Object reply) {
        return bot.rest("PATCH", path("original"), SubspaceBot.replyBody(reply), false);
    }
}
