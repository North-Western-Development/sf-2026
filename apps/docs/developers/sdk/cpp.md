# C++ bots

The C++ bot SDK covers the REST API, the gateway, slash commands and interactions (over the gateway or signed HTTP). Its calls block; the gateway runs on a thread of its own. Source: `sdk/bot/cpp`.

| | |
| --- | --- |
| Archive | `subspace-bot-cpp-0.1.0.tar.gz` |
| CMake target | `subspace::bot` (header `<subspace/bot.h>`) |
| Language | C++17, CMake 3.16+ |
| Depends on | libcurl 7.86+ **built with WebSocket support**, OpenSSL 1.1.1+ (Crypto), nlohmann/json 3.9+ (fetched if missing) |

## Install

Install the dependencies:

| | |
| --- | --- |
| Debian, Ubuntu | `apt install libcurl4-openssl-dev libssl-dev nlohmann-json3-dev` |
| macOS | `brew install curl openssl nlohmann-json` |
| Windows (vcpkg) | `vcpkg install curl[websockets] openssl nlohmann-json` |

Then fetch the SDK from the [package registry](/developers/registry) with CMake, pinned by its hash (from `subspace-bot-cpp-0.1.0.tar.gz.sha256` next to it):

```cmake
include(FetchContent)
FetchContent_Declare(subspace_bot
  URL      https://subspace.click/packages/files/subspace-bot-cpp-0.1.0.tar.gz
  URL_HASH SHA256=<sha256 of the archive>
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(subspace_bot)

add_executable(my_bot main.cpp)
target_link_libraries(my_bot PRIVATE subspace::bot)
```

`add_subdirectory(path/to/sdk/bot/cpp)` works the same way, and a top-level build installs a CMake package (`find_package(subspace_bot)`). `connect()` checks at run time that your libcurl supports `wss://`, and throws if not.

## Quick start

```cpp
#include <cstdlib>
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

A full program is `sdk/bot/cpp/example/dice_bot.cpp`.

## API

Everything is in namespace `subspace`; `json` is `nlohmann::json`.

### `BotOptions`

| Field | Default |
| --- | --- |
| `token` | Required; the bot token without `Bot ` |
| `base_url` | Required |
| `gateway_url` | Empty: `base_url` with `ws(s)://` and `/gateway` |
| `auto_reconnect` | `true` |
| `reconnect_delay` | 2000 ms |
| `request_timeout` | 30000 ms per REST call |
| `ca_info` | A CA bundle file for HTTPS (`CURLOPT_CAINFO`); empty uses libcurl's default |

### `Bot`

| Method | Calls |
| --- | --- |
| `connect()` | Calls `me()`, starts the gateway thread, and blocks until `READY` |
| `wait()` | Blocks until the gateway thread ends |
| `disconnect()` | Closes the connection; the destructor does it too |
| `connected()`, `gateway_url()` | State |
| `me()`, `user()` | `GET /bots/@me`; the last result |
| `send(channel_type, channel_id, content, reply_to_id = "")` | Posts a transmission (`"relay"` or `"thread"`); returns a `Message` |
| `edit(id, content)`, `delete_message(id)`, `react(id, emoji)` | Edit, delete, react |
| `register_commands(commands, beacon_id = "")` | Replaces the global commands, or one beacon's. Takes `std::vector<CommandDefinition>` or `json`. |
| `rest(method, path, body = nullptr, as_bot = true)` | Any other [REST](/developers/rest) call; returns `json` |

A failed call throws `ApiError` (`status()`, `code()`), or `std::runtime_error` for a network failure. Path segments are URL-encoded for you.

### Handlers

Each setter **replaces** the previous handler for that event:

| Setter | Handler gets |
| --- | --- |
| `on_ready` | `const json&`: the `READY` payload |
| `on_message`, `on_message_update` | `const Message&`: `id`, `channel_type`, `channel_id`, `author`, `content`, … |
| `on_message_delete` | `const json&` |
| `on_interaction` | `Interaction&` |
| `on_dispatch` | `(const std::string& type, const json& data)` for every [gateway event](/developers/events) |
| `on_disconnect` | `(int code, const std::string& reason)` |
| `on_error` | `const std::string&` |

### `Interaction`

| Method | |
| --- | --- |
| `id()`, `token()`, `command_name()`, `beacon_id()`, `channel_type()`, `channel_id()`, `user()`, `raw()` | From the [interaction](/developers/commands#receiving-interactions) |
| `option(name)` | `json` (`null` when not given) |
| `option_or<T>(name, fallback)` | A typed value |
| `reply(const Reply&)` | Answer now. `Reply` has `content`, `embeds` (`json` array) and `ephemeral`, and converts from a string. |
| `defer(bool ephemeral = false)` | "Thinking…" |
| `follow_up(const Reply&)`, `edit_reply(const Reply&)` | Another reply; edit the reply |

`CommandOption{type, name, description, required, choices}` and `CommandDefinition(name, description, options = {}, default_member_permissions = "")` describe commands.

## HTTP interactions

With an **Interactions Endpoint URL**, check each request in your HTTP server and answer in the response body:

```cpp
if (!subspace::verify_interaction(raw_body, header("X-Signature-Ed25519"), header("X-Signature-Timestamp"), public_key_hex))
  return respond(401);
auto interaction = subspace::json::parse(raw_body);
return respond(200, subspace::respond_with("Hello " + interaction["user"]["username"].get<std::string>()).dump());
```

| Function | |
| --- | --- |
| `verify_interaction(raw_body, signature_hex, timestamp, public_key_hex, now_unix_seconds = std::nullopt)` | Rejects timestamps more than 5 minutes off |
| `respond_with(const Reply&)` | `json`: `{ type: 4, data }` |
| `defer_with(bool ephemeral = false)` | `json`: `{ type: 5, data }` |

## Threading

- One gateway thread does everything: reading the socket, heartbeats, reconnecting, and calling **all your handlers, one at a time**.
- Keep handlers short. While one runs, the thread neither reads nor sends heartbeats, and a REST call made from a handler can block for up to `request_timeout`. The server drops a connection that stays silent for about 30 to 60 seconds, so hand slow work to another thread (and answer interactions with `defer()` first).
- `connect()` throws if the first connection fails before `READY` (no retry), and `ApiError` (401, `INVALID_BOT_TOKEN`) on close code `4003`. After `READY`, a dropped connection reconnects after `reconnect_delay` while `auto_reconnect` is on. There is no resume.
- libcurl answers WebSocket pings on its own.
