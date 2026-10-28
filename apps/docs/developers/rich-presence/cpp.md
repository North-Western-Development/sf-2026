# Rich Presence for C++

A small C++17 library with no dependencies (no exceptions, no RTTI) that talks to the Subspace desktop app on Windows, macOS and Linux. Source: `sdk/cpp`. The [Unreal plugin](/developers/rich-presence/unreal) is built on it.

| | |
| --- | --- |
| Archive | `subspace-rich-presence-cpp-1.0.0.tar.gz` |
| CMake target | `subspace::rich_presence` (header `subspace/rich_presence.h`) |
| Language | C++17, CMake 3.14+ (or no CMake at all) |
| Links | Threads; `ws2_32` on Windows |

## Install

From the [package registry](/developers/registry), pinned by the hash in `subspace-rich-presence-cpp-1.0.0.tar.gz.sha256`:

```cmake
include(FetchContent)
FetchContent_Declare(subspace_rich_presence
  URL      https://subspace.click/packages/files/subspace-rich-presence-cpp-1.0.0.tar.gz
  URL_HASH SHA256=<sha256 of the archive>)
FetchContent_MakeAvailable(subspace_rich_presence)

target_link_libraries(my_game PRIVATE subspace::rich_presence)
```

Or `add_subdirectory(path/to/sdk/cpp)`, or add its two files to your own build: `include/subspace/rich_presence.h` and `src/rich_presence.cpp` (link `ws2_32` on Windows and pthreads on Linux).

## Quick start

```cpp
#include "subspace/rich_presence.h"

subspace::Options options;
options.clientId = "1234567890";          // your application id
subspace::RichPresence presence(options);  // does not connect yet
presence.Start();                          // returns at once; finds the desktop app in the background

subspace::Activity activity;
activity.type = subspace::ActivityType::Competing;
activity.details = "Competitive \xC2\xB7 Mirage";   // UTF-8
activity.state = "In a match";
activity.startedAt = subspace::UnixTimeMs();         // shows "for 12m"
activity.party = subspace::Party{2, 5};              // "(2 of 5)"
activity.largeImage = "https://cdn.example.com/maps/mirage.png";
activity.largeText = "Mirage";
activity.buttons.push_back({"Watch", "https://example.com/match/123"});
presence.SetActivity(activity);  // call as often as you like; only the latest is sent

presence.ClearActivity();        // later
// The destructor disconnects, and the activity ends with the connection.
```

A full program is `sdk/cpp/example/main.cpp` (`subspace_rich_presence_example <application id>`).

## API

Everything is in namespace `subspace`.

### `Options`

| Field | Default | |
| --- | --- | --- |
| `clientId` | | Your application id |
| `reconnect` | `true` | Keep looking for the desktop app, and reconnect when it restarts |
| `ports` | `DefaultPorts()` (6473 to 6482) | Where to look |
| `host` | `"127.0.0.1"` | |
| `reconnectDelay` | 15000 ms | Between looks |
| `readyTimeout` | 3000 ms | For each port's `READY` |

### `RichPresence`

| Member | |
| --- | --- |
| `explicit RichPresence(Options)` | Doesn't connect yet |
| `bool Start()` | Starts the background thread; returns at once. `false` if `clientId` is invalid. Can be called again after `Stop()`. |
| `void Stop()` | Disconnects and joins the thread; the destructor does it too |
| `void SetActivity(const Activity&)`, `void ClearActivity()` | Never block. Only the latest is sent; it is sent again after a reconnect. |
| `bool IsConnected() const`, `uint16_t ConnectedPort() const` | State |
| `SetOnReady`, `SetOnDisconnected` | `std::function<void()>` |
| `SetOnError` | `std::function<void(const std::string&)>`: the desktop app refused a command |
| `static bool IsValidClientId(const std::string&)` | |

### `Activity`

| Field | Type |
| --- | --- |
| `type` | `std::optional<ActivityType>`: `Playing`, `Streaming`, `Listening`, `Watching`, `Competing` |
| `details`, `state`, `largeImage`, `largeText`, `smallImage`, `smallText` | `std::optional<std::string>`, UTF-8 |
| `startedAt`, `endsAt` | `std::optional<int64_t>`, Unix ms: `UnixTimeMs()` gives now |
| `party` | `std::optional<Party>`: `Party{size, max}` |
| `buttons` | `std::vector<Button>`: `{label, url}`, at most 2 are sent |

See [the activity](/developers/rich-presence/#the-activity) for the rules.

## Threading

- Each `RichPresence` owns one background thread, which holds the socket. Every public method returns at once.
- The callbacks run **on that background thread**. Hand work to your game thread from them, and don't call `Stop()` or destroy the object inside one.
- Ports are tried one after another, each for up to `readyTimeout`. On Windows, closed ports fail fast.
- `Stop()` wakes the thread and joins it within milliseconds, sending a close frame first.
