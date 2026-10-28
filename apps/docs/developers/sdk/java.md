# Java bots

`click.subspace:subspace-bot` covers the REST API, the gateway, slash commands and interactions (over the gateway or signed HTTP). It uses only the JDK: `java.net.http` for HTTP and WebSocket, and the JDK's Ed25519. Source: `sdk/bot/java`.

| | |
| --- | --- |
| Coordinates | `click.subspace:subspace-bot:0.1.0` |
| Java | 17+ |
| Depends on | Nothing outside the JDK |

## Install

Add the [package registry](/developers/registry) as a repository.

Maven:

```xml
<repositories>
  <repository>
    <id>subspace</id>
    <url>https://subspace.click/packages/maven/</url>
  </repository>
</repositories>

<dependencies>
  <dependency>
    <groupId>click.subspace</groupId>
    <artifactId>subspace-bot</artifactId>
    <version>0.1.0</version>
  </dependency>
</dependencies>
```

Gradle (Kotlin DSL):

```kotlin
repositories {
    mavenCentral()
    maven { url = uri("https://subspace.click/packages/maven/") }
}
dependencies {
    implementation("click.subspace:subspace-bot:0.1.0")
}
```

## Quick start

```java
import click.subspace.bot.*;
import java.util.List;

public class DiceBot {
    public static void main(String[] args) {
        SubspaceBot bot = new SubspaceBot(System.getenv("BOT_TOKEN"), "https://subspace.click");

        bot.registerCommands(List.of(
            Command.of("ping", "Check the bot is alive"),
            Command.of("roll", "Roll a die").option(Command.Option.integer("sides", "How many sides"))
        )).join();

        bot.onInteraction(i -> {
            if (i.commandName().equals("ping")) i.reply("Pong!");
            if (i.commandName().equals("roll")) {
                long sides = i.optionLong("sides") != null ? i.optionLong("sides") : 6;
                i.reply(Reply.create().embed(Embed.create().title("🎲 " + (1 + (long) (Math.random() * sides))).footer("d" + sides)));
            }
        });

        bot.connect().join();   // returns at READY; reconnects on its own after that
        bot.closed().join();    // keep the program running until bot.disconnect()
    }
}
```

A runnable version is `sdk/bot/java/examples/DiceBot.java`.

## API

Everything that talks to the server returns a `CompletableFuture`.

### `SubspaceBot`

Constructors: `(token, baseUrl)`, `(token, baseUrl, gatewayUrl)` (`null` for the default), and `(token, baseUrl, gatewayUrl, HttpClient)`. REST calls time out after 30 seconds.

| Method | Calls |
| --- | --- |
| `connect()` | Opens the gateway; completes at `READY` |
| `closed()` | Completes when the bot is disconnected for good |
| `disconnect()`, `close()` | Closes the gateway and stops reconnecting (`SubspaceBot` is `AutoCloseable`) |
| `me()`, `user()` | `GET /bots/@me`; the last result |
| `send(channelType, channelId, message)` | Posts a transmission (`"relay"` or `"thread"`); `message` is a `String`, a `Reply` (content and `replyTo`) or a `Map` |
| `edit(id, content)`, `delete(id)`, `react(id, emoji)` | Edit, delete, react |
| `registerCommands(commands[, beaconId])` | Replaces the global commands, or one beacon's |
| `rest(method, path, body[, asBot])` | Any other [REST](/developers/rest) call; returns a `Map`, a `List`, or `null` for `204` |

A failed call completes exceptionally with `SubspaceApiError` (status and code).

### Events

Register as many handlers as you like:

| Method | Handler gets |
| --- | --- |
| `onReady` | The `READY` payload |
| `onMessage`, `onMessageUpdate` | A `Message`: `id()`, `channelType()`, `channelId()`, `content()`, `author()`, `authorId()`, `authorUsername()`, `mentions()`, `createdAt()`, `raw()` |
| `onMessageDelete` | The `TRANSMISSION_DELETE` payload |
| `onInteraction` | An `Interaction` |
| `onDispatch` | `(type, data)` for every [gateway event](/developers/events) |
| `onClose` | `(code, reason)` |
| `onError` | A `Throwable` |

### Interaction

| Method | |
| --- | --- |
| `id()`, `token()`, `commandName()`, `user()`, `channel()`, `beaconId()`, `applicationId()`, `raw()` | From the [interaction](/developers/commands#receiving-interactions) |
| `option(name)`, `optionString`, `optionLong`, `optionBoolean` | Option values (`null` when not given) |
| `reply(String \| Reply)` | Answer now |
| `defer()`, `defer(Boolean ephemeral)` | "Thinking…" |
| `followUp(…)`, `editReply(…)` | Another reply; edit the reply |

### Builders

| Builder | |
| --- | --- |
| `Command.of(name, description)` | `.option(…)`, `.defaultMemberPermissions(bits)` |
| `Command.Option.string / integer / number / bool / user / relay / clearance(name, description)` | `.required(boolean)`, `.choice(name, value)` |
| `Reply.of(content)`, `Reply.create()` | `.content(…)`, `.embed(…)`, `.ephemeral(boolean)`, `.replyTo(transmissionId)` |
| `Embed.create()` | `.title`, `.description`, `.url`, `.color(int)` or `.color("#RRGGBB")`, `.timestamp(iso)`, `.author(name, url)`, `.footer(text)`, `.image(url)`, `.thumbnail(url)`, `.field(name, value, inline)` |

`ephemeral` and embeds only take effect in interaction replies, not in `send()`.

## HTTP interactions

`Interactions` has the helpers for an **Interactions Endpoint URL**:

```java
// rawBody: the request body exactly as received
if (!Interactions.verifyInteraction(rawBody, signatureHeader, timestampHeader, publicKeyHex)) {
    // answer 401
}
String json = Json.write(Interactions.respondWith("Hello!"));   // the response body, as application/json
```

| Method | |
| --- | --- |
| `verifyInteraction(String \| byte[] rawBody, signature, timestamp, publicKeyHex)` | Rejects timestamps more than 5 minutes (`MAX_AGE_SECONDS`) off |
| `respondWith(String \| Object)` | `{ type: 4, data }` |
| `deferWith()`, `deferWith(Boolean ephemeral)` | `{ type: 5, data }` |

## Threading

- Your handlers run one at a time, in order, on a single daemon thread (`subspace-bot-events`), never on the socket's thread. A slow handler delays the next event but not heartbeats, so blocking calls such as `.join()` are safe there.
- Heartbeats and reconnects run on another daemon thread (`subspace-bot-timers`).
- Because both threads are daemons, keep `main` alive, for example with `bot.closed().join()`.
- After a disconnect it reconnects after 2 seconds, unless you disconnected or the close code was `4003` (bad token). There is no resume.
- If the gateway can't be reached, `connect()` keeps retrying and doesn't complete until it connects.
