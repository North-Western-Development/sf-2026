// A dice bot: /ping and /roll slash commands, and "!hello" in chat.
//
//   SUBSPACE_BOT_TOKEN=...  SUBSPACE_BASE_URL=https://subspace.click  dotnet run --project examples/DiceBot
//
// Optional: SUBSPACE_GATEWAY_URL (when the gateway is not at <base>/gateway), and SUBSPACE_RELAY_ID with
// --once to connect, post one message in that relay, and exit (a smoke test).
using Subspace.Bot;

var token = Environment.GetEnvironmentVariable("SUBSPACE_BOT_TOKEN") ?? throw new InvalidOperationException("Set SUBSPACE_BOT_TOKEN");
var baseUrl = Environment.GetEnvironmentVariable("SUBSPACE_BASE_URL") ?? "https://subspace.click";
var once = args.Contains("--once");

using var bot = new SubspaceBot(new SubspaceBotOptions
{
    Token = token,
    BaseUrl = baseUrl,
    GatewayUrl = Environment.GetEnvironmentVariable("SUBSPACE_GATEWAY_URL"),
});

var commands = await bot.RegisterCommandsAsync(new[]
{
    new CommandDefinition { Name = "ping", Description = "Check the bot is alive" },
    new CommandDefinition
    {
        Name = "roll",
        Description = "Roll a die",
        Options = new() { new CommandOption { Type = CommandOptionType.Integer, Name = "sides", Description = "How many sides" } },
    },
});
Console.WriteLine($"Registered {string.Join(", ", commands.Select(c => "/" + c.Name))} as {bot.User!.Username}");

bot.InteractionReceived += async i =>
{
    switch (i.CommandName)
    {
        case "ping":
            await i.ReplyAsync("Pong!");
            break;
        case "roll":
            var sides = i.GetOption("sides", 6);
            var rolled = Random.Shared.Next(1, Math.Max(1, sides) + 1);
            await i.ReplyAsync(new Reply { Embeds = new() { new Embed { Title = $"\U0001F3B2 {rolled}", Footer = new EmbedFooter { Text = $"d{sides}" } } } });
            break;
    }
};

bot.MessageReceived += async m =>
{
    if (m.Content == "!hello" && m.Author.Id != bot.User!.Id)
        await bot.SendAsync(m.ChannelType, m.ChannelId, new NewMessage { Content = $"Hi {m.Author.Username}!", ReplyToId = m.Id });
};

bot.Ready += _ =>
{
    Console.WriteLine("Gateway READY");
    return Task.CompletedTask;
};
bot.Disconnected += c => Console.WriteLine($"Gateway closed ({c.Code} {c.Reason})");
bot.Error += e => Console.Error.WriteLine($"Error: {e.Message}");

await bot.ConnectAsync();

if (once)
{
    var relayId = Environment.GetEnvironmentVariable("SUBSPACE_RELAY_ID");
    if (!string.IsNullOrEmpty(relayId))
    {
        var sent = await bot.SendAsync("relay", relayId, "Hello from the C# SDK");
        Console.WriteLine($"Sent transmission {sent.Id}");
    }
    await bot.DisconnectAsync();
    return;
}

Console.WriteLine("Running; press Ctrl+C to stop.");
var stop = new TaskCompletionSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    stop.TrySetResult();
};
await stop.Task;
await bot.DisconnectAsync();
