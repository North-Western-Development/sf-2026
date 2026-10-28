// A dice bot: /ping and /roll slash commands, and "!hello" in chat.
//
//   SUBSPACE_BOT_TOKEN=... SUBSPACE_BASE_URL=https://subspace.click ./subspace_bot_example
//
// Optional: SUBSPACE_GATEWAY_URL (when the gateway is not at <base>/gateway), and SUBSPACE_RELAY_ID
// with --once to connect, post one message in that relay, and exit (a smoke test).
#include <subspace/bot.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <random>
#include <thread>

namespace {
std::atomic<bool> g_stop{false};
void Stop(int) { g_stop = true; }
std::string Env(const char* name, const char* fallback = "") {
  const char* value = std::getenv(name);
  return value && *value ? value : fallback;
}
}  // namespace

int main(int argc, char** argv) {
  bool once = false;
  for (int i = 1; i < argc; ++i) once = once || std::strcmp(argv[i], "--once") == 0;

  subspace::BotOptions options;
  options.token = Env("SUBSPACE_BOT_TOKEN");
  options.base_url = Env("SUBSPACE_BASE_URL", "https://subspace.click");
  options.gateway_url = Env("SUBSPACE_GATEWAY_URL");
  if (options.token.empty()) {
    std::cerr << "Set SUBSPACE_BOT_TOKEN\n";
    return 2;
  }

  try {
    subspace::Bot bot(options);

    subspace::CommandOption sides{"integer", "sides", "How many sides"};
    auto commands = bot.register_commands({{"ping", "Check the bot is alive"}, {"roll", "Roll a die", {sides}}});
    std::cout << "Registered " << commands.size() << " commands as " << bot.user()->username << "\n";

    std::mt19937 rng{std::random_device{}()};
    bot.on_interaction([&](subspace::Interaction& i) {
      if (i.command_name() == "ping") {
        i.reply("Pong!");
      } else if (i.command_name() == "roll") {
        const int n = std::max(1, i.option_or("sides", 6));
        const int rolled = std::uniform_int_distribution<int>(1, n)(rng);
        subspace::Reply reply;
        reply.embeds.push_back({{"title", "\xF0\x9F\x8E\xB2 " + std::to_string(rolled)}, {"footer", {{"text", "d" + std::to_string(n)}}}});
        i.reply(reply);
      }
    });
    bot.on_message([&](const subspace::Message& m) {
      if (m.content == "!hello" && m.author.id != bot.user()->id) {
        bot.send(m.channel_type, m.channel_id, "Hi " + m.author.username + "!", m.id);
      }
    });
    bot.on_ready([](const subspace::json&) { std::cout << "Gateway READY\n"; });
    bot.on_disconnect([](int code, const std::string& reason) { std::cout << "Gateway closed (" << code << " " << reason << ")\n"; });
    bot.on_error([](const std::string& e) { std::cerr << "Error: " << e << "\n"; });

    bot.connect();
    if (once) {
      const std::string relay = Env("SUBSPACE_RELAY_ID");
      if (!relay.empty()) {
        auto sent = bot.send("relay", relay, "Hello from the C++ SDK");
        std::cout << "Sent transmission " << sent.id << "\n";
      }
      bot.disconnect();
      bot.wait();
      return 0;
    }
    std::signal(SIGINT, Stop);
    std::cout << "Running; press Ctrl+C to stop.\n";
    while (!g_stop) std::this_thread::sleep_for(std::chrono::milliseconds(200));
    bot.disconnect();
    bot.wait();
  } catch (const subspace::ApiError& e) {
    std::cerr << "API error " << e.status() << " " << e.code() << ": " << e.what() << "\n";
    return 1;
  } catch (const std::exception& e) {
    std::cerr << e.what() << "\n";
    return 1;
  }
  return 0;
}
