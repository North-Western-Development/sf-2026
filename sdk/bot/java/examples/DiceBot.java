import click.subspace.bot.Command;
import click.subspace.bot.Embed;
import click.subspace.bot.Reply;
import click.subspace.bot.SubspaceBot;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

/**
 * A slash-command and message bot. Run it straight from source (Java 17+):
 *
 * <pre>
 *   BOT_TOKEN=... SUBSPACE_URL=https://subspace.click java -cp target/subspace-bot-0.1.0.jar examples/DiceBot.java
 * </pre>
 *
 * Optional: SUBSPACE_GATEWAY_URL (default &lt;SUBSPACE_URL&gt;/gateway), RELAY_ID (posts a hello there once
 * READY), EXIT_AFTER_READY (seconds to stay connected, then exit).
 */
public class DiceBot {
    public static void main(String[] args) throws Exception {
        String base = System.getenv().getOrDefault("SUBSPACE_URL", "https://subspace.click");
        SubspaceBot bot = new SubspaceBot(System.getenv("BOT_TOKEN"), base, System.getenv("SUBSPACE_GATEWAY_URL"));

        bot.registerCommands(List.of(
            Command.of("ping", "Check the bot is alive"),
            Command.of("roll", "Roll a die").option(Command.Option.integer("sides", "How many sides"))
        )).join();

        bot.onReady(ready -> {
            System.out.println("Connected as " + bot.user().get("username"));
            String relay = System.getenv("RELAY_ID");
            if (relay != null) {
                var sent = bot.send("relay", relay, "Dice bot (Java) is online.").join();
                System.out.println("Posted transmission " + sent.get("id"));
            }
        });

        bot.onInteraction(i -> {
            switch (i.commandName()) {
                case "ping":
                    i.reply("Pong!");
                    break;
                case "roll": {
                    long sides = i.optionLong("sides") != null ? i.optionLong("sides") : 6;
                    long roll = ThreadLocalRandom.current().nextLong(1, sides + 1);
                    i.reply(Reply.create().embed(Embed.create().title("🎲 " + roll).footer("d" + sides)));
                    break;
                }
                default:
                    i.reply(Reply.of("I don't know that one.").ephemeral(true));
            }
        });

        bot.onMessage(m -> {
            if (m.content().equals("!hello")) bot.send(m.channelType(), m.channelId(), "Hi " + m.authorUsername() + "!");
        });

        bot.onError(err -> System.err.println("Bot error: " + err));

        bot.connect().join();
        String exitAfter = System.getenv("EXIT_AFTER_READY");
        if (exitAfter != null) {
            Thread.sleep((long) (Double.parseDouble(exitAfter) * 1000));
            bot.close();
        } else {
            Runtime.getRuntime().addShutdownHook(new Thread(bot::close));
            bot.closed().join(); // stay connected until disconnect()
        }
    }
}
