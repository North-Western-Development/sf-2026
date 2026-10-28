# Subspace Rich Presence for C++

Show what a player is doing in your game ("Competitive · Mirage", "In a match (2 of 5)") on their Subspace Frequency profile, next to their name and in member lists.

The SDK talks to the **Subspace desktop app** on the same computer over its local WebSocket server. The desktop app must be running. Browsers can't do this: the desktop app refuses any connection that sends an `Origin` header, which is also why this SDK has its own small WebSocket client instead of using a library that might add one.

- C++17, one header and one source file, no third-party dependencies.
- Windows (Winsock, links `ws2_32`), Linux and macOS (BSD sockets).
- Never blocks the calling thread. A background thread owns the socket.
- No exceptions or RTTI, so it builds in engines that turn them off.

The protocol is described in [`apps/docs/guide/rich-presence.md`](../../apps/docs/guide/rich-presence.md). This SDK behaves like the JavaScript one in `packages/rich-presence`.

## Install

Download `subspace-rich-presence-cpp-<version>.tar.gz` from https://subspace.click/packages/files/ (each archive has a `.sha256` next to it) and use it with CMake `FetchContent` (`URL` + `URL_HASH`), or copy these two files into your project:

Either add the two files to your build:

```
include/subspace/rich_presence.h
src/rich_presence.cpp
```

(link `ws2_32` on Windows and pthreads on Linux), or use CMake:

```cmake
add_subdirectory(path/to/sdk/cpp)
target_link_libraries(my_game PRIVATE subspace::rich_presence)
```

You need an application id: create an application in Subspace under **User Settings › Developer Applications**. Rich Presence shows the application's name and, unless you send your own art, its icon.

## Example

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

With C++20 you can write `subspace::RichPresence presence({.clientId = "1234567890"});`.

`example/main.cpp` is a complete program: `subspace_rich_presence_example <application id>`.

## API

| | |
| --- | --- |
| `RichPresence(Options)` | Stores the options. Does not connect and does not throw. |
| `bool Start()` | Starts the background thread. `false` if `clientId` is not an application id (digits, no leading zero, at most 19). Calling it again while running does nothing. |
| `void Stop()` | Disconnects and joins the thread, promptly. The destructor calls it. `Start()` works again afterwards. |
| `void SetActivity(const Activity&)` | Stores the activity and wakes the thread, which sends it now if connected, and again after every reconnect. |
| `void ClearActivity()` | Removes it. |
| `bool IsConnected()` | The desktop app has said READY and the connection is open. |
| `uint16_t ConnectedPort()` | The port it answered on, or 0. |
| `SetOnReady`, `SetOnDisconnected`, `SetOnError` | Optional callbacks; see Threading. `OnDisconnected` fires when the desktop app goes away, not when you call `Stop()`. `OnError` gets the reason when the desktop app refuses a command. |

`Options`: `clientId`; `reconnect` (default `true`: retry every 15 s while the desktop app is closed); `ports` (default 6473 to 6482, tried in order); `host` (`127.0.0.1` or `localhost`); `reconnectDelay` (15 s) and `readyTimeout` (3 s: a port that doesn't say READY in time is skipped).

`Activity` fields are all `std::optional` (plus `buttons`): `type`, `details`, `state` (up to 128 characters each), `startedAt` / `endsAt` (unix ms), `largeImage` / `smallImage` (https URLs), `largeText` / `smallText`, `party {size, max}`, `buttons` (only the first 2 are sent). Strings are UTF-8; invalid bytes are replaced with U+FFFD so the desktop app doesn't drop the frame. The desktop app truncates and drops invalid values; the SDK doesn't refuse anything.

## Threading

- Every public method is thread-safe and returns without waiting for the network.
- One background thread per `RichPresence` owns the socket. It connects, sends the latest activity whenever it changes, answers pings and reconnects.
- **Callbacks run on that background thread.** Keep them short and hand the work to your own thread (a game's main thread, for example). They may call `SetActivity`, `ClearActivity` and `IsConnected`, but must not call `Stop()` or destroy the object.
- `Stop()` and the destructor wake the thread and return within a few milliseconds, even while it waits 15 s before retrying or 3 s for a READY.

## Build and test

```sh
cmake -S sdk/cpp -B build -G Ninja
cmake --build build
ctest --test-dir build      # or run build/subspace_rich_presence_test directly
```

Or without CMake:

```sh
g++ -std=c++17 -Wall -Wextra -Wpedantic -pthread -Isdk/cpp/include \
  sdk/cpp/src/rich_presence.cpp sdk/cpp/tests/rich_presence_test.cpp -o rp_test && ./rp_test
```

On Windows with LLVM: `clang++ ... -lws2_32`. The test runs against a fake desktop app written in C++ (in the test file), so it needs nothing else. It checks the handshake (no Origin, the right query), READY handling, the exact `SET_ACTIVITY` / `CLEAR_ACTIVITY` JSON and escaping, fragmented and long frames, pings, refused commands, reconnecting after the desktop app restarts (the activity is sent again), skipping a port that never says READY, and how quickly it shuts down.

The Unreal plugin in `sdk/unreal` ships a copy of `include/subspace/rich_presence.h` and `src/rich_presence.cpp`. Keep the copies identical when changing either.
