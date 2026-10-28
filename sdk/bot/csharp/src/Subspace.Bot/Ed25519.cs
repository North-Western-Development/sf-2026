#nullable enable
using System;
using System.Numerics;
using System.Security.Cryptography;

namespace Subspace.Bot
{
    /// <summary>
    /// Ed25519 signature verification (RFC 8032, section 5.1.7), written out with BigInteger so the
    /// SDK needs no native library. It only verifies: the inputs are public, so it does not need to be
    /// constant-time. Like OpenSSL (which the Subspace server and the JS SDK use), it checks the
    /// cofactorless equation encode([S]B - [k]A) == R and rejects S &gt;= L.
    /// </summary>
    internal static class Ed25519
    {
        private static readonly BigInteger P = BigInteger.Pow(2, 255) - 19;
        private static readonly BigInteger L = BigInteger.Pow(2, 252) + BigInteger.Parse("27742317777372353535851937790883648493");
        private static readonly BigInteger D = Mod(-121665 * Inverse(121666));
        private static readonly BigInteger SqrtMinusOne = BigInteger.ModPow(2, (P - 1) / 4, P);
        private static readonly Point BasePoint = MakeBasePoint();

        private readonly struct Point
        {
            public readonly BigInteger X, Y, Z, T;

            public Point(BigInteger x, BigInteger y, BigInteger z, BigInteger t)
            {
                X = x;
                Y = y;
                Z = z;
                T = t;
            }
        }

        // Encodings of the small-order points (libsodium's blocklist, sign bit ignored). A public key
        // or signature R among them lets one signature pass for any message, so both are refused.
        private static readonly byte[][] SmallOrder =
        {
            Hex("0000000000000000000000000000000000000000000000000000000000000000"),
            Hex("0100000000000000000000000000000000000000000000000000000000000000"),
            Hex("26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05"),
            Hex("c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a"),
            Hex("ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"),
            Hex("edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"),
            Hex("eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"),
        };

        private static byte[] Hex(string hex)
        {
            var bytes = new byte[hex.Length / 2];
            for (var i = 0; i < bytes.Length; i++) bytes[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
            return bytes;
        }

        private static bool IsSmallOrder(byte[] bytes, int offset)
        {
            foreach (var c in SmallOrder)
            {
                var same = true;
                for (var i = 0; i < 32 && same; i++) same = (i == 31 ? (byte)(bytes[offset + 31] & 0x7f) : bytes[offset + i]) == c[i];
                if (same) return true;
            }
            return false;
        }

        public const int PublicKeySize = 32;
        public const int SignatureSize = 64;

        public static bool Verify(byte[] publicKey, byte[] message, byte[] signature)
        {
            if (publicKey == null || message == null || signature == null) return false;
            if (publicKey.Length != PublicKeySize || signature.Length != SignatureSize) return false;
            if (IsSmallOrder(publicKey, 0) || IsSmallOrder(signature, 0)) return false;

            var a = Decompress(publicKey);
            if (a == null) return false;

            var r = new byte[32];
            Buffer.BlockCopy(signature, 0, r, 0, 32);
            var sBytes = new byte[32];
            Buffer.BlockCopy(signature, 32, sBytes, 0, 32);
            var s = FromLittleEndian(sBytes);
            if (s >= L) return false;

            byte[] hash;
            using (var sha = SHA512.Create())
            {
                var input = new byte[64 + message.Length];
                Buffer.BlockCopy(r, 0, input, 0, 32);
                Buffer.BlockCopy(publicKey, 0, input, 32, 32);
                Buffer.BlockCopy(message, 0, input, 64, message.Length);
                hash = sha.ComputeHash(input);
            }
            var k = FromLittleEndian(hash) % L;

            var negA = new Point(Mod(-a.Value.X), a.Value.Y, a.Value.Z, Mod(-a.Value.T));
            var check = Add(Multiply(s, BasePoint), Multiply(k, negA));
            var encoded = Compress(check);
            var diff = 0;
            for (var i = 0; i < 32; i++) diff |= encoded[i] ^ r[i];
            return diff == 0;
        }

        private static BigInteger Mod(BigInteger value)
        {
            var r = value % P;
            return r.Sign < 0 ? r + P : r;
        }

        private static BigInteger Inverse(BigInteger value) => BigInteger.ModPow(Mod(value), P - 2, P);

        private static Point Add(Point p, Point q)
        {
            var a = Mod((p.Y - p.X) * (q.Y - q.X));
            var b = Mod((p.Y + p.X) * (q.Y + q.X));
            var c = Mod(2 * p.T * q.T * D);
            var d = Mod(2 * p.Z * q.Z);
            var e = b - a;
            var f = d - c;
            var g = d + c;
            var h = b + a;
            return new Point(Mod(e * f), Mod(g * h), Mod(f * g), Mod(e * h));
        }

        private static Point Multiply(BigInteger scalar, Point point)
        {
            var result = new Point(0, 1, 1, 0);
            while (scalar > 0)
            {
                if (!scalar.IsEven) result = Add(result, point);
                point = Add(point, point);
                scalar >>= 1;
            }
            return result;
        }

        private static BigInteger? RecoverX(BigInteger y, int sign)
        {
            if (y >= P) return null;
            var y2 = y * y;
            var x2 = Mod((y2 - 1) * Inverse(D * y2 + 1));
            if (x2.IsZero) return sign == 0 ? BigInteger.Zero : (BigInteger?)null;
            var x = BigInteger.ModPow(x2, (P + 3) / 8, P);
            if (!Mod(x * x - x2).IsZero) x = Mod(x * SqrtMinusOne);
            if (!Mod(x * x - x2).IsZero) return null;
            if ((int)(x & 1) != sign) x = P - x;
            return x;
        }

        private static Point? Decompress(byte[] bytes)
        {
            var copy = (byte[])bytes.Clone();
            var sign = copy[31] >> 7;
            copy[31] &= 0x7F;
            var y = FromLittleEndian(copy);
            var x = RecoverX(y, sign);
            if (x == null) return null;
            return new Point(x.Value, y, 1, Mod(x.Value * y));
        }

        private static byte[] Compress(Point point)
        {
            var zInverse = Inverse(point.Z);
            var x = Mod(point.X * zInverse);
            var y = Mod(point.Y * zInverse);
            var bytes = ToLittleEndian32(y);
            bytes[31] |= (byte)((int)(x & 1) << 7);
            return bytes;
        }

        private static Point MakeBasePoint()
        {
            var y = Mod(4 * Inverse(5));
            var x = RecoverX(y, 0)!.Value;
            return new Point(x, y, 1, Mod(x * y));
        }

        private static BigInteger FromLittleEndian(byte[] bytes)
        {
            // BigInteger reads little-endian two's complement: a trailing zero byte keeps it positive.
            var unsigned = new byte[bytes.Length + 1];
            Buffer.BlockCopy(bytes, 0, unsigned, 0, bytes.Length);
            return new BigInteger(unsigned);
        }

        private static byte[] ToLittleEndian32(BigInteger value)
        {
            var raw = value.ToByteArray();
            var result = new byte[32];
            Buffer.BlockCopy(raw, 0, result, 0, Math.Min(raw.Length, 32));
            return result;
        }
    }
}
