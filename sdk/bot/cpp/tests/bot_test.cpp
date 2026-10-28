// Tests for the C++ bot SDK, against an in-process fake instance: plain HTTP for /api/v1 and a
// WebSocket gateway on /gateway (HELLO, IDENTIFY with "Bot <token>", READY, then test dispatches).
#if defined(_WIN32) && !defined(NOMINMAX)
#define NOMINMAX
#endif
#include "subspace/bot.h"

#include <openssl/evp.h>
#include <openssl/sha.h>

#include <atomic>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#if defined(_WIN32)
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

using subspace::json;
using Clock = std::chrono::steady_clock;
using std::chrono::milliseconds;

namespace {

int g_failures = 0;
#define CHECK(cond)                                                                   \
  do {                                                                                \
    if (!(cond)) {                                                                    \
      ++g_failures;                                                                   \
      std::cerr << "  FAILED " << __FILE__ << ":" << __LINE__ << ": " #cond << "\n"; \
    }                                                                                 \
  } while (0)
#define CHECK_EQ(a, b)                                                                                   \
  do {                                                                                                   \
    auto va = (a);                                                                                       \
    auto vb = (b);                                                                                       \
    if (!(va == vb)) {                                                                                   \
      ++g_failures;                                                                                      \
      std::cerr << "  FAILED " << __FILE__ << ":" << __LINE__ << ": " #a " == " #b << "\n    got: " << va \
                << "\n    want: " << vb << "\n";                                                         \
    }                                                                                                    \
  } while (0)

template <typename T>
class Queue {
 public:
  void push(T value) {
    std::lock_guard<std::mutex> lock(mutex_);
    items_.push_back(std::move(value));
    changed_.notify_all();
  }
  std::optional<T> pop(milliseconds timeout = milliseconds(10000)) {
    std::unique_lock<std::mutex> lock(mutex_);
    if (!changed_.wait_for(lock, timeout, [&] { return !items_.empty(); })) return std::nullopt;
    T value = std::move(items_.front());
    items_.pop_front();
    return value;
  }

 private:
  std::mutex mutex_;
  std::condition_variable changed_;
  std::deque<T> items_;
};

// ---- sockets (from sdk/cpp's tests) ----

#if defined(_WIN32)
using Socket = SOCKET;
const Socket kNoSocket = INVALID_SOCKET;
void CloseSocket(Socket s) { closesocket(s); }
void ShutdownSocket(Socket s) { shutdown(s, SD_BOTH); }
#else
using Socket = int;
const Socket kNoSocket = -1;
void CloseSocket(Socket s) { close(s); }
void ShutdownSocket(Socket s) { shutdown(s, SHUT_RDWR); }
#endif

bool SendAll(Socket s, const std::string& data) {
  size_t sent = 0;
  while (sent < data.size()) {
#if defined(_WIN32)
    const int n = send(s, data.data() + sent, static_cast<int>(data.size() - sent), 0);
#elif defined(MSG_NOSIGNAL)
    const ssize_t n = send(s, data.data() + sent, data.size() - sent, MSG_NOSIGNAL);
#else
    const ssize_t n = send(s, data.data() + sent, data.size() - sent, 0);
#endif
    if (n <= 0) return false;
    sent += static_cast<size_t>(n);
  }
  return true;
}

bool Readable(Socket s, int timeout_ms) {
#if defined(_WIN32)
  fd_set set;
  FD_ZERO(&set);
  FD_SET(s, &set);
  timeval tv{timeout_ms / 1000, (timeout_ms % 1000) * 1000};
  return select(0, &set, nullptr, nullptr, &tv) > 0;
#else
  pollfd fd{s, POLLIN, 0};
  return poll(&fd, 1, timeout_ms) > 0;
#endif
}

// Reads exactly `size` bytes, giving up when `stop` is set or the peer closes.
bool RecvExact(Socket s, std::string& out, size_t size, const std::atomic<bool>& stop) {
  out.clear();
  char buffer[4096];
  while (out.size() < size) {
    if (stop) return false;
    if (!Readable(s, 50)) continue;
    const size_t want = std::min(sizeof(buffer), size - out.size());
    const auto n = recv(s, buffer, static_cast<int>(want), 0);
    if (n <= 0) return false;
    out.append(buffer, static_cast<size_t>(n));
  }
  return true;
}

Socket Listen(uint16_t* bound_port) {
  const Socket s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (s == kNoSocket) return kNoSocket;
  sockaddr_in address;
  std::memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = 0;
  socklen_t length = sizeof(address);
  if (bind(s, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0 || listen(s, 16) != 0 ||
      getsockname(s, reinterpret_cast<sockaddr*>(&address), &length) != 0) {
    CloseSocket(s);
    return kNoSocket;
  }
  *bound_port = ntohs(address.sin_port);
  return s;
}

std::string ServerFrame(unsigned opcode, const std::string& payload) {
  std::string frame;
  frame.push_back(static_cast<char>(0x80U | opcode));
  const size_t size = payload.size();
  if (size < 126U) {
    frame.push_back(static_cast<char>(size));
  } else if (size <= 0xFFFFU) {
    frame.push_back(static_cast<char>(126));
    frame.push_back(static_cast<char>((size >> 8U) & 0xFFU));
    frame.push_back(static_cast<char>(size & 0xFFU));
  } else {
    frame.push_back(static_cast<char>(127));
    for (int shift = 56; shift >= 0; shift -= 8) frame.push_back(static_cast<char>((static_cast<uint64_t>(size) >> shift) & 0xFFU));
  }
  return frame + payload;
}

std::string Lower(std::string s) {
  for (char& c : s) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return s;
}

std::string WebSocketAccept(const std::string& key) {
  const std::string input = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  unsigned char digest[SHA_DIGEST_LENGTH];
  SHA1(reinterpret_cast<const unsigned char*>(input.data()), input.size(), digest);
  unsigned char out[64];
  const int n = EVP_EncodeBlock(out, digest, SHA_DIGEST_LENGTH);
  return std::string(reinterpret_cast<char*>(out), static_cast<size_t>(n));
}

// ---- the fake instance ----

struct Request {
  std::string method, path, body;
  std::map<std::string, std::string> headers;  // lowercase names
  bool has(const std::string& h) const { return headers.count(h) != 0; }
  std::string header(const std::string& h) const {
    auto it = headers.find(h);
    return it == headers.end() ? "" : it->second;
  }
};

class FakeServer {
 public:
  explicit FakeServer(std::string token = "secret-token") : token(std::move(token)) {
    listener_ = Listen(&port);
    accept_thread_ = std::thread([this] { accept_loop(); });
  }
  ~FakeServer() {
    stop_ = true;
    accept_thread_.join();
    std::vector<std::thread> threads;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      threads.swap(threads_);
    }
    for (auto& t : threads) t.join();
    CloseSocket(listener_);
  }

  std::string base_url() const { return "http://127.0.0.1:" + std::to_string(port); }

  std::string token;
  uint16_t port = 0;
  std::atomic<int> heartbeat_interval{30000};
  std::string me_json = R"({"bot":{"id":"100","username":"dice","appId":"200","beaconIds":["300"]}})";
  std::function<std::optional<std::pair<int, std::string>>(const Request&)> handler;
  Queue<Request> requests;
  Queue<json> frames;            // text frames from clients
  Queue<std::string> upgrades;   // the path of each WebSocket upgrade
  Queue<bool> gateway_closed;    // per connection: true when the client sent a close frame

  void dispatch(const std::string& type, const json& data) {
    for (auto& c : clients()) {
      if (c->identified) c->send(ServerFrame(1, json{{"op", 0}, {"t", type}, {"d", data}}.dump()));
    }
  }
  void send_raw(const json& frame) {
    for (auto& c : clients()) c->send(ServerFrame(1, frame.dump()));
  }
  void drop_gateways() {
    for (auto& c : clients()) ShutdownSocket(c->socket);
  }
  void close_gateways(int code) {
    for (auto& c : clients()) c->close(code, "");
  }

 private:
  struct Client {
    Socket socket;
    std::mutex write_mutex;
    std::atomic<bool> identified{false};
    std::atomic<bool> sent_close{false};
    void send(const std::string& bytes) {
      std::lock_guard<std::mutex> lock(write_mutex);
      SendAll(socket, bytes);
    }
    void close(int code, const std::string& reason) {
      sent_close = true;
      std::string payload;
      payload += static_cast<char>((code >> 8) & 0xFF);
      payload += static_cast<char>(code & 0xFF);
      send(ServerFrame(8, payload + reason));
    }
  };

  std::vector<std::shared_ptr<Client>> clients() {
    std::lock_guard<std::mutex> lock(mutex_);
    return clients_;
  }

  void accept_loop() {
    while (!stop_) {
      if (!Readable(listener_, 50)) continue;
      Socket s = accept(listener_, nullptr, nullptr);
      if (s == kNoSocket) continue;
      std::lock_guard<std::mutex> lock(mutex_);
      threads_.emplace_back([this, s] { serve(s); });
    }
  }

  bool read_head(Socket s, std::string& head) {
    head.clear();
    std::string one;
    while (head.size() < 16384) {
      if (!RecvExact(s, one, 1, stop_)) return false;
      head += one;
      if (head.size() >= 4 && head.compare(head.size() - 4, 4, "\r\n\r\n") == 0) return true;
    }
    return false;
  }

  void serve(Socket s) {
    std::string head;
    if (!read_head(s, head)) {
      CloseSocket(s);
      return;
    }
    Request request;
    size_t line_end = head.find("\r\n");
    const std::string first = head.substr(0, line_end);
    const size_t sp1 = first.find(' '), sp2 = first.find(' ', sp1 + 1);
    request.method = first.substr(0, sp1);
    request.path = first.substr(sp1 + 1, sp2 - sp1 - 1);
    size_t pos = line_end + 2;
    while (pos < head.size()) {
      const size_t end = head.find("\r\n", pos);
      if (end == std::string::npos || end == pos) break;
      const std::string line = head.substr(pos, end - pos);
      const size_t colon = line.find(':');
      if (colon != std::string::npos) {
        std::string value = line.substr(colon + 1);
        while (!value.empty() && value.front() == ' ') value.erase(0, 1);
        request.headers[Lower(line.substr(0, colon))] = value;
      }
      pos = end + 2;
    }
    if (Lower(request.header("upgrade")) == "websocket") {
      serve_gateway(s, request);
      CloseSocket(s);
      return;
    }
    const size_t length = request.has("content-length") ? std::stoul(request.header("content-length")) : 0;
    if (length > 0) RecvExact(s, request.body, length, stop_);
    requests.push(request);
    std::optional<std::pair<int, std::string>> answer;
    if (handler) answer = handler(request);
    if (!answer) {
      if (request.method == "GET" && request.path == "/api/v1/bots/@me") {
        answer = request.header("authorization") == "Bot " + token
                     ? std::make_pair(200, me_json)
                     : std::make_pair(401, std::string(R"({"error":"Invalid bot token","code":"INVALID_BOT_TOKEN"})"));
      } else {
        answer = std::make_pair(200, std::string("{}"));
      }
    }
    std::string response = "HTTP/1.1 " + std::to_string(answer->first) + " X\r\nConnection: close\r\n";
    if (answer->first != 204) {
      response += "Content-Type: application/json\r\nContent-Length: " + std::to_string(answer->second.size()) + "\r\n\r\n" + answer->second;
    } else {
      response += "\r\n";
    }
    SendAll(s, response);
    ShutdownSocket(s);
    CloseSocket(s);
  }

  void serve_gateway(Socket s, const Request& request) {
    auto client = std::make_shared<Client>();
    client->socket = s;
    client->send("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
                 WebSocketAccept(request.header("sec-websocket-key")) + "\r\n\r\n");
    {
      std::lock_guard<std::mutex> lock(mutex_);
      clients_.push_back(client);
    }
    upgrades.push(request.path);
    client->send(ServerFrame(1, json{{"op", 10}, {"d", {{"heartbeat_interval", heartbeat_interval.load()}}}}.dump()));
    bool client_closed = false;
    std::string message;
    while (!stop_) {
      std::string head, ext, mask, payload;
      if (!RecvExact(s, head, 2, stop_)) break;
      const unsigned opcode = static_cast<unsigned char>(head[0]) & 0x0FU;
      const bool fin = (static_cast<unsigned char>(head[0]) & 0x80U) != 0;
      uint64_t length = static_cast<unsigned char>(head[1]) & 0x7FU;
      if (length == 126) {
        if (!RecvExact(s, ext, 2, stop_)) break;
        length = (static_cast<uint64_t>(static_cast<unsigned char>(ext[0])) << 8) | static_cast<unsigned char>(ext[1]);
      } else if (length == 127) {
        if (!RecvExact(s, ext, 8, stop_)) break;
        length = 0;
        for (char c : ext) length = (length << 8) | static_cast<unsigned char>(c);
      }
      if (!RecvExact(s, mask, 4, stop_) || !RecvExact(s, payload, static_cast<size_t>(length), stop_)) break;
      for (size_t i = 0; i < payload.size(); ++i) payload[i] = static_cast<char>(payload[i] ^ mask[i % 4]);
      if (opcode == 8) {
        client_closed = true;
        if (!client->sent_close) client->send(ServerFrame(8, payload.substr(0, 2)));
        break;
      }
      if (opcode == 9) {
        client->send(ServerFrame(10, payload));
        continue;
      }
      if (opcode == 1 || opcode == 0) message += payload;
      if (!fin || (opcode != 1 && opcode != 0)) continue;
      json frame = json::parse(message, nullptr, false);
      message.clear();
      if (frame.is_discarded()) continue;
      frames.push(frame);
      const int op = frame.value("op", -1);
      if (op == 1) client->send(ServerFrame(1, R"({"op":11})"));
      if (op == 2) {
        if (frame["d"].value("token", "") != "Bot " + token) {
          client->close(4003, "Invalid or expired authentication ticket");
          continue;
        }
        client->identified = true;
        client->send(ServerFrame(1, R"({"op":0,"t":"READY","d":{"transmitter":{"id":"100","username":"dice"},"session_id":"s1"}})"));
      }
    }
    {
      std::lock_guard<std::mutex> lock(mutex_);
      for (auto it = clients_.begin(); it != clients_.end(); ++it) {
        if (*it == client) {
          clients_.erase(it);
          break;
        }
      }
    }
    gateway_closed.push(client_closed);
  }

  Socket listener_ = kNoSocket;
  std::atomic<bool> stop_{false};
  std::thread accept_thread_;
  std::mutex mutex_;
  std::vector<std::thread> threads_;
  std::vector<std::shared_ptr<Client>> clients_;
};

std::string Hex(const std::string& hex) {
  std::string out;
  for (size_t i = 0; i + 1 < hex.size(); i += 2) out += static_cast<char>(std::stoi(hex.substr(i, 2), nullptr, 16));
  return out;
}

subspace::BotOptions Options(const FakeServer& server, const std::string& token = "") {
  subspace::BotOptions o;
  o.token = token.empty() ? server.token : token;
  o.base_url = server.base_url() + "/";
  o.reconnect_delay = milliseconds(100);
  return o;
}

Request NextRequest(FakeServer& server, const std::function<bool(const Request&)>& match) {
  while (true) {
    auto r = server.requests.pop();
    if (!r) return Request{};
    if (match(*r)) return *r;
  }
}

json NextFrame(FakeServer& server, int op) {
  while (true) {
    auto f = server.frames.pop();
    if (!f) return json(nullptr);
    if (f->value("op", -1) == op) return *f;
  }
}

// ---- tests ----

const char* kRfc[][3] = {
    {"d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "",
     "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"},
    {"3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "72",
     "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00"},
    {"fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025", "af82",
     "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a"},
};

void TestEd25519Vectors() {
  for (auto& v : kRfc) {
    CHECK(subspace::ed25519_verify(Hex(v[0]), Hex(v[1]), Hex(v[2])));
    std::string bad = Hex(v[2]);
    bad[40] = static_cast<char>(bad[40] ^ 4);
    CHECK(!subspace::ed25519_verify(Hex(v[0]), Hex(v[1]), bad));
    CHECK(!subspace::ed25519_verify(Hex(v[0]), Hex(v[1]) + "x", Hex(v[2])));
  }
  CHECK(!subspace::ed25519_verify(std::string(31, 'a'), "", std::string(64, 'b')));
}

// Signed by Node's crypto.sign (ed25519) over timestamp + body, as the server signs interactions.
const std::string kKey = "8a61b18fb75806fa8b7a855d85b41787575d6227494560d2528882b3f8db311b";
const std::string kTimestamp = "1761500000";
const std::string kBody =
    "{\"type\":2,\"id\":\"978275694148452353\",\"token\":\"tok\",\"applicationId\":\"1\",\"beaconId\":\"2\",\"channel\":{\"type\":"
    "\"relay\",\"id\":\"3\"},\"user\":{\"id\":\"4\",\"username\":\"sam\",\"displayName\":\"Sam \xE2\x9C\xA8\",\"avatarUrl\":null},"
    "\"memberPermissions\":\"0\",\"data\":{\"id\":\"5\",\"name\":\"roll\",\"options\":[{\"name\":\"sides\",\"type\":\"integer\","
    "\"value\":20}]}}";
const std::string kSig =
    "15a5b6ac1a85fa5f331fe7d54da6e07398b574fb28366d9afa6684cddb7a54d30c5cdfce3d65aa3fc857c16e6eaa642ddc59449c7e2c14ccf349e865f610b109";
const int64_t kSignedAt = 1761500000;

void TestVerifyInteraction() {
  CHECK(subspace::verify_interaction(kBody, kSig, kTimestamp, kKey, kSignedAt));
  CHECK(subspace::verify_interaction(kBody, kSig, kTimestamp, kKey, kSignedAt + 299));
  CHECK(!subspace::verify_interaction(kBody + " ", kSig, kTimestamp, kKey, kSignedAt));
  CHECK(!subspace::verify_interaction(kBody, kSig, "1761500001", kKey, kSignedAt));
  CHECK(!subspace::verify_interaction(kBody, kSig, kTimestamp, kKey, kSignedAt + 301));
  CHECK(!subspace::verify_interaction(kBody, kSig, kTimestamp, kKey, kSignedAt - 301));
  CHECK(!subspace::verify_interaction(kBody, "", kTimestamp, kKey, kSignedAt));
  CHECK(!subspace::verify_interaction(kBody, kSig, "soon", kKey, kSignedAt));
  CHECK(!subspace::verify_interaction(kBody, "zz" + kSig.substr(2), kTimestamp, kKey, kSignedAt));
  CHECK(!subspace::verify_interaction(kBody, kSig, kTimestamp, kKey.substr(2), kSignedAt));
  CHECK(!subspace::verify_interaction(kBody, kSig, kTimestamp, kKey));  // years old by the real clock
}

// ---- hostile inputs for verify_interaction / ed25519_verify: all must return false, never crash ----

// RFC 8032 test 1 key pair; signatures made with Node's crypto.sign over timestamp + body.
const std::string kHKey = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const std::string kHTs = "1761500000";
const std::string kHBody = "{\"type\":1}";
const std::string kHSig =
    "45bc058de3de16ea104d507bd0704e6e20396430163f2b5464f9f09b8b953cb9998d00ed448a08cf0a82ad226481731fbe6dab9ed196f69392a528d3d3aadb03";
// Same key over timestamp + {"type":2}.
const std::string kHOtherSig =
    "f54b8786dc0a07b510c7afcad283c4ba3ecd55c8c6119142c159d1db2ae23129938b16413a78305634b918462f97c2e9a02f3d0c8482e9569e78f5685e82140b";
const std::string kIdentity = "0100000000000000000000000000000000000000000000000000000000000000";  // small order (1)
const std::string kOrder2 = "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f";    // y = -1
const std::string kOrder4 = std::string(64, '0');                                                    // y = 0

bool HV(const std::string& body, const std::string& sig, const std::string& ts, const std::string& key) {
  return subspace::verify_interaction(body, sig, ts, key, kSignedAt);
}

std::string ToHex(const std::string& bytes) {
  static const char* digits = "0123456789abcdef";
  std::string out;
  for (unsigned char c : bytes) {
    out += digits[c >> 4];
    out += digits[c & 15];
  }
  return out;
}

// sig with S replaced by S + times * L (little-endian, bytes 32..63), L = 2^252 + 27742317777372353535851937790883648493.
std::string AddL(const std::string& sig, int times) {
  static const unsigned char kL[32] = {0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7,
                                       0xa2, 0xde, 0xf9, 0xde, 0x14, 0,    0,    0,    0,    0,    0,
                                       0,    0,    0,    0,    0,    0,    0,    0,    0,    0x10};
  std::string out = sig;
  for (int t = 0; t < times; ++t) {
    unsigned carry = 0;
    for (int i = 0; i < 32; ++i) {
      unsigned sum = static_cast<unsigned char>(out[32 + i]) + kL[i] + carry;
      out[32 + i] = static_cast<char>(sum & 0xff);
      carry = sum >> 8;
    }
  }
  return out;
}

void TestVerifyHostileInputs() {
  // Baseline, and uppercase hex is accepted for both signature and key.
  CHECK(HV(kHBody, kHSig, kHTs, kHKey));
  CHECK(HV(kHBody, ToHex(Hex(kHSig)), kHTs, kHKey));
  {
    std::string upper_sig = kHSig, upper_key = kHKey;
    for (auto& c : upper_sig) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    for (auto& c : upper_key) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    CHECK(HV(kHBody, upper_sig, kHTs, upper_key));
  }

  // Tampered body / timestamp, and timestamps that parse to the same number but are other bytes.
  CHECK(!HV("{\"type\":2}", kHSig, kHTs, kHKey));
  CHECK(!HV(kHBody + "\n", kHSig, kHTs, kHKey));
  CHECK(!HV("", kHSig, kHTs, kHKey));
  CHECK(!HV(std::string("{\"type\":1}\0", 11), kHSig, kHTs, kHKey));
  CHECK(!HV(kHBody, kHSig, "1761500001", kHKey));
  CHECK(!HV(kHBody, kHSig, "1761499999", kHKey));
  CHECK(!HV(kHBody, kHSig, "1761500000.0", kHKey));
  CHECK(!HV(kHBody, kHSig, " 1761500000", kHKey));
  CHECK(!HV(kHBody, kHSig, "1.7615e9", kHKey));
  CHECK(!HV(kHBody.substr(1), kHSig, kHTs + "{", kHKey));  // same timestamp+body bytes, bad timestamp

  // Signature of a different message by the same key.
  CHECK(!HV(kHBody, kHOtherSig, kHTs, kHKey));
  CHECK(HV("{\"type\":2}", kHOtherSig, kHTs, kHKey));

  // Wrong-length signatures.
  for (const std::string& sig : {std::string(), std::string("00"), kHSig.substr(0, 126), kHSig + "00", kHSig + kHSig,
                                 std::string(100000, 'a')}) {
    CHECK(!HV(kHBody, sig, kHTs, kHKey));
  }

  // Non-hex signatures (HexToBytes rejects odd lengths before indexing i + 1, so no over-read).
  const std::string non_hex[] = {
      kHSig.substr(0, 127),
      kHSig + "0",
      "zz" + kHSig.substr(2),
      kHSig.substr(0, 126) + "g0",
      " " + kHSig.substr(1),
      kHSig.substr(0, 127) + " ",
      kHSig.substr(0, 64) + " " + kHSig.substr(65),
      kHSig + "\n",
      "0x" + kHSig.substr(2),
      "0x" + kHSig,
      kHSig.substr(0, 126) + "-1",
      kHSig.substr(0, 126) + "+1",
      kHSig.substr(0, 126) + std::string("\0\0", 2),
      kHSig.substr(0, 126) + "\xD9\xA3",  // U+0663 ARABIC-INDIC DIGIT THREE in UTF-8
      kHSig.substr(0, 126) + "\xff\x80",
  };
  for (const auto& sig : non_hex) CHECK(!HV(kHBody, sig, kHTs, kHKey));

  // Wrong-length / non-hex / invalid public keys.
  const std::string bad_keys[] = {
      "",
      kHKey.substr(0, 62),
      kHKey.substr(0, 63),
      kHKey + "00",
      kHKey + kHKey,
      "zz" + kHKey.substr(2),
      " " + kHKey.substr(1),
      "0x" + kHKey,
      "0x" + kHKey.substr(2),
      std::string(64, 'f'),                                                // y >= p
      "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",  // y = p
  };
  for (const auto& key : bad_keys) CHECK(!HV(kHBody, kHSig, kHTs, key));

  // Empty inputs.
  CHECK(!HV(kHBody, kHSig, "", kHKey));
  CHECK(!HV("", "", "", ""));
  CHECK(!subspace::ed25519_verify("", "", ""));
  CHECK(!subspace::ed25519_verify(Hex(kHKey), "", ""));
  CHECK(!subspace::ed25519_verify("", "", Hex(kHSig)));

  // Stale / future / nonsense timestamps (the five-minute window is implemented, both directions).
  for (int64_t offset : {301, -301, 86400, -86400 * 365}) {
    CHECK(!subspace::verify_interaction(kHBody, kHSig, kHTs, kHKey, kSignedAt + offset));
  }
  for (const char* ts : {"nan", "NaN", "inf", "-inf", "infinity", "1e400", "-0", "0x68fc5160", "99999999999999999999999999"}) {
    CHECK(!HV(kHBody, kHSig, ts, kHKey));
  }

  // Non-canonical S: S + L, S + 2L, S = L, top bits set.
  const std::string sig = Hex(kHSig);
  CHECK(subspace::ed25519_verify(Hex(kHKey), kHTs + kHBody, sig));
  CHECK(!HV(kHBody, ToHex(AddL(sig, 1)), kHTs, kHKey));
  CHECK(!HV(kHBody, ToHex(AddL(sig, 2)), kHTs, kHKey));
  {
    std::string s_is_l = sig.substr(0, 32) + std::string(32, '\0');
    CHECK(!HV(kHBody, ToHex(AddL(s_is_l, 1)), kHTs, kHKey));
    std::string high = sig;
    high[63] = static_cast<char>(static_cast<unsigned char>(high[63]) | 0xE0);
    CHECK(!HV(kHBody, ToHex(high), kHTs, kHKey));
  }

  // All-zero signature.
  CHECK(!HV(kHBody, std::string(128, '0'), kHTs, kHKey));
  CHECK(!HV(kHBody, std::string(128, '0'), kHTs, kIdentity));
}

// Fixed (was a security bug): ed25519_verify (OpenSSL EVP Ed25519) accepted small-order public keys. With
// A = identity (01 00..00) the signature R = identity, S = 0 verifies for every message, so a bot whose
// configured key is a small-order point accepts forged interactions. Fix: reject keys (and R values)
// of small order, e.g. a blocklist of the small-order encodings (and their non-canonical forms) in
// ed25519_verify before calling OpenSSL, as libsodium does.
// Kept out of the normal list so the suite stays green; main() runs it as a reported known failure.
void TestSmallOrderKeysRejected() {
  const std::string forged = kIdentity + std::string(64, '0');
  CHECK(!HV(kHBody, forged, kHTs, kIdentity));
  CHECK(!HV("{\"type\":1,\"anything\":true}", forged, kHTs, kIdentity));
  for (const auto& key : {kOrder2, kOrder4}) {
    for (const auto& r : {kIdentity, key, kOrder4}) {
      for (int i = 0; i < 16; ++i) CHECK(!HV("{\"n\":" + std::to_string(i) + "}", r + std::string(64, '0'), kHTs, key));
    }
  }
}

void TestResponseBodies() {
  CHECK_EQ(subspace::respond_with("hi").dump(), std::string(R"({"data":{"content":"hi"},"type":4})"));
  subspace::Reply reply;
  reply.content = "Rolled 4";
  reply.embeds.push_back({{"title", "Dice"}, {"color", 0x3b8ef2}});
  reply.ephemeral = true;
  CHECK_EQ(subspace::respond_with(reply)["data"]["embeds"][0]["color"].get<int>(), 0x3b8ef2);
  CHECK_EQ(subspace::respond_with(reply)["data"]["ephemeral"].get<bool>(), true);
  CHECK_EQ(subspace::defer_with(true).dump(), std::string(R"({"data":{"ephemeral":true},"type":5})"));
}

void TestMe() {
  FakeServer server;
  subspace::Bot bot(Options(server));
  auto me = bot.me();
  CHECK_EQ(me.app_id, std::string("200"));
  CHECK_EQ(me.beacon_ids.size(), size_t(1));
  CHECK(bot.user().has_value());
  auto r = server.requests.pop();
  CHECK(r.has_value());
  CHECK_EQ(r->method, std::string("GET"));
  CHECK_EQ(r->path, std::string("/api/v1/bots/@me"));
  CHECK_EQ(r->header("authorization"), std::string("Bot secret-token"));
}

void TestSendEditDeleteReact() {
  FakeServer server;
  server.handler = [](const Request& r) -> std::optional<std::pair<int, std::string>> {
    if (r.method == "POST")
      return std::make_pair(201, std::string(R"({"transmission":{"id":"9","content":"Hi!","author":{"id":"100","username":"dice","botKind":"bot"},"mentions":[],"pinned":false}})"));
    if (r.method == "DELETE" || r.method == "PUT") return std::make_pair(204, std::string());
    return std::nullopt;
  };
  subspace::Bot bot(Options(server));
  auto sent = bot.send("relay", "55", "Hi!");
  CHECK_EQ(sent.id, std::string("9"));
  CHECK_EQ(sent.author.bot_kind, std::string("bot"));
  CHECK_EQ(sent.channel_id, std::string("55"));
  CHECK_EQ(sent.raw["pinned"].get<bool>(), false);
  auto r = server.requests.pop();
  CHECK_EQ(r->path, std::string("/api/v1/channels/relay/55/transmissions"));
  CHECK_EQ(json::parse(r->body), json({{"content", "Hi!"}}));
  CHECK_EQ(r->header("content-type"), std::string("application/json"));
  bot.send("thread", "56", "re", "9");
  r = server.requests.pop();
  CHECK_EQ(json::parse(r->body), json({{"content", "re"}, {"replyToId", "9"}}));

  bot.edit("9", "changed");
  r = server.requests.pop();
  CHECK_EQ(r->method + " " + r->path, std::string("PATCH /api/v1/transmissions/9"));
  CHECK_EQ(json::parse(r->body), json({{"content", "changed"}}));
  bot.delete_message("9");
  r = server.requests.pop();
  CHECK_EQ(r->method + " " + r->path, std::string("DELETE /api/v1/transmissions/9"));
  bot.react("9", "\xF0\x9F\x91\x8D");
  r = server.requests.pop();
  CHECK_EQ(r->method + " " + r->path, std::string("PUT /api/v1/transmissions/9/reactions/%F0%9F%91%8D/@me"));
}

void TestRegisterCommands() {
  FakeServer server;
  server.handler = [](const Request& r) -> std::optional<std::pair<int, std::string>> {
    if (r.method == "PUT") return std::make_pair(200, std::string(R"({"commands":[{"id":"7","name":"roll","description":"Roll a die"}]})"));
    return std::nullopt;
  };
  subspace::Bot bot(Options(server));
  subspace::CommandOption sides{"integer", "sides", "How many sides", true};
  subspace::CommandOption unit{"string", "u", "Unit"};
  unit.choices = json::array({{{"name", "Minutes"}, {"value", "m"}}, {{"name", "Hours"}, {"value", 60}}});
  auto stored = bot.register_commands({{"roll", "Roll a die", {sides}}, {"unit", "Pick", {unit}, "8192"}});
  CHECK_EQ(stored[0]["id"].get<std::string>(), std::string("7"));
  NextRequest(server, [](const Request& r) { return r.path == "/api/v1/bots/@me"; });
  auto put = server.requests.pop();
  CHECK_EQ(put->method + " " + put->path, std::string("PUT /api/v1/applications/200/commands"));
  json want = json::parse(R"([
    {"name":"roll","description":"Roll a die","options":[{"type":"integer","name":"sides","description":"How many sides","required":true}]},
    {"name":"unit","description":"Pick","options":[{"type":"string","name":"u","description":"Unit","choices":[{"name":"Minutes","value":"m"},{"name":"Hours","value":60}]}],"defaultMemberPermissions":"8192"}
  ])");
  CHECK_EQ(json::parse(put->body), want);
  bot.register_commands(json::array({{{"name", "ping"}, {"description", "Pong"}}}), "300");
  put = server.requests.pop();
  CHECK_EQ(put->path, std::string("/api/v1/applications/200/beacons/300/commands"));
}

void TestErrors() {
  FakeServer server;
  server.handler = [](const Request& r) -> std::optional<std::pair<int, std::string>> {
    if (r.path.find("/users/") != std::string::npos)
      return std::make_pair(403, std::string(R"({"error":"Bots cannot use this endpoint","code":"BOT_FORBIDDEN"})"));
    return std::nullopt;
  };
  subspace::Bot bot(Options(server));
  bool threw = false;
  try {
    bot.rest("PATCH", "/users/@me/profile", {{"bio", "hi"}});
  } catch (const subspace::ApiError& e) {
    threw = true;
    CHECK_EQ(e.status(), 403);
    CHECK_EQ(e.code(), std::string("BOT_FORBIDDEN"));
    CHECK_EQ(std::string(e.what()), std::string("Bots cannot use this endpoint"));
  }
  CHECK(threw);
  subspace::Bot wrong(Options(server, "nope"));
  threw = false;
  try {
    wrong.me();
  } catch (const subspace::ApiError& e) {
    threw = true;
    CHECK_EQ(e.status(), 401);
    CHECK_EQ(e.code(), std::string("INVALID_BOT_TOKEN"));
  }
  CHECK(threw);
}

void TestConnectAndHeartbeat() {
  FakeServer server;
  server.heartbeat_interval = 50;
  subspace::Bot bot(Options(server));
  json ready;
  bot.on_ready([&](const json& d) { ready = d; });
  bot.connect();
  CHECK(bot.connected());
  CHECK_EQ(ready.value("session_id", ""), std::string("s1"));
  CHECK_EQ(bot.gateway_url(), "ws://127.0.0.1:" + std::to_string(server.port) + "/gateway");
  CHECK_EQ(server.upgrades.pop().value_or(""), std::string("/gateway"));
  json identify = NextFrame(server, 2);
  CHECK_EQ(identify["d"]["token"].get<std::string>(), std::string("Bot secret-token"));
  CHECK(!NextFrame(server, 1).is_null());
  CHECK(!NextFrame(server, 1).is_null());
  CHECK(!NextFrame(server, 1).is_null());
  bot.disconnect();
  bot.wait();
  CHECK(!bot.connected());
  CHECK_EQ(server.gateway_closed.pop().value_or(false), true);
}

void TestDispatches() {
  FakeServer server;
  subspace::Bot bot(Options(server));
  Queue<subspace::Message> messages, updates;
  Queue<json> deletes;
  Queue<std::string> all;
  bot.on_message([&](const subspace::Message& m) { messages.push(m); });
  bot.on_message_update([&](const subspace::Message& m) { updates.push(m); });
  bot.on_message_delete([&](const json& d) { deletes.push(d); });
  bot.on_dispatch([&](const std::string& t, const json&) { all.push(t); });
  bot.connect();
  server.dispatch("TRANSMISSION_CREATE", json::parse(R"({"channelType":"relay","channelId":"55","transmission":{"id":"9","content":"!hello","author":{"id":"4","username":"sam","displayName":null},"mentions":["100"],"createdAt":"2026-10-27T00:00:00Z"}})"));
  auto m = messages.pop();
  CHECK(m.has_value());
  if (m) {
    CHECK_EQ(m->content, std::string("!hello"));
    CHECK_EQ(m->channel_type + "/" + m->channel_id, std::string("relay/55"));
    CHECK_EQ(m->author.username, std::string("sam"));
    CHECK_EQ(m->mentions.size(), size_t(1));
  }
  server.dispatch("TRANSMISSION_UPDATE", json::parse(R"({"channelType":"relay","channelId":"55","transmission":{"id":"9","content":"edited","author":{"id":"4","username":"sam"}}})"));
  CHECK_EQ(updates.pop().value_or(subspace::Message{}).content, std::string("edited"));
  server.dispatch("TRANSMISSION_DELETE", json::parse(R"({"channelType":"relay","channelId":"55","transmissionId":"9"})"));
  CHECK_EQ(deletes.pop().value_or(json::object()).value("transmissionId", ""), std::string("9"));
  // A big event arrives whole (64 KiB+ crosses curl's receive buffer and the 16-bit length).
  std::string big(100000, 'x');
  server.dispatch("TRANSMISSION_CREATE", {{"channelType", "relay"}, {"channelId", "55"}, {"transmission", {{"id", "10"}, {"content", big}, {"author", {{"id", "4"}, {"username", "sam"}}}}}});
  CHECK_EQ(messages.pop().value_or(subspace::Message{}).content.size(), big.size());
  server.dispatch("PRESENCE_UPDATE", {{"transmitterId", "4"}});
  std::vector<std::string> seen;
  for (int i = 0; i < 6; ++i) seen.push_back(all.pop().value_or("?"));
  CHECK_EQ(seen[0] + "," + seen[1] + "," + seen[2] + "," + seen[3] + "," + seen[4] + "," + seen[5],
           std::string("READY,TRANSMISSION_CREATE,TRANSMISSION_UPDATE,TRANSMISSION_DELETE,TRANSMISSION_CREATE,PRESENCE_UPDATE"));
  bot.disconnect();
  bot.wait();
}

// The gateway currently sends the event name as "type" (the HTTP endpoint gets 2).
const char* kInteraction =
    R"({"type":"INTERACTION_CREATE","id":"77","token":"itok","applicationId":"200","beaconId":"300","channel":{"type":"relay","id":"55"},"user":{"id":"4","username":"sam","displayName":"Sam","avatarUrl":null},"memberPermissions":"1024","data":{"id":"7","name":"roll","options":[{"name":"sides","type":"integer","value":8},{"name":"who","type":"user","value":"4"}]}})";

void TestInteractions() {
  FakeServer server;
  subspace::Bot bot(Options(server));
  Queue<bool> done;
  bot.on_interaction([&](subspace::Interaction& i) {
    CHECK_EQ(i.command_name(), std::string("roll"));
    CHECK_EQ(i.user().value("username", ""), std::string("sam"));
    CHECK_EQ(i.channel_type() + "/" + i.channel_id() + "/" + i.beacon_id(), std::string("relay/55/300"));
    CHECK_EQ(i.option_or("sides", 6), 8);
    CHECK_EQ(i.option_or<std::string>("who", ""), std::string("4"));
    CHECK_EQ(i.option_or("missing", 6), 6);
    CHECK(i.option("missing").is_null());
    i.defer();
    i.follow_up("Took a while: 1");
    subspace::Reply edited("Edited");
    edited.embeds.push_back({{"title", "Dice"}, {"footer", {{"text", "d8"}}}});
    i.edit_reply(edited);
    subspace::Reply now("Now");
    now.ephemeral = true;
    i.reply(now);
    done.push(true);
  });
  bot.connect();
  server.dispatch("INTERACTION_CREATE", json::parse(kInteraction));
  CHECK(done.pop().has_value());
  std::vector<Request> calls;
  while (calls.size() < 4) {
    auto r = server.requests.pop();
    if (!r) break;
    if (r->path.rfind("/api/v1/interactions/", 0) == 0) calls.push_back(*r);
  }
  CHECK_EQ(calls.size(), size_t(4));
  if (calls.size() == 4) {
    for (auto& c : calls) CHECK(!c.has("authorization"));
    CHECK_EQ(calls[0].method + " " + calls[0].path, std::string("POST /api/v1/interactions/77/itok/callback"));
    CHECK_EQ(json::parse(calls[0].body), json::parse(R"({"type":5,"data":{"ephemeral":false}})"));
    CHECK_EQ(calls[1].method + " " + calls[1].path, std::string("POST /api/v1/interactions/77/itok/followup"));
    CHECK_EQ(json::parse(calls[1].body), json::parse(R"({"content":"Took a while: 1"})"));
    CHECK_EQ(calls[2].method + " " + calls[2].path, std::string("PATCH /api/v1/interactions/77/itok/original"));
    CHECK_EQ(json::parse(calls[2].body), json::parse(R"({"content":"Edited","embeds":[{"title":"Dice","footer":{"text":"d8"}}]})"));
    CHECK_EQ(json::parse(calls[3].body), json::parse(R"({"type":4,"data":{"content":"Now","ephemeral":true}})"));
  }
  bot.disconnect();
  bot.wait();
}

void TestHandlerErrors() {
  FakeServer server;
  subspace::Bot bot(Options(server));
  Queue<std::string> errors;
  Queue<bool> after;
  bot.on_error([&](const std::string& e) { errors.push(e); });
  bot.on_message([](const subspace::Message&) { throw std::runtime_error("boom"); });
  bot.on_dispatch([&](const std::string& t, const json&) {
    if (t == "TRANSMISSION_CREATE") after.push(true);
  });
  bot.connect();
  server.dispatch("TRANSMISSION_CREATE", json::parse(R"({"channelType":"relay","channelId":"55","transmission":{"id":"9","content":"x","author":{"id":"4","username":"sam"}}})"));
  CHECK_EQ(errors.pop().value_or(""), std::string("boom"));
  CHECK(after.pop().has_value());
  CHECK(bot.connected());
  bot.disconnect();
  bot.wait();
}

void TestInvalidToken() {
  FakeServer server;
  server.handler = [&server](const Request& r) -> std::optional<std::pair<int, std::string>> {
    if (r.path == "/api/v1/bots/@me") return std::make_pair(200, server.me_json);
    return std::nullopt;
  };
  subspace::Bot bot(Options(server, "revoked"));
  Queue<int> closes;
  bot.on_disconnect([&](int code, const std::string&) { closes.push(code); });
  bool threw = false;
  try {
    bot.connect();
  } catch (const subspace::ApiError& e) {
    threw = true;
    CHECK_EQ(e.status(), 401);
    CHECK_EQ(e.code(), std::string("INVALID_BOT_TOKEN"));
  }
  CHECK(threw);
  CHECK_EQ(closes.pop().value_or(0), 4003);
  CHECK(server.upgrades.pop().has_value());
  CHECK(!server.upgrades.pop(milliseconds(500)).has_value());
  bot.wait();  // returns: the gateway gave up
  CHECK(!bot.connected());
}

void TestReconnect() {
  FakeServer server;
  subspace::Bot bot(Options(server));
  Queue<bool> readies;
  Queue<int> closes;
  bot.on_ready([&](const json&) { readies.push(true); });
  bot.on_disconnect([&](int code, const std::string&) { closes.push(code); });
  bot.connect();
  CHECK(readies.pop().has_value());
  CHECK(server.upgrades.pop().has_value());

  server.drop_gateways();
  CHECK_EQ(closes.pop().value_or(0), 1006);
  CHECK(server.upgrades.pop().has_value());
  CHECK(readies.pop().has_value());

  server.close_gateways(1012);
  CHECK_EQ(closes.pop().value_or(0), 1012);
  CHECK(server.upgrades.pop().has_value());
  CHECK(readies.pop().has_value());
  CHECK(bot.connected());

  // RECONNECT (op 7): the bot closes and comes back.
  server.send_raw(json{{"op", 7}});
  CHECK_EQ(closes.pop().value_or(0), 1000);
  CHECK(server.upgrades.pop().has_value());
  CHECK(readies.pop().has_value());
  // The server saw a drop, then two clean closes.
  CHECK_EQ(server.gateway_closed.pop().value_or(true), false);
  CHECK_EQ(server.gateway_closed.pop().value_or(false), true);
  CHECK_EQ(server.gateway_closed.pop().value_or(false), true);

  bot.disconnect();
  bot.wait();
  CHECK_EQ(server.gateway_closed.pop().value_or(false), true);
  CHECK_EQ(closes.pop().value_or(0), 1000);
  CHECK(!server.upgrades.pop(milliseconds(500)).has_value());
  CHECK(!bot.connected());
}

void TestUnreachable() {
  FakeServer server;
  auto options = Options(server);
  options.gateway_url = "ws://127.0.0.1:1/gateway";
  subspace::Bot bot(options);
  bool threw = false;
  try {
    bot.connect();
  } catch (const std::runtime_error&) {
    threw = true;
  }
  CHECK(threw);
}

struct TestCase {
  const char* name;
  void (*run)();
};

}  // namespace

int main() {
#if defined(_WIN32)
  WSADATA wsa;
  WSAStartup(MAKEWORD(2, 2), &wsa);
#endif
  const TestCase tests[] = {
      {"ed25519 RFC 8032 vectors", TestEd25519Vectors},
      {"small-order public keys and R are refused (was a security bug)", TestSmallOrderKeysRejected},
      {"verify_interaction", TestVerifyInteraction},
      {"verify_interaction rejects hostile inputs", TestVerifyHostileInputs},
      {"respond_with / defer_with", TestResponseBodies},
      {"me sends the bot token", TestMe},
      {"send, edit, delete, react", TestSendEditDeleteReact},
      {"register_commands", TestRegisterCommands},
      {"errors become ApiError", TestErrors},
      {"connect, identify, heartbeat", TestConnectAndHeartbeat},
      {"dispatches", TestDispatches},
      {"interactions answer with their own token", TestInteractions},
      {"handler exceptions are reported", TestHandlerErrors},
      {"invalid token fails connect", TestInvalidToken},
      {"reconnects, stops after disconnect", TestReconnect},
      {"unreachable gateway fails connect", TestUnreachable},
  };
  int failed_tests = 0;
  for (const auto& test : tests) {
    const int before = g_failures;
    const auto start = Clock::now();
    test.run();
    const auto ms = std::chrono::duration_cast<milliseconds>(Clock::now() - start).count();
    const bool ok = g_failures == before;
    if (!ok) ++failed_tests;
    std::cout << (ok ? "PASS " : "FAIL ") << test.name << " (" << ms << " ms)\n";
  }
  const size_t total = sizeof(tests) / sizeof(tests[0]);
  std::cout << (total - static_cast<size_t>(failed_tests)) << "/" << total << " tests passed\n";
  return failed_tests == 0 ? 0 : 1;
}
