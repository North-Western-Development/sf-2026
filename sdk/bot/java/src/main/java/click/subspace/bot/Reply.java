package click.subspace.bot;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * An answer to an interaction, or a message body: text, embeds, and (for interactions) whether
 * only the person who used the command sees it.
 *
 * <pre>{@code
 * Reply.of("Rolled a 4").embed(Embed.create().title("Dice").color(0x3b8ef2)).ephemeral(true)
 * }</pre>
 */
public final class Reply implements Json.JsonValue {
    private String content;
    private final List<Object> embeds = new ArrayList<>();
    private Boolean ephemeral;
    private String replyToId;

    public static Reply of(String content) {
        return new Reply().content(content);
    }

    public static Reply create() {
        return new Reply();
    }

    public Reply content(String content) {
        this.content = content;
        return this;
    }

    /** Add an embed: an {@link Embed} or a {@code Map} in the API's shape. Up to 10. */
    public Reply embed(Object embed) {
        embeds.add(embed);
        return this;
    }

    /** Interactions only: only the person who used the command sees it. */
    public Reply ephemeral(boolean ephemeral) {
        this.ephemeral = ephemeral;
        return this;
    }

    /** Messages only: reply to this transmission. */
    public Reply replyTo(String transmissionId) {
        this.replyToId = transmissionId;
        return this;
    }

    @Override
    public Map<String, Object> toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        if (content != null) m.put("content", content);
        if (!embeds.isEmpty()) m.put("embeds", embeds);
        if (ephemeral != null) m.put("ephemeral", ephemeral);
        if (replyToId != null) m.put("replyToId", replyToId);
        return m;
    }
}
