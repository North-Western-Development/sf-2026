// Shows "Competitive - Mirage / In a match (2 of 5)" on your Subspace profile for a minute.
// Run the Subspace desktop app first, then: example <your application id>

#include "subspace/rich_presence.h"

#include <chrono>
#include <cstdio>
#include <thread>

int main(int argc, char** argv) {
  if (argc < 2 || !subspace::RichPresence::IsValidClientId(argv[1])) {
    std::fprintf(stderr, "usage: %s <application id>\n", argv[0]);
    return 2;
  }

  subspace::Options options;
  options.clientId = argv[1];
  subspace::RichPresence presence(options);
  // Callbacks run on the SDK's background thread.
  presence.SetOnReady([] { std::printf("Connected to the Subspace desktop app\n"); });
  presence.SetOnDisconnected([] { std::printf("The desktop app went away; retrying every 15 s\n"); });
  presence.SetOnError([](const std::string& error) { std::printf("Refused: %s\n", error.c_str()); });
  presence.Start();

  subspace::Activity activity;
  activity.type = subspace::ActivityType::Competing;
  activity.details = "Competitive \xC2\xB7 Mirage";
  activity.state = "In a match";
  activity.startedAt = subspace::UnixTimeMs();
  activity.party = subspace::Party{2, 5};
  activity.buttons.push_back({"Watch", "https://example.com/match/123"});
  presence.SetActivity(activity);  // sent once connected, and again after every reconnect

  for (int second = 0; second < 60; ++second) {
    if (second == 30) {
      activity.state = "Overtime";
      presence.SetActivity(activity);
    }
    std::this_thread::sleep_for(std::chrono::seconds(1));
  }
  presence.ClearActivity();
  return 0;  // the destructor disconnects; the activity ends with the connection
}
