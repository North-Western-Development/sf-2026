// Subspace Frequency Rich Presence for C++17: a minimal WebSocket client (RFC 6455) for the
// Subspace desktop app's local RPC server. See include/subspace/rich_presence.h.
//
// Define SUBSPACE_RICH_PRESENCE_UNREAL when compiling inside an Unreal Engine module: the
// Windows headers are then wrapped in Unreal's AllowWindowsPlatformTypes / HideWindowsPlatformTypes.

#include "subspace/rich_presence.h"

#if defined(_WIN32)
#if !defined(WIN32_LEAN_AND_MEAN)
#define WIN32_LEAN_AND_MEAN
#endif
#if !defined(NOMINMAX)
#define NOMINMAX
#endif
#if defined(SUBSPACE_RICH_PRESENCE_UNREAL)
#include "Windows/AllowWindowsPlatformTypes.h"
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <mstcpip.h>
#if defined(SUBSPACE_RICH_PRESENCE_UNREAL)
#include "Windows/HideWindowsPlatformTypes.h"
#endif
#if defined(_MSC_VER) && !defined(SUBSPACE_RICH_PRESENCE_UNREAL)
#pragma comment(lib, "ws2_32.lib")
#endif
#else
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#endif

#include <algorithm>
#include <atomic>
#include <cstring>
#include <mutex>
#include <random>
#include <thread>
#include <utility>

namespace subspace {
namespace rp_internal {

using Clock = std::chrono::steady_clock;

// ---------------------------------------------------------------------------------------------
// Sockets

#if defined(_WIN32)
using Socket = SOCKET;
static const Socket kNoSocket = INVALID_SOCKET;
static void CloseSocket(Socket s) { ::closesocket(s); }
static int LastSocketError() { return ::WSAGetLastError(); }
static bool WouldBlock(int code) { return code == WSAEWOULDBLOCK || code == WSAEINPROGRESS; }
static bool Interrupted(int code) { return code == WSAEINTR; }
#else
using Socket = int;
static const Socket kNoSocket = -1;
static void CloseSocket(Socket s) { ::close(s); }
static int LastSocketError() { return errno; }
static bool WouldBlock(int code) { return code == EWOULDBLOCK || code == EAGAIN || code == EINPROGRESS; }
static bool Interrupted(int code) { return code == EINTR; }
#endif

static bool SetNonBlocking(Socket s) {
#if defined(_WIN32)
  u_long on = 1;
  return ::ioctlsocket(s, static_cast<long>(FIONBIO), &on) == 0;
#else
  const int flags = ::fcntl(s, F_GETFL, 0);
  return flags >= 0 && ::fcntl(s, F_SETFL, flags | O_NONBLOCK) == 0;
#endif
}

static void SetSocketOptions(Socket s) {
  int on = 1;
  ::setsockopt(s, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&on), sizeof(on));
#if defined(SO_NOSIGPIPE)
  ::setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, reinterpret_cast<const char*>(&on), sizeof(on));
#endif
#if defined(_WIN32) && defined(SIO_TCP_INITIAL_RTO)
  // Windows retries a refused loopback connect for about 2 s; a closed port should fail at once.
  TCP_INITIAL_RTO_PARAMETERS rto;
  rto.Rtt = TCP_INITIAL_RTO_UNSPECIFIED_RTT;
  rto.MaxSynRetransmissions = TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS;
  DWORD returned = 0;
  ::WSAIoctl(s, SIO_TCP_INITIAL_RTO, &rto, sizeof(rto), nullptr, 0, &returned, nullptr, nullptr);
#endif
}

// Bytes sent, 0 when the socket would block, -1 on error.
static long SendSome(Socket s, const char* data, size_t size) {
  const size_t chunk = (std::min)(size, static_cast<size_t>(1) << 20);
#if defined(_WIN32)
  const int n = ::send(s, data, static_cast<int>(chunk), 0);
#elif defined(MSG_NOSIGNAL)
  const ssize_t n = ::send(s, data, chunk, MSG_NOSIGNAL);
#else
  const ssize_t n = ::send(s, data, chunk, 0);
#endif
  if (n >= 0) return static_cast<long>(n);
  const int code = LastSocketError();
  return (WouldBlock(code) || Interrupted(code)) ? 0 : -1;
}

// Bytes read, 0 when the socket would block, -1 on error or when the peer closed.
static long RecvSome(Socket s, char* buffer, size_t size) {
#if defined(_WIN32)
  const int n = ::recv(s, buffer, static_cast<int>(size), 0);
#else
  const ssize_t n = ::recv(s, buffer, size, 0);
#endif
  if (n > 0) return static_cast<long>(n);
  if (n == 0) return -1;
  const int code = LastSocketError();
  return (WouldBlock(code) || Interrupted(code)) ? 0 : -1;
}

struct Readiness {
  bool readable = false;
  bool writable = false;
  bool woken = false;
};

// Waits up to timeoutMs for `s` (if any) to become readable / writable, or for `wake` to fire.
static Readiness WaitSockets(Socket s, bool wantRead, bool wantWrite, Socket wake, int timeoutMs) {
  Readiness result;
  if (s == kNoSocket && wake == kNoSocket) {
    std::this_thread::sleep_for(std::chrono::milliseconds((std::min)(timeoutMs, 50)));
    return result;
  }
#if defined(_WIN32)
  // select() on Windows has no limit on socket values and reports failed connects in `except`.
  fd_set readSet;
  fd_set writeSet;
  fd_set exceptSet;
  FD_ZERO(&readSet);
  FD_ZERO(&writeSet);
  FD_ZERO(&exceptSet);
  if (s != kNoSocket && wantRead) FD_SET(s, &readSet);
  if (s != kNoSocket && wantWrite) {
    FD_SET(s, &writeSet);
    FD_SET(s, &exceptSet);
  }
  if (wake != kNoSocket) FD_SET(wake, &readSet);
  timeval tv;
  tv.tv_sec = timeoutMs / 1000;
  tv.tv_usec = (timeoutMs % 1000) * 1000;
  if (::select(0, &readSet, &writeSet, &exceptSet, &tv) <= 0) return result;
  if (s != kNoSocket) {
    result.readable = FD_ISSET(s, &readSet) != 0;
    result.writable = FD_ISSET(s, &writeSet) != 0 || FD_ISSET(s, &exceptSet) != 0;
  }
  if (wake != kNoSocket) result.woken = FD_ISSET(wake, &readSet) != 0;
#else
  // poll() rather than select(): games can have more than FD_SETSIZE descriptors open.
  pollfd fds[2];
  nfds_t count = 0;
  int socketIndex = -1;
  int wakeIndex = -1;
  if (s != kNoSocket) {
    short events = 0;
    if (wantRead) events = static_cast<short>(events | POLLIN);
    if (wantWrite) events = static_cast<short>(events | POLLOUT);
    fds[count].fd = s;
    fds[count].events = events;
    fds[count].revents = 0;
    socketIndex = static_cast<int>(count++);
  }
  if (wake != kNoSocket) {
    fds[count].fd = wake;
    fds[count].events = POLLIN;
    fds[count].revents = 0;
    wakeIndex = static_cast<int>(count++);
  }
  if (::poll(fds, count, timeoutMs) <= 0) return result;
  if (socketIndex >= 0) {
    const short got = fds[socketIndex].revents;
    const bool failed = (got & (POLLERR | POLLHUP | POLLNVAL)) != 0;
    result.readable = wantRead && ((got & POLLIN) != 0 || failed);
    result.writable = wantWrite && ((got & POLLOUT) != 0 || failed);
  }
  if (wakeIndex >= 0) result.woken = (fds[wakeIndex].revents & POLLIN) != 0;
#endif
  return result;
}

// A loopback UDP socket connected to itself: sending it a byte wakes the background thread.
class Waker {
 public:
  bool Open() {
    socket_ = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (socket_ == kNoSocket) return false;
    sockaddr_in address;
    std::memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = 0;
    socklen_t length = sizeof(address);
    if (::bind(socket_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0 ||
        ::getsockname(socket_, reinterpret_cast<sockaddr*>(&address), &length) != 0 ||
        ::connect(socket_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0 ||
        !SetNonBlocking(socket_)) {
      Close();
      return false;
    }
    return true;
  }
  void Close() {
    if (socket_ != kNoSocket) CloseSocket(socket_);
    socket_ = kNoSocket;
  }
  void Wake() {
    if (socket_ != kNoSocket) SendSome(socket_, "w", 1);
  }
  void Drain() {
    char buffer[64];
    if (socket_ == kNoSocket) return;
    for (int i = 0; i < 64; ++i) {
      if (::recv(socket_, buffer, sizeof(buffer), 0) <= 0) break;
    }
  }
  Socket Get() const { return socket_; }

 private:
  Socket socket_ = kNoSocket;
};

// ---------------------------------------------------------------------------------------------
// SHA-1 and base64, for the WebSocket handshake

static uint32_t RotateLeft(uint32_t value, unsigned bits) { return (value << bits) | (value >> (32U - bits)); }

static std::string Sha1(const std::string& input) {
  uint32_t h[5] = {0x67452301U, 0xEFCDAB89U, 0x98BADCFEU, 0x10325476U, 0xC3D2E1F0U};
  std::string message = input;
  const uint64_t bitLength = static_cast<uint64_t>(input.size()) * 8U;
  message.push_back(static_cast<char>(0x80));
  while (message.size() % 64U != 56U) message.push_back('\0');
  for (int shift = 56; shift >= 0; shift -= 8) {
    message.push_back(static_cast<char>((bitLength >> static_cast<unsigned>(shift)) & 0xFFU));
  }
  for (size_t chunk = 0; chunk < message.size(); chunk += 64U) {
    uint32_t w[80];
    for (size_t i = 0; i < 16U; ++i) {
      const size_t at = chunk + i * 4U;
      w[i] = (static_cast<uint32_t>(static_cast<unsigned char>(message[at])) << 24U) |
             (static_cast<uint32_t>(static_cast<unsigned char>(message[at + 1U])) << 16U) |
             (static_cast<uint32_t>(static_cast<unsigned char>(message[at + 2U])) << 8U) |
             static_cast<uint32_t>(static_cast<unsigned char>(message[at + 3U]));
    }
    for (size_t i = 16U; i < 80U; ++i) w[i] = RotateLeft(w[i - 3U] ^ w[i - 8U] ^ w[i - 14U] ^ w[i - 16U], 1U);
    uint32_t a = h[0];
    uint32_t b = h[1];
    uint32_t c = h[2];
    uint32_t d = h[3];
    uint32_t e = h[4];
    for (size_t i = 0; i < 80U; ++i) {
      uint32_t f;
      uint32_t k;
      if (i < 20U) {
        f = (b & c) | (~b & d);
        k = 0x5A827999U;
      } else if (i < 40U) {
        f = b ^ c ^ d;
        k = 0x6ED9EBA1U;
      } else if (i < 60U) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8F1BBCDCU;
      } else {
        f = b ^ c ^ d;
        k = 0xCA62C1D6U;
      }
      const uint32_t next = RotateLeft(a, 5U) + f + e + k + w[i];
      e = d;
      d = c;
      c = RotateLeft(b, 30U);
      b = a;
      a = next;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
  }
  std::string digest;
  for (uint32_t word : h) {
    for (int shift = 24; shift >= 0; shift -= 8) {
      digest.push_back(static_cast<char>((word >> static_cast<unsigned>(shift)) & 0xFFU));
    }
  }
  return digest;
}

static std::string Base64(const std::string& bytes) {
  static const char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  size_t i = 0;
  for (; i + 2U < bytes.size(); i += 3U) {
    const uint32_t n = (static_cast<uint32_t>(static_cast<unsigned char>(bytes[i])) << 16U) |
                       (static_cast<uint32_t>(static_cast<unsigned char>(bytes[i + 1U])) << 8U) |
                       static_cast<uint32_t>(static_cast<unsigned char>(bytes[i + 2U]));
    out.push_back(kAlphabet[(n >> 18U) & 63U]);
    out.push_back(kAlphabet[(n >> 12U) & 63U]);
    out.push_back(kAlphabet[(n >> 6U) & 63U]);
    out.push_back(kAlphabet[n & 63U]);
  }
  const size_t rest = bytes.size() - i;
  if (rest > 0U) {
    uint32_t n = static_cast<uint32_t>(static_cast<unsigned char>(bytes[i])) << 16U;
    if (rest == 2U) n |= static_cast<uint32_t>(static_cast<unsigned char>(bytes[i + 1U])) << 8U;
    out.push_back(kAlphabet[(n >> 18U) & 63U]);
    out.push_back(kAlphabet[(n >> 12U) & 63U]);
    out.push_back(rest == 2U ? kAlphabet[(n >> 6U) & 63U] : '=');
    out.push_back('=');
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// JSON

static void AppendUtf8(std::string& out, uint32_t codePoint) {
  if (codePoint < 0x80U) {
    out.push_back(static_cast<char>(codePoint));
  } else if (codePoint < 0x800U) {
    out.push_back(static_cast<char>(0xC0U | (codePoint >> 6U)));
    out.push_back(static_cast<char>(0x80U | (codePoint & 0x3FU)));
  } else if (codePoint < 0x10000U) {
    out.push_back(static_cast<char>(0xE0U | (codePoint >> 12U)));
    out.push_back(static_cast<char>(0x80U | ((codePoint >> 6U) & 0x3FU)));
    out.push_back(static_cast<char>(0x80U | (codePoint & 0x3FU)));
  } else {
    out.push_back(static_cast<char>(0xF0U | (codePoint >> 18U)));
    out.push_back(static_cast<char>(0x80U | ((codePoint >> 12U) & 0x3FU)));
    out.push_back(static_cast<char>(0x80U | ((codePoint >> 6U) & 0x3FU)));
    out.push_back(static_cast<char>(0x80U | (codePoint & 0x3FU)));
  }
}

// Length of the valid UTF-8 sequence starting at text[i], or 0 if it is not valid.
static size_t Utf8SequenceLength(const std::string& text, size_t i) {
  const auto byte = [&](size_t at) { return static_cast<unsigned char>(text[at]); };
  const unsigned char lead = byte(i);
  size_t length;
  unsigned char low = 0x80;
  unsigned char high = 0xBF;
  if (lead < 0x80U) return 1;
  if (lead >= 0xC2U && lead <= 0xDFU) {
    length = 2;
  } else if (lead >= 0xE0U && lead <= 0xEFU) {
    length = 3;
    if (lead == 0xE0U) low = 0xA0;   // no overlong forms
    if (lead == 0xEDU) high = 0x9F;  // no surrogates
  } else if (lead >= 0xF0U && lead <= 0xF4U) {
    length = 4;
    if (lead == 0xF0U) low = 0x90;
    if (lead == 0xF4U) high = 0x8F;  // nothing past U+10FFFF
  } else {
    return 0;
  }
  if (i + length > text.size()) return 0;
  if (byte(i + 1U) < low || byte(i + 1U) > high) return 0;
  for (size_t k = 2; k < length; ++k) {
    if (byte(i + k) < 0x80U || byte(i + k) > 0xBFU) return 0;
  }
  return length;
}

static void AppendJsonString(std::string& out, const std::string& text) {
  static const char kHex[] = "0123456789abcdef";
  out.push_back('"');
  size_t i = 0;
  while (i < text.size()) {
    const unsigned char c = static_cast<unsigned char>(text[i]);
    if (c >= 0x80U) {
      const size_t length = Utf8SequenceLength(text, i);
      if (length == 0) {
        out += "\xEF\xBF\xBD";  // U+FFFD: the desktop app drops frames that are not UTF-8
        ++i;
      } else {
        out.append(text, i, length);
        i += length;
      }
      continue;
    }
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20U || c == 0x7FU) {
          out += "\\u00";
          out.push_back(kHex[c >> 4U]);
          out.push_back(kHex[c & 0x0FU]);
        } else {
          out.push_back(static_cast<char>(c));
        }
    }
    ++i;
  }
  out.push_back('"');
}

static const char* ActivityTypeName(ActivityType type) {
  switch (type) {
    case ActivityType::Streaming: return "streaming";
    case ActivityType::Listening: return "listening";
    case ActivityType::Watching: return "watching";
    case ActivityType::Competing: return "competing";
    case ActivityType::Playing: break;
  }
  return "playing";
}

class JsonObjectWriter {
 public:
  explicit JsonObjectWriter(std::string& out) : out_(out) { out_.push_back('{'); }
  void Key(const char* key) {
    if (!first_) out_.push_back(',');
    first_ = false;
    out_.push_back('"');
    out_ += key;
    out_ += "\":";
  }
  void String(const char* key, const std::optional<std::string>& value) {
    if (!value) return;
    Key(key);
    AppendJsonString(out_, *value);
  }
  void Number(const char* key, int64_t value) {
    Key(key);
    out_ += std::to_string(value);
  }
  void End() { out_.push_back('}'); }

 private:
  std::string& out_;
  bool first_ = true;
};

// A small reader for the desktop app's replies: only the top-level scalar fields matter.
class JsonReader {
 public:
  enum class Kind { String, Number, BoolTrue, BoolFalse, NullValue, Container, Bad };

  explicit JsonReader(const std::string& text) : text_(text) {}

  bool ReadReply(detail::Reply& reply) {
    SkipSpace();
    if (!Consume('{')) return false;
    SkipSpace();
    if (Consume('}')) return AtEnd();
    for (;;) {
      std::string key;
      SkipSpace();
      if (!ReadString(key)) return false;
      SkipSpace();
      if (!Consume(':')) return false;
      std::string value;
      const Kind kind = ReadValue(value, 0);
      if (kind == Kind::Bad) return false;
      if (key == "evt" && kind == Kind::String) reply.evt = value;
      if (key == "nonce" && (kind == Kind::String || kind == Kind::Number)) reply.nonce = value;
      if (key == "ok" && (kind == Kind::BoolTrue || kind == Kind::BoolFalse)) reply.ok = kind == Kind::BoolTrue;
      if (key == "error" && kind == Kind::String) reply.error = value;
      SkipSpace();
      if (Consume('}')) return AtEnd();
      if (!Consume(',')) return false;
    }
  }

 private:
  bool AtEnd() {
    SkipSpace();
    return at_ == text_.size();
  }
  void SkipSpace() {
    while (at_ < text_.size() && (text_[at_] == ' ' || text_[at_] == '\t' || text_[at_] == '\n' || text_[at_] == '\r')) ++at_;
  }
  bool Consume(char c) {
    if (at_ < text_.size() && text_[at_] == c) {
      ++at_;
      return true;
    }
    return false;
  }
  bool ReadHex4(uint32_t& value) {
    if (at_ + 4U > text_.size()) return false;
    value = 0;
    for (size_t k = 0; k < 4U; ++k) {
      const char c = text_[at_++];
      uint32_t digit;
      if (c >= '0' && c <= '9') {
        digit = static_cast<uint32_t>(c - '0');
      } else if (c >= 'a' && c <= 'f') {
        digit = static_cast<uint32_t>(c - 'a' + 10);
      } else if (c >= 'A' && c <= 'F') {
        digit = static_cast<uint32_t>(c - 'A' + 10);
      } else {
        return false;
      }
      value = (value << 4U) | digit;
    }
    return true;
  }
  bool ReadString(std::string& out) {
    if (!Consume('"')) return false;
    while (at_ < text_.size()) {
      const char c = text_[at_++];
      if (c == '"') return true;
      if (static_cast<unsigned char>(c) < 0x20U) return false;
      if (c != '\\') {
        out.push_back(c);
        continue;
      }
      if (at_ >= text_.size()) return false;
      const char escaped = text_[at_++];
      switch (escaped) {
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
          if (!ReadHex4(unit)) return false;
          if (unit >= 0xD800U && unit <= 0xDBFFU && at_ + 1U < text_.size() && text_[at_] == '\\' && text_[at_ + 1U] == 'u') {
            const size_t mark = at_;
            at_ += 2U;
            uint32_t lowUnit;
            if (ReadHex4(lowUnit) && lowUnit >= 0xDC00U && lowUnit <= 0xDFFFU) {
              AppendUtf8(out, 0x10000U + ((unit - 0xD800U) << 10U) + (lowUnit - 0xDC00U));
              break;
            }
            at_ = mark;
          }
          AppendUtf8(out, (unit >= 0xD800U && unit <= 0xDFFFU) ? 0xFFFDU : unit);
          break;
        }
        default: return false;
      }
    }
    return false;
  }
  Kind ReadValue(std::string& out, int depth) {
    SkipSpace();
    if (at_ >= text_.size() || depth > 32) return Kind::Bad;
    const char c = text_[at_];
    if (c == '"') return ReadString(out) ? Kind::String : Kind::Bad;
    if (c == '{' || c == '[') {
      const char close = c == '{' ? '}' : ']';
      ++at_;
      SkipSpace();
      if (Consume(close)) return Kind::Container;
      for (;;) {
        std::string ignored;
        if (c == '{') {
          SkipSpace();
          if (!ReadString(ignored)) return Kind::Bad;
          SkipSpace();
          if (!Consume(':')) return Kind::Bad;
        }
        if (ReadValue(ignored, depth + 1) == Kind::Bad) return Kind::Bad;
        SkipSpace();
        if (Consume(close)) return Kind::Container;
        if (!Consume(',')) return Kind::Bad;
      }
    }
    if (text_.compare(at_, 4, "true") == 0) {
      at_ += 4U;
      return Kind::BoolTrue;
    }
    if (text_.compare(at_, 5, "false") == 0) {
      at_ += 5U;
      return Kind::BoolFalse;
    }
    if (text_.compare(at_, 4, "null") == 0) {
      at_ += 4U;
      return Kind::NullValue;
    }
    const size_t start = at_;
    while (at_ < text_.size() && std::strchr("+-.eE0123456789", text_[at_]) != nullptr && text_[at_] != '\0') ++at_;
    if (at_ == start) return Kind::Bad;
    out.assign(text_, start, at_ - start);
    return Kind::Number;
  }

  const std::string& text_;
  size_t at_ = 0;
};

// ---------------------------------------------------------------------------------------------
// WebSocket frames

enum class Opcode : unsigned char { Continuation = 0x0, Text = 0x1, Binary = 0x2, Close = 0x8, Ping = 0x9, Pong = 0xA };

static const size_t kMaxMessage = 1U << 20;  // the desktop app's replies are tiny

class FrameReader {
 public:
  enum class Result { NeedMore, Text, Binary, Close, Ping, Pong, Error };

  void Feed(const char* data, size_t size) { buffer_.append(data, size); }

  // The next complete message or control frame, with its payload in `payload`.
  Result Next(std::string& payload) {
    for (;;) {
      if (buffer_.size() < 2U) return Result::NeedMore;
      const auto byte = [&](size_t at) { return static_cast<unsigned char>(buffer_[at]); };
      const bool fin = (byte(0) & 0x80U) != 0;
      if ((byte(0) & 0x70U) != 0) return Result::Error;  // no extensions were negotiated
      const unsigned opcode = byte(0) & 0x0FU;
      const bool masked = (byte(1) & 0x80U) != 0;
      uint64_t length = byte(1) & 0x7FU;
      size_t at = 2;
      if (length == 126U) {
        if (buffer_.size() < 4U) return Result::NeedMore;
        length = (static_cast<uint64_t>(byte(2)) << 8U) | byte(3);
        at = 4;
      } else if (length == 127U) {
        if (buffer_.size() < 10U) return Result::NeedMore;
        length = 0;
        for (size_t k = 2; k < 10U; ++k) length = (length << 8U) | byte(k);
        at = 10;
      }
      if (length > kMaxMessage) return Result::Error;
      unsigned char mask[4] = {0, 0, 0, 0};
      if (masked) {
        if (buffer_.size() < at + 4U) return Result::NeedMore;
        for (size_t k = 0; k < 4U; ++k) mask[k] = byte(at + k);
        at += 4U;
      }
      const size_t size = static_cast<size_t>(length);
      if (buffer_.size() < at + size) return Result::NeedMore;
      std::string data = buffer_.substr(at, size);
      buffer_.erase(0, at + size);
      if (masked) {
        for (size_t k = 0; k < data.size(); ++k) data[k] = static_cast<char>(static_cast<unsigned char>(data[k]) ^ mask[k % 4U]);
      }

      if ((opcode & 0x08U) != 0) {  // control frames may arrive between fragments
        if (!fin || size > 125U) return Result::Error;
        payload = std::move(data);
        if (opcode == static_cast<unsigned>(Opcode::Close)) return Result::Close;
        if (opcode == static_cast<unsigned>(Opcode::Ping)) return Result::Ping;
        if (opcode == static_cast<unsigned>(Opcode::Pong)) return Result::Pong;
        return Result::Error;
      }
      if (opcode == static_cast<unsigned>(Opcode::Continuation)) {
        if (!inMessage_) return Result::Error;
        message_ += data;
      } else if (opcode == static_cast<unsigned>(Opcode::Text) || opcode == static_cast<unsigned>(Opcode::Binary)) {
        if (inMessage_) return Result::Error;
        inMessage_ = true;
        messageIsText_ = opcode == static_cast<unsigned>(Opcode::Text);
        message_ = std::move(data);
      } else {
        return Result::Error;
      }
      if (message_.size() > kMaxMessage) return Result::Error;
      if (!fin) continue;
      inMessage_ = false;
      payload = std::move(message_);
      message_.clear();
      return messageIsText_ ? Result::Text : Result::Binary;
    }
  }

 private:
  std::string buffer_;
  std::string message_;
  bool inMessage_ = false;
  bool messageIsText_ = true;
};

static std::string EncodeFrame(Opcode opcode, const std::string& payload, const unsigned char mask[4]) {
  std::string frame;
  frame.reserve(payload.size() + 14U);
  frame.push_back(static_cast<char>(0x80U | static_cast<unsigned>(opcode)));
  const uint64_t size = payload.size();
  if (size < 126U) {
    frame.push_back(static_cast<char>(0x80U | size));
  } else if (size <= 0xFFFFU) {
    frame.push_back(static_cast<char>(0x80U | 126U));
    frame.push_back(static_cast<char>((size >> 8U) & 0xFFU));
    frame.push_back(static_cast<char>(size & 0xFFU));
  } else {
    frame.push_back(static_cast<char>(0x80U | 127U));
    for (int shift = 56; shift >= 0; shift -= 8) frame.push_back(static_cast<char>((size >> static_cast<unsigned>(shift)) & 0xFFU));
  }
  for (size_t k = 0; k < 4U; ++k) frame.push_back(static_cast<char>(mask[k]));
  for (size_t k = 0; k < payload.size(); ++k) {
    frame.push_back(static_cast<char>(static_cast<unsigned char>(payload[k]) ^ mask[k % 4U]));
  }
  return frame;
}

static char LowerAscii(char c) { return (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c; }

// The value of an HTTP header (case-insensitive name), trimmed; empty when missing.
static std::string HeaderValue(const std::string& head, const std::string& name) {
  size_t lineStart = head.find("\r\n");
  while (lineStart != std::string::npos) {
    lineStart += 2U;
    const size_t lineEnd = head.find("\r\n", lineStart);
    if (lineEnd == std::string::npos || lineEnd == lineStart) break;
    const size_t colon = head.find(':', lineStart);
    if (colon != std::string::npos && colon < lineEnd && colon - lineStart == name.size()) {
      bool same = true;
      for (size_t k = 0; k < name.size(); ++k) {
        if (LowerAscii(head[lineStart + k]) != LowerAscii(name[k])) same = false;
      }
      if (same) {
        size_t valueStart = colon + 1U;
        size_t valueEnd = lineEnd;
        while (valueStart < valueEnd && (head[valueStart] == ' ' || head[valueStart] == '\t')) ++valueStart;
        while (valueEnd > valueStart && (head[valueEnd - 1U] == ' ' || head[valueEnd - 1U] == '\t')) --valueEnd;
        return head.substr(valueStart, valueEnd - valueStart);
      }
    }
    lineStart = lineEnd;
  }
  return std::string();
}

// ---------------------------------------------------------------------------------------------

#if defined(_WIN32)
struct SocketLibrary {
  SocketLibrary() {
    WSADATA data;
    ok = ::WSAStartup(MAKEWORD(2, 2), &data) == 0;
  }
  ~SocketLibrary() {
    if (ok) ::WSACleanup();
  }
  bool ok = false;
};
#else
struct SocketLibrary {
  bool ok = true;
};
#endif

}  // namespace rp_internal

// ---------------------------------------------------------------------------------------------
// RichPresence

using namespace rp_internal;

struct RichPresence::Impl {
  explicit Impl(Options opts) : options(std::move(opts)), rng(std::random_device{}()) {
    if (options.ports.empty()) options.ports = DefaultPorts();
    waker.Open();
  }
  ~Impl() { waker.Close(); }

  struct Connection {
    Socket socket = kNoSocket;
    FrameReader reader;
    Connection() = default;
    Connection(const Connection&) = delete;
    Connection& operator=(const Connection&) = delete;
    ~Connection() {
      if (socket != kNoSocket) CloseSocket(socket);
    }
  };

  enum class Wait { Ready, Timeout, Stopped };

  SocketLibrary library;  // first: started before, and cleaned up after, every socket below
  Options options;
  Waker waker;

  std::mutex lifecycle;  // Start / Stop
  std::thread worker;
  std::atomic<bool> running{false};
  std::atomic<bool> stopping{false};
  std::atomic<bool> connected{false};
  std::atomic<uint16_t> port{0};

  std::mutex mutex;  // everything below
  std::optional<Activity> activity;
  uint64_t generation = 0;
  std::function<void()> onReady;
  std::function<void()> onDisconnected;
  std::function<void(const std::string&)> onError;

  // Worker thread only.
  std::mt19937 rng;
  uint64_t nonce = 0;

  void Changed() {
    {
      std::lock_guard<std::mutex> lock(mutex);
      ++generation;
    }
    waker.Wake();
  }

  template <typename Callback, typename... Args>
  void Fire(Callback Impl::*member, Args&&... args) {
    Callback callback;
    {
      std::lock_guard<std::mutex> lock(mutex);
      callback = this->*member;
    }
    if (callback) callback(std::forward<Args>(args)...);
  }

  static int MillisecondsUntil(Clock::time_point deadline) {
    const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - Clock::now()).count();
    if (left <= 0) return 0;
    return static_cast<int>((std::min)(left, static_cast<decltype(left)>(250)));
  }

  // Waits for the socket (or, with no socket, just for the deadline); Stop() cuts it short.
  Wait WaitFor(Socket s, bool wantRead, bool wantWrite, Clock::time_point deadline) {
    for (;;) {
      if (stopping) return Wait::Stopped;
      const int slice = MillisecondsUntil(deadline);
      if (slice <= 0) return Wait::Timeout;
      const Readiness ready = WaitSockets(s, wantRead, wantWrite, waker.Get(), slice);
      if (ready.woken) waker.Drain();
      if (stopping) return Wait::Stopped;
      if ((wantRead && ready.readable) || (wantWrite && ready.writable)) return Wait::Ready;
    }
  }

  bool SendAll(Socket s, const std::string& data, Clock::time_point deadline) {
    size_t sent = 0;
    while (sent < data.size()) {
      const long n = SendSome(s, data.data() + sent, data.size() - sent);
      if (n < 0) return false;
      if (n > 0) {
        sent += static_cast<size_t>(n);
        continue;
      }
      if (WaitFor(s, false, true, deadline) != Wait::Ready) return false;
    }
    return true;
  }

  bool SendFrame(Connection& connection, Opcode opcode, const std::string& payload) {
    unsigned char mask[4];
    const uint32_t bits = static_cast<uint32_t>(rng());
    for (size_t k = 0; k < 4U; ++k) mask[k] = static_cast<unsigned char>((bits >> (k * 8U)) & 0xFFU);
    return SendAll(connection.socket, EncodeFrame(opcode, payload, mask), Clock::now() + std::chrono::seconds(5));
  }

  // Reads whatever is available into the frame reader; false when the connection is gone.
  bool ReadAvailable(Connection& connection) {
    char buffer[4096];
    for (int i = 0; i < 64; ++i) {
      const long n = RecvSome(connection.socket, buffer, sizeof(buffer));
      if (n < 0) return false;
      if (n == 0) return true;
      connection.reader.Feed(buffer, static_cast<size_t>(n));
    }
    return true;
  }

  std::string Command(const std::optional<Activity>& current) {
    std::string out = "{\"cmd\":\"";
    out += current ? "SET_ACTIVITY" : "CLEAR_ACTIVITY";
    out += "\",\"nonce\":\"" + std::to_string(++nonce) + "\"";
    if (current) out += ",\"args\":{\"activity\":" + detail::ActivityToJson(*current) + "}";
    out += "}";
    return out;
  }

  // Handles every complete frame. Returns false when the connection should end; sets `ready`
  // when the READY event arrives.
  bool HandleFrames(Connection& connection, bool* ready) {
    std::string payload;
    for (;;) {
      switch (connection.reader.Next(payload)) {
        case FrameReader::Result::NeedMore: return true;
        case FrameReader::Result::Text: {
          const detail::Reply reply = detail::ParseReply(payload);
          if (!reply.valid) break;
          if (ready != nullptr && !*ready) {
            if (reply.evt == "READY") *ready = true;
            break;  // anything before READY is ignored
          }
          if (reply.ok.has_value() && !*reply.ok) {
            Fire(&Impl::onError, reply.error.empty() ? std::string("Refused") : reply.error);
          }
          break;
        }
        case FrameReader::Result::Binary:
        case FrameReader::Result::Pong: break;
        case FrameReader::Result::Ping:
          if (!SendFrame(connection, Opcode::Pong, payload)) return false;
          break;
        case FrameReader::Result::Close:
          SendFrame(connection, Opcode::Close, payload.substr(0, 2));
          return false;
        case FrameReader::Result::Error: return false;
      }
    }
  }

  bool ResolveHost(in_addr& address) const {
    const std::string host = options.host == "localhost" ? std::string("127.0.0.1") : options.host;
    return ::inet_pton(AF_INET, host.c_str(), &address) == 1;
  }

  // Connects to one port and waits for READY, all within readyTimeout.
  bool TryPort(uint16_t candidate, Connection& connection) {
    const Clock::time_point deadline = Clock::now() + options.readyTimeout;
    in_addr address;
    if (!ResolveHost(address)) return false;
    connection.socket = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (connection.socket == kNoSocket) return false;
    const Socket s = connection.socket;
    if (!SetNonBlocking(s)) return false;
    SetSocketOptions(s);

    sockaddr_in target;
    std::memset(&target, 0, sizeof(target));
    target.sin_family = AF_INET;
    target.sin_port = htons(candidate);
    target.sin_addr = address;
    if (::connect(s, reinterpret_cast<sockaddr*>(&target), sizeof(target)) != 0) {
      if (!WouldBlock(LastSocketError())) return false;
      if (WaitFor(s, false, true, deadline) != Wait::Ready) return false;
      int error = 0;
      socklen_t length = sizeof(error);
      if (::getsockopt(s, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&error), &length) != 0 || error != 0) return false;
    }

    // The handshake. No Origin header: the desktop app refuses any request that has one.
    std::string keyBytes;
    for (int i = 0; i < 16; ++i) keyBytes.push_back(static_cast<char>(rng() & 0xFFU));
    const std::string key = Base64(keyBytes);
    std::string request = "GET /?v=1&client_id=" + options.clientId + " HTTP/1.1\r\n";
    request += "Host: " + options.host + ":" + std::to_string(candidate) + "\r\n";
    request += "Upgrade: websocket\r\n";
    request += "Connection: Upgrade\r\n";
    request += "Sec-WebSocket-Key: " + key + "\r\n";
    request += "Sec-WebSocket-Version: 13\r\n";
    request += "User-Agent: subspace-rich-presence-cpp/1\r\n\r\n";
    if (!SendAll(s, request, deadline)) return false;

    std::string head;
    size_t end;
    char buffer[2048];
    while ((end = head.find("\r\n\r\n")) == std::string::npos) {
      if (head.size() > 16384U) return false;
      if (WaitFor(s, true, false, deadline) != Wait::Ready) return false;
      const long n = RecvSome(s, buffer, sizeof(buffer));
      if (n < 0) return false;
      head.append(buffer, static_cast<size_t>(n));
    }
    const std::string status = head.substr(0, head.find("\r\n"));
    if (status.compare(0, 9, "HTTP/1.1 ") != 0 || status.compare(9, 3, "101") != 0) return false;
    if (HeaderValue(head, "Sec-WebSocket-Accept") != detail::WebSocketAccept(key)) return false;
    connection.reader.Feed(head.data() + end + 4U, head.size() - end - 4U);

    bool ready = false;
    for (;;) {
      if (!HandleFrames(connection, &ready)) return false;
      if (ready) return true;
      if (WaitFor(s, true, false, deadline) != Wait::Ready) return false;
      if (!ReadAvailable(connection)) return false;
    }
  }

  // Sends the activity whenever it changes, until the connection ends or Stop() is called.
  void Session(Connection& connection) {
    uint64_t sentGeneration = 0;
    bool first = true;
    while (!stopping) {
      std::string command;
      {
        std::lock_guard<std::mutex> lock(mutex);
        // After (re)connecting, the current activity is sent again; clearing is unnecessary.
        if ((first && activity) || (!first && generation != sentGeneration)) command = Command(activity);
        sentGeneration = generation;
      }
      first = false;
      if (!command.empty() && !SendFrame(connection, Opcode::Text, command)) return;

      const Readiness ready = WaitSockets(connection.socket, true, false, waker.Get(), 1000);
      if (ready.woken) waker.Drain();
      if (stopping) break;
      if (ready.readable && (!ReadAvailable(connection) || !HandleFrames(connection, nullptr))) return;
    }
    // Going away (1001). Best effort: the socket closes right after.
    const std::string code("\x03\xE9", 2);
    unsigned char mask[4] = {0, 0, 0, 0};
    const std::string frame = EncodeFrame(Opcode::Close, code, mask);
    SendSome(connection.socket, frame.data(), frame.size());
  }

  void Run() {
    while (!stopping) {
      bool found = false;
      for (uint16_t candidate : options.ports) {
        if (stopping) break;
        Connection connection;
        if (!TryPort(candidate, connection)) continue;
        found = true;
        port = candidate;
        connected = true;
        Fire(&Impl::onReady);
        Session(connection);
        connected = false;
        port = 0;
        break;
      }
      if (found && !stopping) Fire(&Impl::onDisconnected);
      if (!options.reconnect || stopping) break;
      WaitFor(kNoSocket, false, false, Clock::now() + options.reconnectDelay);
    }
    running = false;
  }
};

std::vector<uint16_t> DefaultPorts() {
  std::vector<uint16_t> ports;
  for (uint16_t p = 6473; p <= 6482; ++p) ports.push_back(p);
  return ports;
}

int64_t UnixTimeMs() {
  return static_cast<int64_t>(
      std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());
}

RichPresence::RichPresence(Options options) : impl_(new Impl(std::move(options))) {}

RichPresence::~RichPresence() {
  Stop();
  if (impl_->worker.joinable()) impl_->worker.detach();  // only when destroyed from a callback
}

bool RichPresence::Start() {
  if (!IsValidClientId(impl_->options.clientId) || !impl_->library.ok) return false;
  std::lock_guard<std::mutex> lock(impl_->lifecycle);
  if (impl_->running) return true;
  if (impl_->worker.joinable()) impl_->worker.join();
  impl_->stopping = false;
  impl_->running = true;
  Impl* impl = impl_.get();
  impl_->worker = std::thread([impl] { impl->Run(); });
  return true;
}

void RichPresence::Stop() {
  std::lock_guard<std::mutex> lock(impl_->lifecycle);
  impl_->stopping = true;
  impl_->waker.Wake();
  if (impl_->worker.joinable() && impl_->worker.get_id() != std::this_thread::get_id()) impl_->worker.join();
}

void RichPresence::SetActivity(const Activity& activity) {
  {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    impl_->activity = activity;
    if (impl_->activity->buttons.size() > 2U) impl_->activity->buttons.resize(2U);
  }
  impl_->Changed();
}

void RichPresence::ClearActivity() {
  {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    impl_->activity.reset();
  }
  impl_->Changed();
}

bool RichPresence::IsConnected() const { return impl_->connected; }

uint16_t RichPresence::ConnectedPort() const { return impl_->port; }

void RichPresence::SetOnReady(std::function<void()> callback) {
  std::lock_guard<std::mutex> lock(impl_->mutex);
  impl_->onReady = std::move(callback);
}

void RichPresence::SetOnDisconnected(std::function<void()> callback) {
  std::lock_guard<std::mutex> lock(impl_->mutex);
  impl_->onDisconnected = std::move(callback);
}

void RichPresence::SetOnError(std::function<void(const std::string& error)> callback) {
  std::lock_guard<std::mutex> lock(impl_->mutex);
  impl_->onError = std::move(callback);
}

bool RichPresence::IsValidClientId(const std::string& clientId) {
  if (clientId.empty() || clientId.size() > 19U || clientId[0] == '0') return false;
  return std::all_of(clientId.begin(), clientId.end(), [](char c) { return c >= '0' && c <= '9'; });
}

namespace detail {

std::string JsonString(const std::string& text) {
  std::string out;
  AppendJsonString(out, text);
  return out;
}

std::string ActivityToJson(const Activity& activity) {
  std::string out;
  JsonObjectWriter object(out);
  if (activity.type) {
    object.Key("type");
    AppendJsonString(out, ActivityTypeName(*activity.type));
  }
  object.String("details", activity.details);
  object.String("state", activity.state);
  if (activity.startedAt) object.Number("startedAt", *activity.startedAt);
  if (activity.endsAt) object.Number("endsAt", *activity.endsAt);
  object.String("largeImage", activity.largeImage);
  object.String("largeText", activity.largeText);
  object.String("smallImage", activity.smallImage);
  object.String("smallText", activity.smallText);
  if (activity.party) {
    object.Key("party");
    out += "{\"size\":" + std::to_string(activity.party->size) + ",\"max\":" + std::to_string(activity.party->max) + "}";
  }
  if (!activity.buttons.empty()) {
    object.Key("buttons");
    out.push_back('[');
    const size_t count = (std::min)(activity.buttons.size(), static_cast<size_t>(2));
    for (size_t i = 0; i < count; ++i) {
      if (i > 0) out.push_back(',');
      out += "{\"label\":";
      AppendJsonString(out, activity.buttons[i].label);
      out += ",\"url\":";
      AppendJsonString(out, activity.buttons[i].url);
      out.push_back('}');
    }
    out.push_back(']');
  }
  object.End();
  return out;
}

std::string WebSocketAccept(const std::string& key) {
  return Base64(Sha1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"));
}

Reply ParseReply(const std::string& json) {
  Reply reply;
  JsonReader reader(json);
  reply.valid = reader.ReadReply(reply);
  return reply;
}

}  // namespace detail
}  // namespace subspace
