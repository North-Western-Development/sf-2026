package click.subspace.bot;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A rich embed. Limits are in the bots guide (title 256, description 4096, 25 fields...). */
public final class Embed implements Json.JsonValue {
    private final Map<String, Object> m = new LinkedHashMap<>();
    private final List<Object> fields = new ArrayList<>();

    public static Embed create() {
        return new Embed();
    }

    public Embed title(String title) {
        m.put("title", title);
        return this;
    }

    public Embed description(String description) {
        m.put("description", description);
        return this;
    }

    public Embed url(String url) {
        m.put("url", url);
        return this;
    }

    /** An RGB integer such as {@code 0x3353D6}. */
    public Embed color(int rgb) {
        m.put("color", rgb);
        return this;
    }

    /** {@code "#RRGGBB"}. */
    public Embed color(String hex) {
        m.put("color", hex);
        return this;
    }

    /** ISO 8601. */
    public Embed timestamp(String iso) {
        m.put("timestamp", iso);
        return this;
    }

    public Embed author(String name, String url) {
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("name", name);
        if (url != null) a.put("url", url);
        m.put("author", a);
        return this;
    }

    public Embed footer(String text) {
        m.put("footer", Map.of("text", text));
        return this;
    }

    public Embed image(String url) {
        m.put("image", Map.of("url", url));
        return this;
    }

    public Embed thumbnail(String url) {
        m.put("thumbnail", Map.of("url", url));
        return this;
    }

    public Embed field(String name, String value, boolean inline) {
        Map<String, Object> f = new LinkedHashMap<>();
        f.put("name", name);
        f.put("value", value);
        if (inline) f.put("inline", true);
        fields.add(f);
        return this;
    }

    @Override
    public Map<String, Object> toJson() {
        Map<String, Object> out = new LinkedHashMap<>(m);
        if (!fields.isEmpty()) out.put("fields", fields);
        return out;
    }
}
