"""A slash-command and message bot.

    BOT_TOKEN=... SUBSPACE_URL=https://subspace.click python examples/dice_bot.py

Optional: SUBSPACE_GATEWAY_URL (default <SUBSPACE_URL>/gateway), RELAY_ID (posts a hello there once READY).
"""

from __future__ import annotations

import asyncio
import os
import random
import signal

from subspace_bot import Interaction, SubspaceBot

bot = SubspaceBot(
    token=os.environ["BOT_TOKEN"],
    base_url=os.environ.get("SUBSPACE_URL", "https://subspace.click"),
    gateway_url=os.environ.get("SUBSPACE_GATEWAY_URL"),
)


@bot.on("ready")
async def on_ready(_data: dict) -> None:
    print(f"Connected as {bot.user['username'] if bot.user else '?'}")
    relay = os.environ.get("RELAY_ID")
    if relay:
        sent = await bot.send("relay", relay, "Dice bot (Python) is online.")
        print(f"Posted transmission {sent['id']}")


@bot.on("interaction")
async def on_interaction(i: Interaction) -> None:
    if i.command_name == "ping":
        await i.reply("Pong!")
    elif i.command_name == "roll":
        sides = int(i.option("sides", 6))
        if sides > 1000:
            await i.defer()
            await asyncio.sleep(1)
            await i.follow_up(f"That took a while: {random.randint(1, sides)}")
        else:
            await i.reply({"embeds": [{"title": f"🎲 {random.randint(1, sides)}", "footer": {"text": f"d{sides}"}}]})


@bot.on("message")
async def on_message(m: dict) -> None:
    if m.get("content") == "!hello":
        await bot.send(m["channelType"], m["channelId"], f"Hi {m['author']['username']}!")


async def main() -> None:
    async with bot:
        await bot.register_commands(
            [
                {"name": "ping", "description": "Check the bot is alive"},
                {
                    "name": "roll",
                    "description": "Roll a die",
                    "options": [{"type": "integer", "name": "sides", "description": "How many sides"}],
                },
            ]
        )
        await bot.connect()
        stop = asyncio.Event()
        try:
            asyncio.get_running_loop().add_signal_handler(signal.SIGINT, stop.set)
        except NotImplementedError:  # Windows: Ctrl+C raises KeyboardInterrupt instead
            pass
        if os.environ.get("EXIT_AFTER_READY"):
            await asyncio.sleep(float(os.environ["EXIT_AFTER_READY"]))
        else:
            await stop.wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
