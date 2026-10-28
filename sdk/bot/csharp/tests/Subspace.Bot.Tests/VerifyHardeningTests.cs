using System.Numerics;
using System.Text;
using Xunit;

namespace Subspace.Bot.Tests;

/// <summary>
/// Hostile inputs for <see cref="Interactions.Verify(string, string, string, string, DateTimeOffset)"/>
/// and <see cref="Ed25519.Verify"/>: every one must return false, never throw.
/// </summary>
public class VerifyHardeningTests
{
    private static byte[] Hex(string hex) => Convert.FromHexString(hex);
    private static string ToHex(byte[] bytes) => Convert.ToHexString(bytes).ToLowerInvariant();

    // RFC 8032 test 1 key pair; the signatures were made with Node's crypto.sign over timestamp + body.
    private const string Key = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
    private const string Timestamp = "1761500000";
    private const string Body = "{\"type\":1}";
    private const string Sig = "45bc058de3de16ea104d507bd0704e6e20396430163f2b5464f9f09b8b953cb9998d00ed448a08cf0a82ad226481731fbe6dab9ed196f69392a528d3d3aadb03";
    // Same key, timestamp + "{\"type\":2}".
    private const string OtherSig = "f54b8786dc0a07b510c7afcad283c4ba3ecd55c8c6119142c159d1db2ae23129938b16413a78305634b918462f97c2e9a02f3d0c8482e9569e78f5685e82140b";
    private static readonly DateTimeOffset Now = DateTimeOffset.FromUnixTimeSeconds(1761500000);

    private static readonly BigInteger L = BigInteger.Pow(2, 252) + BigInteger.Parse("27742317777372353535851937790883648493");

    private static bool V(string body, string? sig, string? ts, string key) => Interactions.Verify(body, sig, ts, key, Now);

    [Fact]
    public void BaselineVerifies()
    {
        Assert.True(V(Body, Sig, Timestamp, Key));
        Assert.True(Interactions.Verify(Encoding.UTF8.GetBytes(Body), Sig, Timestamp, Key, Now));
        // Uppercase hex is accepted for both the signature and the key (documented as "hex").
        Assert.True(V(Body, Sig.ToUpperInvariant(), Timestamp, Key.ToUpperInvariant()));
    }

    [Fact]
    public void RejectsTamperedBodyAndTimestamp()
    {
        Assert.False(V("{\"type\":2}", Sig, Timestamp, Key));
        Assert.False(V(Body + "\n", Sig, Timestamp, Key));
        Assert.False(V("", Sig, Timestamp, Key));
        Assert.False(V(Body, Sig, "1761500001", Key));
        Assert.False(V(Body, Sig, "1761499999", Key));
        // Equivalent numbers that pass the age check but are not the bytes that were signed.
        Assert.False(V(Body, Sig, "1761500000.0", Key));
        Assert.False(V(Body, Sig, " 1761500000", Key));
        Assert.False(V(Body, Sig, "1.7615e9", Key));
        // Moving bytes between timestamp and body keeps timestamp+body identical; the age check is what
        // stops it here (the "timestamp" is no longer a sane number).
        Assert.False(V(Body.Substring(1), Sig, Timestamp + "{", Key));
    }

    [Fact]
    public void RejectsSignatureOfADifferentMessage()
    {
        Assert.False(V(Body, OtherSig, Timestamp, Key));
        Assert.True(V("{\"type\":2}", OtherSig, Timestamp, Key));
    }

    [Theory]
    [InlineData("")]
    [InlineData("00")]
    [InlineData("45bc")]
    public void RejectsShortSignatures(string sig)
    {
        Assert.False(V(Body, sig, Timestamp, Key));
        Assert.False(V(Body, Sig[..126], Timestamp, Key));
    }

    [Fact]
    public void RejectsLongOrNullSignatures()
    {
        Assert.False(V(Body, Sig + "00", Timestamp, Key));
        Assert.False(V(Body, Sig + Sig, Timestamp, Key));
        Assert.False(V(Body, new string('a', 100_000), Timestamp, Key));
        Assert.False(V(Body, null, Timestamp, Key));
    }

    public static readonly TheoryData<string> NonHexSignatures = new()
    {
        Sig[..127],                       // odd length
        Sig + "0",                        // odd length
        "zz" + Sig[2..],                  // non-hex pair
        Sig[..126] + "g0",                // non-hex at the end
        " " + Sig[1..],                   // leading whitespace
        Sig[..127] + " ",                 // trailing whitespace
        Sig[..64] + " " + Sig[65..],      // inner whitespace
        Sig + "\n",
        "0x" + Sig[2..],                  // 0x prefix in place of the first byte
        "0x" + Sig,                       // 0x prefix in addition
        Sig[..126] + "٣٣",      // Unicode digits
        Sig[..126] + "００",      // fullwidth digits
        Sig[..126] + "-1",
        Sig[..126] + "+1",
    };

    [Theory]
    [MemberData(nameof(NonHexSignatures))]
    public void RejectsNonHexSignatures(string sig)
    {
        Assert.False(V(Body, sig, Timestamp, Key));
    }

    public static readonly TheoryData<string> BadKeys = new()
    {
        "",
        Key[..62],
        Key[..63],
        Key + "00",
        Key + Key,
        "zz" + Key[2..],
        " " + Key[1..],
        "0x" + Key,
        "0x" + Key[2..],
        Key[..62] + "٣٣",
        new string('f', 64),              // y >= p: not a valid encoding
        "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", // y = p, non-canonical
    };

    [Theory]
    [MemberData(nameof(BadKeys))]
    public void RejectsBadPublicKeys(string key)
    {
        Assert.False(V(Body, Sig, Timestamp, key));
    }

    [Fact]
    public void RejectsNullAndEmptyInputs()
    {
        Assert.False(Interactions.Verify((string)null!, Sig, Timestamp, Key, Now));
        Assert.False(Interactions.Verify((byte[])null!, Sig, Timestamp, Key, Now));
        Assert.False(V(Body, Sig, null, Key));
        Assert.False(V(Body, Sig, "", Key));
        Assert.False(V(Body, Sig, Timestamp, null!));
        Assert.False(V("", "", "", ""));
        Assert.False(Ed25519.Verify(null!, Array.Empty<byte>(), new byte[64]));
        Assert.False(Ed25519.Verify(new byte[32], null!, new byte[64]));
        Assert.False(Ed25519.Verify(new byte[32], Array.Empty<byte>(), null!));
        Assert.False(Ed25519.Verify(Array.Empty<byte>(), Array.Empty<byte>(), Array.Empty<byte>()));
    }

    [Theory]
    [InlineData(301)]
    [InlineData(-301)]
    [InlineData(86_400)]
    [InlineData(-86_400 * 365)]
    public void RejectsStaleOrFutureTimestamps(int offsetSeconds)
    {
        // Implemented: Interactions.MaxAge is five minutes, checked both ways.
        Assert.Equal(TimeSpan.FromMinutes(5), Interactions.MaxAge);
        Assert.False(Interactions.Verify(Body, Sig, Timestamp, Key, Now.AddSeconds(offsetSeconds)));
    }

    [Theory]
    [InlineData("NaN")]
    [InlineData("Infinity")]
    [InlineData("-Infinity")]
    [InlineData("1e400")]
    [InlineData("-0")]
    [InlineData("99999999999999999999999999")]
    public void RejectsNonsenseTimestamps(string ts)
    {
        Assert.False(V(Body, Sig, ts, Key));
    }

    private static byte[] WithS(byte[] sig, BigInteger s)
    {
        var raw = s.ToByteArray(); // little-endian, maybe with a trailing sign byte
        var result = (byte[])sig.Clone();
        Array.Clear(result, 32, 32);
        Array.Copy(raw, 0, result, 32, Math.Min(32, raw.Length));
        return result;
    }

    private static BigInteger SOf(byte[] sig) => new(sig[32..].Concat(new byte[] { 0 }).ToArray());

    [Fact]
    public void RejectsNonCanonicalS()
    {
        var sig = Hex(Sig);
        var s = SOf(sig);
        Assert.True(s < L);
        Assert.True(Ed25519.Verify(Hex(Key), Encoding.UTF8.GetBytes(Timestamp + Body), WithS(sig, s)));
        Assert.False(V(Body, ToHex(WithS(sig, s + L)), Timestamp, Key));
        Assert.False(V(Body, ToHex(WithS(sig, s + 2 * L)), Timestamp, Key));
        Assert.False(V(Body, ToHex(WithS(sig, L)), Timestamp, Key));
        // Top bits of S set.
        var high = (byte[])sig.Clone();
        high[63] |= 0xE0;
        Assert.False(V(Body, ToHex(high), Timestamp, Key));
    }

    [Fact]
    public void RejectsAllZeroSignature()
    {
        Assert.False(V(Body, new string('0', 128), Timestamp, Key));
        Assert.False(Ed25519.Verify(Hex(Key), Encoding.UTF8.GetBytes(Timestamp + Body), new byte[64]));
    }

    // Small-order points: the identity (y = 1), order 2 (y = -1) and order 4 (y = 0).
    private const string Identity = "0100000000000000000000000000000000000000000000000000000000000000";
    private const string Order2 = "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f";
    private const string Order4 = "0000000000000000000000000000000000000000000000000000000000000000";

    [Fact]
    public void RejectsZeroSignatureForIdentityKey()
    {
        // R = 0 is not the identity's encoding, so this one already fails.
        Assert.False(V(Body, new string('0', 128), Timestamp, Identity));
    }

    // Fixed (was a security bug): with A = identity (01 00..00), R = identity and S = 0 verified any
    // message. Ed25519.Verify now refuses small-order public keys and R (libsodium's blocklist).
    [Fact]
    public void RejectsSmallOrderPublicKeys()
    {
        var forged = Identity + new string('0', 64);
        Assert.False(V(Body, forged, Timestamp, Identity));
        Assert.False(V("{\"type\":1,\"anything\":true}", forged, Timestamp, Identity));
        foreach (var key in new[] { Order2, Order4 })
        {
            foreach (var r in new[] { Identity, key, Order4 })
            {
                for (var i = 0; i < 16; i++)
                    Assert.False(V("{\"n\":" + i + "}", r + new string('0', 64), Timestamp, key));
            }
        }
    }
}
