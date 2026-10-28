# Rich Presence

Rich Presence lets a game or app show what the player is doing next to their name: the map, their party size, how long the match has run. It works like Discord's: your game talks to the **Subspace desktop app** on the same computer, and the desktop app shares the activity with the people allowed to see it.

What people see, and the privacy settings that control it, are described in [Activity status](/guide/rich-presence).

## How it works

1. Your game connects to the desktop app over a local WebSocket (`ws://127.0.0.1:6473`, or the next free port up to 6482) and sends `SET_ACTIVITY`.
2. The desktop app hands the activity to the Subspace page it shows. The page looks up your application, cleans the activity up, and sends it to the gateway.
3. The gateway passes it on to the people who may see it, at most once every 2 seconds, and drops it when the player signs off or your game disconnects.

Nothing reaches the server unless the player has turned **Share my activity** on.

## Getting started

1. Create an application in **User Settings › Developer Applications** ([Getting started](/developers/)). Its **Application ID** is your `clientId`.
2. Pick an SDK, or speak the [protocol](/developers/rich-presence/protocol) yourself:

| SDK | Package | Runs on |
| --- | --- | --- |
| [JavaScript and TypeScript](/developers/rich-presence/javascript) | `@subspace/rich-presence` (npm) | Node 22+, Deno, Bun, Electron |
| [C# and .NET](/developers/rich-presence/csharp) | `Subspace.RichPresence` (NuGet) | `netstandard2.0`: .NET Framework, .NET 6+, Mono |
| [C++](/developers/rich-presence/cpp) | `subspace-rich-presence-cpp` (archive) | C++17, Windows, macOS, Linux, no dependencies |
| [Unity](/developers/rich-presence/unity) | `com.subspace.rich-presence` (Unity registry) | Unity 2021.3+, desktop builds |
| [Unreal Engine](/developers/rich-presence/unreal) | `SubspaceRichPresence` (plugin archive) | Unreal Engine 5, Win64, Mac, Linux |

All are on the [package registry](/developers/registry). Every SDK finds the desktop app on its own, keeps looking in the background while it is closed, keeps only your latest activity, and sends it again when the desktop app restarts. None of them blocks your game.

Rich Presence shows your application's **name**: you can't set another. Unless you send a `largeImage`, it shows the application's icon.

## The activity

| Field | Notes |
| --- | --- |
| `type` | `playing` (default), `streaming`, `listening`, `watching` or `competing`: the word before the name |
| `details`, `state` | The two lines under the name, up to 128 characters each |
| `startedAt` | Unix time in ms: shows "for 12m" |
| `endsAt` | Unix time in ms: shows a countdown instead ("3:12 left"). Must be after `startedAt`. |
| `largeImage`, `smallImage` | `https://` image URLs, up to 512 characters. The small one sits on the corner of the large one. |
| `largeText`, `smallText` | Hover text for the images, up to 128 characters |
| `party` | `{ size, max }`: shown as "(2 of 5)" after the state. Whole numbers, `size` at least 1, `max` at least `size` and at most 10000. |
| `buttons` | Up to two `{ label, url }` links: labels up to 32 characters, `https://` URLs up to 512 |

Anything invalid is dropped rather than refused, so `SET_ACTIVITY` succeeds either way:

- text is trimmed, control characters are removed, and anything past the limit is cut (lengths count UTF-16 code units);
- an unknown `type` becomes `playing`;
- a `http://` image or button, an image URL with a username or password, or one that is too long is left out;
- `startedAt` and `endsAt` must be within a year of now; `endsAt` is kept only when it is after `startedAt`;
- a third button is left out, as is a `party` that breaks the rules above.

Images are loaded through the instance's media proxy, so the people who see them never connect to your servers. The proxy serves PNG, JPEG, GIF, WebP and AVIF up to 10 MB; anything else shows as a broken image.

Update the activity as often as you like. Others see at most one update every 2 seconds per player, always ending on the latest. When several games on one computer report at once, the most recent report is shown. Rich Presence takes the place of a detected game while it is set.

::: warning The application must exist
The page looks your application up (`GET /api/v1/oauth2/applications/<id>`) to get its name and icon. If the id isn't an application on the player's instance, the activity is ignored, although `SET_ACTIVITY` still answers `ok`.
:::

## Art for a detected game

Without Rich Presence, the desktop app still detects well-known games (`packages/constants/src/games.json`) and shows their Steam cover. To show your own art instead, give your application an icon and ask the instance's staff to verify it as your game: staff with *Verify games* link it in **Command Console › Verified Games**.
