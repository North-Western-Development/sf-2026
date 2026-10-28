# C# and .NET bots

`Subspace.Bot` covers the REST API, the gateway, slash commands and interactions (over the gateway or signed HTTP), with `async` methods throughout. Source: `sdk/bot/csharp`.

| | |
| --- | --- |
| Package | `Subspace.Bot` 0.1.0 |
| Targets | `netstandard2.0` and `net8.0` |
| Depends on | `System.Text.Json` (on `netstandard2.0` only). Ed25519 is built in. |

## Install

From the [package registry](/developers/registry):

```bash
dotnet nuget add source https://subspace.click/packages/nuget/index.json --name subspace
dotnet add package Subspace.Bot
```

## Quick start

```csharp
using Subspace.Bot;

using var bot = new SubspaceBot(new SubspaceBotOptions
{
    Token = Environment.GetEnvironmentVariable("SUBSPACE_BOT_TOKEN")!,
    BaseUrl = "https://subspace.click",
});

await bot.RegisterCommandsAsync(new[]
{
    new CommandDefinition { Name = "ping", Description = "Check the bot is alive" },
    new CommandDefinition
    {
        Name = "roll",
        Description = "Roll a die",
        Options = new() { new CommandOption { Type = CommandOptionType.Integer, Name = "sides", Description = "How many sides" } },
    },
});

bot.InteractionReceived += async i =>
{
    if (i.CommandName == "ping") await i.ReplyAsync("Pong!");
    if (i.CommandName == "roll")
    {
        var sides = i.GetOption("sides", 6);
        await i.ReplyAsync(new Reply
        {
            Embeds = new() { new Embed { Title = $"🎲 {Random.Shared.Next(1, sides + 1)}", Footer = new EmbedFooter { Text = $"d{sides}" } } },
        });
    }
};

await bot.ConnectAsync();      // returns on READY
await Task.Delay(Timeout.Infinite);
```

A runnable version is `sdk/bot/csharp/examples/DiceBot`.

## API

### Options

`new SubspaceBot(token, baseUrl)` or `new SubspaceBot(SubspaceBotOptions)`:

| Option | Default |
| --- | --- |
| `Token` | Required; the bot token without `Bot ` |
| `BaseUrl` | Required |
| `GatewayUrl` | `BaseUrl` with `ws(s)://` and `/gateway` |
| `HttpClient` | One the bot makes and disposes |
| `AutoReconnect` | `true` |
| `ReconnectDelay` | 2 seconds |

### Methods

| Method | Calls |
| --- | --- |
| `ConnectAsync(ct)` | Opens the gateway; completes at `READY` |
| `DisconnectAsync()`, `Dispose()` | Closes it and stops reconnecting |
| `MeAsync()`, `User` | `GET /bots/@me`; the last result |
| `SendAsync(channelType, channelId, NewMessage)` | Posts a transmission (`"relay"` or `"thread"`). `NewMessage` has `Content` and `ReplyToId`, and converts from a `string`. |
| `EditAsync(id, content)`, `DeleteAsync(id)`, `ReactAsync(id, emoji)` | Edit, delete, react |
| `RegisterCommandsAsync(commands, beaconId?)` | Replaces the global commands, or one beacon's. Returns `IReadOnlyList<RegisteredCommand>`. |
| `RestAsync(method, path, body?)`, `RestAsync<T>(…)` | Any other [REST](/developers/rest) call; `JsonElement` or your type |

A failed call throws `SubspaceApiException` with `Status` and `Code`.

### Events

| Event | Arguments |
| --- | --- |
| `Ready` | `JsonElement`: the `READY` payload |
| `MessageReceived`, `MessageUpdated` | `Message`: `Id`, `ChannelType`, `ChannelId`, `Author`, `Content`, `Mentions`, `Embeds`, `CreatedAt`, `Raw` |
| `MessageDeleted` | `JsonElement` |
| `InteractionReceived` | `Interaction` |
| `Dispatch` | `(string type, JsonElement data)` for every [gateway event](/developers/events) |
| `Disconnected` | `GatewayClose { Code, Reason }` (an `Action`) |
| `Error` | `Exception` (an `Action`) |

The others are `Func<…, Task>`: assign `async` lambdas.

### Interaction

| Member | |
| --- | --- |
| `Id`, `CommandName`, `User`, `Channel`, `BeaconId`, `Payload` | From the [interaction](/developers/commands#receiving-interactions) |
| `Option(name)` | `JsonElement?` |
| `GetOption<T>(name, fallback)`, `TryGetOption<T>(name, out T)` | Typed option values |
| `ReplyAsync(Reply)` | Answer now. `Reply` has `Content`, `Embeds`, `Ephemeral`, and converts from a `string`. |
| `DeferAsync(bool ephemeral = false)` | "Thinking…" |
| `FollowUpAsync(Reply)`, `EditReplyAsync(Reply)` | Another reply; edit the reply |

## HTTP interactions

The static `Interactions` class, for an **Interactions Endpoint URL** (ASP.NET Core minimal API):

```csharp
app.MapPost("/interactions", async (HttpRequest req) =>
{
    using var reader = new StreamReader(req.Body);
    var body = await reader.ReadToEndAsync();
    if (!Interactions.Verify(body, req.Headers["X-Signature-Ed25519"], req.Headers["X-Signature-Timestamp"], publicKeyHex))
        return Results.Unauthorized();
    var interaction = Interactions.Parse(body);
    return Results.Content(Interactions.RespondWith($"Hello {interaction.User.Username}"), "application/json");
});
```

| Method | |
| --- | --- |
| `Verify(string \| byte[] rawBody, signature, timestamp, publicKeyHex[, now])` | Rejects timestamps more than 5 minutes (`MaxAge`) off |
| `Parse(rawBody)` | An `InteractionPayload` |
| `RespondWith(Reply)`, `DeferWith(bool ephemeral = false)` | The response body, as a JSON **string** |

`SubspaceBot.ParseInteraction(rawBody)` gives you an `Interaction` whose `ReplyAsync` and friends call the REST callback instead.

## Threading

- Each connection has a receive loop. A handler runs on it until its first `await`; the loop then moves on without waiting for the rest, so handlers can overlap. Exceptions from handler tasks are raised as `Error`.
- Heartbeats run in their own task, and sends are serialized, so you can call the bot from any thread.
- `ConnectAsync` throws if the first connection fails (no retry), and `SubspaceApiException` (401, `INVALID_BOT_TOKEN`) on close code `4003`. After `READY`, a dropped connection reconnects every `ReconnectDelay` while `AutoReconnect` is on, reporting failures as `Error`. There is no resume.
