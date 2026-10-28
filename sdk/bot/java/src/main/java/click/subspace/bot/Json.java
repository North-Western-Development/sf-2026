package click.subspace.bot;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A small JSON reader and writer, so the SDK needs nothing beyond the JDK.
 *
 * <p>Objects read as {@code LinkedHashMap<String, Object>}, arrays as {@code ArrayList<Object>},
 * whole numbers as {@link Long} (or {@link BigInteger} when they do not fit), other numbers as
 * {@link Double}, plus {@link String}, {@link Boolean} and {@code null}. Writing also accepts any
 * {@link Map}, {@link Collection}, array of objects, {@link Number}, and {@link JsonValue}.
 */
public final class Json {
    private Json() {}

    /** Something that knows its own JSON form (commands, replies, embeds). */
    public interface JsonValue {
        /** A value {@link Json#write} understands: usually a {@code Map}. */
        Object toJson();
    }

    /** Thrown for text that is not valid JSON. */
    public static final class JsonException extends RuntimeException {
        JsonException(String message) {
            super(message);
        }
    }

    // ---- writing --------------------------------------------------------------------------

    public static String write(Object value) {
        StringBuilder out = new StringBuilder();
        write(value, out);
        return out.toString();
    }

    private static void write(Object v, StringBuilder out) {
        if (v == null) {
            out.append("null");
        } else if (v instanceof JsonValue) {
            write(((JsonValue) v).toJson(), out);
        } else if (v instanceof String || v instanceof Character) {
            quote(v.toString(), out);
        } else if (v instanceof Boolean) {
            out.append(v);
        } else if (v instanceof Double || v instanceof Float) {
            double d = ((Number) v).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) throw new JsonException("JSON has no NaN or Infinity");
            if (d == Math.rint(d) && Math.abs(d) < 1e15) out.append((long) d);
            else out.append(v);
        } else if (v instanceof BigDecimal) {
            out.append(((BigDecimal) v).toPlainString());
        } else if (v instanceof Number) {
            out.append(v);
        } else if (v instanceof Map) {
            out.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
                if (!first) out.append(',');
                first = false;
                quote(String.valueOf(e.getKey()), out);
                out.append(':');
                write(e.getValue(), out);
            }
            out.append('}');
        } else if (v instanceof Collection) {
            out.append('[');
            boolean first = true;
            for (Object item : (Collection<?>) v) {
                if (!first) out.append(',');
                first = false;
                write(item, out);
            }
            out.append(']');
        } else if (v instanceof Object[]) {
            write(List.of((Object[]) v), out);
        } else {
            throw new JsonException("Cannot write " + v.getClass().getName() + " as JSON");
        }
    }

    private static void quote(String s, StringBuilder out) {
        out.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                case '\b': out.append("\\b"); break;
                case '\f': out.append("\\f"); break;
                default:
                    if (c < 0x20 || c == ' ' || c == ' ') out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
            }
        }
        out.append('"');
    }

    // ---- reading --------------------------------------------------------------------------

    public static Object parse(String text) {
        Parser p = new Parser(text);
        p.ws();
        Object v = p.value(0);
        p.ws();
        if (p.i != text.length()) throw p.error("Unexpected text after the value");
        return v;
    }

    /** Parse text that must be an object. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String text) {
        Object v = parse(text);
        if (!(v instanceof Map)) throw new JsonException("Expected a JSON object");
        return (Map<String, Object>) v;
    }

    private static final class Parser {
        private static final int MAX_DEPTH = 512;
        final String s;
        int i;

        Parser(String s) {
            this.s = s;
        }

        JsonException error(String msg) {
            return new JsonException(msg + " at offset " + i);
        }

        void ws() {
            while (i < s.length()) {
                char c = s.charAt(i);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++;
                else break;
            }
        }

        Object value(int depth) {
            if (depth > MAX_DEPTH) throw error("Too deeply nested");
            if (i >= s.length()) throw error("Unexpected end");
            char c = s.charAt(i);
            switch (c) {
                case '{': return object(depth);
                case '[': return array(depth);
                case '"': return string();
                case 't': return literal("true", Boolean.TRUE);
                case 'f': return literal("false", Boolean.FALSE);
                case 'n': return literal("null", null);
                default:
                    if (c == '-' || (c >= '0' && c <= '9')) return number();
                    throw error("Unexpected character '" + c + "'");
            }
        }

        Object literal(String word, Object v) {
            if (!s.startsWith(word, i)) throw error("Expected " + word);
            i += word.length();
            return v;
        }

        Map<String, Object> object(int depth) {
            Map<String, Object> m = new LinkedHashMap<>();
            i++;
            ws();
            if (i < s.length() && s.charAt(i) == '}') {
                i++;
                return m;
            }
            while (true) {
                ws();
                if (i >= s.length() || s.charAt(i) != '"') throw error("Expected a key");
                String key = string();
                ws();
                if (i >= s.length() || s.charAt(i) != ':') throw error("Expected ':'");
                i++;
                ws();
                m.put(key, value(depth + 1));
                ws();
                if (i >= s.length()) throw error("Unexpected end");
                char c = s.charAt(i++);
                if (c == '}') return m;
                if (c != ',') throw error("Expected ',' or '}'");
            }
        }

        List<Object> array(int depth) {
            List<Object> a = new ArrayList<>();
            i++;
            ws();
            if (i < s.length() && s.charAt(i) == ']') {
                i++;
                return a;
            }
            while (true) {
                ws();
                a.add(value(depth + 1));
                ws();
                if (i >= s.length()) throw error("Unexpected end");
                char c = s.charAt(i++);
                if (c == ']') return a;
                if (c != ',') throw error("Expected ',' or ']'");
            }
        }

        String string() {
            i++; // opening quote
            StringBuilder b = null;
            int start = i;
            while (true) {
                if (i >= s.length()) throw error("Unterminated string");
                char c = s.charAt(i);
                if (c == '"') {
                    String out = b == null ? s.substring(start, i) : b.append(s, start, i).toString();
                    i++;
                    return out;
                }
                if (c < 0x20) throw error("Control character in string");
                if (c == '\\') {
                    if (b == null) b = new StringBuilder();
                    b.append(s, start, i);
                    i++;
                    if (i >= s.length()) throw error("Unterminated escape");
                    char e = s.charAt(i++);
                    switch (e) {
                        case '"': b.append('"'); break;
                        case '\\': b.append('\\'); break;
                        case '/': b.append('/'); break;
                        case 'b': b.append('\b'); break;
                        case 'f': b.append('\f'); break;
                        case 'n': b.append('\n'); break;
                        case 'r': b.append('\r'); break;
                        case 't': b.append('\t'); break;
                        case 'u':
                            if (i + 4 > s.length()) throw error("Bad \\u escape");
                            try {
                                b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                            } catch (NumberFormatException ex) {
                                throw error("Bad \\u escape");
                            }
                            i += 4;
                            break;
                        default: throw error("Bad escape \\" + e);
                    }
                    start = i;
                } else {
                    i++;
                }
            }
        }

        Object number() {
            int start = i;
            if (s.charAt(i) == '-') i++;
            if (i >= s.length()) throw error("Bad number");
            if (s.charAt(i) == '0') i++;
            else if (s.charAt(i) >= '1' && s.charAt(i) <= '9') digits();
            else throw error("Bad number");
            boolean whole = true;
            if (i < s.length() && s.charAt(i) == '.') {
                whole = false;
                i++;
                if (digits() == 0) throw error("Bad number");
            }
            if (i < s.length() && (s.charAt(i) == 'e' || s.charAt(i) == 'E')) {
                whole = false;
                i++;
                if (i < s.length() && (s.charAt(i) == '+' || s.charAt(i) == '-')) i++;
                if (digits() == 0) throw error("Bad number");
            }
            String n = s.substring(start, i);
            if (!whole) return Double.parseDouble(n);
            try {
                return Long.parseLong(n);
            } catch (NumberFormatException tooBig) {
                return new BigInteger(n);
            }
        }

        int digits() {
            int start = i;
            while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') i++;
            return i - start;
        }
    }

    // ---- reading values out of parsed JSON ------------------------------------------------

    /** {@code obj[key]} as a map, or null. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(Object obj, String key) {
        Object v = obj instanceof Map ? ((Map<?, ?>) obj).get(key) : null;
        return v instanceof Map ? (Map<String, Object>) v : null;
    }

    /** {@code obj[key]} as a list, or an empty list. */
    @SuppressWarnings("unchecked")
    public static List<Object> list(Object obj, String key) {
        Object v = obj instanceof Map ? ((Map<?, ?>) obj).get(key) : null;
        return v instanceof List ? (List<Object>) v : List.of();
    }

    /** {@code obj[key]} as text, or null. Numbers and booleans are turned into text. */
    public static String str(Object obj, String key) {
        Object v = obj instanceof Map ? ((Map<?, ?>) obj).get(key) : null;
        return v == null || v instanceof Map || v instanceof List ? null : v.toString();
    }

    /** {@code obj[key]} as a long, or {@code fallback}. */
    public static long num(Object obj, String key, long fallback) {
        Object v = obj instanceof Map ? ((Map<?, ?>) obj).get(key) : null;
        return v instanceof Number ? ((Number) v).longValue() : fallback;
    }
}
