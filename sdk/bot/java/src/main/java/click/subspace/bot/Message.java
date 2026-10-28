package click.subspace.bot;

import java.util.List;
import java.util.Map;

/** A transmission from the gateway, with the channel it was posted in. {@link #raw()} has every field. */
public final class Message {
    private final Map<String, Object> raw;

    public Message(Map<String, Object> raw) {
        this.raw = raw;
    }

    public String id() { return Json.str(raw, "id"); }
    /** {@code relay}, {@code thread}, {@code link} or {@code mesh}. */
    public String channelType() { return Json.str(raw, "channelType"); }
    public String channelId() { return Json.str(raw, "channelId"); }
    /** The text; empty when the bot lacks the Message Content intent and was not mentioned. */
    public String content() {
        String c = Json.str(raw, "content");
        return c == null ? "" : c;
    }
    /** {@code {id, username, displayName, botKind}}. */
    public Map<String, Object> author() { return Json.obj(raw, "author"); }
    public String authorId() { return Json.str(author(), "id"); }
    public String authorUsername() { return Json.str(author(), "username"); }
    public List<Object> mentions() { return Json.list(raw, "mentions"); }
    public String createdAt() { return Json.str(raw, "createdAt"); }
    public Map<String, Object> raw() { return raw; }

    @Override
    public String toString() {
        return "Message" + Json.write(raw);
    }
}
