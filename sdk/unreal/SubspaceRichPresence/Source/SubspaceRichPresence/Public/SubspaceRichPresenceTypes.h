#pragma once

#include "CoreMinimal.h"
#include "SubspaceRichPresenceTypes.generated.h"

/** The word shown before your application's name. */
UENUM(BlueprintType)
enum class ESubspaceActivityType : uint8
{
	Playing,
	Streaming,
	Listening,
	Watching,
	Competing
};

/** A link button on the activity. */
USTRUCT(BlueprintType)
struct SUBSPACERICHPRESENCE_API FSubspaceButton
{
	GENERATED_BODY()

	/** Up to 32 characters. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence")
	FString Label;

	/** An https:// link. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence")
	FString Url;
};

/**
 * What the player is doing. Empty strings and zero values are left out.
 * Invalid values are dropped by the desktop app rather than refused.
 */
USTRUCT(BlueprintType)
struct SUBSPACERICHPRESENCE_API FSubspaceActivity
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence")
	ESubspaceActivityType Type = ESubspaceActivityType::Playing;

	/** First line under your application's name (up to 128 characters). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence")
	FString Details;

	/** Second line (up to 128 characters). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence")
	FString State;

	/** Unix time in milliseconds (see Get Unix Time Ms): shows "for 12m". 0 = not shown. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence")
	int64 StartedAt = 0;

	/** Unix time in milliseconds: shows a countdown instead. 0 = not shown. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence")
	int64 EndsAt = 0;

	/** An https:// image URL. Without one your application's icon is shown. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence")
	FString LargeImage;

	/** Hover text for the large image. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence")
	FString LargeText;

	/** An https:// image URL shown on the corner of the large one. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence")
	FString SmallImage;

	/** Hover text for the small image. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence")
	FString SmallText;

	/** Players in the party: "(2 of 5)". Shown when it is at least 1 and no more than Party Max. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence", meta = (ClampMin = "0"))
	int32 PartySize = 0;

	/** Party capacity. 0 = no party. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence", meta = (ClampMin = "0"))
	int32 PartyMax = 0;

	/** Up to two link buttons; the rest are left out. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Subspace|Rich Presence", meta = (TitleProperty = "Label"))
	TArray<FSubspaceButton> Buttons;

	/** Sets StartedAt to now and returns this activity, for chaining in C++. */
	FSubspaceActivity& StartNow();
};
