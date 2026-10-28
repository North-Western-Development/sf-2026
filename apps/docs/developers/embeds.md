# Embeds

Rich embeds are the cards under a transmission (message): a coloured bar, a title, fields, images. They work like Discord's.

| Who | Where |
| --- | --- |
| [Webhooks](/developers/webhooks) | `embeds` in the post body |
| Bots | `embeds` in an [interaction reply](/developers/commands#answering), follow-up or edit |

A bot's plain `POST …/transmissions` takes no embeds: the field is dropped there.

```json
{
  "title": "Build #42",
  "url": "https://ci.example.com/builds/42",
  "description": "All **12** checks passed.",
  "color": "#43B581",
  "author": { "name": "CI", "url": "https://ci.example.com" },
  "fields": [
    { "name": "Branch", "value": "main", "inline": true },
    { "name": "Took", "value": "3m 12s", "inline": true }
  ],
  "thumbnail": { "url": "https://ci.example.com/logo.png" },
  "footer": { "text": "ci.example.com" },
  "timestamp": "2026-10-28T12:00:00Z"
}
```

## Limits

Up to **10** embeds per transmission, and **6000** characters in all, counting every title, description, field name and value, footer text and author name (`400 EMBED_TOO_LARGE`).

| Field | Limit |
| --- | --- |
| `title` | 256 characters. Links to `url` when there is one. |
| `url` | 2048 characters, `http://` or `https://` |
| `description` | 4096 characters, Markdown |
| `color` | An integer from `0` to `0xFFFFFF` (`3363798`), or `"#RRGGBB"`: the bar on the left |
| `author` | `{ name (≤256), url? (≤2048) }` |
| `fields` | Up to 25 `{ name (≤256), value (≤1024), inline? }`. Inline fields sit side by side, three to a row. |
| `image`, `thumbnail` | `{ url (≤2048) }`, `http://` or `https://` |
| `footer` | `{ text (≤2048) }` |
| `timestamp` | An ISO 8601 date |

Fields not in this table (such as `video` or `provider`) are dropped, as are a URL that isn't `http(s)` and a `timestamp` that isn't a date. A value over its limit is refused with a validation error.

## Images

Images and thumbnails are loaded through the instance's media proxy, so the people who see them never connect to the image's host. The proxy serves PNG, JPEG, GIF, WebP and AVIF up to 10 MB.

## Link previews

Links in a transmission still get the usual link previews, shown after any rich embeds. In a transmission's `embeds`, these have `type: "rich"`; link previews are `link`, `image`, `video` or `article`.
