using System.IO;
using UnrealBuildTool;

public class SubspaceRichPresence : ModuleRules
{
	public SubspaceRichPresence(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "DeveloperSettings" });

		// The C++ Rich Presence SDK (a byte-identical copy of sdk/cpp). It speaks WebSocket itself
		// rather than through Unreal's WebSockets module so that no Origin header is ever sent:
		// the desktop app refuses any request that has one.
		PrivateIncludePaths.Add(Path.Combine(ModuleDirectory, "Private", "ThirdParty"));
		PrivateDefinitions.Add("SUBSPACE_RICH_PRESENCE_UNREAL=1");

		if (Target.Platform == UnrealTargetPlatform.Win64)
		{
			PublicSystemLibraries.Add("ws2_32.lib");
		}
	}
}
