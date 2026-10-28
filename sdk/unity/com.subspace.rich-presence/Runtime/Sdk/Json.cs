#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Subspace.RichPresence
{
    /// <summary>
    /// The little JSON the protocol needs, written by hand so the SDK has no dependencies and the same
    /// source compiles in Unity.
    /// </summary>
    internal static class Json
    {
        private const char LineSeparator = (char)0x2028;
        private const char ParagraphSeparator = (char)0x2029;
        private const char Replacement = (char)0xFFFD;

        // ---- Writing -------------------------------------------------------------------------

        public static string WriteActivity(Activity activity)
        {
            var sb = new StringBuilder(256);
            sb.Append('{');
            var first = true;
            if (activity.Type.HasValue) Field(sb, ref first, "type").Append(Quote(TypeName(activity.Type.Value)));
            if (activity.Details != null) Field(sb, ref first, "details").Append(Quote(activity.Details));
            if (activity.State != null) Field(sb, ref first, "state").Append(Quote(activity.State));
            if (activity.StartedAt.HasValue) Field(sb, ref first, "startedAt").Append(activity.StartedAt.Value.ToString(CultureInfo.InvariantCulture));
            if (activity.EndsAt.HasValue) Field(sb, ref first, "endsAt").Append(activity.EndsAt.Value.ToString(CultureInfo.InvariantCulture));
            if (activity.LargeImage != null) Field(sb, ref first, "largeImage").Append(Quote(activity.LargeImage));
            if (activity.LargeText != null) Field(sb, ref first, "largeText").Append(Quote(activity.LargeText));
            if (activity.SmallImage != null) Field(sb, ref first, "smallImage").Append(Quote(activity.SmallImage));
            if (activity.SmallText != null) Field(sb, ref first, "smallText").Append(Quote(activity.SmallText));
            if (activity.Party != null)
            {
                Field(sb, ref first, "party")
                    .Append("{\"size\":").Append(activity.Party.Size.ToString(CultureInfo.InvariantCulture))
                    .Append(",\"max\":").Append(activity.Party.Max.ToString(CultureInfo.InvariantCulture))
                    .Append('}');
            }
            if (activity.Buttons != null)
            {
                Field(sb, ref first, "buttons").Append('[');
                var firstButton = true;
                foreach (var button in activity.Buttons)
                {
                    if (button == null) continue;
                    if (!firstButton) sb.Append(',');
                    firstButton = false;
                    sb.Append("{\"label\":").Append(Quote(button.Label ?? ""))
                      .Append(",\"url\":").Append(Quote(button.Url ?? ""))
                      .Append('}');
                }
                sb.Append(']');
            }
            sb.Append('}');
            return sb.ToString();
        }

        private static StringBuilder Field(StringBuilder sb, ref bool first, string name)
        {
            if (!first) sb.Append(',');
            first = false;
            return sb.Append('"').Append(name).Append("\":");
        }

        private static string TypeName(ActivityType type)
        {
            switch (type)
            {
                case ActivityType.Streaming: return "streaming";
                case ActivityType.Listening: return "listening";
                case ActivityType.Watching: return "watching";
                case ActivityType.Competing: return "competing";
                default: return "playing";
            }
        }

        /// <summary>A JSON string literal. Lone surrogates become U+FFFD so the frame is valid UTF-8.</summary>
        public static string Quote(string value)
        {
            var sb = new StringBuilder(value.Length + 2);
            sb.Append('"');
            for (var i = 0; i < value.Length; i++)
            {
                var c = value[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20 || c == LineSeparator || c == ParagraphSeparator)
                        {
                            sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else if (char.IsHighSurrogate(c))
                        {
                            if (i + 1 < value.Length && char.IsLowSurrogate(value[i + 1]))
                            {
                                sb.Append(c).Append(value[i + 1]);
                                i++;
                            }
                            else
                            {
                                sb.Append(Replacement);
                            }
                        }
                        else if (char.IsLowSurrogate(c))
                        {
                            sb.Append(Replacement);
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        // ---- Reading -------------------------------------------------------------------------

        /// <summary>
        /// Parses a JSON object. Values are string, double, bool, null, List&lt;object?&gt; or
        /// Dictionary&lt;string, object?&gt;. Returns null for anything that is not a well-formed object.
        /// </summary>
        public static Dictionary<string, object?>? ParseObject(string text)
        {
            try
            {
                var reader = new Reader(text);
                reader.SkipWhitespace();
                if (reader.Peek() != '{') return null;
                var value = reader.ReadValue(0) as Dictionary<string, object?>;
                reader.SkipWhitespace();
                return reader.AtEnd ? value : null;
            }
            catch (FormatException)
            {
                return null;
            }
        }

        private sealed class Reader
        {
            private const int MaxDepth = 32;
            private readonly string _text;
            private int _pos;

            public Reader(string text) => _text = text;

            public bool AtEnd => _pos >= _text.Length;

            public char Peek() => _pos < _text.Length ? _text[_pos] : '\0';

            public void SkipWhitespace()
            {
                while (_pos < _text.Length && (_text[_pos] == ' ' || _text[_pos] == '\t' || _text[_pos] == '\n' || _text[_pos] == '\r')) _pos++;
            }

            private char Next()
            {
                if (_pos >= _text.Length) throw new FormatException("Unexpected end of JSON");
                return _text[_pos++];
            }

            private void Expect(string word)
            {
                if (string.CompareOrdinal(_text, _pos, word, 0, word.Length) != 0) throw new FormatException("Bad literal");
                _pos += word.Length;
            }

            public object? ReadValue(int depth)
            {
                if (depth > MaxDepth) throw new FormatException("Too deep");
                SkipWhitespace();
                var c = Peek();
                switch (c)
                {
                    case '{': return ReadObject(depth);
                    case '[': return ReadArray(depth);
                    case '"': return ReadString();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9')) return ReadNumber();
                        throw new FormatException("Unexpected character");
                }
            }

            private Dictionary<string, object?> ReadObject(int depth)
            {
                var result = new Dictionary<string, object?>(StringComparer.Ordinal);
                Next(); // {
                SkipWhitespace();
                if (Peek() == '}')
                {
                    Next();
                    return result;
                }
                while (true)
                {
                    SkipWhitespace();
                    if (Peek() != '"') throw new FormatException("Expected a key");
                    var key = ReadString();
                    SkipWhitespace();
                    if (Next() != ':') throw new FormatException("Expected ':'");
                    result[key] = ReadValue(depth + 1);
                    SkipWhitespace();
                    var c = Next();
                    if (c == '}') return result;
                    if (c != ',') throw new FormatException("Expected ',' or '}'");
                }
            }

            private List<object?> ReadArray(int depth)
            {
                var result = new List<object?>();
                Next(); // [
                SkipWhitespace();
                if (Peek() == ']')
                {
                    Next();
                    return result;
                }
                while (true)
                {
                    result.Add(ReadValue(depth + 1));
                    SkipWhitespace();
                    var c = Next();
                    if (c == ']') return result;
                    if (c != ',') throw new FormatException("Expected ',' or ']'");
                }
            }

            private string ReadString()
            {
                Next(); // "
                var sb = new StringBuilder();
                while (true)
                {
                    var c = Next();
                    if (c == '"') return sb.ToString();
                    if (c < 0x20) throw new FormatException("Control character in string");
                    if (c != '\\')
                    {
                        sb.Append(c);
                        continue;
                    }
                    var e = Next();
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (_pos + 4 > _text.Length) throw new FormatException("Bad escape");
                            if (!int.TryParse(_text.Substring(_pos, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var code))
                                throw new FormatException("Bad escape");
                            _pos += 4;
                            sb.Append((char)code);
                            break;
                        default: throw new FormatException("Bad escape");
                    }
                }
            }

            private double ReadNumber()
            {
                var start = _pos;
                if (Peek() == '-') _pos++;
                while (_pos < _text.Length && "0123456789.eE+-".IndexOf(_text[_pos]) >= 0) _pos++;
                if (!double.TryParse(_text.Substring(start, _pos - start), NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
                    throw new FormatException("Bad number");
                return value;
            }
        }
    }
}
