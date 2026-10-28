# Rich Presence for Unity

`com.subspace.rich-presence` adds a **Subspace Rich Presence** component that talks to the Subspace desktop app from your game, with its events on the main thread. It is built on the [C# SDK](/developers/rich-presence/csharp). Source: `sdk/unity/com.subspace.rich-presence`.

| | |
| --- | --- |
| Package | `com.subspace.rich-presence` 0.1.0 |
| Unity | 2021.3+ |
| Platforms | Desktop builds (Windows, macOS, Linux). WebGL builds compile, but the component does nothing there: browsers can't reach the desktop app. Mobile and consoles have no desktop app, so it never connects. |

## Install

Add the [package registry](/developers/registry) as a scoped registry in `Packages/manifest.json`, and the package to the dependencies:

```json
{
  "scopedRegistries": [
    { "name": "Subspace", "url": "https://subspace.click/packages/npm/", "scopes": ["com.subspace"] }
  ],
  "dependencies": {
    "com.subspace.rich-presence": "0.1.0"
  }
}
```

Without the registry, use **Package Manager › + › Add package from disk…** on the package folder, or a `file:` entry in `Packages/manifest.json`.

## Quick start

1. Put a **Subspace Rich Presence** component (**Add Component › Subspace › Subspace Rich Presence**) on an object in your first scene, and enter your **Application ID**.
2. Set the activity from game code:

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

`SetActivity` can be called before the desktop app is found and as often as you like: the latest activity is sent on connecting, and again after the desktop app restarts. A sample is in **Package Manager › Subspace Rich Presence › Samples › Basic**.

## The component

| Inspector field | |
| --- | --- |
| Application ID | Your application id |
| Connect On Start | Look for the desktop app in `Start` (otherwise call `Connect()`) |
| Dont Destroy On Load | Keep the object and its connection across scenes; copies in later scenes destroy themselves |
| Reconnect | Keep looking every 15 seconds while the desktop app is closed |
| Log Errors | Log failed commands as warnings when you gave no callback |
| On Ready, On Disconnected | `UnityEvent`s |

| Member | |
| --- | --- |
| `SubspaceRichPresence.Instance` | The live component |
| `Connect()` | Start looking for the desktop app |
| `SetActivity(Activity)`, `SetActivity(Activity, Action<Exception> done)`, `SetActivity(string details, string state)` | Set [the activity](/developers/rich-presence/#the-activity) |
| `ClearActivity()`, `ClearActivity(Action<Exception> done)` | Clear it |
| `IsConnected`, `ApplicationId` | State |
| `Client` | The underlying C# `RichPresence` (not in WebGL builds) |

`done` gets `null` on success (or when the activity was kept because the desktop app isn't connected yet), or the error, such as a `RichPresenceException` with the desktop app's reason. `Activity`, `Party` and `Button` are the [C# SDK's](/developers/rich-presence/csharp#activity).

## Threading

- Networking runs on the thread pool. The component queues its events and callbacks and runs them in its `Update`, so **On Ready**, **On Disconnected** and `done` always run on the main thread (and wait while the component is disabled).
- If you use `Client` directly, its `Ready` and `Disconnected` events fire on a thread-pool thread: don't touch Unity objects from them.
- The connection closes in `OnDestroy` and `OnApplicationQuit`, which ends the activity. Leaving Play mode in the Editor does the same.
