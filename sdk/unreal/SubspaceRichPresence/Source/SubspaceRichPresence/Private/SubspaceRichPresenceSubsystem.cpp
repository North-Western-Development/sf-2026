#include "SubspaceRichPresenceSubsystem.h"

#include "Async/Async.h"
#include "CoreGlobals.h"
#include "SubspaceRichPresenceSettings.h"

#include "subspace/rich_presence.h"

#include <string>
#include <utility>

DEFINE_LOG_CATEGORY_STATIC(LogSubspaceRichPresence, Log, All);

/** Owns the SDK client, whose background thread holds the connection to the desktop app. */
struct FSubspaceRichPresenceClient
{
	explicit FSubspaceRichPresenceClient(subspace::Options Options)
		: Presence(std::move(Options))
	{
	}

	subspace::RichPresence Presence;
};

namespace SubspaceRichPresenceConvert
{
	static std::string ToUtf8(const FString& Value)
	{
		const FTCHARToUTF8 Converted(*Value);
		return std::string(reinterpret_cast<const char*>(Converted.Get()), static_cast<size_t>(Converted.Length()));
	}

	static void SetText(std::optional<std::string>& Out, const FString& Value)
	{
		if (!Value.IsEmpty())
		{
			Out = ToUtf8(Value);
		}
	}

	static subspace::ActivityType ToType(ESubspaceActivityType Type)
	{
		switch (Type)
		{
		case ESubspaceActivityType::Streaming: return subspace::ActivityType::Streaming;
		case ESubspaceActivityType::Listening: return subspace::ActivityType::Listening;
		case ESubspaceActivityType::Watching: return subspace::ActivityType::Watching;
		case ESubspaceActivityType::Competing: return subspace::ActivityType::Competing;
		default: return subspace::ActivityType::Playing;
		}
	}

	static subspace::Activity ToActivity(const FSubspaceActivity& Activity)
	{
		subspace::Activity Result;
		Result.type = ToType(Activity.Type);
		SetText(Result.details, Activity.Details);
		SetText(Result.state, Activity.State);
		if (Activity.StartedAt > 0)
		{
			Result.startedAt = Activity.StartedAt;
		}
		if (Activity.EndsAt > 0)
		{
			Result.endsAt = Activity.EndsAt;
		}
		SetText(Result.largeImage, Activity.LargeImage);
		SetText(Result.largeText, Activity.LargeText);
		SetText(Result.smallImage, Activity.SmallImage);
		SetText(Result.smallText, Activity.SmallText);
		// The server shows a party of 1 or more, up to its maximum; anything else is left out here too.
		if (Activity.PartyMax > 0 && Activity.PartySize >= 1 && Activity.PartySize <= Activity.PartyMax)
		{
			subspace::Party Party;
			Party.size = FMath::Max(Activity.PartySize, 0);
			Party.max = Activity.PartyMax;
			Result.party = Party;
		}
		for (const FSubspaceButton& Button : Activity.Buttons)
		{
			if (Result.buttons.size() >= 2)
			{
				break;
			}
			if (Button.Label.IsEmpty() || Button.Url.IsEmpty())
			{
				continue;
			}
			subspace::Button Converted;
			Converted.label = ToUtf8(Button.Label);
			Converted.url = ToUtf8(Button.Url);
			Result.buttons.push_back(std::move(Converted));
		}
		return Result;
	}
}

void USubspaceRichPresenceSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	// A dedicated server has no player and no desktop app to talk to.
	if (IsRunningDedicatedServer())
	{
		return;
	}
	const USubspaceRichPresenceSettings* Settings = GetDefault<USubspaceRichPresenceSettings>();
	if (Settings->bEnabled && !Settings->ApplicationId.TrimStartAndEnd().IsEmpty())
	{
		StartWithApplicationId(Settings->ApplicationId);
	}
}

void USubspaceRichPresenceSubsystem::Deinitialize()
{
	Stop();
	Super::Deinitialize();
}

bool USubspaceRichPresenceSubsystem::StartWithApplicationId(const FString& ApplicationId)
{
	Stop();

	const std::string ClientId = SubspaceRichPresenceConvert::ToUtf8(ApplicationId.TrimStartAndEnd());
	if (!subspace::RichPresence::IsValidClientId(ClientId))
	{
		UE_LOG(LogSubspaceRichPresence, Warning, TEXT("'%s' is not a Subspace application id (digits only, from User Settings > Developer Applications)."), *ApplicationId);
		return false;
	}

	subspace::Options Options;
	Options.clientId = ClientId;
	Options.reconnect = GetDefault<USubspaceRichPresenceSettings>()->bReconnect;
	Client = new FSubspaceRichPresenceClient(std::move(Options));

	// The SDK calls these on its background thread; the delegate fires on the game thread.
	TWeakObjectPtr<USubspaceRichPresenceSubsystem> WeakThis(this);
	auto Notify = [WeakThis](bool bConnected)
	{
		AsyncTask(ENamedThreads::GameThread, [WeakThis, bConnected]()
		{
			if (USubspaceRichPresenceSubsystem* Self = WeakThis.Get())
			{
				Self->OnConnectionChanged.Broadcast(bConnected);
			}
		});
	};
	Client->Presence.SetOnReady([Notify]() { Notify(true); });
	Client->Presence.SetOnDisconnected([Notify]() { Notify(false); });
	Client->Presence.SetOnError([](const std::string& Error)
	{
		UE_LOG(LogSubspaceRichPresence, Warning, TEXT("The Subspace desktop app refused the activity: %s"), UTF8_TO_TCHAR(Error.c_str()));
	});

	if (CurrentActivity.IsSet())
	{
		Client->Presence.SetActivity(SubspaceRichPresenceConvert::ToActivity(CurrentActivity.GetValue()));
	}
	if (!Client->Presence.Start())
	{
		Stop();
		return false;
	}
	return true;
}

void USubspaceRichPresenceSubsystem::Stop()
{
	if (Client != nullptr)
	{
		// Returns promptly: the SDK's thread is woken and joined, the socket closed.
		delete Client;
		Client = nullptr;
	}
}

void USubspaceRichPresenceSubsystem::SetActivity(const FSubspaceActivity& Activity)
{
	CurrentActivity = Activity;
	if (Client != nullptr)
	{
		Client->Presence.SetActivity(SubspaceRichPresenceConvert::ToActivity(Activity));
	}
}

void USubspaceRichPresenceSubsystem::ClearActivity()
{
	CurrentActivity.Reset();
	if (Client != nullptr)
	{
		Client->Presence.ClearActivity();
	}
}

bool USubspaceRichPresenceSubsystem::IsConnected() const
{
	return Client != nullptr && Client->Presence.IsConnected();
}
