import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, ActivityIndicator, Text, TextInput } from "react-native";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { FONTS, PALETTE } from "../theme";

/**
 * App-wide defaults — sets Inter as the default font for every <Text> and
 * <TextInput> in the tree so we don't have to update every component. Any
 * style that explicitly sets `fontFamily` will still override this.
 */
function applyGlobalTextDefaults() {
  // @ts-ignore — RN exposes defaultProps for legacy/global styling
  const TextAny = Text as any;
  TextAny.defaultProps = TextAny.defaultProps || {};
  TextAny.defaultProps.allowFontScaling = false;
  TextAny.defaultProps.style = [
    { fontFamily: FONTS.regular, color: PALETTE.textPrimary },
    TextAny.defaultProps.style,
  ];

  // @ts-ignore
  const InputAny = TextInput as any;
  InputAny.defaultProps = InputAny.defaultProps || {};
  InputAny.defaultProps.allowFontScaling = false;
  InputAny.defaultProps.style = [
    { fontFamily: FONTS.regular, color: PALETTE.textPrimary },
    InputAny.defaultProps.style,
  ];
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (fontsLoaded) {
    applyGlobalTextDefaults();
  }

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: PALETTE.bg }}>
        <ActivityIndicator size="large" color={PALETTE.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: PALETTE.bg } }}>
        <Stack.Screen name="index" />
      </Stack>
    </SafeAreaProvider>
  );
}
