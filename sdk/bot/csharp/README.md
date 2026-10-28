# Subspace Frequency bot SDK for C# / .NET

`Subspace.Bot` wraps the Subspace Frequency bot API: REST calls as `Authorization: Bot <token>`, the gateway (events over a WebSocket), slash commands and their interactions, and checking the signature on interactions delivered to an HTTP endpoint. It mirrors the JavaScript SDK in [`packages/bot-sdk`](../../../packages/bot-sdk); the API itself is described in [`apps/docs/guide/bots.md`](../../../apps/docs/guide/bots.md).

- Targets `netstandard2.0` and `net8.0`. It uses `HttpClient` for REST and `ClientWebSocket` for the gateway.
- One dependency, and only on `netstandard2.0`: `System.Text.Json` (it ships with .NET 8 and later).
- Ed25519 verification is built in (pure C#, no native library).

## Install

From the Subspace package registry:

```sh
dotnet nuget add source https://subspace.click/packages/nuget/index.json --name subspace
dotnet add package Subspace.Bot --version 0.1.0
```

Until then, use the package built from this folder (`dotnet pack`, see [Building](#building)) from a local folder source, or reference the project:

```sh
dotnet nuget add source path/to/sdk/bot/csharp/artifacts --name subspace-local
dotnet add package Subspace.Bot --version 0.1.0
# or
dotnet add reference path/to/sdk/bot/csharp/src/Subspace.Bot/Subspace.Bot.csproj
```

You need a bot: **User Settings > Developer Applications > New Application > Add Bot**, then copy the token (it is shown once) and add the bot to a beacon with its invite link.

## Quick start: a slash-command bot

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

Answer within 3 seconds. For slow work, `await i.DeferAsync()` first ("*Bot* is thinking…"), then `await i.FollowUpAsync("…")` within 15 minutes; `EditReplyAsync` changes the first answer. `Reply.Ephemeral = true` shows the reply only to the person who used the command.

## Quick start: a message-listening bot

```csharp
bot.MessageReceived += async m =>
{
    if (m.Content == "!hello" && m.Author.Id != bot.User!.Id)
        await bot.SendAsync(m.ChannelType, m.ChannelId, new NewMessage { Content = $"Hi {m.Author.Username}!", ReplyToId = m.Id });
};
await bot.ConnectAsync();
```

Without the **Message Content Intent** (Developer Applications, off by default), a bot sees message text only in messages that mention it and in its own; other messages arrive with empty `Content`.

## Interactions over HTTP

Set the application's **Interactions Endpoint URL** and the bot need not stay connected. Check every request, then answer in the response body:

```csharp
app.MapPost("/interactions", async (HttpRequest request) =>
{
    using var reader = new StreamReader(request.Body);
    var body = await reader.ReadToEndAsync();
    if (!Interactions.Verify(body, request.Headers["X-Signature-Ed25519"], request.Headers["X-Signature-Timestamp"], publicKeyHex))
        return Results.Unauthorized();
    var interaction = Interactions.Parse(body);
    return Results.Content(Interactions.RespondWith($"Hello {interaction.User.Username}"), "application/json");
});
```

`Interactions.DeferWith()` defers instead; follow up later with `bot.ParseInteraction(body).FollowUpAsync(...)`. `Verify` rejects anything more than five minutes old.

## API

| `SubspaceBot` | |
| --- | --- |
| `RestAsync(method, path, body?, asBot = true)` | Any `/api/v1` call; returns the JSON (`JsonElement`), throws `SubspaceApiException`. `RestAsync<T>` converts it. |
| `MeAsync()` | `GET /bots/@me`; sets `User`. |
| `SendAsync(channelType, channelId, message)` | Post in a relay or thread (`message` is a string or `NewMessage`). Returns the `Message`. |
| `EditAsync(id, content)`, `DeleteAsync(id)`, `ReactAsync(id, emoji)` | Manage transmissions. |
| `RegisterCommandsAsync(commands, beaconId?)` | Replace the bot's commands, everywhere or in one beacon. |
| `ConnectAsync()`, `DisconnectAsync()` | The gateway. Connecting returns on READY and throws `SubspaceApiException` (401, `INVALID_BOT_TOKEN`) for a refused token; afterwards the bot reconnects by itself until `DisconnectAsync`. |
| `ParseInteraction(body)` | Wrap an HTTP-delivered interaction so it can follow up or edit. |

| Events | JS SDK name | |
| --- | --- | --- |
| `Ready` | `ready` | The READY payload. |
| `MessageReceived`, `MessageUpdated`, `MessageDeleted` | `message`, `messageUpdate`, `messageDelete` | Messages in beacons the bot is in. |
| `InteractionReceived` | `interaction` | Someone used one of its commands. |
| `Dispatch` | `dispatch` | Every gateway event, as `(type, data)`. |
| `Disconnected` | `close` | The connection closed (`GatewayClose.Code`, `.Reason`). |
| `Error` | `error` | A handler threw, or reconnecting failed. |

Event handlers return a `Task`. They run on the receive loop up to their first `await`; the loop does not wait for the rest, so a slow handler does not hold up others. An exception goes to `Error` and does not stop the bot.

`Interaction`: `CommandName`, `User`, `Channel`, `BeaconId`, `Payload` (everything the server sent), `Option(name)` (a `JsonElement?`), `GetOption(name, fallback)`, `TryGetOption(name, out value)`, `ReplyAsync`, `DeferAsync`, `FollowUpAsync`, `EditReplyAsync`.

`Interactions` (static): `Verify(rawBody, signature, timestamp, publicKeyHex)` (also with `byte[]` bodies and a `now` for tests), `Parse(rawBody)`, `RespondWith(reply)`, `DeferWith(ephemeral)`.

## Example

[`examples/DiceBot`](examples/DiceBot/Program.cs) registers `/ping` and `/roll` and answers `!hello`:

```sh
SUBSPACE_BOT_TOKEN=... SUBSPACE_BASE_URL=https://subspace.click dotnet run --project examples/DiceBot
# smoke test: connect, post once in a relay, exit
SUBSPACE_BOT_TOKEN=... SUBSPACE_RELAY_ID=... dotnet run --project examples/DiceBot -- --once
```

`SUBSPACE_GATEWAY_URL` overrides the gateway address when it is not `<base>/gateway`.

## Building

```sh
dotnet test                                           # 24 tests, against an in-process fake instance
dotnet test tests/Subspace.Bot.Tests -p:SdkTarget=netstandard2.0   # the same tests on the netstandard2.0 build
dotnet pack src/Subspace.Bot -c Release               # artifacts/Subspace.Bot.0.1.0.nupkg and .snupkg
```

## Notes

- **Why System.Text.Json:** messages and interactions are open-ended JSON (embeds, polls, new fields); `JsonElement` lets the SDK hand over everything the server sends (`Message.Raw`, `Interaction.Payload`) without a hand-written parser falling behind the API.
- **Why a built-in Ed25519:** .NET has no Ed25519 in the base library, and the usual packages (NSec, libsodium wrappers) need native binaries. Verification needs only public inputs, so a small BigInteger implementation of RFC 8032 is enough; it is tested against the RFC's vectors and signatures made by Node's `crypto` (as the server makes them). Like OpenSSL, it rejects non-canonical `S`.
