// Tests for the C++ Rich Presence SDK against a fake desktop app: a small WebSocket server that
// behaves like apps/desktop/src-tauri/src/activity.rs. No test framework; exits non-zero on failure.

#include "subspace/rich_presence.h"

#if defined(_WIN32)
#if !defined(WIN32_LEAN_AND_MEAN)
#define WIN32_LEAN_AND_MEAN
#endif
#if !defined(NOMINMAX)
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

int g_failures = 0;

#define EXPECT(condition)                                                          \
  do {                                                                             \
    if (!(condition)) {                                                            \
      ++g_failures;                                                                \
      std::printf("    FAILED %s:%d: %s\n", __FILE__, __LINE__, #condition);       \
    }                                                                              \
  } while (0)

#define EXPECT_EQ(actual, expected)                                                \
  do {                                                                             \
    const auto actualValue = (actual);                                             \
    const auto expectedValue = (expected);                                         \
    if (!(actualValue == expectedValue)) {                                         \
      ++g_failures;                                                                \
      std::printf("    FAILED %s:%d: %s\n      got:      %s\n      expected: %s\n", \
                  __FILE__, __LINE__, #actual, Show(actualValue).c_str(),          \
                  Show(expectedValue).c_str());                                    \
    }                                                                              \
  } while (0)

std::string Show(const std::string& s) { return s; }
template <typename T>
std::string Show(T value) { return std::to_string(value); }

using Clock = std::chrono::steady_clock;
using std::chrono::milliseconds;

long long ElapsedMs(Clock::time_point since) {
  return static_cast<long long>(std::chrono::duration_cast<milliseconds>(Clock::now() - since).count());
}

bool WaitUntil(const std::function<bool()>& condition, milliseconds timeout) {
  const Clock::time_point deadline = Clock::now() + timeout;
  while (Clock::now() < deadline) {
    if (condition()) return true;
    std::this_thread::sleep_for(milliseconds(10));
  }
  return condition();
}

// --- sockets ----------------------------------------------------------------------------------

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

bool RecvExact(Socket s, std::string& out, size_t size) {
  out.clear();
  char buffer[4096];
  while (out.size() < size) {
    const size_t want = std::min(sizeof(buffer), size - out.size());
#if defined(_WIN32)
    const int n = recv(s, buffer, static_cast<int>(want), 0);
#else
    const ssize_t n = recv(s, buffer, want, 0);
#endif
    if (n <= 0) return false;
    out.append(buffer, static_cast<size_t>(n));
  }
  return true;
}

Socket Listen(uint16_t port, uint16_t* boundPort) {
  const Socket s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (s == kNoSocket) return kNoSocket;
#if !defined(_WIN32)
  int on = 1;
  setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));
#endif
  sockaddr_in address;
  std::memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = htons(port);
  socklen_t length = sizeof(address);
  if (bind(s, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0 || listen(s, 8) != 0 ||
      getsockname(s, reinterpret_cast<sockaddr*>(&address), &length) != 0) {
    CloseSocket(s);
    return kNoSocket;
  }
  if (boundPort != nullptr) *boundPort = ntohs(address.sin_port);
  return s;
}

bool Readable(Socket s, int timeoutMs) {
#if defined(_WIN32)
  fd_set set;
  FD_ZERO(&set);
  FD_SET(s, &set);
  timeval tv;
  tv.tv_sec = timeoutMs / 1000;
  tv.tv_usec = (timeoutMs % 1000) * 1000;
  return select(0, &set, nullptr, nullptr, &tv) > 0;
#else
  pollfd fd;
  fd.fd = s;
  fd.events = POLLIN;
  fd.revents = 0;
  return poll(&fd, 1, timeoutMs) > 0;
#endif
}

// A port nothing listens on (bound, then released).
uint16_t FreePort() {
  uint16_t port = 0;
  const Socket s = Listen(0, &port);
  CloseSocket(s);
  return port;
}

// An unmasked server frame.
std::string ServerFrame(unsigned opcode, const std::string& payload, bool fin = true) {
  std::string frame;
  frame.push_back(static_cast<char>((fin ? 0x80U : 0U) | opcode));
  const size_t size = payload.size();
  if (size < 126U) {
    frame.push_back(static_cast<char>(size));
  } else if (size <= 0xFFFFU) {
    frame.push_back(static_cast<char>(126));
    frame.push_back(static_cast<char>((size >> 8U) & 0xFFU));
    frame.push_back(static_cast<char>(size & 0xFFU));
  } else {
    frame.push_back(static_cast<char>(127));
    for (int shift = 56; shift >= 0; shift -= 8) {
      frame.push_back(static_cast<char>((static_cast<uint64_t>(size) >> static_cast<unsigned>(shift)) & 0xFFU));
    }
  }
  return frame + payload;
}

std::string Lower(std::string s) {
  for (char& c : s) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return s;
}

// --- the fake desktop app ---------------------------------------------------------------------

class FakeDesktop {
 public:
  enum class Mode {
    Normal,  // READY, then ok:true for every command
    Silent,  // accepts the upgrade but never says READY
    Refuse,  // READY, then ok:false for every command
    Tricky,  // long frames, pings and a fragmented READY first
  };

  explicit FakeDesktop(uint16_t port = 0, Mode mode = Mode::Normal) : mode_(mode) {
    listener_ = Listen(port, &port_);
    if (listener_ != kNoSocket) acceptor_ = std::thread([this] { AcceptLoop(); });
  }
  ~FakeDesktop() { Close(); }

  bool Ok() const { return listener_ != kNoSocket; }
  uint16_t Port() const { return port_; }

  // Stops listening and drops every connection, like the desktop app quitting.
  void Close() {
    if (closed_.exchange(true)) return;
    if (acceptor_.joinable()) acceptor_.join();
    if (listener_ != kNoSocket) CloseSocket(listener_);
    {
      std::lock_guard<std::mutex> lock(mutex_);
      for (Socket s : clients_) ShutdownSocket(s);
    }
    for (std::thread& t : handlers_) t.join();
  }

  std::vector<std::string> Requests() { return Copy(requests_); }
  std::vector<std::string> Messages() { return Copy(messages_); }
  std::vector<std::string> Pongs() { return Copy(pongs_); }
  int Closes() {
    std::lock_guard<std::mutex> lock(mutex_);
    return closes_;
  }
  int UnmaskedFrames() {
    std::lock_guard<std::mutex> lock(mutex_);
    return unmasked_;
  }
  bool WaitForMessages(size_t count, milliseconds timeout = milliseconds(3000)) {
    return WaitUntil([&] { return Messages().size() >= count; }, timeout);
  }

 private:
  std::vector<std::string> Copy(const std::vector<std::string>& v) {
    std::lock_guard<std::mutex> lock(mutex_);
    return v;
  }

  void AcceptLoop() {
    while (!closed_) {
      if (!Readable(listener_, 20)) continue;
      const Socket client = accept(listener_, nullptr, nullptr);
      if (client == kNoSocket) continue;
      std::lock_guard<std::mutex> lock(mutex_);
      clients_.push_back(client);
      handlers_.emplace_back([this, client] {
        Serve(client);
        CloseSocket(client);
      });
    }
  }

  void Serve(Socket client) {
    std::string head;
    std::string byte;
    while (head.find("\r\n\r\n") == std::string::npos) {
      if (!RecvExact(client, byte, 1) || head.size() > 16384U) return;
      head += byte;
    }
    {
      std::lock_guard<std::mutex> lock(mutex_);
      requests_.push_back(head);
    }
    const std::string marker = "sec-websocket-key:";
    const size_t at = Lower(head).find(marker);
    if (at == std::string::npos) return;
    size_t start = at + marker.size();
    while (head[start] == ' ') ++start;
    const std::string key = head.substr(start, head.find("\r\n", start) - start);
    if (Lower(head).find("\r\norigin:") != std::string::npos) {
      SendAll(client, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    std::string response = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n";
    response += "sec-websocket-accept: " + subspace::detail::WebSocketAccept(key) + "\r\n\r\n";
    if (mode_ == Mode::Tricky) {
      // The upgrade response and the first frames in one packet, a 16-bit and a 64-bit length,
      // a ping, and READY split in two with another ping between the fragments.
      response += ServerFrame(0x1, "{\"evt\":\"HELLO\",\"pad\":\"" + std::string(300, 'x') + "\"}");
      response += ServerFrame(0x1, "{\"evt\":\"BIG\",\"pad\":\"" + std::string(70000, 'y') + "\"}");
      response += ServerFrame(0x9, "hb");
      response += ServerFrame(0x1, "{\"evt\":\"RE", false);
      response += ServerFrame(0x9, "mid");
      response += ServerFrame(0x0, "ADY\",\"v\":1}");
    } else if (mode_ != Mode::Silent) {
      response += ServerFrame(0x1, "{\"evt\":\"READY\",\"v\":1}");
    }
    if (!SendAll(client, response)) return;

    for (;;) {
      std::string header;
      if (!RecvExact(client, header, 2)) return;
      const unsigned opcode = static_cast<unsigned char>(header[0]) & 0x0FU;
      const bool masked = (static_cast<unsigned char>(header[1]) & 0x80U) != 0;
      uint64_t size = static_cast<unsigned char>(header[1]) & 0x7FU;
      std::string extra;
      if (size == 126U) {
        if (!RecvExact(client, extra, 2)) return;
        size = (static_cast<uint64_t>(static_cast<unsigned char>(extra[0])) << 8U) | static_cast<unsigned char>(extra[1]);
      } else if (size == 127U) {
        if (!RecvExact(client, extra, 8)) return;
        size = 0;
        for (char c : extra) size = (size << 8U) | static_cast<unsigned char>(c);
      }
      std::string mask(4, '\0');
      if (masked && !RecvExact(client, mask, 4)) return;
      std::string payload;
      if (!RecvExact(client, payload, static_cast<size_t>(size))) return;
      for (size_t k = 0; k < payload.size(); ++k) payload[k] = static_cast<char>(payload[k] ^ mask[k % 4U]);
      std::lock_guard<std::mutex> lock(mutex_);
      if (!masked) ++unmasked_;
      if (opcode == 0x8U) {
        ++closes_;
        return;
      }
      if (opcode == 0xAU) {
        pongs_.push_back(payload);
        continue;
      }
      if (opcode != 0x1U) continue;
      messages_.push_back(payload);
      const subspace::detail::Reply command = subspace::detail::ParseReply(payload);
      const std::string nonce = subspace::detail::JsonString(command.nonce);
      const std::string reply = mode_ == Mode::Refuse
                                    ? "{\"nonce\":" + nonce + ",\"ok\":false,\"error\":\"Nope \\\"x\\\" \\u00e9\"}"
                                    : "{\"nonce\":" + nonce + ",\"ok\":true}";
      SendAll(client, ServerFrame(0x1, reply));
    }
  }

  Mode mode_;
  Socket listener_ = kNoSocket;
  uint16_t port_ = 0;
  std::atomic<bool> closed_{false};
  std::thread acceptor_;
  std::mutex mutex_;
  std::vector<Socket> clients_;
  std::vector<std::thread> handlers_;
  std::vector<std::string> requests_;
  std::vector<std::string> messages_;
  std::vector<std::string> pongs_;
  int closes_ = 0;
  int unmasked_ = 0;
};

subspace::Options TestOptions(std::vector<uint16_t> ports) {
  subspace::Options options;
  options.clientId = "1234567890";
  options.ports = std::move(ports);
  options.reconnect = false;
  return options;
}

subspace::Activity FullActivity() {
  subspace::Activity activity;
  activity.type = subspace::ActivityType::Competing;
  activity.details = "Competitive \xC2\xB7 Mirage \xF0\x9F\x8E\xAF";  // "·" and an emoji pass through
  activity.state = "Say \"hi\"\\ now\n\t\x01 bad:\xFF end";        // escapes; invalid byte -> U+FFFD
  activity.startedAt = 1700000000000LL;
  activity.endsAt = 1700000600000LL;
  activity.largeImage = "https://cdn.example.com/maps/mirage.png";
  activity.largeText = "Mirage";
  activity.smallImage = "https://cdn.example.com/rank.png";
  activity.smallText = "Rank";
  activity.party = subspace::Party{2, 5};
  activity.buttons = {{"Watch", "https://example.com/match/123"},
                      {"Join", "https://example.com/join"},
                      {"Third", "https://example.com/dropped"}};
  return activity;
}

const char* const kFullActivityJson =
    "{\"type\":\"competing\",\"details\":\"Competitive \xC2\xB7 Mirage \xF0\x9F\x8E\xAF\","
    "\"state\":\"Say \\\"hi\\\"\\\\ now\\n\\t\\u0001 bad:\xEF\xBF\xBD end\","
    "\"startedAt\":1700000000000,\"endsAt\":1700000600000,"
    "\"largeImage\":\"https://cdn.example.com/maps/mirage.png\",\"largeText\":\"Mirage\","
    "\"smallImage\":\"https://cdn.example.com/rank.png\",\"smallText\":\"Rank\","
    "\"party\":{\"size\":2,\"max\":5},"
    "\"buttons\":[{\"label\":\"Watch\",\"url\":\"https://example.com/match/123\"},"
    "{\"label\":\"Join\",\"url\":\"https://example.com/join\"}]}";

// --- tests ------------------------------------------------------------------------------------

void TestHandshakeKey() {
  // RFC 6455 section 1.3.
  EXPECT_EQ(subspace::detail::WebSocketAccept("dGhlIHNhbXBsZSBub25jZQ=="), std::string("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
}

void TestJson() {
  EXPECT_EQ(subspace::detail::ActivityToJson(FullActivity()), std::string(kFullActivityJson));
  EXPECT_EQ(subspace::detail::ActivityToJson(subspace::Activity()), std::string("{}"));
  subspace::Activity minimal;
  minimal.state = "";
  EXPECT_EQ(subspace::detail::ActivityToJson(minimal), std::string("{\"state\":\"\"}"));
  EXPECT_EQ(subspace::detail::JsonString(std::string("a\0b\x7F\x1F", 5)), std::string("\"a\\u0000b\\u007f\\u001f\""));
  // Overlong, surrogate and truncated sequences are replaced, byte by byte.
  EXPECT_EQ(subspace::detail::JsonString("\xC0\xAF|\xED\xA0\x80|\xE2\x82"),
            std::string("\"\xEF\xBF\xBD\xEF\xBF\xBD|\xEF\xBF\xBD\xEF\xBF\xBD\xEF\xBF\xBD|\xEF\xBF\xBD\xEF\xBF\xBD\""));

  const subspace::detail::Reply ready = subspace::detail::ParseReply("{ \"evt\" : \"READY\", \"v\": 1 }");
  EXPECT(ready.valid);
  EXPECT_EQ(ready.evt, std::string("READY"));
  const subspace::detail::Reply ok = subspace::detail::ParseReply("{\"nonce\":\"7\",\"ok\":true,\"x\":{\"a\":[1,{\"b\":null}]}}");
  EXPECT(ok.valid);
  EXPECT_EQ(ok.nonce, std::string("7"));
  EXPECT(ok.ok.has_value() && *ok.ok);
  const subspace::detail::Reply refused = subspace::detail::ParseReply("{\"nonce\":12,\"ok\":false,\"error\":\"Bad \\u00e9 \\ud83c\\udfaf \\n\"}");
  EXPECT(refused.valid);
  EXPECT_EQ(refused.nonce, std::string("12"));
  EXPECT(refused.ok.has_value() && !*refused.ok);
  EXPECT_EQ(refused.error, std::string("Bad \xC3\xA9 \xF0\x9F\x8E\xAF \n"));
  EXPECT(!subspace::detail::ParseReply("not json").valid);
  EXPECT(!subspace::detail::ParseReply("{\"evt\":\"READY\"").valid);
  EXPECT(!subspace::detail::ParseReply("[1]").valid);
}

void TestClientId() {
  EXPECT(subspace::RichPresence::IsValidClientId("1234567890"));
  EXPECT(subspace::RichPresence::IsValidClientId("9223372036854775807"));
  EXPECT(!subspace::RichPresence::IsValidClientId(""));
  EXPECT(!subspace::RichPresence::IsValidClientId("0123"));
  EXPECT(!subspace::RichPresence::IsValidClientId("12a"));
  EXPECT(!subspace::RichPresence::IsValidClientId("12345678901234567890"));
  subspace::Options options;
  options.clientId = "abc";
  subspace::RichPresence presence(options);
  EXPECT(!presence.Start());
  EXPECT(!presence.IsConnected());
}

void TestConnectAndCommands() {
  FakeDesktop desktop;
  EXPECT(desktop.Ok());
  const uint16_t closedPort = FreePort();
  subspace::RichPresence presence(TestOptions({closedPort, desktop.Port()}));
  std::atomic<int> readyCalls{0};
  presence.SetOnReady([&] { ++readyCalls; });
  EXPECT(presence.Start());
  EXPECT(WaitUntil([&] { return presence.IsConnected(); }, milliseconds(8000)));
  EXPECT_EQ(presence.ConnectedPort(), desktop.Port());
  EXPECT_EQ(readyCalls.load(), 1);

  const std::vector<std::string> requests = desktop.Requests();
  EXPECT_EQ(requests.size(), static_cast<size_t>(1));
  if (!requests.empty()) {
    const std::string head = requests[0];
    EXPECT_EQ(head.substr(0, head.find("\r\n")), std::string("GET /?v=1&client_id=1234567890 HTTP/1.1"));
    EXPECT(Lower(head).find("origin") == std::string::npos);
    EXPECT(head.find("\r\nUpgrade: websocket\r\n") != std::string::npos);
    EXPECT(head.find("\r\nConnection: Upgrade\r\n") != std::string::npos);
    EXPECT(head.find("\r\nSec-WebSocket-Version: 13\r\n") != std::string::npos);
    EXPECT(head.find("\r\nHost: 127.0.0.1:" + std::to_string(desktop.Port()) + "\r\n") != std::string::npos);
  }

  presence.SetActivity(FullActivity());
  EXPECT(desktop.WaitForMessages(1));
  presence.ClearActivity();
  EXPECT(desktop.WaitForMessages(2));
  const std::vector<std::string> messages = desktop.Messages();
  EXPECT_EQ(messages.size(), static_cast<size_t>(2));
  if (messages.size() == 2U) {
    EXPECT_EQ(messages[0], std::string("{\"cmd\":\"SET_ACTIVITY\",\"nonce\":\"1\",\"args\":{\"activity\":") + kFullActivityJson + "}}");
    EXPECT_EQ(messages[1], std::string("{\"cmd\":\"CLEAR_ACTIVITY\",\"nonce\":\"2\"}"));
  }
  EXPECT_EQ(desktop.UnmaskedFrames(), 0);
}

void TestActivityBeforeConnecting() {
  FakeDesktop desktop;
  subspace::RichPresence presence(TestOptions({desktop.Port()}));
  subspace::Activity activity;
  activity.details = "Loading";
  presence.SetActivity(activity);
  activity.details = "In the lobby";
  presence.SetActivity(activity);  // only the latest is sent
  presence.Start();
  EXPECT(desktop.WaitForMessages(1));
  std::this_thread::sleep_for(milliseconds(200));
  const std::vector<std::string> messages = desktop.Messages();
  EXPECT_EQ(messages.size(), static_cast<size_t>(1));
  if (!messages.empty()) {
    EXPECT_EQ(messages[0], std::string("{\"cmd\":\"SET_ACTIVITY\",\"nonce\":\"1\",\"args\":{\"activity\":{\"details\":\"In the lobby\"}}}"));
  }
}

void TestSilentPortIsSkipped() {
  FakeDesktop silent(0, FakeDesktop::Mode::Silent);
  FakeDesktop desktop;
  subspace::RichPresence presence(TestOptions({silent.Port(), desktop.Port()}));  // default 3 s readyTimeout
  const Clock::time_point started = Clock::now();
  presence.Start();
  EXPECT(WaitUntil([&] { return presence.IsConnected(); }, milliseconds(6000)));
  const long long took = ElapsedMs(started);
  std::printf("    connected after skipping the silent port in %lld ms\n", took);
  EXPECT(took >= 2900 && took < 4500);
  EXPECT_EQ(presence.ConnectedPort(), desktop.Port());
  EXPECT_EQ(silent.Requests().size(), static_cast<size_t>(1));
}

void TestFramesPingsAndFragments() {
  FakeDesktop desktop(0, FakeDesktop::Mode::Tricky);
  subspace::RichPresence presence(TestOptions({desktop.Port()}));
  presence.Start();
  EXPECT(WaitUntil([&] { return presence.IsConnected(); }, milliseconds(3000)));
  EXPECT(WaitUntil([&] { return desktop.Pongs().size() >= 2U; }, milliseconds(2000)));
  const std::vector<std::string> pongs = desktop.Pongs();
  EXPECT(pongs.size() == 2U && pongs[0] == "hb" && pongs[1] == "mid");
  subspace::Activity activity;
  activity.state = std::string(200, 's');  // a client frame with a 16-bit length
  presence.SetActivity(activity);
  EXPECT(desktop.WaitForMessages(1));
  const std::vector<std::string> messages = desktop.Messages();
  if (!messages.empty()) EXPECT(messages[0].find(std::string(200, 's')) != std::string::npos);
}

void TestRefusedCommandReportsError() {
  FakeDesktop desktop(0, FakeDesktop::Mode::Refuse);
  subspace::RichPresence presence(TestOptions({desktop.Port()}));
  std::mutex mutex;
  std::string error;
  presence.SetOnError([&](const std::string& e) {
    std::lock_guard<std::mutex> lock(mutex);
    error = e;
  });
  presence.Start();
  presence.SetActivity(subspace::Activity());
  EXPECT(WaitUntil([&] {
    std::lock_guard<std::mutex> lock(mutex);
    return !error.empty();
  }, milliseconds(3000)));
  std::lock_guard<std::mutex> lock(mutex);
  EXPECT_EQ(error, std::string("Nope \"x\" \xC3\xA9"));
}

void TestReconnectSendsActivityAgain() {
  std::unique_ptr<FakeDesktop> desktop(new FakeDesktop());
  const uint16_t port = desktop->Port();
  subspace::Options options = TestOptions({port});
  options.reconnect = true;
  options.reconnectDelay = milliseconds(200);
  subspace::RichPresence presence(options);
  std::atomic<int> readyCalls{0};
  std::atomic<int> disconnectCalls{0};
  presence.SetOnReady([&] { ++readyCalls; });
  presence.SetOnDisconnected([&] { ++disconnectCalls; });
  presence.Start();
  subspace::Activity activity;
  activity.state = "In the lobby";
  presence.SetActivity(activity);
  EXPECT(desktop->WaitForMessages(1));

  desktop->Close();  // the desktop app quits
  EXPECT(WaitUntil([&] { return !presence.IsConnected(); }, milliseconds(3000)));
  EXPECT(WaitUntil([&] { return disconnectCalls.load() == 1; }, milliseconds(1000)));
  std::this_thread::sleep_for(milliseconds(500));  // a few failed attempts while it is closed

  desktop.reset(new FakeDesktop(port));  // and starts again on the same port
  EXPECT(desktop->Ok());
  EXPECT(desktop->WaitForMessages(1, milliseconds(5000)));
  EXPECT(presence.IsConnected());
  EXPECT_EQ(readyCalls.load(), 2);
  const std::vector<std::string> messages = desktop->Messages();
  if (!messages.empty()) {
    EXPECT_EQ(messages[0], std::string("{\"cmd\":\"SET_ACTIVITY\",\"nonce\":\"2\",\"args\":{\"activity\":{\"state\":\"In the lobby\"}}}"));
  }
}

void TestShutdownIsFast() {
  {  // while connected
    FakeDesktop desktop;
    Clock::time_point started;
    {
      subspace::Options options = TestOptions({desktop.Port()});
      options.reconnect = true;
      subspace::RichPresence presence(options);
      std::atomic<int> disconnectCalls{0};
      presence.SetOnDisconnected([&] { ++disconnectCalls; });
      presence.Start();
      EXPECT(WaitUntil([&] { return presence.IsConnected(); }, milliseconds(3000)));
      started = Clock::now();
      presence.Stop();
      EXPECT_EQ(disconnectCalls.load(), 0);  // only when the desktop app goes away
    }
    const long long took = ElapsedMs(started);
    std::printf("    stop while connected: %lld ms\n", took);
    EXPECT(took < 300);
    EXPECT(WaitUntil([&] { return desktop.Closes() == 1; }, milliseconds(1000)));
  }
  {  // while waiting 15 s before the next attempt
    subspace::Options options = TestOptions({FreePort()});
    options.reconnect = true;
    std::unique_ptr<subspace::RichPresence> presence(new subspace::RichPresence(options));
    presence->Start();
    std::this_thread::sleep_for(milliseconds(300));
    const Clock::time_point started = Clock::now();
    presence.reset();
    const long long took = ElapsedMs(started);
    std::printf("    destroy while waiting to reconnect: %lld ms\n", took);
    EXPECT(took < 300);
  }
  {  // while waiting for READY from a port that never answers
    FakeDesktop silent(0, FakeDesktop::Mode::Silent);
    std::unique_ptr<subspace::RichPresence> presence(new subspace::RichPresence(TestOptions({silent.Port()})));
    presence->Start();
    EXPECT(WaitUntil([&] { return silent.Requests().size() == 1U; }, milliseconds(2000)));
    const Clock::time_point started = Clock::now();
    presence.reset();
    const long long took = ElapsedMs(started);
    std::printf("    destroy while waiting for READY: %lld ms\n", took);
    EXPECT(took < 300);
  }
}

void TestRestartAfterStop() {
  FakeDesktop desktop;
  subspace::RichPresence presence(TestOptions({desktop.Port()}));
  presence.Start();
  EXPECT(WaitUntil([&] { return presence.IsConnected(); }, milliseconds(3000)));
  presence.Stop();
  EXPECT(!presence.IsConnected());
  EXPECT(presence.Start());
  EXPECT(WaitUntil([&] { return presence.IsConnected(); }, milliseconds(3000)));
  EXPECT_EQ(desktop.Requests().size(), static_cast<size_t>(2));
}

// --- hostile strings ----------------------------------------------------------------------------

// A strict RFC 8259 parser for the tests: no raw control characters in strings, only the standard
// escapes, \u surrogates must pair, raw bytes must be valid UTF-8, no trailing data, no duplicate
// keys. Values are kept as a tree so tests can check the exact keys and round-tripped strings.
struct JsonValue {
  enum class Kind { Null, Bool, Number, String, Array, Object } kind = Kind::Null;
  std::string text;  // string value, or the number / literal as written
  std::vector<JsonValue> items;
  std::vector<std::pair<std::string, JsonValue>> members;
  const JsonValue* Get(const std::string& key) const {
    for (const auto& member : members) {
      if (member.first == key) return &member.second;
    }
    return nullptr;
  }
  std::vector<std::string> Keys() const {
    std::vector<std::string> keys;
    for (const auto& member : members) keys.push_back(member.first);
    return keys;
  }
};

class StrictJson {
 public:
  static bool Parse(const std::string& text, JsonValue& out) {
    out = JsonValue();
    StrictJson parser(text);
    parser.Space();
    if (!parser.Value(out, 0)) return false;
    parser.Space();
    return parser.at_ == text.size();
  }

 private:
  explicit StrictJson(const std::string& text) : s_(text) {}
  unsigned char Peek() const { return at_ < s_.size() ? static_cast<unsigned char>(s_[at_]) : 0U; }
  void Space() {
    while (at_ < s_.size() && (s_[at_] == ' ' || s_[at_] == '\t' || s_[at_] == '\n' || s_[at_] == '\r')) ++at_;
  }
  bool Literal(const char* word) {
    const size_t n = std::strlen(word);
    if (s_.compare(at_, n, word) != 0) return false;
    at_ += n;
    return true;
  }
  bool Value(JsonValue& out, int depth) {
    if (depth > 64) return false;
    const unsigned char c = Peek();
    if (c == '{') return Object(out, depth);
    if (c == '[') return Array(out, depth);
    if (c == '"') {
      out.kind = JsonValue::Kind::String;
      return String(out.text);
    }
    if (c == 't' || c == 'f') {
      out.kind = JsonValue::Kind::Bool;
      out.text = c == 't' ? "true" : "false";
      return Literal(c == 't' ? "true" : "false");
    }
    if (c == 'n') {
      out.kind = JsonValue::Kind::Null;
      return Literal("null");
    }
    return Number(out);
  }
  bool Number(JsonValue& out) {
    const size_t start = at_;
    if (Peek() == '-') ++at_;
    if (Peek() == '0') {
      ++at_;
    } else if (Peek() >= '1' && Peek() <= '9') {
      while (Peek() >= '0' && Peek() <= '9') ++at_;
    } else {
      return false;
    }
    if (Peek() == '.') {
      ++at_;
      if (!(Peek() >= '0' && Peek() <= '9')) return false;
      while (Peek() >= '0' && Peek() <= '9') ++at_;
    }
    if (Peek() == 'e' || Peek() == 'E') {
      ++at_;
      if (Peek() == '+' || Peek() == '-') ++at_;
      if (!(Peek() >= '0' && Peek() <= '9')) return false;
      while (Peek() >= '0' && Peek() <= '9') ++at_;
    }
    out.kind = JsonValue::Kind::Number;
    out.text = s_.substr(start, at_ - start);
    return true;
  }
  bool Array(JsonValue& out, int depth) {
    out.kind = JsonValue::Kind::Array;
    ++at_;
    Space();
    if (Peek() == ']') {
      ++at_;
      return true;
    }
    for (;;) {
      JsonValue item;
      Space();
      if (!Value(item, depth + 1)) return false;
      out.items.push_back(std::move(item));
      Space();
      if (Peek() == ',') {
        ++at_;
        continue;
      }
      if (Peek() != ']') return false;
      ++at_;
      return true;
    }
  }
  bool Object(JsonValue& out, int depth) {
    out.kind = JsonValue::Kind::Object;
    ++at_;
    Space();
    if (Peek() == '}') {
      ++at_;
      return true;
    }
    for (;;) {
      Space();
      std::string key;
      if (Peek() != '"' || !String(key)) return false;
      if (out.Get(key) != nullptr) return false;  // duplicate key
      Space();
      if (Peek() != ':') return false;
      ++at_;
      Space();
      JsonValue value;
      if (!Value(value, depth + 1)) return false;
      out.members.emplace_back(std::move(key), std::move(value));
      Space();
      if (Peek() == ',') {
        ++at_;
        continue;
      }
      if (Peek() != '}') return false;
      ++at_;
      return true;
    }
  }
  bool Hex4(uint32_t& value) {
    if (at_ + 4U > s_.size()) return false;
    value = 0;
    for (int k = 0; k < 4; ++k) {
      const char c = s_[at_++];
      uint32_t digit;
      if (c >= '0' && c <= '9') digit = static_cast<uint32_t>(c - '0');
      else if (c >= 'a' && c <= 'f') digit = static_cast<uint32_t>(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F') digit = static_cast<uint32_t>(c - 'A' + 10);
      else return false;
      value = (value << 4U) | digit;
    }
    return true;
  }
  static void Utf8(std::string& out, uint32_t cp) {
    if (cp < 0x80U) {
      out.push_back(static_cast<char>(cp));
    } else if (cp < 0x800U) {
      out.push_back(static_cast<char>(0xC0U | (cp >> 6U)));
      out.push_back(static_cast<char>(0x80U | (cp & 0x3FU)));
    } else if (cp < 0x10000U) {
      out.push_back(static_cast<char>(0xE0U | (cp >> 12U)));
      out.push_back(static_cast<char>(0x80U | ((cp >> 6U) & 0x3FU)));
      out.push_back(static_cast<char>(0x80U | (cp & 0x3FU)));
    } else {
      out.push_back(static_cast<char>(0xF0U | (cp >> 18U)));
      out.push_back(static_cast<char>(0x80U | ((cp >> 12U) & 0x3FU)));
      out.push_back(static_cast<char>(0x80U | ((cp >> 6U) & 0x3FU)));
      out.push_back(static_cast<char>(0x80U | (cp & 0x3FU)));
    }
  }
  // Length of a valid UTF-8 sequence at at_, 0 if invalid.
  size_t Utf8Length() const {
    const unsigned char lead = Peek();
    size_t n;
    unsigned char low = 0x80, high = 0xBF;
    if (lead >= 0xC2U && lead <= 0xDFU) n = 2;
    else if (lead >= 0xE0U && lead <= 0xEFU) {
      n = 3;
      if (lead == 0xE0U) low = 0xA0;
      if (lead == 0xEDU) high = 0x9F;
    } else if (lead >= 0xF0U && lead <= 0xF4U) {
      n = 4;
      if (lead == 0xF0U) low = 0x90;
      if (lead == 0xF4U) high = 0x8F;
    } else return 0;
    if (at_ + n > s_.size()) return 0;
    const unsigned char second = static_cast<unsigned char>(s_[at_ + 1U]);
    if (second < low || second > high) return 0;
    for (size_t k = 2; k < n; ++k) {
      const unsigned char b = static_cast<unsigned char>(s_[at_ + k]);
      if (b < 0x80U || b > 0xBFU) return 0;
    }
    return n;
  }
  bool String(std::string& out) {
    ++at_;  // opening quote
    for (;;) {
      if (at_ >= s_.size()) return false;
      const unsigned char c = Peek();
      if (c == '"') {
        ++at_;
        return true;
      }
      if (c < 0x20U) return false;  // raw control character
      if (c >= 0x80U) {
        const size_t n = Utf8Length();
        if (n == 0) return false;
        out.append(s_, at_, n);
        at_ += n;
        continue;
      }
      if (c != '\\') {
        out.push_back(static_cast<char>(c));
        ++at_;
        continue;
      }
      ++at_;
      if (at_ >= s_.size()) return false;
      const char e = s_[at_++];
      switch (e) {
        case '"': out.push_back('"'); break;
        case '\\': out.push_back('\\'); break;
        case '/': out.push_back('/'); break;
        case 'b': out.push_back('\b'); break;
        case 'f': out.push_back('\f'); break;
        case 'n': out.push_back('\n'); break;
        case 'r': out.push_back('\r'); break;
        case 't': out.push_back('\t'); break;
        case 'u': {
          uint32_t unit;
          if (!Hex4(unit)) return false;
          if (unit >= 0xDC00U && unit <= 0xDFFFU) return false;  // lone low surrogate
          if (unit >= 0xD800U && unit <= 0xDBFFU) {
            uint32_t low;
            if (s_.compare(at_, 2, "\\u") != 0) return false;  // lone high surrogate
            at_ += 2;
            if (!Hex4(low) || low < 0xDC00U || low > 0xDFFFU) return false;
            unit = 0x10000U + ((unit - 0xD800U) << 10U) + (low - 0xDC00U);
          }
          Utf8(out, unit);
          break;
        }
        default: return false;
      }
    }
  }

  const std::string& s_;
  size_t at_ = 0;
};

// Every byte 0x00-0x1F and 0x7F, plus quotes, backslashes, slashes and U+2028 / U+2029.
std::string AllControlCharacters() {
  std::string text;
  for (int c = 0; c < 0x20; ++c) text.push_back(static_cast<char>(c));
  text += "\x7F\"\\/\\\\\"\xE2\x80\xA8|\xE2\x80\xA9";
  return text;
}

const std::vector<std::string>& HostileStrings() {
  static const std::vector<std::string> strings = {
      "\"",
      "\\",
      "\\\"",
      "\"\\",
      "a\"b\\c\"d",
      "line\nbreak\r\ncarriage\ttab",
      AllControlCharacters(),
      std::string(1, '\0'),
      std::string("nul\0inside", 10),
      "\xE2\x80\xA8\xE2\x80\xA9",                                 // U+2028 / U+2029
      "</script><script>alert(1)</script>",
      "\",\"type\":0,\"x\":\"",                                   // JSON injection
      "\"},\"cmd\":\"CLEAR_ACTIVITY\",\"z\":{\"a\":\"",
      "\\\",\\\"type\\\":0,\\\"x\\\":\\\"",
      "\"]}],\"buttons\":[{\"label\":\"x\",\"url\":\"javascript:alert(1)\"}],\"y\":\"",
      "\xF0\x9F\x8E\xAF emoji \xC3\xA9 \xE4\xB8\xAD \xF4\x8F\xBF\xBF",  // up to U+10FFFF
      std::string(70000, 'x') + "\"" + std::string(70000, '\\'),  // long, and a 64-bit frame length
  };
  return strings;
}

subspace::Activity HostileActivity(const std::string& s) {
  subspace::Activity activity;
  activity.type = subspace::ActivityType::Playing;
  activity.details = s;
  activity.state = s;
  activity.largeImage = s;
  activity.largeText = s;
  activity.smallImage = s;
  activity.smallText = s;
  activity.buttons = {{s, s}, {s + "2", s + "3"}};
  return activity;
}

// Parses an ActivityToJson object and checks it has exactly the expected keys with `want` everywhere.
void ExpectHostileActivity(const JsonValue& object, const std::string& want) {
  EXPECT(object.kind == JsonValue::Kind::Object);
  const std::vector<std::string> keys = {"type", "details", "state", "largeImage", "largeText", "smallImage", "smallText", "buttons"};
  EXPECT(object.Keys() == keys);
  const JsonValue* type = object.Get("type");
  EXPECT(type != nullptr && type->kind == JsonValue::Kind::String && type->text == "playing");
  for (size_t k = 1; k + 1 < keys.size(); ++k) {
    const JsonValue* value = object.Get(keys[k]);
    EXPECT(value != nullptr && value->kind == JsonValue::Kind::String && value->text == want);
  }
  const JsonValue* buttons = object.Get("buttons");
  EXPECT(buttons != nullptr && buttons->kind == JsonValue::Kind::Array && buttons->items.size() == 2U);
  if (buttons != nullptr && buttons->items.size() == 2U) {
    const std::vector<std::string> buttonKeys = {"label", "url"};
    EXPECT(buttons->items[0].Keys() == buttonKeys);
    EXPECT(buttons->items[1].Keys() == buttonKeys);
    const JsonValue* label = buttons->items[0].Get("label");
    const JsonValue* url = buttons->items[0].Get("url");
    EXPECT(label != nullptr && label->text == want);
    EXPECT(url != nullptr && url->text == want);
    const JsonValue* label2 = buttons->items[1].Get("label");
    const JsonValue* url2 = buttons->items[1].Get("url");
    EXPECT(label2 != nullptr && label2->text == want + "2");
    EXPECT(url2 != nullptr && url2->text == want + "3");
  }
}

void TestHostileStringsSerialize() {
  // The parser itself must be strict, or the checks below prove nothing.
  JsonValue scratch;
  EXPECT(!StrictJson::Parse("{\"a\":\"\x01\"}", scratch));
  EXPECT(!StrictJson::Parse("{\"a\":\"\\ud800\"}", scratch));
  EXPECT(!StrictJson::Parse("{\"a\":\"\\udc00\"}", scratch));
  EXPECT(!StrictJson::Parse("{\"a\":\"\\x41\"}", scratch));
  EXPECT(!StrictJson::Parse("{\"a\":\"\xFF\"}", scratch));
  EXPECT(!StrictJson::Parse("{\"a\":1,\"a\":2}", scratch));
  EXPECT(!StrictJson::Parse("{\"a\":1} x", scratch));
  EXPECT(StrictJson::Parse("{\"a\":\"\\ud83c\\udfaf\\u2028\"}", scratch));

  for (const std::string& s : HostileStrings()) {
    const std::string json = subspace::detail::ActivityToJson(HostileActivity(s));
    JsonValue object;
    const bool parsed = StrictJson::Parse(json, object);
    EXPECT(parsed);
    if (parsed) ExpectHostileActivity(object, s);
    JsonValue str;
    EXPECT(StrictJson::Parse(subspace::detail::JsonString(s), str) && str.kind == JsonValue::Kind::String && str.text == s);
  }

  // Every single byte value: valid ASCII round-trips, any lone byte >= 0x80 becomes U+FFFD.
  for (int b = 0; b < 256; ++b) {
    const std::string s(1, static_cast<char>(b));
    JsonValue str;
    const bool parsed = StrictJson::Parse(subspace::detail::JsonString(s), str);
    EXPECT(parsed);
    if (parsed) EXPECT_EQ(str.text, b < 0x80 ? s : std::string("\xEF\xBF\xBD"));
  }

  // Lone surrogates can only reach C++ as CESU-8 / WTF-8 bytes; they are replaced (documented: "invalid
  // UTF-8 replaced"), never emitted as \ud800 or raw ED A0 80.
  std::string sixReplacements;
  for (int k = 0; k < 6; ++k) sixReplacements += "\xEF\xBF\xBD";
  const std::vector<std::pair<std::string, std::string>> surrogates = {
      {"\xED\xA0\x80", "\xEF\xBF\xBD\xEF\xBF\xBD\xEF\xBF\xBD"},  // lone high U+D800
      {"\xED\xBF\xBF", "\xEF\xBF\xBD\xEF\xBF\xBD\xEF\xBF\xBD"},  // lone low U+DFFF
      {"a\xED\xA0\xBD\xED\xBE\xAF" "b", "a" + sixReplacements + "b"},  // CESU-8 pair for U+1F3AF
  };
  for (const auto& pair : surrogates) {
    JsonValue str;
    const bool parsed = StrictJson::Parse(subspace::detail::JsonString(pair.first), str);
    EXPECT(parsed);
    if (parsed) EXPECT_EQ(str.text, pair.second);
  }
  // Truncated sequences at the very end of the string must not read past it.
  for (const char* tail : {"\xC3", "\xE2\x82", "\xF0\x9F\x8E", "\xF0", "\xE2"}) {
    JsonValue str;
    const std::string s = std::string("end") + tail;
    EXPECT(StrictJson::Parse(subspace::detail::JsonString(s), str) && str.text.substr(0, 3) == "end");
  }
}

void TestHostileClientIds() {
  // The client id goes straight into the HTTP request line, so anything but digits must be refused.
  for (const char* id : {"1 HTTP/1.1\r\nOrigin: https://evil.example\r\nX: y", "1\r\n", "1&client_id=2", "1%0d%0a",
                         "\xEF\xBC\x91\xEF\xBC\x92", "12 ", " 12", "-12", "+12", "1.5", "\"1\""}) {
    EXPECT(!subspace::RichPresence::IsValidClientId(id));
    subspace::Options options;
    options.clientId = id;
    subspace::RichPresence presence(options);
    EXPECT(!presence.Start());
  }
  EXPECT(!subspace::RichPresence::IsValidClientId(std::string("12\0" "3", 4)));
}

void TestHostileStringsOnTheWire() {
  // Through a real WebSocket: the fake desktop reads exactly the advertised payload length, so a
  // header that disagreed with the UTF-8 byte length would desync the stream and fail these checks.
  FakeDesktop desktop;
  subspace::RichPresence presence(TestOptions({desktop.Port()}));
  presence.Start();
  EXPECT(WaitUntil([&] { return presence.IsConnected(); }, milliseconds(3000)));
  const std::vector<std::string> wire = {
      "\xF0\x9F\x8E\xAF\xE2\x80\xA8\xC3\xA9",  // 4 + 3 + 2 bytes in 3 characters
      std::string(40, '\x01') + "\xF0\x9F\x8E\xAF",  // 7-bit header length but 6x escaped
      std::string(30000, '\xC3') + "\xA9",  // invalid lead bytes -> 3-byte U+FFFD: payload > 65535
      HostileStrings()[11],
      HostileStrings().back(),
  };
  size_t expected = 0;
  for (const std::string& s : wire) {
    subspace::Activity activity = HostileActivity(s);
    presence.SetActivity(activity);
    ++expected;
    EXPECT(desktop.WaitForMessages(expected, milliseconds(5000)));
    const std::vector<std::string> messages = desktop.Messages();
    if (messages.size() != expected) break;
    const std::string& message = messages.back();
    EXPECT_EQ(message, std::string("{\"cmd\":\"SET_ACTIVITY\",\"nonce\":\"") + std::to_string(expected) +
                           "\",\"args\":{\"activity\":" + subspace::detail::ActivityToJson(activity) + "}}");
    JsonValue command;
    const bool parsed = StrictJson::Parse(message, command);
    EXPECT(parsed);
    if (!parsed) continue;
    EXPECT(command.Keys() == (std::vector<std::string>{"cmd", "nonce", "args"}));
    const JsonValue* args = command.Get("args");
    EXPECT(args != nullptr && args->Keys() == std::vector<std::string>{"activity"});
    if (args == nullptr || args->Get("activity") == nullptr) continue;
    JsonValue sanitized;
    EXPECT(StrictJson::Parse(subspace::detail::JsonString(s), sanitized));
    ExpectHostileActivity(*args->Get("activity"), sanitized.text);
  }
  EXPECT_EQ(desktop.UnmaskedFrames(), 0);
}

struct TestCase {
  const char* name;
  void (*run)();
};

}  // namespace

int main() {
#if defined(_WIN32)
  WSADATA data;
  WSAStartup(MAKEWORD(2, 2), &data);
#endif
  const TestCase tests[] = {
      {"WebSocket accept key matches RFC 6455", TestHandshakeKey},
      {"activity JSON, escaping and reply parsing", TestJson},
      {"client id validation", TestClientId},
      {"handshake without Origin, READY, SET_ACTIVITY and CLEAR_ACTIVITY", TestConnectAndCommands},
      {"activity set before connecting is sent once connected", TestActivityBeforeConnecting},
      {"a port that never says READY is skipped after 3 s", TestSilentPortIsSkipped},
      {"extended lengths, pings and a fragmented READY", TestFramesPingsAndFragments},
      {"a refused command reaches OnError", TestRefusedCommandReportsError},
      {"reconnects after the desktop app restarts and re-sends the activity", TestReconnectSendsActivityAgain},
      {"shutdown is fast", TestShutdownIsFast},
      {"Start again after Stop", TestRestartAfterStop},
      {"hostile strings serialize to strict JSON and round-trip", TestHostileStringsSerialize},
      {"hostile client ids are refused", TestHostileClientIds},
      {"hostile strings on the wire: frame length matches UTF-8 bytes", TestHostileStringsOnTheWire},
  };
  int failedTests = 0;
  for (const TestCase& test : tests) {
    const int before = g_failures;
    const Clock::time_point started = Clock::now();
    test.run();
    const bool passed = g_failures == before;
    if (!passed) ++failedTests;
    std::printf("%s %s (%lld ms)\n", passed ? "PASS" : "FAIL", test.name, ElapsedMs(started));
    std::fflush(stdout);
  }
  const int total = static_cast<int>(sizeof(tests) / sizeof(tests[0]));
  std::printf("\n%d of %d tests passed\n", total - failedTests, total);
#if defined(_WIN32)
  WSACleanup();
#endif
  return failedTests == 0 ? 0 : 1;
}
