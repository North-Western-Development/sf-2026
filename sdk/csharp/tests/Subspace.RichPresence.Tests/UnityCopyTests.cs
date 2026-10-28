using Xunit;

namespace Subspace.RichPresence.Tests;

/// <summary>The Unity package ships a copy of the SDK source; it must not drift.</summary>
public sealed class UnityCopyTests
{
    public static TheoryData<string> Files => new() { "Activity.cs", "Json.cs", "RichPresence.cs", "RichPresenceOptions.cs" };

    [Theory]
    [MemberData(nameof(Files))]
    public void Unity_package_source_is_byte_identical(string file)
    {
        var sdk = FindSdkRoot();
        var original = Path.Combine(sdk, "csharp", "src", "Subspace.RichPresence", file);
        var copy = Path.Combine(sdk, "unity", "com.subspace.rich-presence", "Runtime", "Sdk", file);
        Assert.True(File.Exists(copy), "missing " + copy);
        Assert.True(File.ReadAllBytes(original).AsSpan().SequenceEqual(File.ReadAllBytes(copy)),
            $"{copy} differs from {original}: copy sdk/csharp/src/Subspace.RichPresence/{file} over it");
    }

    private static string FindSdkRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            if (dir.Name == "sdk" && Directory.Exists(Path.Combine(dir.FullName, "csharp"))) return dir.FullName;
        }
        throw new DirectoryNotFoundException("sdk/ not found above " + AppContext.BaseDirectory);
    }
}
