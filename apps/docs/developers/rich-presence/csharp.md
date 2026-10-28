# Rich Presence for C# and .NET

`Subspace.RichPresence` talks to the Subspace desktop app from any .NET game or app. It has no dependencies. Source: `sdk/csharp`. The [Unity package](/developers/rich-presence/unity) is built on the same code.

| | |
| --- | --- |
| Package | `Subspace.RichPresence` 0.1.0 |
| Target | `netstandard2.0`: .NET Framework 4.7.2+, .NET 6+, Mono |

## Install

From the [package registry](/developers/registry):

```bash
dotnet nuget add source https://subspace.click/packages/nuget/index.json --name subspace
dotnet add package Subspace.RichPresence
```

## Quick start

```csharp
using Subspace.RichPresence;

using var presence = new RichPresence(new RichPresenceOptions { ClientId = "1234567890" });
presence.Ready += (_, _) => Console.WriteLine("Connected to Subspace");
presence.Disconnected += (_, _) => Console.WriteLine("Subspace went away; looking again");

await presence.ConnectAsync(); // keeps looking in the background if the desktop app is closed

await presence.SetActivityAsync(new Activity
{
    Details = "Competitive - Mirage",
    State = "In a match",
    StartedAt = Activity.Now(),
    Party = new Party(2, 5),
    LargeImage = "https://cdn.example.com/maps/mirage.png",
    LargeText = "Mirage",
    Buttons = new List<Button> { new Button("Watch", "https://example.com/match/123") },
});

// Later:
await presence.ClearActivityAsync();
await presence.CloseAsync(); // or Dispose(); the activity also ends when your process exits
```

## API

### `RichPresenceOptions`

| Property | Default | |
| --- | --- | --- |
| `ClientId` | | Required: your application id (1 to 19 digits) |
| `Reconnect` | `true` | Keep looking for the desktop app, and reconnect when it restarts |
| `Ports` | `RichPresence.DefaultPorts` (6473 to 6482) | Where to look |
| `Host` | `"127.0.0.1"` | `"127.0.0.1"` or `"localhost"` |
| `ReconnectDelay` | 15 seconds | Between looks |
| `ReadyTimeout` | 3 seconds | For each port's `READY` |
| `ReplyTimeout` | 10 seconds | For each command's reply |

Invalid options throw `ArgumentException` from the constructor.

### `RichPresence` (`IDisposable`)

| Member | |
| --- | --- |
| `Task ConnectAsync()` | Starts looking for the desktop app |
| `Task<bool> SetActivityAsync(Activity)` | `true` when the desktop app took it; `false` when not connected (it is kept, and sent on connecting). Throws `ArgumentException` for an activity over 16 KB. |
| `Task<bool> ClearActivityAsync()` | Clears it |
| `Task CloseAsync(TimeSpan? timeout = null)`, `Dispose()` | Disconnects. A disposed client can't be reused. |
| `bool IsConnected` | |
| `event EventHandler Ready`, `Disconnected` | |
| `DefaultPorts`, `MaxFrameBytes` (16384) | Constants |

A refusal from the desktop app throws `RichPresenceException`.

### `Activity`

| Property | Type |
| --- | --- |
| `Type` | `ActivityType?`: `Playing`, `Streaming`, `Listening`, `Watching`, `Competing` |
| `Details`, `State` | `string?` |
| `StartedAt`, `EndsAt` | `long?`, Unix ms. `Activity.Now()` and `Activity.UnixMs(DateTimeOffset)` make them. |
| `LargeImage`, `LargeText`, `SmallImage`, `SmallText` | `string?` |
| `Party` | `Party { Size, Max }`, or `new Party(size, max)` |
| `Buttons` | `IList<Button>?`: `new Button(label, url)` |

`null` properties are not sent. See [the activity](/developers/rich-presence/#the-activity) for the rules.

## Threading

- The connection lives on thread-pool tasks; nothing blocks your game's thread.
- `Ready` and `Disconnected` are raised on a thread-pool thread, not your UI or game thread. Exceptions thrown by your handlers are swallowed.
- It tries all ports at once and takes the first, in port order, that answers `READY`.
- After the desktop app restarts, it reconnects and sends the last activity again. With `Reconnect = false` it stops after the first disconnect.
- `CloseAsync` and `Dispose` don't raise `Disconnected`.
