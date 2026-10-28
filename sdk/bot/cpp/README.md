# Subspace Frequency bot SDK for C++

A C++17 library for Subspace Frequency bots: REST calls as `Authorization: Bot <token>`, the gateway (events over a WebSocket), slash commands and their interactions, and checking the signature on interactions delivered to an HTTP endpoint. It mirrors the JavaScript SDK in [`packages/bot-sdk`](../../../packages/bot-sdk); the API is described in [`apps/docs/guide/bots.md`](../../../apps/docs/guide/bots.md).

CMake target: **`subspace::bot`** (a static library). Header: `<subspace/bot.h>`.

## Dependencies

| | Why |
| --- | --- |
| **libcurl** 7.86+, built with WebSockets | HTTPS for REST, and `wss://` for the gateway through libcurl's WebSocket API (`curl_ws_send` / `curl_ws_recv`). One library for both, with the platform's TLS. WebSockets are on by default from curl 8.11. |
| **OpenSSL** 1.1.1+ (libcrypto) | Ed25519 verification for `verify_interaction`. curl usually links it already. |
| **nlohmann/json** 3.9+ | JSON (header-only). Fetched automatically when not installed (`SUBSPACE_BOT_FETCH_JSON`, on by default). |

```sh
# Debian / Ubuntu
sudo apt-get install -y cmake g++ libcurl4-openssl-dev libssl-dev nlohmann-json3-dev
# macOS
brew install cmake curl openssl nlohmann-json
# Windows (vcpkg; this folder has a vcpkg.json manifest)
vcpkg install curl[websockets] openssl nlohmann-json
```

## Install with CMake FetchContent

Download the source release (`subspace-bot-cpp-0.1.0.tar.gz`) from wherever your Subspace instance publishes it, or point at a copy you host:

```cmake
include(FetchContent)
FetchContent_Declare(subspace_bot
  URL https://subspace.click/packages/files/subspace-bot-cpp-0.1.0.tar.gz   # or a local path
  URL_HASH SHA256=<sha256>   # https://subspace.click/packages/files/subspace-bot-cpp-0.1.0.tar.gz.sha256
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(subspace_bot)

add_executable(my_bot main.cpp)
target_link_libraries(my_bot PRIVATE subspace::bot)
```

The example and tests are not built when the SDK is a subproject. `add_subdirectory(path/to/sdk/bot/cpp)` works the same way. A top-level build also installs a CMake package (`find_package(subspace_bot)`).

## Quick start: a slash-command bot

```cpp
#include <subspace/bot.h>

int main() {
  subspace::Bot bot({std::getenv("SUBSPACE_BOT_TOKEN"), "https://subspace.click"});

  subspace::CommandOption sides{"integer", "sides", "How many sides"};
  bot.register_commands({{"ping", "Check the bot is alive"}, {"roll", "Roll a die", {sides}}});

  bot.on_interaction([](subspace::Interaction& i) {
    if (i.command_name() == "ping") i.reply("Pong!");
    if (i.command_name() == "roll") {
      int n = i.option_or("sides", 6);
      subspace::Reply reply;
      reply.embeds.push_back({{"title", "Rolled " + std::to_string(1 + std::rand() % n)}, {"footer", {{"text", "d" + std::to_string(n)}}}});
      i.reply(reply);
    }
  });

  bot.connect();  // returns on READY; throws subspace::ApiError for a bad token
  bot.wait();     // until bot.disconnect()
}
```

Answer within 3 seconds. For slow work call `i.defer()` first, then `i.follow_up("…")` within 15 minutes; `i.edit_reply(…)` changes the first answer. `reply.ephemeral = true` shows it only to the person who used the command.

## Quick start: a message-listening bot

```cpp
bot.on_message([&](const subspace::Message& m) {
  if (m.content == "!hello" && m.author.id != bot.user()->id)
    bot.send(m.channel_type, m.channel_id, "Hi " + m.author.username + "!", /*reply_to_id=*/m.id);
});
bot.connect();
bot.wait();
```

Without the **Message Content Intent**, a bot sees message text only in messages that mention it and in its own.

## Interactions over HTTP

With an **Interactions Endpoint URL** set, check each request and answer in the response body (your HTTP server of choice):

```cpp
if (!subspace::verify_interaction(raw_body, header("X-Signature-Ed25519"), header("X-Signature-Timestamp"), public_key_hex))
  return respond(401);
auto interaction = subspace::json::parse(raw_body);
return respond(200, subspace::respond_with("Hello " + interaction["user"]["username"].get<std::string>()).dump());
```

`subspace::defer_with()` defers instead; `subspace::Interaction(bot, interaction).follow_up(...)` sends the answer later.

## API

| `subspace::Bot` | |
| --- | --- |
| `rest(method, path, body = nullptr, as_bot = true)` | Any `/api/v1` call. Returns the JSON (null for 204), throws `ApiError` (`status()`, `code()`). |
| `me()`, `user()` | `GET /bots/@me`; the bot it returned. |
| `send(channel_type, channel_id, content, reply_to_id = "")` | Post in a relay or thread; returns the `Message`. |
| `edit(id, content)`, `delete_message(id)`, `react(id, emoji)` | Manage transmissions. |
| `register_commands(commands, beacon_id = "")` | Replace the commands (a `std::vector<CommandDefinition>` or JSON). Returns the stored ones. |
| `connect()`, `disconnect()`, `wait()`, `connected()` | The gateway. `connect()` returns on READY; afterwards the bot reconnects by itself until `disconnect()`. |
| `on_ready`, `on_message`, `on_message_update`, `on_message_delete`, `on_interaction`, `on_dispatch`, `on_disconnect`, `on_error` | Events (JS: `ready`, `message`, `messageUpdate`, `messageDelete`, `interaction`, `dispatch`, `close`, `error`). |

Handlers run one at a time on the bot's gateway thread; set them before `connect()`. REST calls work from any thread, including inside handlers. An exception in a handler goes to `on_error`.

Free functions: `verify_interaction(raw_body, signature_hex, timestamp, public_key_hex, now = clock)`, `respond_with(reply)`, `defer_with(ephemeral)`.

## Example

[`example/dice_bot.cpp`](example/dice_bot.cpp) registers `/ping` and `/roll` and answers `!hello`:

```sh
SUBSPACE_BOT_TOKEN=... SUBSPACE_BASE_URL=https://subspace.click ./build/subspace_bot_example
SUBSPACE_BOT_TOKEN=... SUBSPACE_RELAY_ID=... ./build/subspace_bot_example --once   # connect, post once, exit
```

`SUBSPACE_GATEWAY_URL` overrides the gateway address when it is not `<base>/gateway`. `BotOptions::ca_info` sets a CA bundle if libcurl cannot find one.

## Building and testing

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure     # 14 tests against an in-process fake instance (HTTP + WebSocket)
```

On Windows with vcpkg: `cmake -S . -B build -DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake`, then `cmake --build build --config Release` and `ctest --test-dir build -C Release`.

The source release is made with `sh package.sh` (writes `dist/subspace-bot-cpp-0.1.0.tar.gz` and prints its SHA-256).

## Notes

- The tests use a plain `ws://` / `http://` fake server; TLS is libcurl's.
