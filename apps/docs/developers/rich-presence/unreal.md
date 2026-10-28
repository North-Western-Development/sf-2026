# Rich Presence for Unreal Engine

The **Subspace Rich Presence** plugin talks to the Subspace desktop app from Blueprints or C++, through a game instance subsystem. It brings its own small WebSocket client (the [C++ SDK](/developers/rich-presence/cpp)) rather than Unreal's WebSockets module. Source: `sdk/unreal/SubspaceRichPresence`.

| | |
| --- | --- |
| Archive | `SubspaceRichPresence-unreal-1.0.0.zip` |
| Engine | Unreal Engine 5 |
| Platforms | Win64, Mac, Linux. Runtime module, no content. Does nothing on a dedicated server. |

## Install

1. Download `SubspaceRichPresence-unreal-1.0.0.zip` from the [package registry](/developers/registry) (`https://subspace.click/packages/files/`) and unzip it into your project's `Plugins/` folder (create it if needed).
2. Regenerate project files and build, or open the project and let the editor build the plugin. Enable **Subspace Rich Presence** under **Edit › Plugins** if it isn't already.
3. In **Project Settings › Plugins › Subspace Rich Presence**, paste your **Application ID** and leave **Enabled** on.

The settings are saved to `Config/DefaultGame.ini`:

```ini
[/Script/SubspaceRichPresence.SubspaceRichPresenceSettings]
ApplicationId=1234567890
bEnabled=True
```

The subsystem starts with the game instance (in Play In Editor too) and stops when it shuts down.

## Blueprints

1. Anywhere you have a world (a Game Instance, Game Mode or Player Controller blueprint): **Get Game Instance Subsystem** with class **Subspace Rich Presence Subsystem**.
2. **Make Subspace Activity**: set Type, Details, State, images, and Party Size / Party Max. For "for 12m", feed **Get Unix Time Ms** into Started At, or pass the struct through **Start Now**.
3. Call **Set Activity** with it, again whenever something changes; only the latest is sent. **Clear Activity** removes it.
4. Optionally bind **On Connection Changed** (`bConnected`) to know when the desktop app connects or goes away, or check **Is Connected**.

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

## API

### `USubspaceRichPresenceSubsystem`

| Member | |
| --- | --- |
| `SetActivity(const FSubspaceActivity&)` | Set [the activity](/developers/rich-presence/#the-activity) |
| `ClearActivity()` | Clear it |
| `IsConnected()` | Whether the desktop app is connected |
| `StartWithApplicationId(const FString&)` | Start, or restart, with an id that isn't in Project Settings. The current activity carries over. |
| `Stop()` | Disconnect |
| `OnConnectionChanged` | Delegate: `(bool bConnected)` |

`USubspaceRichPresenceLibrary` adds `GetUnixTimeMs()` and `StartNow(Activity)`.

### `FSubspaceActivity`

| Field | Notes |
| --- | --- |
| `Type` | `ESubspaceActivityType`: Playing (default), Streaming, Listening, Watching, Competing |
| `Details`, `State` | Empty: not shown |
| `StartedAt`, `EndsAt` | `int64` Unix ms; 0: not shown. `StartNow()` sets `StartedAt` to now. |
| `LargeImage`, `LargeText`, `SmallImage`, `SmallText` | Empty: not shown |
| `PartySize`, `PartyMax` | Sent when `PartyMax` is above 0. Shown only when `PartySize` is at least 1 and at most `PartyMax`. |
| `Buttons` | `TArray<FSubspaceButton>` (`Label`, `Url`); ones missing either are skipped, and at most 2 are sent |

### Settings

`USubspaceRichPresenceSettings` (**Project Settings › Plugins › Subspace Rich Presence**): **Application ID**, **Enabled** (default on), and under Advanced, **Reconnect** (default on).

## Threading

- **Set Activity**, **Clear Activity** and **Is Connected** never block the game thread: they store the latest activity and wake the SDK's background thread, which owns the connection, sends it, and sends it again after the desktop app restarts.
- **On Connection Changed** always fires on the game thread.
- Shutting down (leaving PIE, quitting) closes the connection within milliseconds; the activity ends with it.
- Errors from the desktop app are logged as warnings.
