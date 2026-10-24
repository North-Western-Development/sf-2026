import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, normalizeServer } from './shell';

/** First run: choose the Subspace instance and check it answers like one. */
export function ConnectScreen({ initial, onConnect }: { initial: string; onConnect: (origin: string) => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setError(null);
    const origin = normalizeServer(value);
    if (!origin) return setError('Enter an https:// address, like https://subspace.example.com.');
    setBusy(true);
    try {
      const res = await fetch(`${origin}/api/v1/system/info`);
      if (!res.ok) throw new Error(String(res.status));
      await res.json();
      onConnect(origin);
    } catch {
      setError('That address did not answer like a Subspace Frequency server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <View style={styles.card}>
        <Image source={require('../assets/icon.png')} style={styles.icon} accessibilityIgnoresInvertColors />
        <Text style={styles.title} accessibilityRole="header">
          Connect to Subspace
        </Text>
        <Text style={styles.sub}>Enter the address of the Subspace Frequency instance you use.</Text>
        <Text style={styles.label}>SERVER ADDRESS</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          onSubmitEditing={() => void connect()}
          placeholder="https://subspace.example.com"
          placeholderTextColor={colors.fgSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          accessibilityLabel="Server address"
          style={styles.input}
        />
        {error && (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        )}
        <Pressable accessibilityRole="button" onPress={() => void connect()} disabled={busy} style={({ pressed }) => [styles.button, (pressed || busy) && { opacity: 0.8 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Connect</Text>}
        </Pressable>
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerText}>A transmission from</Text>
        <Image source={require('../assets/nwd-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="NWD" />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 440, backgroundColor: colors.overlay, borderRadius: 16, padding: 28 },
  icon: { width: 64, height: 64, alignSelf: 'center', marginBottom: 12, borderRadius: 14 },
  title: { color: colors.fg, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  sub: { color: colors.fgMuted, fontSize: 15, textAlign: 'center', marginTop: 8, marginBottom: 24 },
  label: { color: colors.fgMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 },
  input: { height: 46, borderRadius: 6, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.void, color: colors.fg, paddingHorizontal: 12, fontSize: 16 },
  error: { color: colors.danger, fontSize: 13, marginTop: 8 },
  button: { height: 46, borderRadius: 6, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: 24, gap: 8 },
  footerText: { color: colors.fgSubtle, fontSize: 12 },
  logo: { width: 56, height: 30 },
});
