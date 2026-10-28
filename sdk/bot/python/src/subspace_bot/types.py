"""Payload shapes. They are plain dicts with the API's own (camelCase) keys."""

from __future__ import annotations

import sys
from typing import Any, Literal, TypedDict, Union

if sys.version_info >= (3, 11):
    from typing import NotRequired
else:  # pragma: no cover
    from typing_extensions import NotRequired  # type: ignore[assignment]

ChannelType = Literal["relay", "thread"]
OptionType = Literal["string", "integer", "number", "boolean", "user", "relay", "clearance"]


class EmbedAuthor(TypedDict):
    name: str
    url: NotRequired[str]


class EmbedField(TypedDict):
    name: str
    value: str
    inline: NotRequired[bool]


class Embed(TypedDict, total=False):
    title: str
    description: str
    url: str
    color: Union[int, str]
    timestamp: str
    author: EmbedAuthor
    footer: dict[str, str]
    image: dict[str, str]
    thumbnail: dict[str, str]
    fields: list[EmbedField]


class CommandChoice(TypedDict):
    name: str
    value: Union[str, int, float]


class CommandOption(TypedDict):
    type: OptionType
    name: str
    description: str
    required: NotRequired[bool]
    choices: NotRequired[list[CommandChoice]]


class CommandDefinition(TypedDict):
    name: str
    description: str
    options: NotRequired[list[CommandOption]]
    defaultMemberPermissions: NotRequired[Union[str, None]]
    """A permission bitfield (decimal string) members need to see and use it."""


class Reply(TypedDict, total=False):
    content: str
    embeds: list[Embed]
    ephemeral: bool
    """Only the person who used the command sees it."""


class BotUser(TypedDict):
    id: str
    username: str
    appId: str
    beaconIds: list[str]


# A transmission as the gateway sends it, plus channelType/channelId. Keys follow the API.
Message = dict[str, Any]
InteractionPayload = dict[str, Any]
