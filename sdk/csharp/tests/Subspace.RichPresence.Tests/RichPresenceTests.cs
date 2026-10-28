using System.Diagnostics;
using System.Text.Json;
using System.Threading.Channels;
using Xunit;

namespace Subspace.RichPresence.Tests;

public sealed class RichPresenceTests
{
    private const string ClientId = "1234567890";
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(10);

    // Every test gets its own ports (16573+) so nothing collides with a real desktop app on 6473.
    private static int _nextPort = 16573;
    private static int NextPort() => Interlocked.Increment(ref _nextPort);

    private static RichPresence Client(params int[] ports) => new(new RichPresenceOptions
    {
        ClientId = ClientId,
        Ports = ports,
        ReconnectDelay = TimeSpan.FromMilliseconds(200),
        ReadyTimeout = TimeSpan.FromMilliseconds(500),
        ReplyTimeout = TimeSpan.FromSeconds(3),
    });

    private static async Task<T> Next<T>(Channel<T> channel)
    {
        using var cts = new CancellationTokenSource(Wait);
        return await channel.Reader.ReadAsync(cts.Token);
    }

    private static JsonElement Parse(string text) => JsonDocument.Parse(text).RootElement;

    [Fact]
    public async Task Handshake_has_no_origin_and_the_right_query_then_ready()
    {
        using var desktop = new FakeDesktop(NextPort()).Start();
        using var presence = Client(desktop.Port);
        var ready = 0;
        presence.Ready += (_, _) => Interlocked.Increment(ref ready);

        await presence.ConnectAsync();

        Assert.True(presence.IsConnected);
        Assert.Equal(1, Volatile.Read(ref ready));
        var handshake = await Next(desktop.Handshakes);
        Assert.Equal("/?v=1&client_id=1234567890", handshake.Target);
        Assert.False(handshake.Headers.ContainsKey("Origin"), "Origin header was sent: " + string.Join(", ", handshake.Headers.Keys));
        Assert.Equal("websocket", handshake.Headers["Upgrade"], ignoreCase: true);
        Assert.Equal("127.0.0.1:" + desktop.Port, handshake.Headers["Host"]);
    }

    [Fact]
    public async Task SetActivity_sends_every_field_with_correct_escaping()
    {
        using var desktop = new FakeDesktop(NextPort()).Start();
        using var presence = Client(desktop.Port);
        await presence.ConnectAsync();

        var tricky = "say \"hi\" \\ back\nslash\ttab" + (char)0x01 + (char)0x1F + (char)0x2028 + " " + char.ConvertFromUtf32(0x1F600) + " " + (char)0x7F + "/";
        var accepted = await presence.SetActivityAsync(new Activity
        {
            Type = ActivityType.Competing,
            Details = tricky,
            State = "In a match",
            StartedAt = 1_700_000_000_123,
            EndsAt = 1_700_000_999_000,
            LargeImage = "https://cdn.example.com/maps/mirage.png",
            LargeText = "Mirage",
            SmallImage = "https://cdn.example.com/rank.png",
            SmallText = "Gold",
            Party = new Party(2, 5),
            Buttons = new List<Button> { new("Watch", "https://example.com/match/123"), new("Join", "https://example.com/j?a=1&b=2") },
        });
        Assert.True(accepted);

        var raw = await Next(desktop.Messages);
        var msg = Parse(raw);
        Assert.Equal("SET_ACTIVITY", msg.GetProperty("cmd").GetString());
        Assert.Equal(JsonValueKind.String, msg.GetProperty("nonce").ValueKind);
        var activity = msg.GetProperty("args").GetProperty("activity");
        Assert.Equal("competing", activity.GetProperty("type").GetString());
        Assert.Equal(tricky, activity.GetProperty("details").GetString());
        Assert.Equal("In a match", activity.GetProperty("state").GetString());
        Assert.Equal(1_700_000_000_123, activity.GetProperty("startedAt").GetInt64());
        Assert.Equal(1_700_000_999_000, activity.GetProperty("endsAt").GetInt64());
        Assert.Equal("https://cdn.example.com/maps/mirage.png", activity.GetProperty("largeImage").GetString());
        Assert.Equal("Mirage", activity.GetProperty("largeText").GetString());
        Assert.Equal("https://cdn.example.com/rank.png", activity.GetProperty("smallImage").GetString());
        Assert.Equal("Gold", activity.GetProperty("smallText").GetString());
        Assert.Equal(2, activity.GetProperty("party").GetProperty("size").GetInt32());
        Assert.Equal(5, activity.GetProperty("party").GetProperty("max").GetInt32());
        var buttons = activity.GetProperty("buttons");
        Assert.Equal(2, buttons.GetArrayLength());
        Assert.Equal("Join", buttons[1].GetProperty("label").GetString());
        Assert.Equal("https://example.com/j?a=1&b=2", buttons[1].GetProperty("url").GetString());
        // Control characters are escaped on the wire, never sent raw.
        Assert.DoesNotContain((char)0x01, raw);
        Assert.DoesNotContain('\n', raw);
    }

    [Fact]
    public async Task Unset_fields_are_omitted_and_lone_surrogates_are_replaced()
    {
        using var desktop = new FakeDesktop(NextPort()).Start();
        using var presence = Client(desktop.Port);
        await presence.ConnectAsync();

        await presence.SetActivityAsync(new Activity { Details = "a" + (char)0xD800 + "b" });

        var activity = Parse(await Next(desktop.Messages)).GetProperty("args").GetProperty("activity");
        Assert.Equal(new[] { "details" }, activity.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal("a" + (char)0xFFFD + "b", activity.GetProperty("details").GetString());
    }

    [Fact]
    public async Task ClearActivity_sends_clear_without_args()
    {
        using var desktop = new FakeDesktop(NextPort()).Start();
        using var presence = Client(desktop.Port);
        await presence.ConnectAsync();

        Assert.True(await presence.ClearActivityAsync());

        var msg = Parse(await Next(desktop.Messages));
        Assert.Equal("CLEAR_ACTIVITY", msg.GetProperty("cmd").GetString());
        Assert.True(msg.TryGetProperty("nonce", out _));
        Assert.False(msg.TryGetProperty("args", out _));
    }

    [Fact]
    public async Task Refusal_surfaces_as_an_exception_with_the_error()
    {
        using var desktop = new FakeDesktop(NextPort()).Start();
        desktop.Reply = msg => $"{{\"nonce\":{msg.GetProperty("nonce").GetRawText()},\"ok\":false,\"error\":\"args.activity must be an object\"}}";
        using var presence = Client(desktop.Port);
        await presence.ConnectAsync();

        var error = await Assert.ThrowsAsync<RichPresenceException>(() => presence.SetActivityAsync(new Activity { State = "x" }));
        Assert.Equal("args.activity must be an object", error.Message);
        Assert.True(presence.IsConnected);
    }

    [Fact]
    public async Task No_reply_times_out()
    {
        using var desktop = new FakeDesktop(NextPort()).Start();
        desktop.Reply = _ => null;
        using var presence = new RichPresence(new RichPresenceOptions { ClientId = ClientId, Ports = new[] { desktop.Port }, ReplyTimeout = TimeSpan.FromMilliseconds(300) });
        await presence.ConnectAsync();

        var error = await Assert.ThrowsAsync<RichPresenceException>(() => presence.ClearActivityAsync());
        Assert.Contains("timed out", error.Message);
    }

    [Fact]
    public async Task Activity_set_before_connecting_is_sent_on_connect()
    {
        using var desktop = new FakeDesktop(NextPort()).Start();
        using var presence = Client(desktop.Port);

        Assert.False(await presence.SetActivityAsync(new Activity { Details = "early" }));
        await presence.ConnectAsync();

        var msg = Parse(await Next(desktop.Messages));
        Assert.Equal("early", msg.GetProperty("args").GetProperty("activity").GetProperty("details").GetString());
    }

    [Fact]
    public async Task Reconnects_after_the_desktop_app_restarts_and_sends_the_activity_again()
    {
        var port = NextPort();
        var desktop = new FakeDesktop(port).Start();
        using var presence = Client(port);
        var ready = Channel.CreateUnbounded<bool>();
        var disconnected = Channel.CreateUnbounded<bool>();
        presence.Ready += (_, _) => ready.Writer.TryWrite(true);
        presence.Disconnected += (_, _) => disconnected.Writer.TryWrite(true);

        await presence.ConnectAsync();
        await Next(ready);
        await presence.SetActivityAsync(new Activity { Details = "Competitive", Party = new Party(1, 5) });
        await Next(desktop.Messages);

        desktop.Stop();
        await Next(disconnected);
        Assert.False(presence.IsConnected);
        Assert.False(await presence.SetActivityAsync(new Activity { Details = "Competitive", Party = new Party(3, 5) }));

        using var restarted = new FakeDesktop(port).Start();
        await Next(ready);
        var msg = Parse(await Next(restarted.Messages));
        Assert.Equal("SET_ACTIVITY", msg.GetProperty("cmd").GetString());
        Assert.Equal(3, msg.GetProperty("args").GetProperty("activity").GetProperty("party").GetProperty("size").GetInt32());
        Assert.True(presence.IsConnected);
    }

    [Fact]
    public async Task A_port_that_never_says_ready_is_skipped()
    {
        using var silent = new FakeDesktop(NextPort(), sendReady: false).Start();
        using var desktop = new FakeDesktop(NextPort()).Start();
        using var presence = Client(silent.Port, desktop.Port);

        var watch = Stopwatch.StartNew();
        await presence.ConnectAsync();
        watch.Stop();

        Assert.True(presence.IsConnected);
        await Next(silent.Handshakes);
        await Next(desktop.Handshakes);
        Assert.True(watch.ElapsedMilliseconds >= 450, $"connected after {watch.ElapsedMilliseconds} ms, before the READY timeout");
        await Next(silent.Closed); // and the client hung up on it
        await presence.ClearActivityAsync();
        Assert.Equal("CLEAR_ACTIVITY", Parse(await Next(desktop.Messages)).GetProperty("cmd").GetString());
    }

    [Fact]
    public async Task All_closed_ports_are_tried_at_once()
    {
        // Ten ports nobody listens on, with the default 3 s READY timeout. A refused loopback
        // connection takes about 2 s on Windows, so one port at a time would take about 20 s.
        var ports = Enumerable.Range(0, 10).Select(_ => NextPort()).ToArray();
        using var presence = new RichPresence(new RichPresenceOptions { ClientId = ClientId, Ports = ports });

        var watch = Stopwatch.StartNew();
        await presence.ConnectAsync();
        watch.Stop();

        Assert.False(presence.IsConnected);
        Assert.True(watch.ElapsedMilliseconds < 5000, $"the sweep took {watch.ElapsedMilliseconds} ms");
    }

    [Fact]
    public async Task The_first_port_in_order_that_says_ready_wins_even_if_slower()
    {
        using var low = new FakeDesktop(NextPort()) { ReadyDelay = TimeSpan.FromMilliseconds(300) }.Start();
        using var high = new FakeDesktop(NextPort()).Start();
        using var presence = Client(low.Port, high.Port);

        await presence.ConnectAsync();

        Assert.True(presence.IsConnected);
        await Next(low.Handshakes);
        await Next(high.Handshakes); // both were tried
        await Next(high.Closed); // the other one is hung up on
        await presence.ClearActivityAsync();
        Assert.Equal("CLEAR_ACTIVITY", Parse(await Next(low.Messages)).GetProperty("cmd").GetString());
        Assert.False(high.Messages.Reader.TryRead(out _));
    }

    [Fact]
    public async Task A_later_port_wins_when_the_earlier_ones_fail()
    {
        var closed = NextPort();
        using var silent = new FakeDesktop(NextPort(), sendReady: false).Start();
        using var desktop = new FakeDesktop(NextPort()).Start();
        using var presence = Client(closed, silent.Port, desktop.Port);

        await presence.ConnectAsync();

        Assert.True(presence.IsConnected);
        await presence.ClearActivityAsync();
        Assert.Equal("CLEAR_ACTIVITY", Parse(await Next(desktop.Messages)).GetProperty("cmd").GetString());
    }

    [Fact]
    public async Task Dispose_aborts_every_attempt_in_flight()
    {
        var silent = Enumerable.Range(0, 3).Select(_ => new FakeDesktop(NextPort(), sendReady: false).Start()).ToArray();
        try
        {
            var presence = new RichPresence(new RichPresenceOptions
            {
                ClientId = ClientId,
                Ports = silent.Select(s => s.Port).ToArray(),
                ReadyTimeout = TimeSpan.FromSeconds(30),
            });
            var connecting = presence.ConnectAsync();
            foreach (var s in silent) await Next(s.Handshakes);

            var watch = Stopwatch.StartNew();
            presence.Dispose();
            foreach (var s in silent) await Next(s.Closed);
            await connecting.WaitAsync(Wait);
            watch.Stop();

            Assert.True(watch.ElapsedMilliseconds < 2000, $"attempts ended {watch.ElapsedMilliseconds} ms after Dispose");
            Assert.False(presence.IsConnected);
        }
        finally
        {
            foreach (var s in silent) s.Dispose();
        }
    }

    [Fact]
    public async Task Without_reconnect_a_missing_desktop_app_throws()
    {
        var port = NextPort(); // nothing listens here
        using var presence = new RichPresence(new RichPresenceOptions { ClientId = ClientId, Ports = new[] { port }, Reconnect = false, ReadyTimeout = TimeSpan.FromMilliseconds(500) });

        var error = await Assert.ThrowsAsync<RichPresenceException>(() => presence.ConnectAsync());
        Assert.Contains("not running", error.Message);
    }

    [Fact]
    public async Task With_reconnect_a_missing_desktop_app_resolves_and_is_found_later()
    {
        var port = NextPort();
        using var presence = Client(port);
        var ready = Channel.CreateUnbounded<bool>();
        presence.Ready += (_, _) => ready.Writer.TryWrite(true);

        await presence.ConnectAsync();
        Assert.False(presence.IsConnected);

        using var desktop = new FakeDesktop(port).Start();
        await Next(ready);
        Assert.True(presence.IsConnected);
    }

    [Fact]
    public async Task Dispose_is_prompt_and_ends_the_connection()
    {
        using var desktop = new FakeDesktop(NextPort()).Start();
        var presence = Client(desktop.Port);
        var disconnected = 0;
        presence.Disconnected += (_, _) => Interlocked.Increment(ref disconnected);
        await presence.ConnectAsync();
        await presence.SetActivityAsync(new Activity { Details = "x" });

        var watch = Stopwatch.StartNew();
        presence.Dispose();
        watch.Stop();

        Assert.True(watch.ElapsedMilliseconds < 200, $"Dispose took {watch.ElapsedMilliseconds} ms");
        Assert.False(presence.IsConnected);
        await Next(desktop.Closed);
        Assert.Equal(0, Volatile.Read(ref disconnected));
        await Assert.ThrowsAsync<ObjectDisposedException>(() => presence.SetActivityAsync(new Activity()));
        presence.Dispose(); // twice is fine
    }

    [Fact]
    public async Task Dispose_while_looking_stops_looking()
    {
        var port = NextPort();
        var presence = Client(port);
        await presence.ConnectAsync();

        var watch = Stopwatch.StartNew();
        presence.Dispose();
        Assert.True(watch.ElapsedMilliseconds < 200, $"Dispose took {watch.ElapsedMilliseconds} ms");

        using var desktop = new FakeDesktop(port).Start();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1.5));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await desktop.Handshakes.Reader.ReadAsync(cts.Token));
    }

    [Fact]
    public async Task CloseAsync_says_goodbye_with_a_close_frame()
    {
        using var desktop = new FakeDesktop(NextPort()).Start();
        var presence = Client(desktop.Port);
        await presence.ConnectAsync();

        var watch = Stopwatch.StartNew();
        await presence.CloseAsync();
        Assert.True(watch.ElapsedMilliseconds < 1500, $"CloseAsync took {watch.ElapsedMilliseconds} ms");
        Assert.True(await Next(desktop.Closed), "the server did not get a close frame");
    }

    [Fact]
    public void Options_are_validated()
    {
        Assert.Throws<ArgumentException>(() => new RichPresence(new RichPresenceOptions { ClientId = "" }));
        Assert.Throws<ArgumentException>(() => new RichPresence(new RichPresenceOptions { ClientId = "0123" }));
        Assert.Throws<ArgumentException>(() => new RichPresence(new RichPresenceOptions { ClientId = "12a" }));
        Assert.Throws<ArgumentException>(() => new RichPresence(new RichPresenceOptions { ClientId = "12345678901234567890" }));
        Assert.Throws<ArgumentException>(() => new RichPresence(new RichPresenceOptions { ClientId = ClientId, Host = "example.com" }));
        Assert.Throws<ArgumentException>(() => new RichPresence(new RichPresenceOptions { ClientId = ClientId, Ports = Array.Empty<int>() }));
        using var ok = new RichPresence(new RichPresenceOptions { ClientId = ClientId });
        Assert.False(ok.IsConnected);
        Assert.Equal(Enumerable.Range(6473, 10), RichPresence.DefaultPorts);
    }

    [Fact]
    public async Task Too_large_activity_is_refused_before_sending()
    {
        using var presence = Client(NextPort());
        await Assert.ThrowsAsync<ArgumentException>(() => presence.SetActivityAsync(new Activity { Details = new string('x', 17 * 1024) }));
    }

    [Fact]
    public async Task Concurrent_updates_all_get_answers()
    {
        using var desktop = new FakeDesktop(NextPort()).Start();
        using var presence = Client(desktop.Port);
        await presence.ConnectAsync();

        var results = await Task.WhenAll(Enumerable.Range(0, 50).Select(i => Task.Run(() => presence.SetActivityAsync(new Activity { Details = "update " + i }))));

        Assert.All(results, Assert.True);
    }
}
