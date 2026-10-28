"""Subspace Frequency bot SDK: REST, the real-time gateway, slash commands and interactions."""

from .client import EVENTS, Interaction, SubspaceApiError, SubspaceBot
from .types import BotUser, CommandDefinition, CommandOption, Embed, InteractionPayload, Message, Reply
from .verify import defer_with, respond_with, verify_interaction

__version__ = "0.1.0"

__all__ = [
    "EVENTS",
    "BotUser",
    "CommandDefinition",
    "CommandOption",
    "Embed",
    "Interaction",
    "InteractionPayload",
    "Message",
    "Reply",
    "SubspaceApiError",
    "SubspaceBot",
    "defer_with",
    "respond_with",
    "verify_interaction",
    "__version__",
]
