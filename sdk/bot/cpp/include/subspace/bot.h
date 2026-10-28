// Subspace Frequency bot SDK for C++17.
//
//   subspace::Bot bot({"<bot token>", "https://subspace.click"});
//   bot.register_commands({{"ping", "Check the bot is alive"}});
//   bot.on_interaction([](subspace::Interaction& i) { i.reply("Pong!"); });
//   bot.on_message([&](const subspace::Message& m) {
//     if (m.content == "!hello") bot.send(m.channel_type, m.channel_id, "Hi!");
//   });
//   bot.connect();  // returns on READY; events then arrive on the gateway thread
//   bot.wait();     // until disconnect()
//
// REST goes through libcurl (HTTP/HTTPS), the gateway through libcurl's WebSocket API, and
// interaction signatures are checked with OpenSSL's Ed25519.
#pragma once

#include <chrono>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace subspace {

using json = nlohmann::json;

/// A REST call the server refused (or a gateway refusal: 401 INVALID_BOT_TOKEN).
class ApiError : public std::runtime_error {
 public:
  ApiError(const std::string& message, int status, std::string code = "")
      : std::runtime_error(message), status_(status), code_(std::move(code)) {}
  /// The HTTP status.
  int status() const { return status_; }
  /// The server's error code, such as "BOT_FORBIDDEN" or "UNKNOWN_INTERACTION"; empty if none.
  const std::string& code() const { return code_; }

 private:
  int status_;
  std::string code_;
};

struct BotOptions {
  /// The bot token (without the "Bot " prefix).
  std::string token;
  /// The instance, e.g. https://subspace.click.
  std::string base_url;
  /// The gateway's WebSocket URL; by default <base_url>/gateway with ws(s).
  std::string gateway_url;
  /// Reconnect when the gateway connection drops.
  bool auto_reconnect = true;
  /// How long to wait before reconnecting.
  std::chrono::milliseconds reconnect_delay{2000};
  /// How long one REST call may take.
  std::chrono::milliseconds request_timeout{30000};
  /// A CA bundle file for HTTPS/WSS (CURLOPT_CAINFO); empty uses libcurl's default.
  std::string ca_info;
};

/// The bot account.
struct BotUser {
  std::string id;
  std::string username;
  std::string app_id;
  std::vector<std::string> beacon_ids;
};

/// Who wrote a message.
struct MessageAuthor {
  std::string id;
  std::string username;
  std::string display_name;  // empty when unset
  std::string bot_kind;      // "bot", "webhook" or empty
};

/// A message (a transmission).
struct Message {
  std::string id;
  std::string channel_type;  // "relay", "thread", "link" or "mesh"
  std::string channel_id;
  MessageAuthor author;
  /// Empty when the bot lacks the Message Content intent and was not mentioned.
  std::string content;
  std::vector<std::string> mentions;
  std::string created_at;
  /// The whole transmission as the server sent it.
  json raw;

  static Message from_json(const json& transmission);
};

/// An answer to an interaction. A string converts to a plain text reply.
struct Reply {
  Reply() = default;
  Reply(std::string text) : content(std::move(text)) {}  // NOLINT(google-explicit-constructor)
  Reply(const char* text) : content(text) {}             // NOLINT(google-explicit-constructor)

  std::optional<std::string> content;
  /// Up to 10 embeds, e.g. {{"title", "Dice"}, {"color", 0x3b8ef2}, {"footer", {{"text", "d6"}}}}.
  json embeds = json::array();
  /// Only the person who used the command sees it.
  std::optional<bool> ephemeral;

  json to_json() const;
};

/// An option of a slash command. type: string, integer, number, boolean, user, relay or clearance.
struct CommandOption {
  std::string type;
  std::string name;
  std::string description;
  bool required = false;
  /// [{"name": "Minutes", "value": "m"}, ...]; null for none.
  json choices = nullptr;
};

/// A slash command to register.
struct CommandDefinition {
  CommandDefinition() = default;
  CommandDefinition(std::string name_, std::string description_, std::vector<CommandOption> options_ = {},
                    std::string default_member_permissions_ = "")
      : name(std::move(name_)),
        description(std::move(description_)),
        options(std::move(options_)),
        default_member_permissions(std::move(default_member_permissions_)) {}

  std::string name;
  std::string description;
  std::vector<CommandOption> options;
  /// A permission bitfield (decimal string) members need to see and use it; empty for none.
  std::string default_member_permissions;

  json to_json() const;
};

class Bot;

/// A slash command someone used: read its options, then answer within 3 seconds (or defer).
/// The answering calls use the interaction's own token, not the bot token.
class Interaction {
 public:
  Interaction(Bot& bot, json payload);

  const json& raw() const { return payload_; }
  std::string id() const;
  std::string token() const;
  std::string command_name() const;
  std::string beacon_id() const;
  std::string channel_type() const;
  std::string channel_id() const;
  /// {"id", "username", "displayName", "avatarUrl"}.
  const json& user() const;
  /// An option's value, or null when it was not given.
  json option(const std::string& name) const;
  /// An option's value converted to T, or `fallback` when it was not given (or has another type).
  template <typename T>
  T option_or(const std::string& name, T fallback) const {
    json value = option(name);
    if (value.is_null()) return fallback;
    try {
      return value.get<T>();
    } catch (const json::exception&) {
      return fallback;
    }
  }

  /// Answer now.
  void reply(const Reply& reply);
  /// "Thinking…": answer later with follow_up (within 15 minutes).
  void defer(bool ephemeral = false);
  /// Send the answer after deferring, or another message after replying.
  void follow_up(const Reply& reply);
  /// Change the first answer.
  void edit_reply(const Reply& reply);

 private:
  std::string path(const std::string& suffix) const;
  Bot* bot_;
  json payload_;
};

/// A Subspace Frequency bot: the REST API (as "Authorization: Bot <token>") and the gateway.
///
/// Event handlers run on the bot's gateway thread, one at a time; exceptions they throw are
/// passed to on_error. REST calls are safe from any thread, including from handlers.
class Bot {
 public:
  explicit Bot(BotOptions options);
  ~Bot();
  Bot(const Bot&) = delete;
  Bot& operator=(const Bot&) = delete;

  // ---- REST ----

  /// A call to /api/v1<path>. `body` null sends none. `as_bot` false leaves out the bot token (the
  /// interaction endpoints). Returns the response JSON, or null for 204. Throws ApiError.
  json rest(const std::string& method, const std::string& path, const json& body = nullptr, bool as_bot = true);
  /// GET /bots/@me; also remembers the bot (see user()).
  BotUser me();
  /// Who the bot is, once connected or after me().
  std::optional<BotUser> user() const;
  /// Post in a relay or thread the bot can see; returns the transmission.
  Message send(const std::string& channel_type, const std::string& channel_id, const std::string& content,
               const std::string& reply_to_id = "");
  /// Change one of the bot's messages.
  void edit(const std::string& transmission_id, const std::string& content);
  /// Delete a message.
  void delete_message(const std::string& transmission_id);
  /// React with an emoji.
  void react(const std::string& transmission_id, const std::string& emoji);
  /// Replace the bot's commands: everywhere, or in one beacon. Returns the stored commands (with ids).
  json register_commands(const std::vector<CommandDefinition>& commands, const std::string& beacon_id = "");
  /// As above, with the command list as JSON.
  json register_commands(const json& commands, const std::string& beacon_id = "");

  // ---- Gateway ----

  /// Connects and returns on READY. Throws ApiError (401, INVALID_BOT_TOKEN) when the gateway refuses
  /// the token, or std::runtime_error when it cannot be reached. Afterwards it reconnects on its own.
  void connect();
  /// Closes the connection and stops reconnecting. Safe to call from a handler.
  void disconnect();
  /// Blocks until disconnect() (or until the gateway gives up: invalid token, or auto_reconnect off).
  void wait();
  /// Whether the gateway connection is open and identified.
  bool connected() const;
  /// The gateway URL connect() uses.
  std::string gateway_url() const;

  /// Connected (the READY payload).
  void on_ready(std::function<void(const json&)> handler);
  /// A message in a beacon the bot is in.
  void on_message(std::function<void(const Message&)> handler);
  /// A message was edited.
  void on_message_update(std::function<void(const Message&)> handler);
  /// A message was deleted (the TRANSMISSION_DELETE payload).
  void on_message_delete(std::function<void(const json&)> handler);
  /// Someone used one of the bot's commands.
  void on_interaction(std::function<void(Interaction&)> handler);
  /// Every gateway event, as (type, data).
  void on_dispatch(std::function<void(const std::string&, const json&)> handler);
  /// The connection closed: (code, reason). 1006 when it dropped without a close frame.
  void on_disconnect(std::function<void(int, const std::string&)> handler);
  /// Something failed in the background: a handler threw, or reconnecting failed.
  void on_error(std::function<void(const std::string&)> handler);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

/// For HTTP interactions: whether a request really came from Subspace. Pass the raw body, the
/// X-Signature-Ed25519 and X-Signature-Timestamp headers and the application's public key (hex).
/// Requests more than five minutes from `now_unix_seconds` (default: the clock) are rejected.
bool verify_interaction(const std::string& raw_body, const std::string& signature_hex, const std::string& timestamp,
                        const std::string& public_key_hex, std::optional<int64_t> now_unix_seconds = std::nullopt);

/// HTTP interactions: the response body that answers right away (type 4).
json respond_with(const Reply& reply);
/// HTTP interactions: the response body that defers (type 5).
json defer_with(bool ephemeral = false);

/// Ed25519 verification of a raw message (exposed for tests).
bool ed25519_verify(const std::string& public_key, const std::string& message, const std::string& signature);

}  // namespace subspace
