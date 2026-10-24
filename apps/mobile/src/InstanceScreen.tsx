import { useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import { colors, injectedBridge, parseShellMessage, staysInApp } from './shell';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Ask for what calls and notifications need, once. */
async function requestPermissions() {
  if (Platform.OS === 'android') {
    await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA]).catch(() => {});
  }
  await Notifications.requestPermissionsAsync().catch(() => {});
}

/** An Expo push token for this install, or null without a configured EAS project. */
async function pushToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}

/** The Subspace instance in a WebView, with native notifications, haptics and back navigation. */
export function InstanceScreen({ server }: { server: string }) {
  const web = useRef<WebView>(null);
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const canGoBack = useRef(false);

  useEffect(() => {
    void requestPermissions().then(pushToken).then(setToken);
  }, []);

  // Tapping a push opens what it was about (only paths on this instance).
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const path = response.notification.request.content.data?.path;
      if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) {
        web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(server + path)}); true;`);
      }
    });
    return () => sub.remove();
  }, [server]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack.current) return false;
      web.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  const onMessage = (event: WebViewMessageEvent) => {
    const msg = parseShellMessage(event.nativeEvent.data);
    if (msg?.type === 'notify') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      void Notifications.scheduleNotificationAsync({ content: { title: msg.title, body: msg.body, data: { tag: msg.tag } }, trigger: null });
    }
  };

  if (token === undefined) return <View style={styles.screen} />;
  return (
    <View style={styles.screen}>
      <WebView
        ref={web}
        source={{ uri: server }}
        style={styles.web}
        originWhitelist={['https://*', 'http://*', 'about:*', 'blob:*', 'data:*']}
        injectedJavaScriptBeforeContentLoaded={injectedBridge(token, Platform.OS)}
        onMessage={onMessage}
        onNavigationStateChange={(nav) => (canGoBack.current = nav.canGoBack)}
        onShouldStartLoadWithRequest={(req) => {
          if (staysInApp(server, req.url)) return true;
          void Linking.openURL(req.url);
          return false;
        }}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled={false}
        decelerationRate="normal"
        webviewDebuggingEnabled={__DEV__}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  web: { flex: 1, backgroundColor: colors.void },
});
