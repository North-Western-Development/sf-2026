// Subspace Frequency Rich Presence for C++17.
//
// Shows what a player is doing in your game ("Competitive - Mirage", "In a party of 2 of 5") on
// their Subspace profile, next to their name and in member lists. It talks to the Subspace
// desktop app on the same computer over its local WebSocket server (127.0.0.1, ports 6473-6482).
// Browsers cannot do this; the desktop app must be running.
//
//   subspace::Options options;
//   options.clientId = "1234567890";          // your application id
//   subspace::RichPresence presence(options);
//   presence.Start();                          // returns at once; connects in the background
//
//   subspace::Activity activity;
//   activity.details = "Competitive - Mirage";
//   activity.state = "In a match";
//   activity.startedAt = subspace::UnixTimeMs();
//   presence.SetActivity(activity);            // never blocks; sent when connected
//
// Threading: one background thread owns the socket. Every public method is thread-safe and
// returns without waiting for the network. Callbacks run on that background thread.
//
// No dependencies beyond the C++17 standard library and the platform's sockets (ws2_32 on
// Windows). Exceptions and RTTI are not used.

#ifndef SUBSPACE_RICH_PRESENCE_H
#define SUBSPACE_RICH_PRESENCE_H

#include <chrono>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace subspace {

// The word shown before your application's name. The desktop app defaults to Playing.
enum class ActivityType { Playing, Streaming, Listening, Watching, Competing };

// Shown after the state: "(2 of 5)".
struct Party {
  int32_t size = 0;
  int32_t max = 0;
};

// A link button. https:// only; labels up to 32 characters.
struct Button {
  std::string label;
  std::string url;
};

// Every field is optional. Strings are UTF-8 (invalid bytes are replaced with U+FFFD).
// Invalid values are dropped by the desktop app rather than refused.
struct Activity {
  std::optional<ActivityType> type;
  std::optional<std::string> details;    // first line under the name, up to 128 characters
  std::optional<std::string> state;      // second line, up to 128 characters
  std::optional<int64_t> startedAt;      // unix time in ms: shows "for 12m"
  std::optional<int64_t> endsAt;         // unix time in ms: shows a countdown instead
  std::optional<std::string> largeImage; // https:// image URL; without it your app icon shows
  std::optional<std::string> largeText;  // hover text for the large image
  std::optional<std::string> smallImage; // https:// image URL on the corner of the large one
  std::optional<std::string> smallText;
  std::optional<Party> party;
  std::vector<Button> buttons;           // at most 2 are sent
};

// 6473..6482: the desktop app listens on the first free one.
std::vector<uint16_t> DefaultPorts();

// Milliseconds since the unix epoch, for Activity::startedAt / endsAt.
int64_t UnixTimeMs();

struct Options {
  // Your application id from User Settings > Developer Applications (digits only).
  std::string clientId;
  // Keep looking for the desktop app while it is closed, then send the activity again.
  bool reconnect = true;
  // Ports to try, in order.
  std::vector<uint16_t> ports = DefaultPorts();
  // Host of the desktop app's server: "127.0.0.1" or "localhost" (always this computer).
  std::string host = "127.0.0.1";
  // How long to wait between attempts while not connected.
  std::chrono::milliseconds reconnectDelay{15000};
  // A port that has not said READY within this time is not the desktop app.
  std::chrono::milliseconds readyTimeout{3000};
};

class RichPresence {
 public:
  // Does not connect yet: call Start(). Does not throw.
  explicit RichPresence(Options options);
  // Stops the background thread and closes the connection (the activity ends with it).
  // Returns promptly. Do not destroy the object from inside one of its callbacks.
  ~RichPresence();

  RichPresence(const RichPresence&) = delete;
  RichPresence& operator=(const RichPresence&) = delete;

  // Starts the background thread, which finds the desktop app. Returns at once.
  // Returns false (and does nothing) when the clientId is not a valid application id.
  // Calling it again while running does nothing; after Stop() it starts over.
  bool Start();

  // Disconnects and stops the background thread. Called by the destructor.
  void Stop();

  // Shows or updates the activity. Stored and sent as soon as possible; sent again after every
  // reconnect. Only the latest value is sent when several calls happen close together.
  void SetActivity(const Activity& activity);

  // Removes the activity.
  void ClearActivity();

  // Whether the desktop app is connected (it has said READY) right now.
  bool IsConnected() const;

  // The port the desktop app answered on, or 0 while not connected.
  uint16_t ConnectedPort() const;

  // Callbacks run on the background thread; keep them short and marshal to your own thread.
  // They may call SetActivity / ClearActivity / IsConnected, but not Stop or the destructor.
  void SetOnReady(std::function<void()> callback);
  void SetOnDisconnected(std::function<void()> callback);
  // A command the desktop app refused, with its reason.
  void SetOnError(std::function<void(const std::string& error)> callback);

  // Digits only, no leading zero, at most 19 characters.
  static bool IsValidClientId(const std::string& clientId);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

// Building blocks, exposed for tests.
namespace detail {

// The activity as the JSON object the desktop app expects.
std::string ActivityToJson(const Activity& activity);

// A JSON string literal (with quotes), control characters escaped, invalid UTF-8 replaced.
std::string JsonString(const std::string& text);

// base64(sha1(key + RFC 6455 GUID)): the Sec-WebSocket-Accept a server must answer with.
std::string WebSocketAccept(const std::string& key);

struct Reply {
  bool valid = false;  // a JSON object
  std::string evt;
  std::string nonce;
  std::optional<bool> ok;
  std::string error;
};

// Reads the top-level evt / nonce / ok / error of a message from the desktop app.
Reply ParseReply(const std::string& json);

}  // namespace detail
}  // namespace subspace

#endif  // SUBSPACE_RICH_PRESENCE_H
