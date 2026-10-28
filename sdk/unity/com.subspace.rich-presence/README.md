# Subspace Rich Presence for Unity

Show what the player is doing in your game on their Subspace Frequency profile ("Competitive - Mirage", "In a match (2 of 5)").

It talks to the **Subspace desktop app** running on the same computer, so **the desktop app must be running** (and signed in) for anything to show. The player's Activity Privacy setting decides who sees it.

- Unity 2021.3 or later. Windows, macOS and Linux players and the Editor.
- **Not WebGL.** The desktop app refuses browsers by design (any connection with an `Origin` header), so a WebGL build cannot use it. The package still compiles for WebGL: the component does nothing there, `IsConnected` is always false, and callbacks run with `null` straight away.
- Mobile and consoles have no Subspace desktop app; the component simply never connects.

## Install

From the Subspace package registry: add it as a scoped registry in `Packages/manifest.json`, then install **Subspace Rich Presence** from the Package Manager (My Registries):

```json
{
  "scopedRegistries": [{ "name": "Subspace", "url": "https://subspace.click/packages/npm/", "scopes": ["com.subspace"] }],
  "dependencies": { "com.subspace.rich-presence": "0.1.0" }
}
```

Or reference this folder directly:

Window > Package Manager > **+** > *Add package from disk...* and pick `sdk/unity/com.subspace.rich-presence/package.json`, or add it to `Packages/manifest.json`:

```json
{
  "dependencies": {
    "com.subspace.rich-presence": "file:../../path/to/sdk/unity/com.subspace.rich-presence"
  }
}
```

Create an application in Subspace under **User Settings > Developer Applications**; its id is the **Application ID**.

## Use

1. Add **Subspace > Subspace Rich Presence** to a GameObject in your first scene and set **Application ID**.
2. From game code:

```csharp
using Subspace.RichPresence;
using UnityEngine;

public class Match : MonoBehaviour
{
    void OnMatchStarted()
    {
        SubspaceRichPresence.Instance.SetActivity(new Activity
        {
            Details = "Competitive - Mirage",
            State = "In a match",
            StartedAt = Activity.Now(),
            Party = new Party(2, 5),
            LargeImage = "https://cdn.example.com/maps/mirage.png",
        });
    }

    void OnMatchEnded() => SubspaceRichPresence.Instance.ClearActivity();
}
```

`SetActivity` can be called before the desktop app is found and as often as you like: the latest activity is sent on connect and again after the desktop app restarts. A sample is under Package Manager > Subspace Rich Presence > Samples > **Basic**.

### Inspector

| Field | |
| --- | --- |
| Application ID | Your application's id. |
| Connect On Start | Look for the desktop app in `Start` (otherwise call `Connect()`). |
| Dont Destroy On Load | Keep the object and its connection across scenes; copies in later scenes destroy themselves. `SubspaceRichPresence.Instance` is the live one. |
| Reconnect | Keep looking every 15 s while the desktop app is closed. |
| Log Errors | Log failed commands as warnings when you gave no callback. |
| On Ready / On Disconnected | `UnityEvent`s, run on the main thread. |

### Methods

- `Connect()`
- `SetActivity(Activity)`, `SetActivity(Activity, Action<Exception> done)`, `SetActivity(string details, string state)`
- `ClearActivity()`, `ClearActivity(Action<Exception> done)`
- `IsConnected`, `Instance`, `ApplicationId`, and `Client` (the underlying `RichPresence`; not in WebGL builds)

`done` runs on the main thread with `null` on success (or when the activity was stored because the desktop app is not connected yet) or with the error, for example a `RichPresenceException` carrying the desktop app's reason.

## Threading

The SDK does its networking on the thread pool. The component queues its events and callbacks and runs them in its `Update`, so `onReady`, `onDisconnected` and `done` always run on the main thread (and wait while the component is disabled). If you use `Client` directly, its `Ready`/`Disconnected` events fire on a thread-pool thread: do not touch Unity objects from them.

The connection is closed in `OnDestroy` and `OnApplicationQuit`, which ends the activity. Leaving Play mode in the Editor does the same.

## Source

`Runtime/Sdk/*.cs` is a byte-identical copy of `sdk/csharp/src/Subspace.RichPresence/*.cs` (the .NET SDK). Change it there and copy it over; `dotnet test` in `sdk/csharp` fails when they differ.
