using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Xunit;

namespace Subspace.RichPresence.Tests;

/// <summary>
/// Hostile strings in every activity field must reach the desktop app as strict JSON (valid UTF-8,
/// no raw control characters, no injected keys) that round-trips to the original value, with lone
/// surrogates replaced by U+FFFD as documented on <c>Json.Quote</c>.
/// </summary>
public sealed class HostileStringTests
{
    private const string ClientId = "1234567890";
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(10);
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    // Ports 17573+ so these never collide with RichPresenceTests (16573+) or a real desktop app.
    private static int _nextPort = 17573;
    private static int NextPort() => Interlocked.Increment(ref _nextPort);

    private static RichPresence Client(int port) => new(new RichPresenceOptions
    {
        ClientId = ClientId,
        Ports = new[] { port },
        ReconnectDelay = TimeSpan.FromMilliseconds(200),
        ReadyTimeout = TimeSpan.FromMilliseconds(500),
        ReplyTimeout = TimeSpan.FromSeconds(3),
    });

    private static async Task<T> Next<T>(Channel<T> channel)
    {
        using var cts = new CancellationTokenSource(Wait);
        return await channel.Reader.ReadAsync(cts.Token);
    }

    private static string AllControlCharacters()
    {
        var sb = new StringBuilder();
        for (var c = 0; c < 0x20; c++) sb.Append((char)c);
        sb.Append('\u007f').Append('"').Append('\\').Append('/').Append('\u2028').Append('\u2029');
        return sb.ToString();
    }

    private static readonly string[] Hostile =
    {
        "\"",
        "\\",
        "\\\"",
        "\"\\",
        "a\"b\\c\"d",
        "line\nbreak\r\ncarriage\ttab",
        AllControlCharacters(),
        "\0",
        "nul\0inside",
        "\u2028\u2029",
        "</script><script>alert(1)</script>",
        "\",\"type\":0,\"x\":\"",
        "\"},\"cmd\":\"CLEAR_ACTIVITY\",\"z\":{\"a\":\"",
        "\\\",\\\"type\\\":0,\\\"x\\\":\\\"",
        "\"]}],\"buttons\":[{\"label\":\"x\",\"url\":\"javascript:alert(1)\"}],\"y\":\"",
        "\ud83c\udfaf emoji \u00e9 \u4e2d \udbff\udfff",           // valid pairs, up to U+10FFFF
        "lone high \ud800 here",
        "lone low \udc00 here",
        "reversed \udc00\ud800 pair",
        "ends with high \ud83c",
        "\udfaf starts with low",
        "pair then lone \ud83c\udfaf\ud83c",
        new string('x', 300) + "\"" + new string('\\', 300),     // long, but 8 copies stay under the 16 KB frame limit
    };

    public static TheoryData<int> Cases()
    {
        var data = new TheoryData<int>();
        for (var i = 0; i < Hostile.Length; i++) data.Add(i);
        return data;
    }

    // What the SDK documents: lone surrogates become U+FFFD, everything else is kept.
    private static string Sanitized(string s)
    {
        var sb = new StringBuilder(s.Length);
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]))
            {
                sb.Append(c).Append(s[++i]);
            }
            else if (char.IsSurrogate(c))
            {
                sb.Append('\ufffd');
            }
            else
            {
                sb.Append(c);
            }
        }
        return sb.ToString();
    }

    private static Activity HostileActivity(string s) => new()
    {
        Type = ActivityType.Playing,
        Details = s,
        State = s,
        LargeImage = s,
        LargeText = s,
        SmallImage = s,
        SmallText = s,
        Buttons = new List<Button> { new(s, s), new(s + "2", s + "3") },
    };

    // Strictly decodes and parses one frame, and checks the activity has exactly the expected keys
    // (duplicates would show up as repeated names) with `want` in every string field.
    private static void AssertFrame(byte[] raw, string want)
    {
        var text = StrictUtf8.GetString(raw); // throws on invalid UTF-8
        Assert.Equal(raw.Length, Encoding.UTF8.GetByteCount(text));
        Assert.DoesNotContain('\u2028', text);
        Assert.DoesNotContain('\u2029', text);
        Assert.DoesNotContain(text, c => c < 0x20);
        using var doc = JsonDocument.Parse(text, new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow });
        var root = doc.RootElement;
        Assert.Equal(new[] { "cmd", "nonce", "args" }, root.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal("SET_ACTIVITY", root.GetProperty("cmd").GetString());
        var args = root.GetProperty("args");
        Assert.Equal(new[] { "activity" }, args.EnumerateObject().Select(p => p.Name).ToArray());
        var activity = args.GetProperty("activity");
        Assert.Equal(
            new[] { "type", "details", "state", "largeImage", "largeText", "smallImage", "smallText", "buttons" },
            activity.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal("playing", activity.GetProperty("type").GetString());
        foreach (var name in new[] { "details", "state", "largeImage", "largeText", "smallImage", "smallText" })
        {
            Assert.Equal(want, activity.GetProperty(name).GetString()); // GetString throws on lone \ud800 escapes
        }
        var buttons = activity.GetProperty("buttons");
        Assert.Equal(2, buttons.GetArrayLength());
        foreach (var button in buttons.EnumerateArray())
        {
            Assert.Equal(new[] { "label", "url" }, button.EnumerateObject().Select(p => p.Name).ToArray());
        }
        Assert.Equal(want, buttons[0].GetProperty("label").GetString());
        Assert.Equal(want, buttons[0].GetProperty("url").GetString());
        Assert.Equal(want + "2", buttons[1].GetProperty("label").GetString());
        Assert.Equal(want + "3", buttons[1].GetProperty("url").GetString());
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task Hostile_strings_reach_the_desktop_app_as_strict_json(int index)
    {
        var s = Hostile[index];
        using var desktop = new FakeDesktop(NextPort()).Start();
        using var presence = Client(desktop.Port);
        await presence.ConnectAsync();

        Assert.True(await presence.SetActivityAsync(HostileActivity(s)));

        AssertFrame(await Next(desktop.RawMessages), Sanitized(s));
    }

    [Fact]
    public async Task Frame_lengths_match_the_utf8_byte_length_of_multibyte_payloads()
    {
        // The fake desktop reads exactly the length in each frame header, so a header that counted
        // UTF-16 chars instead of UTF-8 bytes would cut the JSON short or swallow the next frame.
        using var desktop = new FakeDesktop(NextPort()).Start();
        using var presence = Client(desktop.Port);
        await presence.ConnectAsync();
        var strings = new[]
        {
            "\ud83c\udfaf\u2028\u00e9",                           // 4 + 6 (escaped) + 2 bytes
            new string('\u0001', 20) + "\ud83c\udfaf",           // 7-bit length on the char count, not on the wire
            string.Concat(Enumerable.Repeat("\u4e2d", 60)),       // 60 chars, 180 bytes: 16-bit length
            string.Concat(Enumerable.Repeat("\ud83c\udfaf", 200)), // 400 chars, 800 bytes per field
        };
        foreach (var s in strings)
        {
            Assert.True(await presence.SetActivityAsync(HostileActivity(s)));
            AssertFrame(await Next(desktop.RawMessages), s);
        }
    }

    [Fact]
    public async Task The_16_kb_limit_counts_utf8_bytes_after_escaping()
    {
        using var desktop = new FakeDesktop(NextPort()).Start();
        using var presence = Client(desktop.Port);
        await presence.ConnectAsync();

        // 3000 chars but 18000 bytes once each U+0001 becomes \u0001.
        await Assert.ThrowsAsync<ArgumentException>(() => presence.SetActivityAsync(new Activity { Details = new string('\u0001', 3000) }));
        // 8400 UTF-16 chars (under 16 K) but 16800 UTF-8 bytes.
        await Assert.ThrowsAsync<ArgumentException>(() => presence.SetActivityAsync(new Activity { Details = string.Concat(Enumerable.Repeat("\ud83c\udfaf", 4200)) }));
        // 6000 chars of quotes and backslashes: 12000 bytes, under the limit.
        var quotes = string.Concat(Enumerable.Repeat("\"\\", 3000));
        Assert.True(await presence.SetActivityAsync(new Activity { Details = quotes }));
        var text = StrictUtf8.GetString(await Next(desktop.RawMessages));
        using var doc = JsonDocument.Parse(text);
        Assert.Equal(quotes, doc.RootElement.GetProperty("args").GetProperty("activity").GetProperty("details").GetString());
        Assert.Equal(new[] { "details" }, doc.RootElement.GetProperty("args").GetProperty("activity").EnumerateObject().Select(p => p.Name).ToArray());
    }

    [Theory]
    [InlineData("1 HTTP/1.1\r\nOrigin: https://evil.example\r\nX: y")]
    [InlineData("1\r\n")]
    [InlineData("1&client_id=2")]
    [InlineData("1%0d%0a")]
    [InlineData("1/../2")]
    [InlineData("1#x")]
    [InlineData("\uff11\uff12")]
    [InlineData("\u0661\u0662")]
    [InlineData("12 ")]
    [InlineData(" 12")]
    [InlineData("-12")]
    [InlineData("+12")]
    [InlineData("1.5")]
    [InlineData("\"1\"")]
    [InlineData("1\u00002")]
    [InlineData("\",\"type\":0,\"x\":\"")]
    public void Hostile_client_ids_are_refused(string clientId)
    {
        // The client id goes into the handshake URL, so anything but an application id must be refused.
        Assert.Throws<ArgumentException>(() => new RichPresence(new RichPresenceOptions { ClientId = clientId }));
    }
}
