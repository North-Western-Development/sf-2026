# Subspace Rich Presence for Unreal Engine

An Unreal Engine 5 plugin that shows what a player is doing in your game ("Competitive · Mirage", "In a match (2 of 5)") on their Subspace Frequency profile, next to their name and in member lists.

It talks to the **Subspace desktop app** on the same computer. The desktop app must be running; when it isn't, nothing happens and the plugin keeps looking every 15 seconds. Browsers can't do this (the desktop app refuses any connection with an `Origin` header), and that's why the plugin brings its own small WebSocket client, the [C++ SDK](../cpp), instead of Unreal's WebSockets module.

Platforms: Win64, Mac, Linux. Runtime module, no content.

## Install

Download `SubspaceRichPresence-unreal-<version>.zip` from https://subspace.click/packages/files/ and unzip it into your project's `Plugins` folder, or copy this folder there:

1. Copy `SubspaceRichPresence/` into your project's `Plugins/` folder (create it if needed).
2. Regenerate project files and build, or open the project and let the editor build the plugin.
3. Enable **Subspace Rich Presence** under Edit › Plugins if it isn't already.
4. Create an application in Subspace under **User Settings › Developer Applications** and copy its id.
5. In **Project Settings › Plugins › Subspace Rich Presence**, paste it into **Application ID** and leave **Enabled** on.

The settings are saved to `Config/DefaultGame.ini`:

```ini
[/Script/SubspaceRichPresence.SubspaceRichPresenceSettings]
ApplicationId=1234567890
bEnabled=True
```

The subsystem starts when the game instance does (in Play In Editor too) and stops when it shuts down. It does nothing on a dedicated server.

## Blueprint

1. Anywhere you have a world (a Game Instance, Game Mode or Player Controller blueprint): **Get Game Instance Subsystem** with class **Subspace Rich Presence Subsystem**.
2. **Make Subspace Activity**: set Type, Details, State, images and Party Size / Party Max. For "for 12m", feed **Get Unix Time Ms** into Started At, or pass the struct through **Start Now**.
3. Call **Set Activity** with it. Call it again whenever something changes; only the latest is sent. **Clear Activity** removes it.
4. Optional: bind to **On Connection Changed** (`bConnected`) to know when the desktop app connects or goes away, or check **Is Connected**.

## C++

Add `"SubspaceRichPresence"` to your module's dependencies in its `.Build.cs`, then:

```cpp
#include "SubspaceRichPresenceSubsystem.h"

void AMyGameMode::OnMatchStarted()
{
	USubspaceRichPresenceSubsystem* Presence = GetGameInstance()->GetSubsystem<USubspaceRichPresenceSubsystem>();

	FSubspaceActivity Activity;
	Activity.Type = ESubspaceActivityType::Competing;
	Activity.Details = TEXT("Competitive · Mirage");
	Activity.State = TEXT("In a match");
	Activity.PartySize = 2;
	Activity.PartyMax = 5;
	Activity.LargeImage = TEXT("https://cdn.example.com/maps/mirage.png");
	FSubspaceButton Watch;
	Watch.Label = TEXT("Watch");
	Watch.Url = TEXT("https://example.com/match/123");
	Activity.Buttons.Add(Watch);
	Activity.StartNow();

	Presence->SetActivity(Activity);
}
```

`StartWithApplicationId(TEXT("1234567890"))` starts (or restarts) with an id that isn't in Project Settings, and `Stop()` disconnects.

## The activity

| Field | Notes |
| --- | --- |
| Type | Playing (default), Streaming, Listening, Watching, Competing: the word before your app's name |
| Details, State | The two lines under the name, up to 128 characters each. Empty = not shown |
| Started At / Ends At | Unix time in milliseconds (int64). 0 = not shown. Ends At shows a countdown |
| Large Image / Small Image | `https://` image URLs. Without a large image your application's icon is shown |
| Large Text / Small Text | Hover text for the images |
| Party Size / Party Max | "(2 of 5)". Shown when Party Size is at least 1 and no more than Party Max |
| Buttons | Up to two `{Label, Url}` links, `https://` only, labels up to 32 characters. Extra ones are left out |

Invalid values are dropped by the desktop app rather than refused.

## Threading

- **Set Activity**, **Clear Activity** and **Is Connected** never block the game thread. They store the latest activity and wake the SDK's background thread, which owns the connection, sends it, and sends it again after the desktop app restarts.
- **On Connection Changed** always fires on the game thread: the plugin moves it there with `AsyncTask(ENamedThreads::GameThread, ...)`.
- Shutting down (leaving PIE, quitting) closes the connection within milliseconds; the activity ends with it.

## Notes for maintainers

`Source/SubspaceRichPresence/Private/ThirdParty/` holds byte-identical copies of the C++ SDK:

| Plugin file | Must match |
| --- | --- |
| `Private/ThirdParty/subspace/rich_presence.h` | `sdk/cpp/include/subspace/rich_presence.h` |
| `Private/ThirdParty/rich_presence.cpp` | `sdk/cpp/src/rich_presence.cpp` |

The SDK source wraps its Windows headers in `Windows/AllowWindowsPlatformTypes.h` / `HideWindowsPlatformTypes.h` when `SUBSPACE_RICH_PRESENCE_UNREAL` is defined, which `SubspaceRichPresence.Build.cs` does; it also links `ws2_32.lib` on Win64.
