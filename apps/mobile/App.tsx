import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConnectScreen } from './src/ConnectScreen';
import { InstanceScreen } from './src/InstanceScreen';
import { colors } from './src/shell';

const SERVER_KEY = 'subspace.server';

/** Subspace Frequency on mobile: pick an instance once, then use it like the desktop app. */
export default function App() {
  const [server, setServer] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void AsyncStorage.getItem(SERVER_KEY).then(setServer, () => setServer(null));
  }, []);

  const connect = (origin: string) => {
    void AsyncStorage.setItem(SERVER_KEY, origin);
    setServer(origin);
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.void }} edges={['top', 'bottom']}>
        {server === undefined ? <View style={{ flex: 1 }} /> : server ? <InstanceScreen server={server} /> : <ConnectScreen initial="" onConnect={connect} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
