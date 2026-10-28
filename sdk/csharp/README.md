# Subspace Rich Presence for C# / .NET

Show what a player is doing in your game ("Competitive - Mirage", "In a match (2 of 5)") on their Subspace Frequency profile, next to their name and in member lists.

The SDK talks to the **Subspace desktop app** on the same computer over its local RPC server, so **the desktop app must be running** and signed in. The player's Activity Privacy setting decides who sees it. The protocol is described in [`apps/docs/guide/rich-presence.md`](../../apps/docs/guide/rich-presence.md); this SDK behaves like the JavaScript one in `packages/rich-presence`.

- `netstandard2.0`, no dependencies (it uses `System.Net.WebSockets.ClientWebSocket` and writes its JSON by hand), so it should run on .NET Framework 4.7.2+, .NET 6+ and Mono (the tests run on .NET 8), and the same source is used by the Unity package in [`sdk/unity`](../unity/com.subspace.rich-presence).
- Desktop only: browsers are refused by the desktop app by design.

## Install

From the Subspace package registry:

```sh
dotnet nuget add source https://subspace.click/packages/nuget/index.json --name subspace
dotnet add package Subspace.RichPresence
```

Or build it from this folder:

Reference the project, or build the DLL and reference that:

```sh
dotnet add reference path/to/sdk/csharp/src/Subspace.RichPresence/Subspace.RichPresence.csproj
# or
dotnet build sdk/csharp/src/Subspace.RichPresence -c Release   # bin/Release/netstandard2.0/Subspace.RichPresence.dll
```

You need an application: create one in Subspace under **User Settings > Developer Applications**. Its id is your `ClientId`; Rich Presence shows the application's name and, unless you send your own art, its icon.

## Example

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

| Member | |
| --- | --- |
| `new RichPresence(RichPresenceOptions)` | Validates the options (throws `ArgumentException`). Nothing connects yet. |
| `Task ConnectAsync()` | Tries every port at once (they get `ReadyTimeout`, 3 s, to say READY) and uses the first in `Ports` order that does. Completes when connected or after the first full sweep. With `Reconnect` on (default) it never throws for a missing desktop app and keeps trying every `ReconnectDelay` (15 s); with it off it throws `RichPresenceException`. |
| `Task<bool> SetActivityAsync(Activity)` | `true` when the desktop app accepted it, `false` when not connected (it is remembered and sent on connect, and again after every reconnect). Throws `RichPresenceException` when refused (`ok:false`, the message is the server's `error`), on no reply within `ReplyTimeout` (10 s), or when the connection drops meanwhile. `ArgumentException` if the frame would exceed 16 KB. |
| `Task<bool> ClearActivityAsync()` | Same, for `CLEAR_ACTIVITY`. |
| `bool IsConnected` | Connected right now. |
| `event EventHandler Ready` / `Disconnected` | See threading below. `Disconnected` is not raised by your own `Dispose`/`CloseAsync`. |
| `void Dispose()` | Aborts the connection immediately and stops looking. Pending calls fail. |
| `Task CloseAsync(TimeSpan? timeout)` | Sends a WebSocket close frame first (waits at most 1 s), then the same as `Dispose`. |
| `RichPresenceOptions` | `ClientId` (required), `Reconnect` (true), `Ports` (6473-6482), `Host` (`127.0.0.1` or `localhost`), `ReconnectDelay`, `ReadyTimeout`, `ReplyTimeout`. |
| `Activity` | `Type` (`ActivityType.Playing` ... `Competing`), `Details`, `State`, `StartedAt`, `EndsAt` (Unix ms; `Activity.Now()` / `Activity.UnixMs(DateTimeOffset)`), `LargeImage`, `LargeText`, `SmallImage`, `SmallText`, `Party`, `Buttons`. Leave a field null and it is not sent. |

What the fields mean and how invalid values are handled (dropped, not refused) is in the [guide](../../apps/docs/guide/rich-presence.md#the-activity).

> All ports are tried at once, so a sweep takes at most `ReadyTimeout`. On Windows a refused loopback connection takes about 2 seconds, so with the desktop app closed `ConnectAsync` completes after about 2 seconds (it would be about 20 seconds trying the 10 ports one at a time). When more than one port answers READY, the first in `Ports` order wins (the lowest, for the defaults).

## Threading

- Every member is thread-safe; call it from any thread.
- `Ready` and `Disconnected` are raised on a **thread-pool thread**. In a UI app or game loop, marshal to your main thread before touching UI (the Unity component does this for you). Exceptions thrown by handlers are swallowed.
- The SDK uses `ConfigureAwait(false)` throughout, so awaiting its tasks never needs your synchronization context and cannot deadlock on it. Your own code after `await` resumes as usual.
- `SetActivityAsync` can be called as often as you like; Subspace shows updates to other people at most once every 2 seconds, always ending on the latest.

## Tests

```sh
cd sdk/csharp
dotnet test
```

The tests run a fake desktop app in-process (a `TcpListener` with a hand-written WebSocket handshake, so no admin rights or URL ACLs) on ports 16573 and up, and check the handshake (no `Origin` header, the query string), READY, the JSON sent, escaping, refusals, timeouts, reconnecting, skipping a port that never says READY, trying all ports at once (ten closed ports finish well under the old 20 s), the first READY port in order winning, and that `Dispose` is prompt and aborts attempts in flight. They also check that the Unity package's copy of the source is byte-identical.
