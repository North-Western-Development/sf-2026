using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;
using Xunit;

namespace Subspace.Bot.Tests;

public class BotTests
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(10);

    private static async Task<T> Next<T>(Channel<T> channel)
    {
        using var cts = new CancellationTokenSource(Wait);
        return await channel.Reader.ReadAsync(cts.Token);
    }

    private static async Task<RecordedRequest> NextRequest(FakeServer server, Func<RecordedRequest, bool> match)
    {
        while (true)
        {
            var request = await Next(server.Requests);
            if (match(request)) return request;
        }
    }

    private static async Task<JsonElement> NextFrame(FakeServer server, int op)
    {
        while (true)
        {
            var frame = await Next(server.GatewayFrames);
            if (frame.GetProperty("op").GetInt32() == op) return frame;
        }
    }

    private static SubspaceBot NewBot(FakeServer server, string? token = null) => new(new SubspaceBotOptions
    {
        Token = token ?? server.Token,
        BaseUrl = server.BaseUrl + "/",
        ReconnectDelay = TimeSpan.FromMilliseconds(100),
    });

    // ---- REST ----------------------------------------------------------------------------------

    [Fact]
    public async Task MeSendsTheBotTokenAndRemembersTheBot()
    {
        using var server = new FakeServer();
        using var bot = NewBot(server);
        var me = await bot.MeAsync();
        Assert.Equal("200", me.AppId);
        Assert.Equal(new[] { "300" }, me.BeaconIds);
        Assert.Same(me, bot.User);
        var request = await Next(server.Requests);
        Assert.Equal("GET", request.Method);
        Assert.Equal("/api/v1/bots/@me", request.Path);
        Assert.Equal("Bot secret-token", request.Headers["Authorization"]);
    }

    [Fact]
    public async Task SendPostsToTheChannelAndReturnsTheTransmission()
    {
        using var server = new FakeServer();
        server.Handler = r => r.Method == "POST"
            ? (201, "{\"transmission\":{\"id\":\"9\",\"content\":\"Hi!\",\"author\":{\"id\":\"100\",\"username\":\"dice\",\"botKind\":\"bot\"},\"mentions\":[],\"embeds\":[],\"createdAt\":\"2026-10-27T00:00:00Z\",\"pinned\":false}}")
            : null;
        using var bot = NewBot(server);
        var sent = await bot.SendAsync("relay", "55", "Hi!");
        Assert.Equal("9", sent.Id);
        Assert.Equal("bot", sent.Author.BotKind);
        Assert.Equal("relay", sent.ChannelType);
        Assert.Equal("55", sent.ChannelId);
        Assert.False(sent.Raw.GetProperty("pinned").GetBoolean());
        var request = await Next(server.Requests);
        Assert.Equal("/api/v1/channels/relay/55/transmissions", request.Path);
        Assert.Equal("{\"content\":\"Hi!\"}", request.Body);
        Assert.StartsWith("application/json", request.Headers["Content-Type"]);

        await bot.SendAsync("thread", "56", new NewMessage { Content = "re", ReplyToId = "9" });
        request = await Next(server.Requests);
        Assert.Equal("/api/v1/channels/thread/56/transmissions", request.Path);
        Assert.Equal("{\"content\":\"re\",\"replyToId\":\"9\"}", request.Body);
    }

    [Fact]
    public async Task EditDeleteAndReactUseTheirRoutes()
    {
        using var server = new FakeServer();
        server.Handler = r => r.Method == "DELETE" || r.Method == "PUT" ? (204, "") : null;
        using var bot = NewBot(server);
        await bot.EditAsync("9", "changed");
        var edit = await Next(server.Requests);
        Assert.Equal(("PATCH", "/api/v1/transmissions/9", "{\"content\":\"changed\"}"), (edit.Method, edit.Path, edit.Body));
        await bot.DeleteAsync("9");
        var delete = await Next(server.Requests);
        Assert.Equal(("DELETE", "/api/v1/transmissions/9"), (delete.Method, delete.Path));
        await bot.ReactAsync("9", "\U0001F44D");
        var react = await Next(server.Requests);
        Assert.Equal(("PUT", "/api/v1/transmissions/9/reactions/%F0%9F%91%8D/@me"), (react.Method, react.Path));
        Assert.Equal("Bot secret-token", react.Headers["Authorization"]);
    }

    [Fact]
    public async Task RegisterCommandsPutsTheWholeListGloballyOrInABeacon()
    {
        using var server = new FakeServer();
        server.Handler = r => r.Method == "PUT" ? (200, "{\"commands\":[{\"id\":\"7\",\"name\":\"roll\",\"description\":\"Roll a die\",\"options\":[{\"type\":\"integer\",\"name\":\"sides\",\"description\":\"How many sides\",\"required\":true}]}]}") : null;
        using var bot = NewBot(server);
        var commands = new[]
        {
            new CommandDefinition
            {
                Name = "roll",
                Description = "Roll a die",
                Options = new() { new CommandOption { Type = CommandOptionType.Integer, Name = "sides", Description = "How many sides", Required = true } },
            },
            new CommandDefinition
            {
                Name = "unit",
                Description = "Pick",
                Options = new() { new CommandOption { Type = CommandOptionType.String, Name = "u", Description = "Unit", Choices = new() { new CommandChoice("Minutes", "m"), new CommandChoice("Hours", 60) } } },
                DefaultMemberPermissions = "8192",
            },
        };
        var registered = await bot.RegisterCommandsAsync(commands);
        Assert.Equal("7", registered[0].Id);
        Assert.Equal(CommandOptionType.Integer, registered[0].Options![0].Type);

        await NextRequest(server, r => r.Path == "/api/v1/bots/@me");
        var put = await Next(server.Requests);
        Assert.Equal(("PUT", "/api/v1/applications/200/commands"), (put.Method, put.Path));
        Assert.Equal(
            "[{\"name\":\"roll\",\"description\":\"Roll a die\",\"options\":[{\"type\":\"integer\",\"name\":\"sides\",\"description\":\"How many sides\",\"required\":true}]}," +
            "{\"name\":\"unit\",\"description\":\"Pick\",\"options\":[{\"type\":\"string\",\"name\":\"u\",\"description\":\"Unit\",\"choices\":[{\"name\":\"Minutes\",\"value\":\"m\"},{\"name\":\"Hours\",\"value\":60}]}],\"defaultMemberPermissions\":\"8192\"}]",
            put.Body);

        await bot.RegisterCommandsAsync(commands.Take(1), beaconId: "300");
        put = await Next(server.Requests);
        Assert.Equal("/api/v1/applications/200/beacons/300/commands", put.Path);
    }

    [Fact]
    public async Task ErrorsBecomeSubspaceApiExceptions()
    {
        using var server = new FakeServer();
        server.Handler = r => r.Path.Contains("/users/") ? (403, "{\"error\":\"Bots cannot use this endpoint\",\"code\":\"BOT_FORBIDDEN\"}") : null;
        using var bot = NewBot(server);
        var error = await Assert.ThrowsAsync<SubspaceApiException>(() => bot.RestAsync(new HttpMethod("PATCH"), "/users/@me/profile", new { bio = "hi" }));
        Assert.Equal(403, error.Status);
        Assert.Equal("BOT_FORBIDDEN", error.Code);
        Assert.Equal("Bots cannot use this endpoint", error.Message);

        using var wrong = NewBot(server, token: "nope");
        var unauthorized = await Assert.ThrowsAsync<SubspaceApiException>(() => wrong.MeAsync());
        Assert.Equal(401, unauthorized.Status);
        Assert.Equal("INVALID_BOT_TOKEN", unauthorized.Code);
    }

    // ---- Gateway -------------------------------------------------------------------------------

    [Fact]
    public async Task ConnectIdentifiesWithTheBotTokenAndCompletesOnReady()
    {
        using var server = new FakeServer();
        using var bot = NewBot(server);
        JsonElement? ready = null;
        bot.Ready += d =>
        {
            ready = d;
            return Task.CompletedTask;
        };
        await bot.ConnectAsync();
        Assert.True(bot.IsConnected);
        Assert.Equal("s1", ready!.Value.GetProperty("session_id").GetString());
        Assert.Equal("/gateway", await Next(server.GatewayConnections));
        var identify = await NextFrame(server, 2);
        Assert.Equal("Bot secret-token", identify.GetProperty("d").GetProperty("token").GetString());
        Assert.Equal("200", bot.User!.AppId);
        Assert.Equal($"ws://127.0.0.1:{server.Port}/gateway", bot.GatewayUrl);
        await bot.DisconnectAsync();
    }

    [Fact]
    public async Task HeartbeatsAtTheHelloInterval()
    {
        using var server = new FakeServer { HeartbeatInterval = 50 };
        using var bot = NewBot(server);
        await bot.ConnectAsync();
        await NextFrame(server, 1);
        await NextFrame(server, 1);
        await NextFrame(server, 1);
        await bot.DisconnectAsync();
    }

    [Fact]
    public async Task DispatchesMessagesAndEveryEvent()
    {
        using var server = new FakeServer();
        using var bot = NewBot(server);
        var messages = Channel.CreateUnbounded<Message>();
        var updates = Channel.CreateUnbounded<Message>();
        var deletes = Channel.CreateUnbounded<JsonElement>();
        var all = new ConcurrentQueue<string>();
        bot.MessageReceived += m => messages.Writer.WriteAsync(m).AsTask();
        bot.MessageUpdated += m => updates.Writer.WriteAsync(m).AsTask();
        bot.MessageDeleted += d => deletes.Writer.WriteAsync(d).AsTask();
        bot.Dispatch += (t, _) =>
        {
            all.Enqueue(t);
            return Task.CompletedTask;
        };
        await bot.ConnectAsync();

        await server.DispatchAsync("TRANSMISSION_CREATE", "{\"channelType\":\"relay\",\"channelId\":\"55\",\"transmission\":{\"id\":\"9\",\"content\":\"!hello\",\"author\":{\"id\":\"4\",\"username\":\"sam\",\"displayName\":null},\"mentions\":[\"100\"],\"embeds\":[],\"createdAt\":\"2026-10-27T00:00:00Z\"}}");
        var message = await Next(messages);
        Assert.Equal(("9", "!hello", "relay", "55", "sam"), (message.Id, message.Content, message.ChannelType, message.ChannelId, message.Author.Username));
        Assert.Equal(new[] { "100" }, message.Mentions);

        await server.DispatchAsync("TRANSMISSION_UPDATE", "{\"channelType\":\"relay\",\"channelId\":\"55\",\"transmission\":{\"id\":\"9\",\"content\":\"edited\",\"author\":{\"id\":\"4\",\"username\":\"sam\"}}}");
        Assert.Equal("edited", (await Next(updates)).Content);
        await server.DispatchAsync("TRANSMISSION_DELETE", "{\"channelType\":\"relay\",\"channelId\":\"55\",\"transmissionId\":\"9\"}");
        Assert.Equal("9", (await Next(deletes)).GetProperty("transmissionId").GetString());
        await server.DispatchAsync("PRESENCE_UPDATE", "{\"transmitterId\":\"4\",\"presence\":\"online\"}");
        var deadline = DateTime.UtcNow + Wait;
        while (!all.Contains("PRESENCE_UPDATE") && DateTime.UtcNow < deadline) await Task.Delay(20);
        Assert.Equal(new[] { "READY", "TRANSMISSION_CREATE", "TRANSMISSION_UPDATE", "TRANSMISSION_DELETE", "PRESENCE_UPDATE" }, all.ToArray());
        await bot.DisconnectAsync();
    }

    // The gateway currently sends the event name as "type" (the HTTP endpoint gets 2).
    private const string InteractionJson = "{\"type\":\"INTERACTION_CREATE\",\"id\":\"77\",\"token\":\"itok\",\"applicationId\":\"200\",\"beaconId\":\"300\",\"channel\":{\"type\":\"relay\",\"id\":\"55\"},\"user\":{\"id\":\"4\",\"username\":\"sam\",\"displayName\":\"Sam\",\"avatarUrl\":null},\"memberPermissions\":\"1024\",\"data\":{\"id\":\"7\",\"name\":\"roll\",\"options\":[{\"name\":\"sides\",\"type\":\"integer\",\"value\":8},{\"name\":\"who\",\"type\":\"user\",\"value\":\"4\"}]}}";

    [Fact]
    public async Task InteractionsAnswerWithTheirOwnToken()
    {
        using var server = new FakeServer();
        using var bot = NewBot(server);
        var done = new TaskCompletionSource();
        bot.InteractionReceived += async i =>
        {
            Assert.Equal(("roll", "sam", "relay", "55", "300"), (i.CommandName, i.User.Username, i.Channel.Type, i.Channel.Id, i.BeaconId));
            Assert.Equal(8, i.GetOption("sides", 6));
            Assert.Equal("4", i.GetOption<string?>("who", null));
            Assert.Equal(6, i.GetOption("missing", 6));
            Assert.False(i.TryGetOption<int>("missing", out _));
            Assert.True(i.TryGetOption<long>("sides", out var sides) && sides == 8);
            await i.DeferAsync();
            await i.FollowUpAsync("Took a while: 1");
            await i.EditReplyAsync(new Reply { Content = "Edited", Embeds = new() { new Embed { Title = "Dice", Footer = new EmbedFooter { Text = "d8" } } } });
            await i.ReplyAsync(new Reply { Content = "Now", Ephemeral = true });
            done.SetResult();
        };
        await bot.ConnectAsync();
        await server.DispatchAsync("INTERACTION_CREATE", InteractionJson);
        await done.Task.WaitAsync(Wait);

        var requests = new List<RecordedRequest>();
        while (requests.Count < 4)
        {
            var r = await Next(server.Requests);
            if (r.Path.StartsWith("/api/v1/interactions/")) requests.Add(r);
        }
        Assert.All(requests, r => Assert.False(r.Headers.ContainsKey("Authorization")));
        Assert.Equal(("POST", "/api/v1/interactions/77/itok/callback", "{\"type\":5,\"data\":{\"ephemeral\":false}}"), (requests[0].Method, requests[0].Path, requests[0].Body));
        Assert.Equal(("POST", "/api/v1/interactions/77/itok/followup", "{\"content\":\"Took a while: 1\"}"), (requests[1].Method, requests[1].Path, requests[1].Body));
        Assert.Equal(("PATCH", "/api/v1/interactions/77/itok/original", "{\"content\":\"Edited\",\"embeds\":[{\"title\":\"Dice\",\"footer\":{\"text\":\"d8\"}}]}"), (requests[2].Method, requests[2].Path, requests[2].Body));
        Assert.Equal(("POST", "/api/v1/interactions/77/itok/callback", "{\"type\":4,\"data\":{\"content\":\"Now\",\"ephemeral\":true}}"), (requests[3].Method, requests[3].Path, requests[3].Body));
        await bot.DisconnectAsync();
    }

    [Fact]
    public async Task HandlerExceptionsAreReportedNotFatal()
    {
        using var server = new FakeServer();
        using var bot = NewBot(server);
        var errors = Channel.CreateUnbounded<Exception>();
        var messages = Channel.CreateUnbounded<Message>();
        bot.Error += e => errors.Writer.TryWrite(e);
        bot.MessageReceived += m => throw new InvalidOperationException("sync boom");
        bot.InteractionReceived += async i =>
        {
            await Task.Yield();
            throw new InvalidOperationException("async boom");
        };
        bot.MessageReceived += m => messages.Writer.WriteAsync(m).AsTask();
        await bot.ConnectAsync();
        await server.DispatchAsync("TRANSMISSION_CREATE", "{\"channelType\":\"relay\",\"channelId\":\"55\",\"transmission\":{\"id\":\"9\",\"content\":\"x\",\"author\":{\"id\":\"4\",\"username\":\"sam\"}}}");
        Assert.Equal("sync boom", (await Next(errors)).Message);
        Assert.Equal("9", (await Next(messages)).Id);
        await server.DispatchAsync("INTERACTION_CREATE", InteractionJson);
        Assert.Equal("async boom", (await Next(errors)).Message);
        Assert.True(bot.IsConnected);
        await bot.DisconnectAsync();
    }

    [Fact]
    public async Task AnInvalidTokenFailsConnectAndDoesNotReconnect()
    {
        using var server = new FakeServer();
        server.MeJson = "{\"bot\":{\"id\":\"100\",\"username\":\"dice\",\"appId\":\"200\",\"beaconIds\":[]}}";
        server.Handler = r => r.Path == "/api/v1/bots/@me" ? (200, server.MeJson) : null;
        using var bot = NewBot(server, token: "revoked");
        var closes = Channel.CreateUnbounded<GatewayClose>();
        bot.Disconnected += c => closes.Writer.TryWrite(c);
        var error = await Assert.ThrowsAsync<SubspaceApiException>(() => bot.ConnectAsync());
        Assert.Equal(401, error.Status);
        Assert.Equal("INVALID_BOT_TOKEN", error.Code);
        Assert.Equal(4003, (await Next(closes)).Code);
        await Next(server.GatewayConnections);
        await Task.Delay(500);
        Assert.False(server.GatewayConnections.Reader.TryRead(out _));
        Assert.False(bot.IsConnected);
    }

    [Fact]
    public async Task ReconnectsAfterADropAndStopsAfterDisconnect()
    {
        using var server = new FakeServer();
        using var bot = NewBot(server);
        var readies = Channel.CreateUnbounded<JsonElement>();
        var closes = Channel.CreateUnbounded<GatewayClose>();
        bot.Ready += d => readies.Writer.WriteAsync(d).AsTask();
        bot.Disconnected += c => closes.Writer.TryWrite(c);
        await bot.ConnectAsync();
        await Next(readies);
        await Next(server.GatewayConnections);

        server.DropGateways();
        Assert.Equal(1006, (await Next(closes)).Code);
        await Next(server.GatewayConnections);
        await Next(readies);

        await server.CloseGatewaysAsync(1012);
        Assert.Equal(1012, (await Next(closes)).Code);
        await Next(server.GatewayConnections);
        await Next(readies);
        Assert.True(bot.IsConnected);

        // Drain the closes the server saw for the dropped connections.
        Assert.False(await Next(server.GatewayClosed));
        await Next(server.GatewayClosed);

        await bot.DisconnectAsync();
        Assert.True(await Next(server.GatewayClosed));
        Assert.Equal(1000, (await Next(closes)).Code);
        await Task.Delay(500);
        Assert.False(server.GatewayConnections.Reader.TryRead(out _));
        Assert.False(bot.IsConnected);
    }

    [Fact]
    public async Task ConnectFailsWhenTheGatewayIsUnreachable()
    {
        using var server = new FakeServer();
        using var bot = new SubspaceBot(new SubspaceBotOptions { Token = server.Token, BaseUrl = server.BaseUrl, GatewayUrl = "ws://127.0.0.1:1/gateway" });
        await Assert.ThrowsAnyAsync<Exception>(() => bot.ConnectAsync());
    }
}
