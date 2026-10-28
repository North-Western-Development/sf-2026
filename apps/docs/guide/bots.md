# Bots, webhooks and slash commands

Subspace has the same three ways to automate a beacon (server) as Discord:

- **Webhooks** post into one relay (channel) from a secret URL. Nothing to host: point CI, monitoring or a feed at it.
- **Bots** are accounts that belong to an application. A bot joins beacons, reads and sends transmissions (messages), and answers slash commands.
- **Slash commands** are commands a bot registers. Members pick them from the `/` menu, and the bot answers.

This page is about using them in your beacons. To build one, see the [developer documentation](/developers/).

## Adding a bot

Open the bot's invite link, or **Add App** on its profile card. Pick a beacon where you have **Manage Beacon**, untick any permission you don't want to give it, then **Authorize**.

- The bot gets a clearance (role) named after it that holds what you granted. You can't give a bot permissions you don't hold yourself.
- Some bots are private: only their developers can add them, and nobody else sees **Add App**.
- To remove a bot, use **Beacon Settings › Integrations › Remove**, or kick it.

## Using slash commands

Type `/` in the message box to see the commands of the bots in the beacon. In the message box, members type `/remind who:@sam minutes:10`; a command with one option takes the whole text after its name.

You need **Use Application Commands** in the relay, and a bot can limit a command to members with certain permissions. If the bot doesn't answer within 3 seconds you see "did not respond". Some replies are **only visible to you**: they are never stored and go away when you reload.

## Webhooks

**Beacon Settings › Integrations › New Webhook** makes one. You need **Manage Webhooks** in its relay. Its URL is shown only when it is made or reset. Anyone with the URL can post, so keep it secret, and use **Reset URL** if it leaks.

Webhook posts can carry rich embeds and mention people, but never ping `@everyone` or `@here`. See [Webhooks](/developers/webhooks) for the request format.

## Announcement relays

A text relay can be an **announcement relay** (**Create Relay › Announcement Relay**, or the switch in its settings). Other beacons can **Follow** it from its header: what it publishes is copied into a text relay of theirs where the follower has *Manage Webhooks*. To publish a transmission, right-click it and choose **Publish** (your own, or anyone's with *Manage Transmissions*). A relay publishes at most 10 times an hour.

Copies are signed with the source beacon's name and icon, carry the **BEACON** tag, and never ping anyone in the beacons that follow. A follow shows in **Beacon Settings › Integrations**, where **Unfollow** ends it.

## Tags

Accounts that are not people carry a tag next to their name: **APP** for a bot, **HOOK** for a webhook, and **BEACON** on an announcement copied from a relay this beacon follows. Instance staff can verify a well-known bot: its tag then shows a check (**✓ APP**) everywhere, so a copy with the same name and picture can't pass for it.

## For developers

- [Getting started](/developers/): Developer Applications, teams and the instance's developer policy.
- [Bots](/developers/bots), [Slash commands](/developers/commands), [Webhooks](/developers/webhooks).
- SDKs for [JavaScript](/developers/sdk/javascript), [Deno](/developers/sdk/deno), [Python](/developers/sdk/python), [Java](/developers/sdk/java), [C#](/developers/sdk/csharp) and [C++](/developers/sdk/cpp), on the [package registry](/developers/registry).
