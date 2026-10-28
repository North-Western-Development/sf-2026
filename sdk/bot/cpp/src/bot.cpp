// Subspace Frequency bot SDK for C++17. See include/subspace/bot.h.
#if defined(_WIN32) && !defined(NOMINMAX)
#define NOMINMAX
#endif
#include "subspace/bot.h"

#include <atomic>
#include <condition_variable>
#include <cstring>
#include <ctime>
#include <exception>
#include <mutex>
#include <thread>

#include <curl/curl.h>
#include <openssl/evp.h>

#ifdef _WIN32
#include <winsock2.h>
#else
#include <poll.h>
#endif

namespace subspace {

namespace {

// ---- libcurl -----------------------------------------------------------------------------------

struct CurlGlobal {
  CurlGlobal() { curl_global_init(CURL_GLOBAL_DEFAULT); }
  ~CurlGlobal() { curl_global_cleanup(); }
};

void EnsureCurl() {
  static CurlGlobal global;
  (void)global;
}

struct EasyHandle {
  CURL* handle = curl_easy_init();
  curl_slist* headers = nullptr;
  ~EasyHandle() {
    if (headers) curl_slist_free_all(headers);
    if (handle) curl_easy_cleanup(handle);
  }
};

size_t AppendToString(char* data, size_t size, size_t count, void* user) {
  static_cast<std::string*>(user)->append(data, size * count);
  return size * count;
}

std::string TrimSlash(std::string url) {
  while (!url.empty() && url.back() == '/') url.pop_back();
  return url;
}

std::string Escape(const std::string& text) {
  std::string out;
  static const char* hex = "0123456789ABCDEF";
  for (unsigned char c : text) {
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' ||
        c == '~') {
      out += static_cast<char>(c);
    } else {
      out += '%';
      out += hex[c >> 4];
      out += hex[c & 15];
    }
  }
  return out;
}

std::string StringField(const json& object, const char* name) {
  if (!object.is_object()) return "";
  auto it = object.find(name);
  return it != object.end() && it->is_string() ? it->get<std::string>() : std::string();
}

bool HexToBytes(const std::string& hex, std::string& out) {
  if (hex.size() % 2 != 0) return false;
  out.clear();
  out.reserve(hex.size() / 2);
  auto nibble = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  for (size_t i = 0; i < hex.size(); i += 2) {
    int hi = nibble(hex[i]), lo = nibble(hex[i + 1]);
    if (hi < 0 || lo < 0) return false;
    out += static_cast<char>((hi << 4) | lo);
  }
  return true;
}

bool CurlSupportsWebSockets() {
  const curl_version_info_data* info = curl_version_info(CURLVERSION_NOW);
  if (!info || !info->protocols) return false;
  for (const char* const* p = info->protocols; *p; ++p) {
    if (std::strcmp(*p, "ws") == 0) return true;
  }
  return false;
}

// Waits up to `ms` for the socket to become readable.
void WaitReadable(curl_socket_t socket, int ms) {
#ifdef _WIN32
  fd_set read;
  FD_ZERO(&read);
  FD_SET(socket, &read);
  timeval tv{ms / 1000, (ms % 1000) * 1000};
  select(0, &read, nullptr, nullptr, &tv);
#else
  pollfd fd{socket, POLLIN, 0};
  poll(&fd, 1, ms);
#endif
}

}  // namespace

// ---- Models ------------------------------------------------------------------------------------

Message Message::from_json(const json& transmission) {
  Message m;
  m.raw = transmission;
  m.id = StringField(transmission, "id");
  m.content = StringField(transmission, "content");
  m.created_at = StringField(transmission, "createdAt");
  m.channel_type = StringField(transmission, "channelType");
  m.channel_id = StringField(transmission, "channelId");
  if (transmission.is_object() && transmission.contains("author")) {
    const json& a = transmission["author"];
    m.author.id = StringField(a, "id");
    m.author.username = StringField(a, "username");
    m.author.display_name = StringField(a, "displayName");
    m.author.bot_kind = StringField(a, "botKind");
  }
  if (transmission.is_object() && transmission.contains("mentions") && transmission["mentions"].is_array()) {
    for (const auto& id : transmission["mentions"]) {
      if (id.is_string()) m.mentions.push_back(id.get<std::string>());
    }
  }
  return m;
}

json Reply::to_json() const {
  json out = json::object();
  if (content) out["content"] = *content;
  if (embeds.is_array() && !embeds.empty()) out["embeds"] = embeds;
  if (ephemeral) out["ephemeral"] = *ephemeral;
  return out;
}

json CommandDefinition::to_json() const {
  json out = {{"name", name}, {"description", description}};
  if (!options.empty()) {
    json list = json::array();
    for (const auto& o : options) {
      json option = {{"type", o.type}, {"name", o.name}, {"description", o.description}};
      if (o.required) option["required"] = true;
      if (!o.choices.is_null()) option["choices"] = o.choices;
      list.push_back(option);
    }
    out["options"] = list;
  }
  if (!default_member_permissions.empty()) out["defaultMemberPermissions"] = default_member_permissions;
  return out;
}

json respond_with(const Reply& reply) { return {{"type", 4}, {"data", reply.to_json()}}; }

json defer_with(bool ephemeral) { return {{"type", 5}, {"data", {{"ephemeral", ephemeral}}}}; }

// ---- Ed25519 -----------------------------------------------------------------------------------

namespace {
// Encodings of the small-order points (libsodium's blocklist, sign bit ignored). A public key or
// signature R among them lets one signature pass for any message (OpenSSL accepts them), so both
// are refused.
const unsigned char kSmallOrder[7][32] = {
    {0},
    {1},
    {0x26, 0xe8, 0x95, 0x8f, 0xc2, 0xb2, 0x27, 0xb0, 0x45, 0xc3, 0xf4, 0x89, 0xf2, 0xef, 0x98, 0xf0,
     0xd5, 0xdf, 0xac, 0x05, 0xd3, 0xc6, 0x33, 0x39, 0xb1, 0x38, 0x02, 0x88, 0x6d, 0x53, 0xfc, 0x05},
    {0xc7, 0x17, 0x6a, 0x70, 0x3d, 0x4d, 0xd8, 0x4f, 0xba, 0x3c, 0x0b, 0x76, 0x0d, 0x10, 0x67, 0x0f,
     0x2a, 0x20, 0x53, 0xfa, 0x2c, 0x39, 0xcc, 0xc6, 0x4e, 0xc7, 0xfd, 0x77, 0x92, 0xac, 0x03, 0x7a},
    {0xec, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f},
    {0xed, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f},
    {0xee, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f},
};

bool is_small_order(const unsigned char* point) {
  for (const auto& c : kSmallOrder) {
    bool same = true;
    for (int i = 0; i < 32 && same; ++i) same = (i == 31 ? (point[31] & 0x7f) : point[i]) == c[i];
    if (same) return true;
  }
  return false;
}
}  // namespace

bool ed25519_verify(const std::string& public_key, const std::string& message, const std::string& signature) {
  if (public_key.size() != 32 || signature.size() != 64) return false;
  if (is_small_order(reinterpret_cast<const unsigned char*>(public_key.data())) ||
      is_small_order(reinterpret_cast<const unsigned char*>(signature.data()))) {
    return false;
  }
  EVP_PKEY* key = EVP_PKEY_new_raw_public_key(EVP_PKEY_ED25519, nullptr,
                                              reinterpret_cast<const unsigned char*>(public_key.data()), 32);
  if (!key) return false;
  EVP_MD_CTX* ctx = EVP_MD_CTX_new();
  bool ok = false;
  if (ctx && EVP_DigestVerifyInit(ctx, nullptr, nullptr, nullptr, key) == 1) {
    ok = EVP_DigestVerify(ctx, reinterpret_cast<const unsigned char*>(signature.data()), signature.size(),
                          reinterpret_cast<const unsigned char*>(message.data()), message.size()) == 1;
  }
  EVP_MD_CTX_free(ctx);
  EVP_PKEY_free(key);
  return ok;
}

bool verify_interaction(const std::string& raw_body, const std::string& signature_hex, const std::string& timestamp,
                        const std::string& public_key_hex, std::optional<int64_t> now_unix_seconds) {
  if (signature_hex.empty() || timestamp.empty()) return false;
  double seconds = 0;
  try {
    size_t used = 0;
    seconds = std::stod(timestamp, &used);
    if (used != timestamp.size()) return false;
  } catch (const std::exception&) {
    return false;
  }
  const double now = static_cast<double>(now_unix_seconds ? *now_unix_seconds : static_cast<int64_t>(std::time(nullptr)));
  if (!(seconds == seconds) || (now - seconds > 300) || (seconds - now > 300)) return false;
  std::string key, sig;
  if (!HexToBytes(public_key_hex, key) || !HexToBytes(signature_hex, sig)) return false;
  return ed25519_verify(key, timestamp + raw_body, sig);
}

// ---- Interaction -------------------------------------------------------------------------------

Interaction::Interaction(Bot& bot, json payload) : bot_(&bot), payload_(std::move(payload)) {}

std::string Interaction::id() const { return StringField(payload_, "id"); }
std::string Interaction::token() const { return StringField(payload_, "token"); }
std::string Interaction::beacon_id() const { return StringField(payload_, "beaconId"); }
std::string Interaction::command_name() const {
  return payload_.contains("data") ? StringField(payload_["data"], "name") : std::string();
}
std::string Interaction::channel_type() const {
  return payload_.contains("channel") ? StringField(payload_["channel"], "type") : std::string();
}
std::string Interaction::channel_id() const {
  return payload_.contains("channel") ? StringField(payload_["channel"], "id") : std::string();
}
const json& Interaction::user() const {
  static const json empty = json::object();
  auto it = payload_.find("user");
  return it != payload_.end() ? *it : empty;
}

json Interaction::option(const std::string& name) const {
  auto data = payload_.find("data");
  if (data == payload_.end() || !data->contains("options") || !(*data)["options"].is_array()) return nullptr;
  for (const auto& o : (*data)["options"]) {
    if (StringField(o, "name") == name) return o.contains("value") ? o["value"] : json(nullptr);
  }
  return nullptr;
}

std::string Interaction::path(const std::string& suffix) const {
  return "/interactions/" + Escape(id()) + "/" + Escape(token()) + "/" + suffix;
}

void Interaction::reply(const Reply& r) { bot_->rest("POST", path("callback"), respond_with(r), false); }
void Interaction::defer(bool ephemeral) { bot_->rest("POST", path("callback"), defer_with(ephemeral), false); }
void Interaction::follow_up(const Reply& r) { bot_->rest("POST", path("followup"), r.to_json(), false); }
void Interaction::edit_reply(const Reply& r) { bot_->rest("PATCH", path("original"), r.to_json(), false); }

// ---- Bot ---------------------------------------------------------------------------------------

struct Bot::Impl {
  explicit Impl(Bot& owner, BotOptions o) : bot(owner), options(std::move(o)) {}

  Bot& bot;
  BotOptions options;

  mutable std::mutex user_mutex;
  std::optional<BotUser> user;

  // Handlers (set before connect()).
  std::function<void(const json&)> ready_handler;
  std::function<void(const Message&)> message_handler;
  std::function<void(const Message&)> update_handler;
  std::function<void(const json&)> delete_handler;
  std::function<void(Interaction&)> interaction_handler;
  std::function<void(const std::string&, const json&)> dispatch_handler;
  std::function<void(int, const std::string&)> disconnect_handler;
  std::function<void(const std::string&)> error_handler;

  // Gateway state.
  std::thread thread;
  std::mutex mutex;
  std::condition_variable changed;
  std::atomic<bool> stopping{false};
  std::atomic<bool> identified{false};
  bool running = false;          // the gateway thread is alive
  bool ready_settled = false;    // connect() may return
  std::exception_ptr ready_error;

  void report_error(const std::string& message) {
    if (!error_handler) return;
    try {
      error_handler(message);
    } catch (...) {
      // Nowhere left to report it.
    }
  }

  template <typename F>
  void guarded(F&& f) {
    try {
      f();
    } catch (const std::exception& e) {
      report_error(e.what());
    } catch (...) {
      report_error("unknown exception in a handler");
    }
  }

  void settle(std::exception_ptr error) {
    std::lock_guard<std::mutex> lock(mutex);
    if (ready_settled) return;
    ready_settled = true;
    ready_error = std::move(error);
    changed.notify_all();
  }

  // One WebSocket connection: returns the close code (1006 for a drop) and reason.
  struct Closed {
    int code;
    std::string reason;
  };

  bool send_frame(CURL* curl, const std::string& payload, unsigned int flags) {
    size_t offset = 0;
    for (int attempt = 0; attempt < 1000; ++attempt) {
      size_t sent = 0;
      CURLcode rc = curl_ws_send(curl, payload.data() + offset, payload.size() - offset, &sent, 0, flags);
      offset += sent;
      if (rc == CURLE_OK && offset >= payload.size()) return true;
      if (rc != CURLE_OK && rc != CURLE_AGAIN) return false;
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    return false;
  }

  void handle_text(CURL* curl, const std::string& text, std::chrono::steady_clock::time_point& next_beat,
                   std::chrono::milliseconds& beat_every, bool& reconnect_requested) {
    json frame = json::parse(text, nullptr, false);
    if (frame.is_discarded() || !frame.is_object() || !frame.contains("op") || !frame["op"].is_number_integer()) return;
    const int op = frame["op"].get<int>();
    const json data = frame.contains("d") ? frame["d"] : json(nullptr);
    if (op == 10) {  // HELLO
      int every = 30000;
      if (data.is_object() && data.contains("heartbeat_interval") && data["heartbeat_interval"].is_number()) {
        every = data["heartbeat_interval"].get<int>();
      }
      if (every <= 0) every = 30000;
      beat_every = std::chrono::milliseconds(every);
      next_beat = std::chrono::steady_clock::now() + beat_every;
      json identify = {{"op", 2}, {"d", {{"token", "Bot " + options.token}}}};
      send_frame(curl, identify.dump(), CURLWS_TEXT);
      return;
    }
    if (op == 7) {  // RECONNECT
      reconnect_requested = true;
      return;
    }
    if (op != 0 || !frame.contains("t") || !frame["t"].is_string()) return;
    const std::string type = frame["t"].get<std::string>();
    if (type == "READY") {
      identified = true;
      settle(nullptr);
      if (ready_handler) guarded([&] { ready_handler(data); });
    } else if ((type == "TRANSMISSION_CREATE" || type == "TRANSMISSION_UPDATE") && data.is_object() &&
               data.contains("transmission") && data["transmission"].is_object()) {
      Message m = Message::from_json(data["transmission"]);
      std::string channel_type = StringField(data, "channelType"), channel_id = StringField(data, "channelId");
      if (!channel_type.empty()) m.channel_type = channel_type;
      if (!channel_id.empty()) m.channel_id = channel_id;
      auto& handler = type == "TRANSMISSION_CREATE" ? message_handler : update_handler;
      if (handler) guarded([&] { handler(m); });
    } else if (type == "TRANSMISSION_DELETE") {
      if (delete_handler) guarded([&] { delete_handler(data); });
    } else if (type == "INTERACTION_CREATE") {
      if (interaction_handler) {
        guarded([&] {
          Interaction interaction(bot, data);
          interaction_handler(interaction);
        });
      }
    }
    if (dispatch_handler) guarded([&] { dispatch_handler(type, data); });
  }

  // Runs one connection. `opened` is set once the WebSocket handshake succeeded.
  Closed run_connection(bool& opened, std::string& open_error) {
    opened = false;
    EasyHandle easy;
    CURL* curl = easy.handle;
    if (!curl) {
      open_error = "curl_easy_init failed";
      return {1006, ""};
    }
    const std::string url = bot.gateway_url();
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_CONNECT_ONLY, 2L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 10000L);
    if (!options.ca_info.empty()) curl_easy_setopt(curl, CURLOPT_CAINFO, options.ca_info.c_str());
    CURLcode rc = curl_easy_perform(curl);
    if (rc != CURLE_OK) {
      open_error = std::string("Could not connect to the gateway at ") + url + ": " + curl_easy_strerror(rc);
      return {1006, ""};
    }
    opened = true;
    curl_socket_t socket = CURL_SOCKET_BAD;
    curl_easy_getinfo(curl, CURLINFO_ACTIVESOCKET, &socket);

    auto next_beat = std::chrono::steady_clock::time_point::max();
    std::chrono::milliseconds beat_every{30000};
    bool close_sent = false;
    bool reconnect_requested = false;
    auto close_deadline = std::chrono::steady_clock::time_point::max();
    std::string message, close_payload;
    bool message_is_text = true;
    std::vector<char> buffer(64 * 1024);

    auto send_close = [&](int code) {
      std::string payload;
      payload += static_cast<char>((code >> 8) & 0xFF);
      payload += static_cast<char>(code & 0xFF);
      send_frame(curl, payload, CURLWS_CLOSE);
      close_sent = true;
      close_deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    };

    while (true) {
      if ((stopping || reconnect_requested) && !close_sent) send_close(1000);

      // Read everything available (TLS may hold data the socket no longer signals).
      while (true) {
        size_t received = 0;
        const curl_ws_frame* meta = nullptr;
        rc = curl_ws_recv(curl, buffer.data(), buffer.size(), &received, &meta);
        if (rc == CURLE_AGAIN) break;
        if (rc != CURLE_OK || !meta) {
          identified = false;
          return {close_sent ? 1000 : 1006, ""};
        }
        if (meta->flags & CURLWS_CLOSE) {
          close_payload.append(buffer.data(), received);
          if (meta->bytesleft > 0) continue;
          int code = 1005;
          std::string reason;
          if (close_payload.size() >= 2) {
            code = (static_cast<unsigned char>(close_payload[0]) << 8) | static_cast<unsigned char>(close_payload[1]);
            reason = close_payload.substr(2);
          }
          if (!close_sent) {
            std::string echo = close_payload.substr(0, 2);
            send_frame(curl, echo, CURLWS_CLOSE);
          }
          identified = false;
          return {code, reason};
        }
        if (meta->flags & CURLWS_PING) continue;  // libcurl answers pings itself
        if (message.empty() && meta->offset == 0) message_is_text = (meta->flags & CURLWS_TEXT) != 0;
        message.append(buffer.data(), received);
        if (message.size() > 64u * 1024u * 1024u) {
          report_error("Gateway message too large");
          identified = false;
          return {1009, ""};
        }
        if (meta->bytesleft == 0 && !(meta->flags & CURLWS_CONT)) {
          std::string complete;
          complete.swap(message);
          if (message_is_text && !close_sent) handle_text(curl, complete, next_beat, beat_every, reconnect_requested);
        }
      }

      const auto now = std::chrono::steady_clock::now();
      if (close_sent && now >= close_deadline) {
        identified = false;
        return {1000, ""};
      }
      if (!close_sent && now >= next_beat) {
        send_frame(curl, "{\"op\":1}", CURLWS_TEXT);
        next_beat = now + beat_every;
      }
      int wait_ms = 50;
      if (next_beat != std::chrono::steady_clock::time_point::max() && !close_sent) {
        auto until = std::chrono::duration_cast<std::chrono::milliseconds>(next_beat - now).count();
        if (until < wait_ms) wait_ms = static_cast<int>(until < 1 ? 1 : until);
      }
      if (socket != CURL_SOCKET_BAD) {
        WaitReadable(socket, wait_ms);
      } else {
        std::this_thread::sleep_for(std::chrono::milliseconds(wait_ms));
      }
    }
  }

  void thread_main() {
    bool ever_ready = false;
    while (!stopping) {
      bool opened = false;
      std::string open_error;
      Closed closed = run_connection(opened, open_error);
      {
        std::lock_guard<std::mutex> lock(mutex);
        if (ready_settled && !ready_error) ever_ready = true;
      }
      if (!opened) {
        if (!ever_ready) {
          settle(std::make_exception_ptr(std::runtime_error(open_error)));
          break;
        }
        report_error(open_error);
      } else if (disconnect_handler) {
        guarded([&] { disconnect_handler(closed.code, closed.reason); });
      }
      if (opened && closed.code == 4003) {
        settle(std::make_exception_ptr(ApiError("Invalid bot token", 401, "INVALID_BOT_TOKEN")));
        break;
      }
      if (stopping) break;
      if (!options.auto_reconnect) {
        settle(std::make_exception_ptr(
            std::runtime_error("The gateway closed the connection (" + std::to_string(closed.code) + ")")));
        break;
      }
      std::unique_lock<std::mutex> lock(mutex);
      changed.wait_for(lock, options.reconnect_delay, [&] { return stopping.load(); });
    }
    settle(std::make_exception_ptr(std::runtime_error("Disconnected")));
    std::lock_guard<std::mutex> lock(mutex);
    running = false;
    changed.notify_all();
  }
};

Bot::Bot(BotOptions options) : impl_(new Impl(*this, std::move(options))) {
  if (impl_->options.token.empty()) throw std::invalid_argument("A bot token is required");
  if (impl_->options.base_url.empty()) throw std::invalid_argument("A base URL is required");
  EnsureCurl();
}

Bot::~Bot() {
  disconnect();
  if (impl_->thread.joinable()) {
    if (impl_->thread.get_id() == std::this_thread::get_id()) {
      impl_->thread.detach();
    } else {
      impl_->thread.join();
    }
  }
}

json Bot::rest(const std::string& method, const std::string& path, const json& body, bool as_bot) {
  EasyHandle easy;
  if (!easy.handle) throw std::runtime_error("curl_easy_init failed");
  CURL* curl = easy.handle;
  const std::string url = TrimSlash(impl_->options.base_url) + "/api/v1" + path;
  std::string payload, response;
  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, method.c_str());
  curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
  curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, static_cast<long>(impl_->options.request_timeout.count()));
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, AppendToString);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
  if (!impl_->options.ca_info.empty()) curl_easy_setopt(curl, CURLOPT_CAINFO, impl_->options.ca_info.c_str());
  if (as_bot) easy.headers = curl_slist_append(easy.headers, ("Authorization: Bot " + impl_->options.token).c_str());
  easy.headers = curl_slist_append(easy.headers, "Expect:");
  if (!body.is_null()) {
    payload = body.dump();
    easy.headers = curl_slist_append(easy.headers, "Content-Type: application/json");
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(payload.size()));
  } else if (method == "GET") {
    curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
  }
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, easy.headers);
  CURLcode rc = curl_easy_perform(curl);
  if (rc != CURLE_OK) throw std::runtime_error(std::string("Request to ") + url + " failed: " + curl_easy_strerror(rc));
  long status = 0;
  curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
  if (status == 204) return nullptr;
  json data = response.empty() ? json(nullptr) : json::parse(response, nullptr, false);
  if (data.is_discarded()) data = nullptr;
  if (status < 200 || status >= 300) {
    std::string message = StringField(data, "error");
    if (message.empty()) message = "HTTP " + std::to_string(status);
    throw ApiError(message, static_cast<int>(status), StringField(data, "code"));
  }
  return data;
}

BotUser Bot::me() {
  json data = rest("GET", "/bots/@me");
  if (!data.is_object() || !data.contains("bot") || !data["bot"].is_object()) {
    throw ApiError("Unexpected /bots/@me response", 500);
  }
  const json& b = data["bot"];
  BotUser user;
  user.id = StringField(b, "id");
  user.username = StringField(b, "username");
  user.app_id = StringField(b, "appId");
  if (b.contains("beaconIds") && b["beaconIds"].is_array()) {
    for (const auto& id : b["beaconIds"]) {
      if (id.is_string()) user.beacon_ids.push_back(id.get<std::string>());
    }
  }
  std::lock_guard<std::mutex> lock(impl_->user_mutex);
  impl_->user = user;
  return user;
}

std::optional<BotUser> Bot::user() const {
  std::lock_guard<std::mutex> lock(impl_->user_mutex);
  return impl_->user;
}

Message Bot::send(const std::string& channel_type, const std::string& channel_id, const std::string& content,
                  const std::string& reply_to_id) {
  json body = {{"content", content}};
  if (!reply_to_id.empty()) body["replyToId"] = reply_to_id;
  json data = rest("POST", "/channels/" + Escape(channel_type) + "/" + Escape(channel_id) + "/transmissions", body);
  Message m = Message::from_json(data.is_object() && data.contains("transmission") ? data["transmission"] : json::object());
  if (m.channel_type.empty()) m.channel_type = channel_type;
  if (m.channel_id.empty()) m.channel_id = channel_id;
  return m;
}

void Bot::edit(const std::string& transmission_id, const std::string& content) {
  rest("PATCH", "/transmissions/" + Escape(transmission_id), {{"content", content}});
}

void Bot::delete_message(const std::string& transmission_id) {
  rest("DELETE", "/transmissions/" + Escape(transmission_id));
}

void Bot::react(const std::string& transmission_id, const std::string& emoji) {
  rest("PUT", "/transmissions/" + Escape(transmission_id) + "/reactions/" + Escape(emoji) + "/@me");
}

json Bot::register_commands(const std::vector<CommandDefinition>& commands, const std::string& beacon_id) {
  json list = json::array();
  for (const auto& c : commands) list.push_back(c.to_json());
  return register_commands(list, beacon_id);
}

json Bot::register_commands(const json& commands, const std::string& beacon_id) {
  std::optional<BotUser> known = user();
  const std::string app_id = known ? known->app_id : me().app_id;
  const std::string path = beacon_id.empty()
                               ? "/applications/" + Escape(app_id) + "/commands"
                               : "/applications/" + Escape(app_id) + "/beacons/" + Escape(beacon_id) + "/commands";
  json data = rest("PUT", path, commands);
  return data.is_object() && data.contains("commands") ? data["commands"] : json::array();
}

std::string Bot::gateway_url() const {
  if (!impl_->options.gateway_url.empty()) return impl_->options.gateway_url;
  std::string base = TrimSlash(impl_->options.base_url);
  if (base.rfind("https://", 0) == 0) {
    base = "wss://" + base.substr(8);
  } else if (base.rfind("http://", 0) == 0) {
    base = "ws://" + base.substr(7);
  }
  return base + "/gateway";
}

void Bot::connect() {
  if (!CurlSupportsWebSockets()) {
    throw std::runtime_error("This libcurl was built without WebSocket support (needs curl 7.86+ with ws enabled)");
  }
  if (!user()) me();
  {
    std::unique_lock<std::mutex> lock(impl_->mutex);
    if (impl_->running) throw std::logic_error("Already connected");
  }
  if (impl_->thread.joinable()) impl_->thread.join();
  {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    impl_->stopping = false;
    impl_->ready_settled = false;
    impl_->ready_error = nullptr;
    impl_->running = true;
  }
  impl_->thread = std::thread([this] { impl_->thread_main(); });
  std::unique_lock<std::mutex> lock(impl_->mutex);
  impl_->changed.wait(lock, [&] { return impl_->ready_settled; });
  if (impl_->ready_error) std::rethrow_exception(impl_->ready_error);
}

void Bot::disconnect() {
  std::lock_guard<std::mutex> lock(impl_->mutex);
  impl_->stopping = true;
  impl_->changed.notify_all();
}

void Bot::wait() {
  {
    std::unique_lock<std::mutex> lock(impl_->mutex);
    impl_->changed.wait(lock, [&] { return !impl_->running; });
  }
  if (impl_->thread.joinable() && impl_->thread.get_id() != std::this_thread::get_id()) impl_->thread.join();
}

bool Bot::connected() const { return impl_->identified; }

void Bot::on_ready(std::function<void(const json&)> h) { impl_->ready_handler = std::move(h); }
void Bot::on_message(std::function<void(const Message&)> h) { impl_->message_handler = std::move(h); }
void Bot::on_message_update(std::function<void(const Message&)> h) { impl_->update_handler = std::move(h); }
void Bot::on_message_delete(std::function<void(const json&)> h) { impl_->delete_handler = std::move(h); }
void Bot::on_interaction(std::function<void(Interaction&)> h) { impl_->interaction_handler = std::move(h); }
void Bot::on_dispatch(std::function<void(const std::string&, const json&)> h) { impl_->dispatch_handler = std::move(h); }
void Bot::on_disconnect(std::function<void(int, const std::string&)> h) { impl_->disconnect_handler = std::move(h); }
void Bot::on_error(std::function<void(const std::string&)> h) { impl_->error_handler = std::move(h); }

}  // namespace subspace
