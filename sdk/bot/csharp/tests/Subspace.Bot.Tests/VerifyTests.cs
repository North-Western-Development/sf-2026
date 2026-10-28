using System.Text;
using System.Text.Json;
using Xunit;

namespace Subspace.Bot.Tests;

public class VerifyTests
{
    private static byte[] Hex(string hex) => Convert.FromHexString(hex);

    // RFC 8032 section 7.1, tests 1-3 (also checked against Node's crypto.verify).
    public static readonly TheoryData<string, string, string> Rfc8032 = new()
    {
        { "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "", "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b" },
        { "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "72", "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00" },
        { "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025", "af82", "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a" },
    };

    [Theory]
    [MemberData(nameof(Rfc8032))]
    public void AcceptsRfc8032Vectors(string publicKey, string message, string signature)
    {
        Assert.True(Ed25519.Verify(Hex(publicKey), Hex(message), Hex(signature)));
    }

    [Theory]
    [MemberData(nameof(Rfc8032))]
    public void RejectsAnyFlippedBit(string publicKey, string message, string signature)
    {
        var sig = Hex(signature);
        foreach (var index in new[] { 0, 17, 31, 32, 50, 62 })
        {
            var bad = (byte[])sig.Clone();
            bad[index] ^= 0x04;
            Assert.False(Ed25519.Verify(Hex(publicKey), Hex(message), bad));
        }
        var msg = Hex(message);
        var longer = msg.Concat(new byte[] { 0 }).ToArray();
        Assert.False(Ed25519.Verify(Hex(publicKey), longer, sig));
        var key = Hex(publicKey);
        key[5] ^= 1;
        Assert.False(Ed25519.Verify(key, msg, sig));
    }

    [Fact]
    public void RejectsMalleatedS()
    {
        // S + L verifies the same equation; RFC 8032 (and OpenSSL) require S < L.
        var (publicKey, _, signature) = ("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "", "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
        var sig = Hex(signature);
        var s = new System.Numerics.BigInteger(sig[32..].Concat(new byte[] { 0 }).ToArray());
        var l = System.Numerics.BigInteger.Pow(2, 252) + System.Numerics.BigInteger.Parse("27742317777372353535851937790883648493");
        var bigger = (s + l).ToByteArray();
        var malleated = sig[..32].Concat(bigger.Take(32)).Concat(new byte[Math.Max(0, 32 - bigger.Length)]).ToArray();
        Assert.Equal(64, malleated.Length);
        Assert.False(Ed25519.Verify(Hex(publicKey), Array.Empty<byte>(), malleated));
    }

    [Fact]
    public void RejectsWrongSizes()
    {
        Assert.False(Ed25519.Verify(new byte[31], Array.Empty<byte>(), new byte[64]));
        Assert.False(Ed25519.Verify(new byte[32], Array.Empty<byte>(), new byte[63]));
    }

    // Signed by Node's crypto.sign (ed25519) over timestamp + body, as the server signs interactions.
    private const string PublicKey = "8a61b18fb75806fa8b7a855d85b41787575d6227494560d2528882b3f8db311b";
    private const string Timestamp = "1761500000";
    private const string Body = "{\"type\":2,\"id\":\"978275694148452353\",\"token\":\"tok\",\"applicationId\":\"1\",\"beaconId\":\"2\",\"channel\":{\"type\":\"relay\",\"id\":\"3\"},\"user\":{\"id\":\"4\",\"username\":\"sam\",\"displayName\":\"Sam ✨\",\"avatarUrl\":null},\"memberPermissions\":\"0\",\"data\":{\"id\":\"5\",\"name\":\"roll\",\"options\":[{\"name\":\"sides\",\"type\":\"integer\",\"value\":20}]}}";
    private const string Signature = "15a5b6ac1a85fa5f331fe7d54da6e07398b574fb28366d9afa6684cddb7a54d30c5cdfce3d65aa3fc857c16e6eaa642ddc59449c7e2c14ccf349e865f610b109";
    private static readonly DateTimeOffset SignedAt = DateTimeOffset.FromUnixTimeSeconds(1761500000);

    [Fact]
    public void VerifiesASignedInteraction()
    {
        Assert.True(Interactions.Verify(Body, Signature, Timestamp, PublicKey, SignedAt));
        Assert.True(Interactions.Verify(Encoding.UTF8.GetBytes(Body), Signature, Timestamp, PublicKey, SignedAt.AddSeconds(299)));
        Assert.True(Interactions.Verify(Body, Signature.ToUpperInvariant(), Timestamp, PublicKey.ToUpperInvariant(), SignedAt));
    }

    [Fact]
    public void RejectsForgedOldOrMalformedInteractions()
    {
        Assert.False(Interactions.Verify(Body + " ", Signature, Timestamp, PublicKey, SignedAt));
        Assert.False(Interactions.Verify(Body, Signature, "1761500001", PublicKey, SignedAt));
        Assert.False(Interactions.Verify(Body, Signature, Timestamp, PublicKey, SignedAt.AddSeconds(301)));
        Assert.False(Interactions.Verify(Body, Signature, Timestamp, PublicKey, SignedAt.AddSeconds(-301)));
        Assert.False(Interactions.Verify(Body, "", Timestamp, PublicKey, SignedAt));
        Assert.False(Interactions.Verify(Body, Signature, "", PublicKey, SignedAt));
        Assert.False(Interactions.Verify(Body, Signature, "soon", PublicKey, SignedAt));
        Assert.False(Interactions.Verify(Body, "zz" + Signature[2..], Timestamp, PublicKey, SignedAt));
        Assert.False(Interactions.Verify(Body, Signature, Timestamp, PublicKey[..62], SignedAt));
        // Without a clock override the signature is years old.
        Assert.False(Interactions.Verify(Body, Signature, Timestamp, PublicKey));
    }

    [Fact]
    public void ParsesAndAnswersHttpInteractions()
    {
        var payload = Interactions.Parse(Body);
        Assert.Equal("roll", payload.Data.Name);
        Assert.Equal("Sam ✨", payload.User.DisplayName);
        Assert.Equal(20, payload.Data.Options[0].Value.GetInt32());

        var reply = JsonDocument.Parse(Interactions.RespondWith(new Reply { Content = "Rolled 4", Embeds = new() { new Embed { Title = "Dice", Color = 0x3b8ef2 } } })).RootElement;
        Assert.Equal(4, reply.GetProperty("type").GetInt32());
        Assert.Equal("Rolled 4", reply.GetProperty("data").GetProperty("content").GetString());
        Assert.Equal(0x3b8ef2, reply.GetProperty("data").GetProperty("embeds")[0].GetProperty("color").GetInt32());
        Assert.False(reply.GetProperty("data").TryGetProperty("ephemeral", out _));
        Assert.Equal("{\"type\":4,\"data\":{\"content\":\"hi\"}}", Interactions.RespondWith("hi"));
        Assert.Equal("{\"type\":5,\"data\":{\"ephemeral\":true}}", Interactions.DeferWith(ephemeral: true));
    }
}
