import { useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import * as ScreenCapture from 'expo-screen-capture';
import { colors, injectedBridge, parseShellMessage, pushUpdateScript, staysInApp, type PushState } from './shell';
import { onNotificationOpen, showLocal, startPush } from './push';

/** Ask for what calls need, once (notifications are asked for by startPush). */
async function requestPermissions() {
  if (Platform.OS === 'android') {
    await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA]).catch(() => {});
  }
}

/** One key for the page's requests, so turning it off undoes exactly what it turned on. */
const SECURE_KEY = 'encrypted-conversation';

const WORKING: PushState = { target: null, status: 'waiting', reason: 'Checking push notifications.' };

/** The Subspace instance in a WebView, with native notifications, haptics and back navigation. */
export function InstanceScreen({ server }: { server: string }) {
  const web = useRef<WebView>(null);
  const canGoBack = useRef(false);
  // The bridge is injected once, with what was known at load; later changes are handed to the page.
  const [initialPush, setInitialPush] = useState<PushState | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    let first = true;
    let stop = () => {};
    void requestPermissions().then(() => {
      stop = startPush(server, (state) => {
        if (first) {
          first = false;
          setInitialPush(state);
        } else web.current?.injectJavaScript(pushUpdateScript(state));
      });
    });
    // Do not hold the page back if push takes long to settle.
    const timer = setTimeout(() => first && ((first = false), setInitialPush(WORKING)), 4000);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [server]);

  // Tapping a push opens what it was about (only paths on this instance).
  useEffect(
    () =>
      onNotificationOpen((path) => {
        const go = () => web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(server + path)}); true;`);
        if (loaded.current) go();
        else setTimeout(go, 1500);
      }),
    [server]
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack.current) return false;
      web.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  // Leaving the instance (changing server, closing) always lifts screenshot protection.
  useEffect(() => () => void ScreenCapture.allowScreenCaptureAsync(SECURE_KEY).catch(() => {}), []);

  const onMessage = (event: WebViewMessageEvent) => {
    const msg = parseShellMessage(event.nativeEvent.data);
    if (msg?.type === 'secure') {
      void (msg.on ? ScreenCapture.preventScreenCaptureAsync(SECURE_KEY) : ScreenCapture.allowScreenCaptureAsync(SECURE_KEY)).catch(() => {});
    }
    if (msg?.type === 'notify') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showLocal(msg.title, msg.body);
    }
  };

  if (!initialPush) return <View style={styles.screen} />;
  return (
    <View style={styles.screen}>
      <WebView
        ref={web}
        source={{ uri: server }}
        style={styles.web}
        originWhitelist={['https://*', 'http://*', 'about:*', 'blob:*', 'data:*']}
        injectedJavaScriptBeforeContentLoaded={injectedBridge(initialPush, Platform.OS)}
        onMessage={onMessage}
        onNavigationStateChange={(nav) => (canGoBack.current = nav.canGoBack)}
        onLoadEnd={() => (loaded.current = true)}
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
        webviewDebuggingEnabled={__DEV__}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  web: { flex: 1, backgroundColor: colors.void },
});
