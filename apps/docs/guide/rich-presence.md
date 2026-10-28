# Activity status and Rich Presence

Subspace shows what people are playing next to their name: in member lists, Direct Links, the friends list and on their profile. Two things fill it, and both need the **Subspace desktop app**:

- **Game detection.** The desktop app checks every 15 seconds which known games are running on the computer. Nothing else about the processes on the PC leaves the app: the page only ever learns the name of a game from its built-in list (`packages/constants/src/games.json`).
- **Rich Presence.** A game or app reports what the player is doing, such as the map, their party size, or how long the match has run. It talks to the desktop app on the same computer over a local connection.

## Privacy

What someone plays is never stored. It lives in the gateway's memory while they are connected and is gone when they stop playing or sign off.

**User Settings › Activity Privacy** controls it:

| Setting | Who sees it |
| --- | --- |
| Share my activity: off (the default) | Nobody |
| Everyone | Everyone who can see your status: affiliates, members of your beacons, people you share a Direct Link or mesh with |
| Affiliates only | Affiliates |

Going **Invisible** hides it too. Each detected game can be hidden from the list on that page; that choice, and the list of games seen, stay on the computer.

A detected game shows its Steam cover when it is on Steam (its `steam` app id in `games.json`), or a placeholder. When the game's developer has an application on the instance, staff can verify it in **Command Console › Verified Games** (the *Verify games* permission), and the application's icon shows instead. Images in Rich Presence and game covers are loaded through the instance's media proxy, so the people who see them never connect to the game's servers. Viewers only show images from the instance itself.

## Rich Presence for developers

Games and apps report Rich Presence through the desktop app with an SDK for JavaScript, C#, C++, Unity or Unreal Engine, or over a small local protocol. See [Rich Presence](/developers/rich-presence/) in the developer documentation.

To show your own art for a detected game instead of its Steam cover, ask the instance's staff to verify your application as that game in **Command Console › Verified Games**.
