# subspace-bot (Java)

Build bots for Subspace Frequency in Java: the REST API, the real-time gateway, slash commands and interactions. Java 17+, **no dependencies**: it uses `java.net.http` (HttpClient and WebSocket), the JDK's Ed25519, and a small built-in JSON reader/writer. It mirrors the JavaScript SDK (`@subspace/bot-sdk`): same events, same payloads.

## Install

From the Subspace package registry, a plain Maven repository at `https://subspace.click/packages/maven/`.

Maven:

```xml
<repositories>
  <repository>
    <id>subspace</id>
    <url>https://subspace.click/packages/maven/</url>
  </repository>
</repositories>

<dependency>
  <groupId>click.subspace</groupId>
  <artifactId>subspace-bot</artifactId>
  <version>0.1.0</version>
</dependency>
```

Gradle:

```kotlin
repositories { maven { url = uri("https://subspace.click/packages/maven/") } }
dependencies { implementation("click.subspace:subspace-bot:0.1.0") }
```

Or put `subspace-bot-0.1.0.jar` on the classpath.

## A slash-command bot

```java
import click.subspace.bot.*;
import java.util.List;

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
```

Slow answers: `i.defer()` within 3 seconds, then `i.followUp("...")` within 15 minutes. `i.editReply(...)` changes the reply.

## A bot that listens to messages

```java
bot.onMessage(m -> {
    if (m.content().equals("!hello")) bot.send(m.channelType(), m.channelId(), "Hi " + m.authorUsername() + "!");
});
```

Without the **Message Content** intent a bot sees message text only where it is mentioned (and in its own messages); other messages arrive with empty `content()`.

## API

Every call returns a `CompletableFuture`; `join()` it in blocking code. Failures are `SubspaceApiError` (`status()`, `code()`), wrapped in `CompletionException` by `join()`.

| | |
| --- | --- |
| `new SubspaceBot(token, baseUrl[, gatewayUrl[, httpClient]])` | `gatewayUrl` defaults to `<baseUrl>/gateway` (ws/wss). |
| `me()`, `user()` | `{id, username, appId, beaconIds}`. |
| `send(channelType, channelId, String \| Reply \| Map)` | `"relay"` or `"thread"`. `Reply` has `content`, `embed`, `replyTo`. Resolves to the transmission. |
| `edit(id, content)`, `delete(id)`, `react(id, emoji)` | |
| `registerCommands(List<Command \| Map>[, beaconId])` | Replaces the list (global, or one beacon); resolves to them with ids. |
| `rest(method, path, body[, asBot])` | Any other endpoint under `/api/v1`; resolves to parsed JSON (`Map`/`List`/…), null for 204. |
| `connect()`, `disconnect()`, `closed()`, `close()` | `close()` (AutoCloseable) disconnects and stops the bot's threads. |
| `Interaction` | `id()`, `commandName()`, `user()`, `channel()`, `beaconId()`, `option(name)`, `optionString/optionLong/optionBoolean`, `raw()`; `reply`, `defer([ephemeral])`, `followUp`, `editReply`. |
| `Interactions` | `verifyInteraction(rawBody, signature, timestamp, publicKeyHex)`, `respondWith(...)`, `deferWith([ephemeral])`. |
| `Json` | `parse`, `parseObject`, `write`, plus `obj/list/str/num` helpers for reading payloads. |

Events, with the JavaScript SDK's names: `onReady` (ready), `onMessage` (message, a `Message`), `onMessageUpdate`, `onMessageDelete`, `onInteraction`, `onDispatch` (type, data for every gateway event), `onClose` (code, reason), `onError`. Handlers run one at a time, in order, on the bot's event thread (not the socket's), so they may block on `join()`. An exception in a handler goes to `onError` (or `java.util.logging`, logger `click.subspace.bot`). The bot's threads are daemon threads, so keep `main` alive with `closed().join()`.

## Interactions over HTTP

Set the app's **Interactions Endpoint URL** and answer in the response body. Check every request first, using the raw body:

```java
import com.sun.net.httpserver.HttpServer;

server.createContext("/interactions", ex -> {
    byte[] raw = ex.getRequestBody().readAllBytes();
    var h = ex.getRequestHeaders();
    if (!Interactions.verifyInteraction(raw, h.getFirst("X-Signature-Ed25519"), h.getFirst("X-Signature-Timestamp"), PUBLIC_KEY_HEX)) {
        ex.sendResponseHeaders(401, -1);
        return;
    }
    var interaction = Json.parseObject(new String(raw, java.nio.charset.StandardCharsets.UTF_8));
    byte[] out = Json.write(Interactions.respondWith("Hello " + Json.str(Json.obj(interaction, "user"), "username"))).getBytes();
    ex.getResponseHeaders().set("Content-Type", "application/json");
    ex.sendResponseHeaders(200, out.length);
    ex.getResponseBody().write(out);
    ex.close();
});
```

`Interactions.deferWith()` defers instead. Requests more than five minutes old are refused.

## Build

With Maven: `mvn verify` (compiles for Java 17, runs the built-in test runner, attaches a sources jar).

Without Maven, with only a JDK:

```bash
JAVA_HOME=/path/to/jdk ./build.sh
```

It compiles with `--release 17`, runs the tests, and writes `target/subspace-bot-0.1.0.jar`, `-sources.jar`, `-javadoc.jar`, `.pom`, plus `target/repo/` — the same files in a static Maven repository layout (`click/subspace/subspace-bot/0.1.0/…` with `.sha1`/`.md5` and `maven-metadata.xml`) ready to upload.

Windows note: if `HttpClient` fails with "Unable to establish loopback connection", the JDK cannot create its AF_UNIX selector socket in `%TEMP%` (an 8.3 short path, or one with spaces). Run with `-Djdk.net.unixdomain.tmpdir=C:\some\plain\dir`. `build.sh` does this for the tests.

The full guide (webhooks, intents, command rules, embeds): `apps/docs/guide/bots.md` in the Subspace repository.

## License

The Subspace Frequency repository has no LICENSE file, so no license is granted yet; the pom declares none.
