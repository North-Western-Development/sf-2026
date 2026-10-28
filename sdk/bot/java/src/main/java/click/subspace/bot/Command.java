package click.subspace.bot;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A slash command definition for {@link SubspaceBot#registerCommands}.
 *
 * <pre>{@code
 * Command.of("roll", "Roll a die").option(Command.Option.integer("sides", "How many sides").required(true))
 * }</pre>
 */
public final class Command implements Json.JsonValue {
    private final String name;
    private final String description;
    private final List<Option> options = new ArrayList<>();
    private String defaultMemberPermissions;
    private boolean permissionsSet;

    private Command(String name, String description) {
        this.name = name;
        this.description = description;
    }

    /** Names: lowercase letters, digits, {@code -} and {@code _}, up to 32 characters. */
    public static Command of(String name, String description) {
        return new Command(name, description);
    }

    public Command option(Option option) {
        options.add(option);
        return this;
    }

    /** A permission bitfield (decimal string) members need to see and use it; null for everyone. */
    public Command defaultMemberPermissions(String bits) {
        this.defaultMemberPermissions = bits;
        this.permissionsSet = true;
        return this;
    }

    @Override
    public Map<String, Object> toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("description", description);
        if (!options.isEmpty()) m.put("options", options);
        if (permissionsSet) m.put("defaultMemberPermissions", defaultMemberPermissions);
        return m;
    }

    /** A command option. Types: string, integer, number, boolean, user, relay, clearance. */
    public static final class Option implements Json.JsonValue {
        private final String type;
        private final String name;
        private final String description;
        private boolean required;
        private final List<Map<String, Object>> choices = new ArrayList<>();

        public Option(String type, String name, String description) {
            this.type = type;
            this.name = name;
            this.description = description;
        }

        public static Option string(String name, String description) { return new Option("string", name, description); }
        public static Option integer(String name, String description) { return new Option("integer", name, description); }
        public static Option number(String name, String description) { return new Option("number", name, description); }
        public static Option bool(String name, String description) { return new Option("boolean", name, description); }
        public static Option user(String name, String description) { return new Option("user", name, description); }
        public static Option relay(String name, String description) { return new Option("relay", name, description); }
        public static Option clearance(String name, String description) { return new Option("clearance", name, description); }

        public Option required(boolean required) {
            this.required = required;
            return this;
        }

        /** A fixed choice; {@code value} is a String or a Number. */
        public Option choice(String name, Object value) {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("name", name);
            c.put("value", value);
            choices.add(c);
            return this;
        }

        @Override
        public Map<String, Object> toJson() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("type", type);
            m.put("name", name);
            m.put("description", description);
            if (required) m.put("required", true);
            if (!choices.isEmpty()) m.put("choices", choices);
            return m;
        }
    }
}
