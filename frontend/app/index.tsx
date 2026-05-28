	import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,

  StyleSheet,
  ScrollView,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Linking,
  RefreshControl,
  Modal,
  Image,
  Animated,
  Dimensions,
  PanResponder,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { rs, rf } from "../theme/responsive";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Contacts from "expo-contacts";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";

const API = `https://ptl-market.onrender.com/api`;

// Phone-auth storage keys
const PROFILE_KEY = "profile";
const PHONE_VERIFIED_KEY = "phoneVerified";

// === Native Firebase Phone Auth (Android-only) ===
// We use a defensive lazy require so the web preview (which has no native
// module) doesn't crash on import. On a real Android build the require
// always succeeds and the FULL NATIVE flow is used:
//   - auth().verifyPhoneNumber(phone).on('state_changed', ...)
//     -> handles CODE_SENT, AUTO_VERIFIED (silent SMS retrieval), ERROR
//   - auth().onAuthStateChanged(user) is the source of truth: when a user
//     appears we mint a fresh ID token and verify it on the backend.
// There is NO Firebase Web SDK, NO RecaptchaVerifier, NO signInWithRedirect,
// NO firebaseapp.com browser page, NO sessionStorage, NO expo-auth-session
// anywhere in this flow.
let rnfAuthModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  rnfAuthModule = require("@react-native-firebase/auth");
} catch {
  rnfAuthModule = null;
}
const firebaseAuth: any = rnfAuthModule?.default || null;
const PhoneAuthState: any = firebaseAuth?.PhoneAuthState || null;
const PhoneAuthProvider: any = firebaseAuth?.PhoneAuthProvider || null;

type PhoneVerified = {
  phone: string;       // 10-digit local form, e.g. "9876543210"
  phoneFull: string;   // e.g. "+919876543210"
  verifiedAt: string;  // ISO timestamp
  uid: string;         // Firebase UID
};

const COLORS = {
  primary: "#0A2463",
  secondary: "#FF6B35",
  success: "#16A34A",
  bg: "#F9FAFB",
  surface: "#FFFFFF",
  text: "#1F2937",
  textMuted: "#6B7280",
  textSubtle: "#9CA3AF",
  border: "#E5E7EB",
  danger: "#DC2626",
};

const PLACEMENT = ["Stackable", "Non Stackable"];
const PLACEMENT_OPTIONS = [
  { key: "Stackable",     label: "Stackable",     image: require("../assets/images/stackable.png") },
  { key: "Non Stackable", label: "Non Stackable",  image: require("../assets/images/non_stackable.png") },
];
const TRUCK_TYPES: { name: string; image: any }[] = [
  { name: "Open", image: require("../assets/trucks/open.png") },
  { name: "Container", image: require("../assets/trucks/container.png") },
  { name: "Trailer", image: require("../assets/trucks/trailer.png") },
];

type Profile = { name: string; phone: string; company: string };

type Load = {
  id: string;
  origin_pincode: string;
  origin_locality: string;
  origin_city: string;
  origin_state: string;
  destination_pincode: string;
  destination_locality: string;
  destination_city: string;
  destination_state: string;
  cargo_types: string[];
  cargo_placement: string;
  weight_tons: number;
  space_cuft: number | null;
  dimension_length?: number | null;
  dimension_breadth?: number | null;
  dimension_height?: number | null;
  price_per_ton?: number | null;
  loading_date: string;
  poster_name: string;
  poster_phone: string;
  poster_company: string;
  created_at: string;
  truck_type?: string;
  images?: string[];
  image_count?: number;
};

type MapplsSuggestion = {
  placeName: string;
  placeAddress: string;
  eLoc: string;
};

// Extract 6-digit pincode from Mappls placeAddress string
function extractPincode(address: string): string {
  const match = address.match(/\b(\d{6})\b/);
  return match ? match[1] : "";
}

// Indian state / UT name → 2-letter abbreviation (per RTO codes).
const IN_STATE_ABBR: Record<string, string> = {
  "andhra pradesh": "AP",
  "arunachal pradesh": "AR",
  "assam": "AS",
  "bihar": "BR",
  "chhattisgarh": "CG",
  "chattisgarh": "CG",
  "goa": "GA",
  "gujarat": "GJ",
  "haryana": "HR",
  "himachal pradesh": "HP",
  "jharkhand": "JH",
  "karnataka": "KA",
  "kerala": "KL",
  "madhya pradesh": "MP",
  "maharashtra": "MH",
  "manipur": "MN",
  "meghalaya": "ML",
  "mizoram": "MZ",
  "nagaland": "NL",
  "odisha": "OD",
  "orissa": "OD",
  "punjab": "PB",
  "rajasthan": "RJ",
  "sikkim": "SK",
  "tamil nadu": "TN",
  "telangana": "TS",
  "tripura": "TR",
  "uttar pradesh": "UP",
  "uttarakhand": "UK",
  "uttaranchal": "UK",
  "west bengal": "WB",
  // Union Territories
  "andaman and nicobar islands": "AN",
  "andaman & nicobar islands": "AN",
  "chandigarh": "CH",
  "dadra and nagar haveli and daman and diu": "DN",
  "dadra and nagar haveli": "DN",
  "daman and diu": "DD",
  "delhi": "DL",
  "nct of delhi": "DL",
  "jammu and kashmir": "JK",
  "jammu & kashmir": "JK",
  "ladakh": "LA",
  "lakshadweep": "LD",
  "puducherry": "PY",
  "pondicherry": "PY",
};

function stateAbbr(state: string): string {
  const s = (state || "").trim().toLowerCase();
  if (!s) return "";
  return IN_STATE_ABBR[s] || state.trim().slice(0, 2).toUpperCase();
}

// ============== Root ==============
export default function Index() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [phoneVerified, setPhoneVerified] = useState<PhoneVerified | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<"post" | "market">("post");
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    (async () => {
      const [rawProfile, rawVerif] = await Promise.all([
        AsyncStorage.getItem(PROFILE_KEY),
        AsyncStorage.getItem(PHONE_VERIFIED_KEY),
      ]);
      if (rawProfile) {
        try { setProfile(JSON.parse(rawProfile)); } catch {}
      }
      if (rawVerif) {
        try { setPhoneVerified(JSON.parse(rawVerif)); } catch {}
      }
      setLoaded(true);
    })();
  }, []);
	
useEffect(() => {
  if (!firebaseAuth) {
    console.log("Firebase Auth module NOT loaded");
    return;
  }

  try {
    console.log("===== FIREBASE APP CONFIG =====");
    console.log("App Name:", firebaseAuth().app.name);
    console.log("App Options:", firebaseAuth().app.options);
    console.log("App ID:", firebaseAuth().app.options.appId);
    console.log("Project ID:", firebaseAuth().app.options.projectId);
    console.log("Storage Bucket:", firebaseAuth().app.options.storageBucket);
    console.log("Package:", "com.ptlmarket.trucktraffic");
    console.log("================================");
  } catch (e) {
    console.log("Firebase config read failed:", e);
  }
}, []);

	
  // Ask for contacts permission once profile is set up (so user can save truck-owner numbers).
  useEffect(() => {
    if (!profile) return;
    (async () => {
      try {
        const asked = await AsyncStorage.getItem("contacts_perm_asked");
        if (asked === "1") return;
        const { status: cur } = await Contacts.getPermissionsAsync();
        if (cur === "granted") { await AsyncStorage.setItem("contacts_perm_asked", "1"); return; }
        const { status } = await Contacts.requestPermissionsAsync();
        await AsyncStorage.setItem("contacts_perm_asked", "1");
        if (status !== "granted") {
          // Soft note — user can also save contacts later from a load card
          Alert.alert(
            "Contacts permission",
            "You can grant contacts access anytime from Settings to save truck-owner numbers directly to your phonebook."
          );
        }
      } catch {}
    })();
  }, [profile]);

  const saveProfile = async (p: Profile) => {
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    setProfile(p);
    // Persist to backend (best-effort; doesn't block UX if offline).
    try {
      await fetch(`${API}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: p.phone,
          name: p.name,
          company: p.company || "",
        }),
      });
    } catch (e) {
      console.log("Failed to sync profile to backend:", e);
    }
  };

  const saveVerification = async (v: PhoneVerified) => {
    await AsyncStorage.setItem(PHONE_VERIFIED_KEY, JSON.stringify(v));
    setPhoneVerified(v);
    // If we don't have a local profile yet, try to restore one from the
    // backend so a returning/reinstalled user keeps their name & company.
    try {
      const existing = await AsyncStorage.getItem(PROFILE_KEY);
      if (!existing) {
        const res = await fetch(`${API}/users/${encodeURIComponent(v.phone)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.name && (data.name as string).trim().length >= 2) {
            const restored: Profile = {
              name: data.name,
              phone: data.phone,
              company: data.company || "",
            };
            await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(restored));
            setProfile(restored);
          }
        }
      }
    } catch (e) {
      console.log("Failed to restore profile from backend:", e);
    }
  };

  if (!loaded) {
    return (
      <View style={[styles.fill, styles.center]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // Step 1: Phone OTP verification (must run first, before profile setup)
  if (!phoneVerified) {
    return <PhoneVerification onVerified={saveVerification} />;
  }

  // Step 2: Profile setup (phone auto-filled & locked from verification)
  if (!profile) {
    return <ProfileSetup onSave={saveProfile} lockedPhone={phoneVerified.phone} />;
  }

  if (showProfile) {
    return (
      <ProfileScreen
        profile={profile}
        onClose={() => setShowProfile(false)}
        onEdit={() => { setShowProfile(false); setProfile(null); }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.fill} edges={["top"]}>
      <View style={styles.header} testID="app-header">
        <View style={styles.headerLeft}>
          <View style={{ flex: 1 }}>
            <Text
              style={styles.headerTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              allowFontScaling={false}
            >
              Truck Traffic PTL
            </Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>Hi, {profile.name.split(" ")[0]}</Text>
          </View>
        </View>
        <TouchableOpacity testID="open-profile-btn" onPress={() => setShowProfile(true)} style={styles.iconBtn}>
          <Ionicons name="person-circle-outline" size={28} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabs} testID="tabs">
        <TabButton label="Post Truck Space" icon="add-circle-outline" active={tab === "post"} onPress={() => setTab("post")} testID="tab-post" />
        <TabButton label="Find Truck Space" icon="search-outline" active={tab === "market"} onPress={() => setTab("market")} testID="tab-market" />
      </View>

      <SwipeableTabs tab={tab} setTab={setTab}>
        <View style={[StyleSheet.absoluteFill, { display: tab === "post" ? "flex" : "none" }]} testID="post-tab-pane">
          <PostLoadScreen profile={profile} onPosted={() => setTab("market")} />
        </View>
        <View style={[StyleSheet.absoluteFill, { display: tab === "market" ? "flex" : "none" }]} testID="market-tab-pane">
          <LoadMarketScreen profile={profile} />
        </View>
      </SwipeableTabs>
    </SafeAreaView>
  );
}

// Swipe-left/right between tabs
function SwipeableTabs({ tab, setTab, children }: { tab: "post" | "market"; setTab: (t: "post" | "market") => void; children: React.ReactNode }) {
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dy) < 24,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -60) setTabRef.current("market");
        else if (g.dx > 60) setTabRef.current("post");
      },
    })
  ).current;
  const setTabRef = useRef(setTab);
  useEffect(() => { setTabRef.current = setTab; }, [setTab]);
  return (
    <View style={styles.fill} {...responder.panHandlers}>
      {children}
    </View>
  );
}

function TabButton({ label, icon, active, onPress, testID }: any) {
  return (
    <TouchableOpacity testID={testID} onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Ionicons name={icon} size={rf(16)} color={active ? COLORS.primary : COLORS.textMuted} />
      <Text
        style={[styles.tabText, active && styles.tabTextActive]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        allowFontScaling={false}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ============== Profile Setup ==============
function ProfileSetup({ onSave, lockedPhone }: { onSave: (p: Profile) => void; lockedPhone?: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(lockedPhone || "");
  const [company, setCompany] = useState("");
  const phoneIsLocked = !!lockedPhone && /^\d{10}$/.test(lockedPhone);

  const submit = () => {
    if (name.trim().length < 2) return Alert.alert("Required", "Please enter your name");
    if (!/^\d{10}$/.test(phone.trim())) return Alert.alert("Invalid", "Enter a 10-digit phone number");
    onSave({ name: name.trim(), phone: phone.trim(), company: company.trim() });
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: COLORS.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.fill}>
        <ScrollView contentContainerStyle={styles.profileWrap} keyboardShouldPersistTaps="handled">
          <Text style={styles.profileTitle}>Welcome to Truck Traffic PTL</Text>
          <Text style={styles.profileSubtitle}>Set up your profile to start posting and finding loads</Text>
          <View style={{ height: 24 }} />
          <Field label="Your Name *">
            <TextInput testID="profile-name-input" style={styles.input} placeholder="e.g., Rajesh Kumar" placeholderTextColor={COLORS.textSubtle} value={name} onChangeText={setName} />
          </Field>
          <Field label={phoneIsLocked ? "Phone Number ✓ Verified" : "Phone Number *"}>
            {phoneIsLocked ? (
              <View style={styles.lockedPhoneRow} testID="profile-phone-locked">
                <Text style={styles.lockedPhonePrefix}>+91</Text>
                <Text style={styles.lockedPhoneText}>{phone}</Text>
                <Ionicons name="checkmark-circle" size={20} color={COLORS.success} style={{ marginLeft: "auto" }} />
              </View>
            ) : (
              <TextInput testID="profile-phone-input" style={styles.input} placeholder="10-digit mobile number" placeholderTextColor={COLORS.textSubtle} value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))} keyboardType="number-pad" maxLength={10} />
            )}
          </Field>
          <Field label="Company (Optional)">
            <TextInput testID="profile-company-input" style={styles.input} placeholder="Transport company name" placeholderTextColor={COLORS.textSubtle} value={company} onChangeText={setCompany} />
          </Field>
          <TouchableOpacity testID="profile-save-btn" style={styles.primaryBtn} onPress={submit}>
            <Text style={styles.primaryBtnText}>Continue</Text>
            <Ionicons name="arrow-forward" size={20} color={COLORS.surface} />
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============== Phone Verification (OTP) ==============
function PhoneVerification({ onVerified }: { onVerified: (v: PhoneVerified) => void }) {
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [autoVerified, setAutoVerified] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const listenerRef = useRef<any>(null);
  const fullPhoneRef = useRef<string>("");

  // Resend countdown
  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  // Stop any pending PhoneAuthListener when the screen unmounts
  useEffect(() => {
    return () => {
      try { listenerRef.current?.removeAllListeners?.(); } catch {}
      listenerRef.current = null;
    };
  }, []);

  // Backend token verification helper — called whenever we have a signed-in
  // user (either via manual OTP entry OR via silent auto-retrieval).
  const completeWithSignedInUser = useCallback(async (user: any) => {
    try {
      const idToken: string = await user.getIdToken(true);
      const res = await fetch(`${API}/auth/verify-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: idToken }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.detail || `Server returned ${res.status}`);
      }
      const data = await res.json();
      const verified: PhoneVerified = {
        phone: data.phone_local || phone.trim(),
        phoneFull: data.phone_number || fullPhoneRef.current,
        verifiedAt: data.verified_at || new Date().toISOString(),
        uid: data.uid || user.uid,
      };
      onVerified(verified);
    } catch (e: any) {
      console.warn("Backend token verify failed:", e);
      Alert.alert("Verification failed", e?.message || "Could not verify the session. Please retry.");
      setBusy(false);
    }
  }, [onVerified, phone]);

  // onAuthStateChanged = single source of truth. As soon as a phone user
  // is signed in (auto-retrieved OR manually confirmed) we proceed.
  useEffect(() => {
    if (!firebaseAuth) return;
    const unsub = firebaseAuth().onAuthStateChanged((user: any) => {
      if (user && user.phoneNumber) {
        completeWithSignedInUser(user);
      }
    });
    return () => { try { unsub(); } catch {} };
  }, [completeWithSignedInUser]);

  const sendOtp = async () => {
    if (!/^\d{10}$/.test(phone.trim())) {
      return Alert.alert("Invalid number", "Enter a valid 10-digit Indian mobile number.");
    }
    if (!firebaseAuth) {
      return Alert.alert(
        "Native build required",
        "Phone OTP verification uses native Firebase on Android. Please install the APK on your phone to use this feature.",
      );
    }
    setBusy(true);
    setAutoVerified(false);
    setOtp("");
    setVerificationId(null);
    const fullPhone = `+91${phone.trim()}`;
    fullPhoneRef.current = fullPhone;

    try {
      // Stop any previous listener
      try { listenerRef.current?.removeAllListeners?.(); } catch {}

      // verifyPhoneNumber returns a PhoneAuthListener that emits a state
      // machine. This is the API that supports silent auto-retrieval on
      // Android (no SMS reading permission required — uses SMS Retriever).
      const listener = firebaseAuth().verifyPhoneNumber(fullPhone, 60);
      listenerRef.current = listener;

      listener.on(
        "state_changed",
        async (snap: any) => {
          switch (snap.state) {
            case PhoneAuthState?.CODE_SENT: {
              setVerificationId(snap.verificationId);
              setStage("otp");
              setResendTimer(45);
              setBusy(false);
              break;
            }
            case PhoneAuthState?.AUTO_VERIFIED: {
              // Android silently retrieved the SMS. Show the code briefly
              // in the input, then sign in via credential.
              if (snap.code) setOtp(snap.code);
              setAutoVerified(true);
              try {
                const credential = PhoneAuthProvider.credential(
                  snap.verificationId,
                  snap.code,
                );
                await firebaseAuth().signInWithCredential(credential);
                // onAuthStateChanged effect will call completeWithSignedInUser
              } catch (e: any) {
                console.warn("Auto-verify sign-in failed:", e);
                Alert.alert("Verification failed", e?.message || "Auto-verification could not complete. Please enter the code manually.");
                setBusy(false);
                setAutoVerified(false);
              }
              break;
            }
            case PhoneAuthState?.AUTO_VERIFY_TIMEOUT: {
              // Silent auto-retrieve timed out. Stay on OTP screen.
              setBusy(false);
              break;
            }
            case PhoneAuthState?.ERROR: {
              const code = snap.error?.code || "";
              let msg = "Could not send OTP. Please check your number and try again.";
              if (code === "auth/invalid-phone-number") msg = "The phone number is invalid.";
              else if (code === "auth/too-many-requests") msg = "Too many requests. Please try again later.";
              else if (code === "auth/network-request-failed") msg = "Network error. Please check your internet connection.";
              else if (snap.error?.message) msg = snap.error.message;
              Alert.alert("Failed to send OTP", msg);
              setBusy(false);
              break;
            }
            default:
              break;
          }
        },
        (error: any) => {
          console.warn("PhoneAuthListener error:", error);
          Alert.alert("Failed to send OTP", error?.message || "Please try again.");
          setBusy(false);
        },
      );
    } catch (e: any) {
      console.warn("verifyPhoneNumber failed:", e);
      Alert.alert("Failed to send OTP", e?.message || "Please try again.");
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (autoVerified) return; // already signed in via auto-retrieval
    if (!/^\d{6}$/.test(otp.trim())) {
      return Alert.alert("Invalid code", "Enter the 6-digit code sent to your phone.");
    }
    if (!verificationId) {
      return Alert.alert("Session expired", "Please request a new OTP.");
    }
    setBusy(true);
    try {
      const credential = PhoneAuthProvider.credential(verificationId, otp.trim());
      await firebaseAuth().signInWithCredential(credential);
      // onAuthStateChanged will fire and call completeWithSignedInUser
    } catch (e: any) {
      console.warn("Manual sign-in failed:", e);
      const code = e?.code || "";
      let msg = "Could not verify the code. Please try again.";
      if (code === "auth/invalid-verification-code") msg = "The OTP you entered is incorrect.";
      else if (code === "auth/code-expired") msg = "OTP expired. Please request a new one.";
      else if (e?.message) msg = e.message;
      Alert.alert("Verification failed", msg);
      setBusy(false);
    }
  };

  const changeNumber = () => {
    try { listenerRef.current?.removeAllListeners?.(); } catch {}
    listenerRef.current = null;
    setStage("phone");
    setOtp("");
    setVerificationId(null);
    setAutoVerified(false);
    setResendTimer(0);
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: COLORS.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.fill}>
        <ScrollView contentContainerStyle={styles.profileWrap} keyboardShouldPersistTaps="handled">
          <View style={styles.profileLogo}>
            <Ionicons name={stage === "phone" ? "phone-portrait" : (autoVerified ? "checkmark-done" : "shield-checkmark")} size={36} color={COLORS.surface} />
          </View>
          <Text style={styles.profileTitle}>
            {stage === "phone" ? "Verify your phone" : (autoVerified ? "Auto-verified" : "Enter OTP")}
          </Text>
          <Text style={styles.profileSubtitle}>
            {stage === "phone"
              ? "We will send you a one-time SMS code. On Android the code is read automatically — you usually won't need to type it."
              : autoVerified
                ? `Signing you in automatically…`
                : `Enter the 6-digit code sent to +91 ${phone}`}
          </Text>
          <View style={{ height: 24 }} />

          {stage === "phone" ? (
            <>
              <Field label="Mobile Number">
                <View style={styles.phoneInputRow} testID="otp-phone-row">
                  <View style={styles.phonePrefix}>
                    <Text style={styles.phonePrefixText}>+91</Text>
                  </View>
                  <TextInput
                    testID="otp-phone-input"
                    style={styles.phoneInput}
                    placeholder="10-digit number"
                    placeholderTextColor={COLORS.textSubtle}
                    value={phone}
                    onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))}
                    keyboardType="number-pad"
                    maxLength={10}
                    autoFocus
                  />
                </View>
              </Field>
              <TouchableOpacity
                testID="otp-send-btn"
                style={[styles.primaryBtn, busy && { opacity: 0.7 }]}
                onPress={sendOtp}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color={COLORS.surface} />
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Send OTP</Text>
                    <Ionicons name="arrow-forward" size={20} color={COLORS.surface} />
                  </>
                )}
              </TouchableOpacity>
              <Text style={styles.otpHint}>
                By continuing you agree to receive an SMS for verification.
              </Text>
            </>
          ) : (
            <>
              <Field label={autoVerified ? "Code (auto-read)" : "6-digit Code"}>
                <TextInput
                  testID="otp-code-input"
                  style={[styles.input, styles.otpCodeInput, autoVerified && { borderColor: COLORS.success, color: COLORS.success }]}
                  placeholder="••••••"
                  placeholderTextColor={COLORS.textSubtle}
                  value={otp}
                  onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  editable={!autoVerified}
                  autoFocus={!autoVerified}
                />
              </Field>
              <TouchableOpacity
                testID="otp-verify-btn"
                style={[styles.primaryBtn, (busy || autoVerified) && { opacity: 0.7 }]}
                onPress={verifyOtp}
                disabled={busy || autoVerified}
              >
                {busy || autoVerified ? (
                  <ActivityIndicator color={COLORS.surface} />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color={COLORS.surface} />
                    <Text style={styles.primaryBtnText}>Verify & Continue</Text>
                  </>
                )}
              </TouchableOpacity>

              {!autoVerified && (
                <View style={styles.otpFooterRow}>
                  <TouchableOpacity testID="otp-change-btn" onPress={changeNumber} disabled={busy}>
                    <Text style={styles.otpLinkText}>Change number</Text>
                  </TouchableOpacity>
                  {resendTimer > 0 ? (
                    <Text style={styles.otpHintMuted}>Resend in {resendTimer}s</Text>
                  ) : (
                    <TouchableOpacity testID="otp-resend-btn" onPress={sendOtp} disabled={busy}>
                      <Text style={styles.otpLinkText}>Resend OTP</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============== Shared types ==============
type CitySuggestion = { name: string; city: string; locality: string; state: string; pincode: string };
type RouteInfo = { city: string; locality: string; state: string; valid: boolean } | null;

// ============== EditLoadModal ==============
function EditLoadModal({ load, visible, onClose, onSaved }: { load: Load; visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [originText, setOriginText] = useState(load.origin_locality || load.origin_city || load.origin_pincode);
  const [originPin, setOriginPin] = useState(load.origin_pincode);
  const [originInfo, setOriginInfo] = useState<RouteInfo>({ city: load.origin_city, locality: load.origin_locality || "", state: load.origin_state, valid: true });
  const [destText, setDestText] = useState(load.destination_locality || load.destination_city || load.destination_pincode);
  const [destPin, setDestPin] = useState(load.destination_pincode);
  const [destInfo, setDestInfo] = useState<RouteInfo>({ city: load.destination_city, locality: load.destination_locality || "", state: load.destination_state, valid: true });
  const [weight, setWeight] = useState(load.weight_tons || 1);
  const [placement, setPlacement] = useState(load.cargo_placement || "");
  const [truckType, setTruckType] = useState(load.truck_type || "");
  const [date, setDate] = useState(new Date(load.loading_date));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [weightModalVisible, setWeightModalVisible] = useState(false);
  const [weightInput, setWeightInput] = useState("");
  const [dimL, setDimL] = useState(load.dimension_length ? String(load.dimension_length) : "");
  const [dimB, setDimB] = useState(load.dimension_breadth ? String(load.dimension_breadth) : "");
  const [dimH, setDimH] = useState(load.dimension_height ? String(load.dimension_height) : "");
  const [pricePerTon, setPricePerTon] = useState(load.price_per_ton ? String(load.price_per_ton) : "");
  const [images, setImages] = useState<string[]>([]);
  const [imagesLoaded, setImagesLoaded] = useState(false);

  // Fetch the full load (with inline base64 images) when the modal opens so
  // the user can add/remove photos without losing existing ones.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/loads/${load.id}/full`);
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setImages(Array.isArray(j?.images) ? j.images : []);
      } catch {}
      finally { if (!cancelled) setImagesLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [visible, load.id]);

  const pickImage = async () => {
    if (images.length >= 3) { Alert.alert("Limit", "You can attach up to 3 photos."); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Please grant photo library access to attach images."); return; }
    const remaining = 3 - images.length;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.5, base64: true });
    if (!res.canceled && res.assets && res.assets.length > 0) {
      const newOnes = res.assets.slice(0, remaining).filter((a: any) => !!a.base64).map((a: any) => `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
      setImages((prev) => [...prev, ...newOnes].slice(0, 3));
    }
  };
  const removeImage = (idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx));

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const maxDate = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() + 14); return d; }, [today]);

  const onDateChange = (event: any, selected?: Date) => {
    if (Platform.OS !== "ios") setShowDatePicker(false);
    if (event?.type === "dismissed") return;
    if (selected) {
      if (selected < today) setDate(today);
      else if (selected > maxDate) setDate(maxDate);
      else setDate(selected);
    }
  };

  const save = async () => {
    if (!/^\d{6}$/.test(originPin)) return Alert.alert("Invalid Origin", "Select a valid origin.");
    if (!/^\d{6}$/.test(destPin)) return Alert.alert("Invalid Destination", "Select a valid destination.");
    if (!truckType) return Alert.alert("Required", "Select a truck type.");
    if (!weight || weight <= 0) return Alert.alert("Invalid", "Enter valid weight.");
    setBusy(true);
    try {
      const lengthVal = dimL ? Math.min(40, parseInt(dimL, 10)) : null;
      const breadthVal = dimB ? Math.min(8, parseInt(dimB, 10)) : null;
      const heightVal = dimH ? Math.min(9, parseInt(dimH, 10)) : null;
      const priceVal = pricePerTon ? parseInt(pricePerTon, 10) : null;
      const payload = {
        origin_pincode: originPin, origin_locality: originInfo?.locality || "", origin_city: originInfo?.city || "", origin_state: originInfo?.state || "",
        destination_pincode: destPin, destination_locality: destInfo?.locality || "", destination_city: destInfo?.city || "", destination_state: destInfo?.state || "",
        cargo_placement: placement, truck_type: truckType, weight_tons: weight, space_cuft: null,
        dimension_length: lengthVal, dimension_breadth: breadthVal, dimension_height: heightVal, price_per_ton: priceVal,
        loading_date: date.toISOString().slice(0, 10),
        images,
      };
      const res = await fetch(`${API}/loads/${load.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error("Failed");
      onSaved(); onClose();
    } catch { Alert.alert("Error", "Failed to update load. Please try again."); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { maxHeight: "94%" }]} testID="edit-load-modal">
          <View style={styles.modalHandle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>Edit Posting</Text>

            <SectionTitle icon="navigate-outline" title="Route" />
            <View style={styles.routeInputsRow}>
              <SmartRouteInput label="Origin" testIDPrefix="edit-origin" text={originText} pin={originPin} info={originInfo}
                onChange={(t, p, i) => { setOriginText(t); setOriginPin(p); setOriginInfo(i); }} />
              <View style={styles.routeArrowMid}><Ionicons name="arrow-forward" size={20} color={COLORS.secondary} /></View>
              <SmartRouteInput label="Destination" testIDPrefix="edit-dest" text={destText} pin={destPin} info={destInfo}
                onChange={(t, p, i) => { setDestText(t); setDestPin(p); setDestInfo(i); }} />
            </View>

            <SectionTitle icon="calendar-outline" title="Loading Date" />
            <View style={[styles.stepperRow, styles.filledBorder]}>
              <TouchableOpacity
                testID="edit-loading-date-minus"
                style={styles.stepperBtn}
                onPress={() => {
                  setDate(prev => {
                    const d = new Date(prev); d.setDate(d.getDate() - 1);
                    return d < today ? today : d;
                  });
                }}
              >
                <Text style={styles.stepperBtnText}>-</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="edit-loading-date-btn"
                style={styles.stepperCenter}
                activeOpacity={0.8}
                onPress={() => setShowDatePicker(true)}
              >
                <Ionicons name="calendar" size={14} color={COLORS.primary} />
                <Text
                  style={styles.stepperDateText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  allowFontScaling={false}
                >
                  {date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="edit-loading-date-plus"
                style={styles.stepperBtn}
                onPress={() => {
                  setDate(prev => {
                    const d = new Date(prev); d.setDate(d.getDate() + 1);
                    return d > maxDate ? maxDate : d;
                  });
                }}
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            {showDatePicker && (
              <DateTimePicker
                value={date}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                minimumDate={today}
                maximumDate={maxDate}
                onChange={onDateChange}
              />
            )}

            <SectionTitle icon="scale-outline" title="Available Load Capacity" />
            <View style={[styles.stepperRow, weight > 0 && styles.filledBorder]}>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => setWeight(w => Math.max(0.5, parseFloat((w - 0.5).toFixed(1))))}>
                <Text style={styles.stepperBtnText}>-</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.stepperCenter} activeOpacity={0.8} onPress={() => { setWeightInput(String(weight)); setWeightModalVisible(true); }}>
                <Text style={styles.stepperValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} allowFontScaling={false}>{weight.toFixed(1)}</Text>
                <Text style={styles.stepperUnit} numberOfLines={1} allowFontScaling={false}>tons</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => setWeight(w => parseFloat((w + 0.5).toFixed(1)))}>
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <SectionTitle icon="bus-outline" title="Truck Type" />
            <View style={styles.truckRow}>
              {TRUCK_TYPES.map((t) => {
                const on = truckType === t.name;
                return (
                  <TouchableOpacity key={t.name} onPress={() => setTruckType(t.name)} style={[styles.truckCard, on && styles.truckCardOn, on && styles.filledBorder]} activeOpacity={0.7}>
                    <Image source={t.image} style={styles.truckImg} resizeMode="contain" />
                    <Text style={[styles.truckLabel, on && styles.truckLabelOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false}>{t.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.optionalHeading}>Add more details (optional)</Text>

            <CollapsibleSection
              icon="resize-outline"
              title="Available Space"
              summary={(dimL || dimB || dimH) ? `${dimL || "-"} x ${dimB || "-"} x ${dimH || "-"} ft` : ""}
              testID="edit-opt-space"
            >
              <View style={styles.dimRow}>
                <View style={styles.dimItem}>
                  <Text style={styles.dimLabel}>Length</Text>
                  <View style={[styles.dimInputWrap, dimL && styles.filledBorder]}>
                    <TextInput
                      testID="edit-dim-length-input"
                      style={styles.dimInputText}
                      value={dimL}
                      onChangeText={(t) => {
                        const digits = t.replace(/\D/g, "");
                        if (!digits) { setDimL(""); return; }
                        const n = Math.min(40, parseInt(digits, 10));
                        setDimL(String(n));
                      }}
                      keyboardType="number-pad"
                      maxLength={2}
                      placeholder="0"
                      placeholderTextColor={COLORS.textSubtle}
                    />
                    <Text style={styles.dimSuffix}>ft</Text>
                  </View>
                </View>
                <View style={styles.dimItem}>
                  <Text style={styles.dimLabel}>Breadth</Text>
                  <View style={[styles.dimInputWrap, dimB && styles.filledBorder]}>
                    <TextInput
                      testID="edit-dim-breadth-input"
                      style={styles.dimInputText}
                      value={dimB}
                      onChangeText={(t) => {
                        const digits = t.replace(/\D/g, "");
                        if (!digits) { setDimB(""); return; }
                        const n = Math.min(8, parseInt(digits, 10));
                        setDimB(String(n));
                      }}
                      keyboardType="number-pad"
                      maxLength={1}
                      placeholder="0"
                      placeholderTextColor={COLORS.textSubtle}
                    />
                    <Text style={styles.dimSuffix}>ft</Text>
                  </View>
                </View>
                <View style={styles.dimItem}>
                  <Text style={styles.dimLabel}>Height</Text>
                  <View style={[styles.dimInputWrap, dimH && styles.filledBorder]}>
                    <TextInput
                      testID="edit-dim-height-input"
                      style={styles.dimInputText}
                      value={dimH}
                      onChangeText={(t) => {
                        const digits = t.replace(/\D/g, "");
                        if (!digits) { setDimH(""); return; }
                        const n = Math.min(9, parseInt(digits, 10));
                        setDimH(String(n));
                      }}
                      keyboardType="number-pad"
                      maxLength={1}
                      placeholder="0"
                      placeholderTextColor={COLORS.textSubtle}
                    />
                    <Text style={styles.dimSuffix}>ft</Text>
                  </View>
                </View>
              </View>
            </CollapsibleSection>

            <CollapsibleSection
              icon="pricetag-outline"
              title="Pricing"
              summary={pricePerTon ? `₹${pricePerTon} / ton` : ""}
              testID="edit-opt-pricing"
            >
              <View style={[styles.priceRow, pricePerTon && styles.filledBorder]}>
                <Text style={styles.priceSymbol}>₹</Text>
                <TextInput
                  testID="edit-price-per-ton-input"
                  style={styles.priceInput}
                  value={pricePerTon}
                  onChangeText={(t) => setPricePerTon(t.replace(/\D/g, "").slice(0, 7))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={COLORS.textSubtle}
                />
                <Text style={styles.priceSuffix}>/ ton</Text>
              </View>
            </CollapsibleSection>

            <CollapsibleSection
              icon="layers-outline"
              title="Cargo Placement"
              summary={placement}
              testID="edit-opt-placement"
            >
              <View style={styles.placementRow}>
                {PLACEMENT_OPTIONS.map((p) => {
                  const on = placement === p.key;
                  return (
                    <TouchableOpacity
                      key={p.key}
                      style={[styles.placementCardCompact, on && (p.key === "Stackable" ? styles.placementCardGreen : styles.placementCardRed)]}
                      onPress={() => setPlacement(prev => prev === p.key ? "" : p.key)}
                      activeOpacity={0.7}
                    >
                      <Image source={p.image} style={styles.placementImgCompact} resizeMode="contain" />
                      <Text style={[styles.placementLabelCompact, on && (p.key === "Stackable" ? styles.placementLabelGreen : styles.placementLabelRed)]}>{p.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </CollapsibleSection>

            <CollapsibleSection
              icon="image-outline"
              title="Photos"
              summary={imagesLoaded ? (images.length > 0 ? `${images.length} photo${images.length > 1 ? "s" : ""}` : "") : "Loading…"}
              testID="edit-opt-photos"
            >
              <Text style={styles.label}>Attach up to 3 photos of the truck or available space</Text>
              <View style={styles.photoRow}>
                {[0, 1, 2].map((idx) => {
                  const img = images[idx];
                  if (img) {
                    return (
                      <View key={idx} style={styles.photoCell}>
                        <Image source={{ uri: img }} style={styles.photoImg} resizeMode="cover" />
                        <TouchableOpacity testID={`edit-photo-remove-${idx}`} onPress={() => removeImage(idx)} style={styles.photoRemoveBtn}>
                          <Ionicons name="close" size={14} color={COLORS.surface} />
                        </TouchableOpacity>
                      </View>
                    );
                  }
                  return (
                    <TouchableOpacity key={idx} testID={`edit-photo-add-${idx}`} onPress={pickImage} style={[styles.photoCell, styles.photoEmpty]} activeOpacity={0.7}>
                      <Ionicons name="add" size={28} color={COLORS.textMuted} />
                      <Text style={styles.photoAddLabel}>Add</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </CollapsibleSection>

            <View style={[styles.row, { marginTop: 16, gap: 10 }]}>
              <TouchableOpacity style={[styles.outlineBtn, styles.flex1]} onPress={onClose} disabled={busy}>
                <Text style={styles.outlineBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, styles.flex1, { marginTop: 0 }]} onPress={save} disabled={busy}>
                {busy ? <ActivityIndicator color={COLORS.surface} /> : <Text style={styles.primaryBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </View>
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {/* Weight quick-entry modal */}
      <Modal visible={weightModalVisible} transparent animationType="fade" onRequestClose={() => setWeightModalVisible(false)}>
        <TouchableOpacity style={wmStyles.backdrop} activeOpacity={1} onPress={() => setWeightModalVisible(false)}>
          <TouchableOpacity style={wmStyles.sheet} activeOpacity={1}>
            <Text style={wmStyles.title}>Enter Weight</Text>
            <TextInput
              style={wmStyles.input}
              value={weightInput}
              onChangeText={setWeightInput}
              keyboardType="decimal-pad"
              autoFocus
              placeholder="e.g. 15"
              placeholderTextColor={COLORS.textSubtle}
            />
            <View style={wmStyles.presets}>
              {[1,2,5,10,15,20,25].map(n => (
                <TouchableOpacity key={n} style={wmStyles.preset} onPress={() => setWeightInput(String(n))}>
                  <Text style={wmStyles.presetText}>{n}T</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={wmStyles.btn} onPress={() => {
              const n = parseFloat(weightInput);
              if (!isNaN(n) && n > 0) setWeight(parseFloat(n.toFixed(1)));
              setWeightModalVisible(false);
            }}>
              <Text style={wmStyles.btnText}>Set Weight</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </Modal>
  );
}

// ============== Profile Screen ==============
function ProfileScreen({ profile, onClose, onEdit }: { profile: Profile; onClose: () => void; onEdit: () => void }) {
  const [myLoads, setMyLoads] = useState<Load[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editLoad, setEditLoad] = useState<Load | null>(null);

  const fetchMy = useCallback(async () => {
    try {
      const r = await fetch(`${API}/loads`);
      const j: Load[] = await r.json();
      setMyLoads(j.filter((l) => l.poster_phone === profile.phone));
    } catch {} finally {
      setLoading(false); setRefreshing(false);
    }
  }, [profile.phone]);

  useEffect(() => { fetchMy(); }, [fetchMy]);

  const deleteLoad = (load: Load) => {
    Alert.alert("Delete Posting", "Are you sure you want to delete this load posting? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await fetch(`${API}/loads/${load.id}`, { method: "DELETE" });
          setMyLoads(prev => prev.filter(l => l.id !== load.id));
        } catch { Alert.alert("Error", "Failed to delete. Please try again."); }
      }},
    ]);
  };

  const initials = profile.name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  return (
    <SafeAreaView style={styles.fill} edges={["top"]}>
      <View style={styles.header} testID="profile-header">
        <TouchableOpacity testID="profile-back-btn" onPress={onClose} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Profile</Text>
        <TouchableOpacity testID="profile-edit-btn" onPress={onEdit} style={styles.iconBtn}>
          <Ionicons name="create-outline" size={22} color={COLORS.primary} />
        </TouchableOpacity>
      </View>
      <FlatList
        testID="my-loads-list"
        data={loading ? [] : myLoads}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchMy(); }} />}
        ListHeaderComponent={
          <>
            <View style={styles.profileCard} testID="profile-card">
              <View style={styles.avatarBig}><Text style={styles.avatarBigText}>{initials || "?"}</Text></View>
              <Text style={styles.profileCardName} testID="profile-card-name">{profile.name}</Text>
              {profile.company ? <Text style={styles.profileCardCompany} testID="profile-card-company">{profile.company}</Text> : null}
              <View style={styles.profilePhoneRow}>
                <Ionicons name="call-outline" size={14} color={COLORS.textMuted} />
                <Text style={styles.profileCardPhone} testID="profile-card-phone">+91 {profile.phone}</Text>
              </View>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statBox}><Text style={styles.statValue} testID="my-loads-count">{myLoads.length}</Text><Text style={styles.statLabel}>Loads Posted</Text></View>
              <View style={styles.statBox}><Text style={styles.statValue}>{myLoads.reduce((s, l) => s + (l.weight_tons || 0), 0).toFixed(1)} T</Text><Text style={styles.statLabel}>Total Weight</Text></View>
            </View>
            <Text style={styles.sectionHeading}>My Posted Loads</Text>
            {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 24 }} /> : null}
          </>
        }
        ListEmptyComponent={!loading ? (
          <View style={styles.emptyWrap} testID="profile-empty">
            <Ionicons name="cube-outline" size={42} color={COLORS.textSubtle} />
            <Text style={styles.emptyTitle}>No loads posted yet</Text>
            <Text style={styles.emptySub}>Post your first load to see it listed here.</Text>
          </View>
        ) : null}
        renderItem={({ item }) => (
          <View>
            <LoadCard load={item} isMine={true} />
            <View style={profileStyles.actionRow}>
              <TouchableOpacity style={profileStyles.editBtn} onPress={() => setEditLoad(item)} testID={`edit-load-${item.id}`}>
                <Ionicons name="create-outline" size={15} color={COLORS.primary} />
                <Text style={profileStyles.editBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={profileStyles.deleteBtn} onPress={() => deleteLoad(item)} testID={`delete-load-${item.id}`}>
                <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                <Text style={profileStyles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
      {editLoad && (
        <EditLoadModal
          load={editLoad}
          visible={!!editLoad}
          onClose={() => setEditLoad(null)}
          onSaved={() => { setEditLoad(null); fetchMy(); }}
        />
      )}
    </SafeAreaView>
  );
}

const profileStyles = StyleSheet.create({
  actionRow: { flexDirection: "row", gap: 10, marginTop: -6, marginBottom: 14, paddingHorizontal: 2 },
  editBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: "#EEF2FA" },
  editBtnText: { color: COLORS.primary, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13 },
  deleteBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.danger, backgroundColor: "#FDF1F1" },
  deleteBtnText: { color: COLORS.danger, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13 },
});

// ============== Post Load ==============
function PostLoadScreen({ profile, onPosted }: { profile: Profile; onPosted: () => void }) {
  const [originText, setOriginText] = useState("");
  const [originPin, setOriginPin] = useState("");
  const [originInfo, setOriginInfo] = useState<RouteInfo>(null);
  const [destText, setDestText] = useState("");
  const [destPin, setDestPin] = useState("");
  const [destInfo, setDestInfo] = useState<RouteInfo>(null);
  const [images, setImages] = useState<string[]>([]);
  const [placement, setPlacement] = useState<string>("");
  const [truckType, setTruckType] = useState<string>("");
 
const [weight, setWeight] = useState(1.0);
const [date, setDate] = useState<Date>(new Date());
const [showDatePicker, setShowDatePicker] = useState(false);
const [weightModalVisible, setWeightModalVisible] = useState(false);
const [weightInput, setWeightInput] = useState("");
const [dimL, setDimL] = useState("");
const [dimB, setDimB] = useState("");
const [dimH, setDimH] = useState("");
const [pricePerTon, setPricePerTon] = useState("");

const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
const maxDate = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() + 14); return d; }, [today]);

const onDateChange = (event: any, selected?: Date) => {
  if (Platform.OS !== "ios") setShowDatePicker(false);
  if (event?.type === "dismissed") return;
  if (selected) {
    if (selected < today) setDate(today);
    else if (selected > maxDate) setDate(maxDate);
    else setDate(selected);
  }
};
  
	
  const [loadingPost, setLoadingPost] = useState(false);

  const pickImage = async () => {
    if (images.length >= 3) { Alert.alert("Limit", "You can attach up to 3 photos."); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Please grant photo library access to attach images."); return; }
    const remaining = 3 - images.length;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.5, base64: true });
    if (!res.canceled && res.assets && res.assets.length > 0) {
      const newOnes = res.assets.slice(0, remaining).filter((a: any) => !!a.base64).map((a: any) => `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
      setImages((prev) => [...prev, ...newOnes].slice(0, 3));
    }
  };

  const removeImage = (idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx));

  const submit = async (alsoShare: boolean) => {
    if (!/^\d{6}$/.test(originPin)) return Alert.alert("Invalid Origin", "Enter a valid 6-digit pincode or pick a city from the list.");
    if (!/^\d{6}$/.test(destPin)) return Alert.alert("Invalid Destination", "Enter a valid 6-digit pincode or pick a city from the list.");
    if (!truckType) return Alert.alert("Required", "Select a truck type");
const w = weight;
if (!w || w <= 0) return Alert.alert("Invalid", "Enter valid weight in tons");
    
    setLoadingPost(true);
    try {
      const lengthVal = dimL ? Math.min(40, parseInt(dimL, 10)) : null;
      const breadthVal = dimB ? Math.min(8, parseInt(dimB, 10)) : null;
      const heightVal = dimH ? Math.min(9, parseInt(dimH, 10)) : null;
      const priceVal = pricePerTon ? parseInt(pricePerTon, 10) : null;
      const payload = {
        origin_pincode: originPin, origin_locality: originInfo?.locality || "", origin_city: originInfo?.city || "", origin_state: originInfo?.state || "",
        destination_pincode: destPin, destination_locality: destInfo?.locality || "", destination_city: destInfo?.city || "", destination_state: destInfo?.state || "",
        cargo_types: [], cargo_placement: placement, truck_type: truckType, weight_tons: w, space_cuft: null,
        dimension_length: lengthVal, dimension_breadth: breadthVal, dimension_height: heightVal, price_per_ton: priceVal,
        loading_date: date.toISOString().slice(0, 10), poster_name: profile.name, poster_phone: profile.phone,
        poster_company: profile.company, images,
      };
      const res = await fetch(`${API}/loads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error("Failed to post");
      const created = await res.json();

      const reset = () => {
        setOriginText(""); setOriginPin(""); setOriginInfo(null);
        setDestText(""); setDestPin(""); setDestInfo(null);
        setTruckType(""); setPlacement(""); setWeight(1.0); setImages([]);
        setDimL(""); setDimB(""); setDimH(""); setPricePerTon("");
      };

      if (alsoShare) {
        const dateStr = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        const oLocality = originInfo?.locality || originInfo?.city || "";
        const dLocality = destInfo?.locality || destInfo?.city || "";
        const originLine = `📍 ${originPin}${oLocality ? `, ${oLocality}` : ""}${originInfo?.state ? `, ${originInfo.state}` : ""}`;
        const destLine   = `📍 ${destPin}${dLocality ? `, ${dLocality}` : ""}${destInfo?.state ? `, ${destInfo.state}` : ""}`;
        const loadLink = created?.id
          ? `\n\n🔗 More info & pics: https://www.trucktraffic.in?load=${created.id}`
          : `\n\n🔗 More info & pics: https://www.trucktraffic.in`;
        const text = `🚛 *Truck Space Available – Truck Traffic PTL*\n\n` +
          `*Route:*\n${originLine}\n   ⬇️\n${destLine}\n\n` +
          `🚚 *Truck:* ${truckType}\n` +
          `⚖️ *Weight:* ${w} Tons\n` +
          `📅 *Loading:* ${dateStr}\n` +
          `🧱 *Placement:* ${placement}` +
          `\n\n📞 *Contact:* ${profile.name}` +
          (profile.company ? ` — ${profile.company}` : "") +
          `\n+91 ${profile.phone}` +
          loadLink;
        try { await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`); } catch {
          Alert.alert("Posted", "Load posted, but WhatsApp could not be opened.");
        }
        reset(); onPosted();
      } else {
        Alert.alert("Posted!", "Your load has been added to the market.", [{ text: "View Market", onPress: () => { reset(); onPosted(); } }]);
      }
    } catch (e) {
      Alert.alert("Error", "Failed to post load. Please try again.");
    } finally {
      setLoadingPost(false);
    }
  };

return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.fill}
      keyboardVerticalOffset={80}
    >
      <ScrollView
        contentContainerStyle={styles.formWrap}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        testID="post-load-form"
      >

        <SectionTitle icon="navigate-outline" title="Route" />
        <View style={styles.routeInputsRow}>
          <SmartRouteInput
            label="Origin"
            testIDPrefix="origin"
            text={originText}
            pin={originPin}
            info={originInfo}
            onChange={(t, pin, info) => {
              setOriginText(t);
              setOriginPin(pin);
              setOriginInfo(info);
            }}
          />
          <View style={styles.routeArrowMid}>
            <Ionicons name="arrow-forward" size={20} color={COLORS.secondary} />
          </View>
          <SmartRouteInput
            label="Destination"
            testIDPrefix="dest"
            text={destText}
            pin={destPin}
            info={destInfo}
            onChange={(t, pin, info) => {
              setDestText(t);
              setDestPin(pin);
              setDestInfo(info);
            }}
          />
        </View>

        <SectionTitle icon="calendar-outline" title="Loading Date" />
        <View style={[styles.stepperRow, styles.filledBorder]}>
          <TouchableOpacity
            testID="loading-date-minus"
            style={styles.stepperBtn}
            onPress={() => {
              setDate(prev => {
                const d = new Date(prev); d.setDate(d.getDate() - 1);
                return d < today ? today : d;
              });
            }}
          >
            <Text style={styles.stepperBtnText}>-</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="loading-date-btn"
            style={styles.stepperCenter}
            activeOpacity={0.8}
            onPress={() => setShowDatePicker(true)}
          >
            <Ionicons name="calendar" size={14} color={COLORS.primary} />
            <Text
              style={styles.stepperDateText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              allowFontScaling={false}
            >
              {date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="loading-date-plus"
            style={styles.stepperBtn}
            onPress={() => {
              setDate(prev => {
                const d = new Date(prev); d.setDate(d.getDate() + 1);
                return d > maxDate ? maxDate : d;
              });
            }}
          >
            <Text style={styles.stepperBtnText}>+</Text>
          </TouchableOpacity>
        </View>
        {showDatePicker && (
          <DateTimePicker
            value={date}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            minimumDate={today}
            maximumDate={maxDate}
            onChange={onDateChange}
          />
        )}

        <SectionTitle icon="scale-outline" title="Available Load Capacity" />
        <View style={[styles.stepperRow, weight > 0 && styles.filledBorder]}>
          <TouchableOpacity
            style={styles.stepperBtn}
            onPress={() => setWeight(w => Math.max(0.5, parseFloat((w - 0.5).toFixed(1))))}
          >
            <Text style={styles.stepperBtnText}>-</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stepperCenter}
            activeOpacity={0.8}
            onPress={() => { setWeightInput(String(weight)); setWeightModalVisible(true); }}
          >
            <Text style={styles.stepperValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} allowFontScaling={false}>{weight.toFixed(1)}</Text>
            <Text style={styles.stepperUnit} numberOfLines={1} allowFontScaling={false}>tons</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stepperBtn}
            onPress={() => setWeight(w => parseFloat((w + 0.5).toFixed(1)))}
          >
            <Text style={styles.stepperBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        {/* Weight quick-entry modal */}
        <Modal visible={weightModalVisible} transparent animationType="fade" onRequestClose={() => setWeightModalVisible(false)}>
          <TouchableOpacity style={wmStyles.backdrop} activeOpacity={1} onPress={() => setWeightModalVisible(false)}>
            <TouchableOpacity style={wmStyles.sheet} activeOpacity={1}>
              <Text style={wmStyles.title}>Enter Weight</Text>
              <TextInput
                style={wmStyles.input}
                value={weightInput}
                onChangeText={setWeightInput}
                keyboardType="decimal-pad"
                autoFocus
                placeholder="e.g. 15"
                placeholderTextColor={COLORS.textSubtle}
              />
              <View style={wmStyles.presets}>
                {[1,2,5,10,15,20,25].map(n => (
                  <TouchableOpacity key={n} style={wmStyles.preset} onPress={() => setWeightInput(String(n))}>
                    <Text style={wmStyles.presetText}>{n}T</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={wmStyles.btn} onPress={() => {
                const n = parseFloat(weightInput);
                if (!isNaN(n) && n > 0) setWeight(parseFloat(n.toFixed(1)));
                setWeightModalVisible(false);
              }}>
                <Text style={wmStyles.btnText}>Set Weight</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        <SectionTitle icon="bus-outline" title="Truck Type" />
        <View style={styles.truckRow} testID="truck-types-row">
          {TRUCK_TYPES.map((t) => {
            const on = truckType === t.name;
            return (
              <TouchableOpacity key={t.name} testID={`truck-type-${t.name.replace(/\s+/g, "-")}`} onPress={() => setTruckType(t.name)} style={[styles.truckCard, on && styles.truckCardOn, on && styles.filledBorder]} activeOpacity={0.7}>
                <Image source={t.image} style={[styles.truckImg, on && styles.truckImgOn]} resizeMode="contain" />
                <Text style={[styles.truckLabel, on && styles.truckLabelOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false}>{t.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ===== Optional fields (collapsible) ===== */}
        <Text style={styles.optionalHeading}>Add more details (optional)</Text>

        <CollapsibleSection
          icon="resize-outline"
          title="Available Space"
          summary={(dimL || dimB || dimH) ? `${dimL || "-"} x ${dimB || "-"} x ${dimH || "-"} ft` : ""}
          testID="opt-space"
        >
          <View style={styles.dimRow} testID="dimension-row">
            <View style={styles.dimItem}>
              <Text style={styles.dimLabel}>Length</Text>
              <View style={[styles.dimInputWrap, dimL && styles.filledBorder]}>
                <TextInput
                  testID="dim-length-input"
                  style={styles.dimInputText}
                  value={dimL}
                  onChangeText={(t) => {
                    const digits = t.replace(/\D/g, "");
                    if (!digits) { setDimL(""); return; }
                    const n = Math.min(40, parseInt(digits, 10));
                    setDimL(String(n));
                  }}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="0"
                  placeholderTextColor={COLORS.textSubtle}
                />
                <Text style={styles.dimSuffix}>ft</Text>
              </View>
            </View>
            <View style={styles.dimItem}>
              <Text style={styles.dimLabel}>Breadth</Text>
              <View style={[styles.dimInputWrap, dimB && styles.filledBorder]}>
                <TextInput
                  testID="dim-breadth-input"
                  style={styles.dimInputText}
                  value={dimB}
                  onChangeText={(t) => {
                    const digits = t.replace(/\D/g, "");
                    if (!digits) { setDimB(""); return; }
                    const n = Math.min(8, parseInt(digits, 10));
                    setDimB(String(n));
                  }}
                  keyboardType="number-pad"
                  maxLength={1}
                  placeholder="0"
                  placeholderTextColor={COLORS.textSubtle}
                />
                <Text style={styles.dimSuffix}>ft</Text>
              </View>
            </View>
            <View style={styles.dimItem}>
              <Text style={styles.dimLabel}>Height</Text>
              <View style={[styles.dimInputWrap, dimH && styles.filledBorder]}>
                <TextInput
                  testID="dim-height-input"
                  style={styles.dimInputText}
                  value={dimH}
                  onChangeText={(t) => {
                    const digits = t.replace(/\D/g, "");
                    if (!digits) { setDimH(""); return; }
                    const n = Math.min(9, parseInt(digits, 10));
                    setDimH(String(n));
                  }}
                  keyboardType="number-pad"
                  maxLength={1}
                  placeholder="0"
                  placeholderTextColor={COLORS.textSubtle}
                />
                <Text style={styles.dimSuffix}>ft</Text>
              </View>
            </View>
          </View>
        </CollapsibleSection>

        <CollapsibleSection
          icon="pricetag-outline"
          title="Pricing"
          summary={pricePerTon ? `₹${pricePerTon} / ton` : ""}
          testID="opt-pricing"
        >
          <View style={[styles.priceRow, pricePerTon && styles.filledBorder]}>
            <Text style={styles.priceSymbol}>₹</Text>
            <TextInput
              testID="price-per-ton-input"
              style={styles.priceInput}
              value={pricePerTon}
              onChangeText={(t) => setPricePerTon(t.replace(/\D/g, "").slice(0, 7))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={COLORS.textSubtle}
            />
            <Text style={styles.priceSuffix}>/ ton</Text>
          </View>
        </CollapsibleSection>

        <CollapsibleSection
          icon="layers-outline"
          title="Cargo Placement"
          summary={placement}
          testID="opt-placement"
        >
          <View style={styles.placementRow} testID="placement-segment">
            {PLACEMENT_OPTIONS.map((p) => {
              const on = placement === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  testID={`placement-${p.key.replace(" ", "-")}`}
                  style={[
                    styles.placementCardCompact,
                    on && (p.key === "Stackable" ? styles.placementCardGreen : styles.placementCardRed),
                  ]}
                  onPress={() => setPlacement(prev => prev === p.key ? "" : p.key)}
                  activeOpacity={0.7}
                >
                  <Image source={p.image} style={styles.placementImgCompact} resizeMode="contain" />
                  <Text
                    style={[
                      styles.placementLabelCompact,
                      on && (p.key === "Stackable" ? styles.placementLabelGreen : styles.placementLabelRed),
                    ]}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </CollapsibleSection>

        <CollapsibleSection
          icon="image-outline"
          title="Photos"
          summary={images.length > 0 ? `${images.length} photo${images.length > 1 ? "s" : ""}` : ""}
          testID="opt-photos"
        >
          <Text style={styles.label}>Attach up to 3 photos of the truck or available space</Text>
          <View style={styles.photoRow} testID="photos-row">
            {[0, 1, 2].map((idx) => {
              const img = images[idx];
              if (img) {
                return (
                  <View key={idx} style={styles.photoCell} testID={`photo-${idx}`}>
                    <Image source={{ uri: img }} style={styles.photoImg} resizeMode="cover" />
                    <TouchableOpacity testID={`photo-remove-${idx}`} onPress={() => removeImage(idx)} style={styles.photoRemoveBtn}>
                      <Ionicons name="close" size={14} color={COLORS.surface} />
                    </TouchableOpacity>
                  </View>
                );
              }
              return (
                <TouchableOpacity key={idx} testID={`photo-add-${idx}`} onPress={pickImage} style={[styles.photoCell, styles.photoEmpty]} activeOpacity={0.7}>
                  <Ionicons name="add" size={28} color={COLORS.textMuted} />
                  <Text style={styles.photoAddLabel}>Add</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </CollapsibleSection>

        <View style={[styles.row, { marginTop: 24 }]}>
          <TouchableOpacity testID="submit-load-btn" style={[styles.primaryBtn, styles.flex1, { marginTop: 0 }]} onPress={() => submit(false)} disabled={loadingPost}>
            {loadingPost ? <ActivityIndicator color={COLORS.surface} /> : <><Ionicons name="checkmark-circle" size={18} color={COLORS.surface} /><Text style={styles.primaryBtnText}>Post</Text></>}
          </TouchableOpacity>
          <View style={{ width: 10 }} />
          <TouchableOpacity testID="submit-load-share-btn" style={[styles.whatsappBtn, styles.flex1]} onPress={() => submit(true)} disabled={loadingPost}>
            {loadingPost ? <ActivityIndicator color={COLORS.surface} /> : <><Ionicons name="logo-whatsapp" size={18} color={COLORS.surface} /><Text style={styles.primaryBtnText}>Post & Share</Text></>}
          </TouchableOpacity>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ============== CollapsibleSection ==============
function CollapsibleSection({ icon, title, summary, children, testID }: { icon: any; title: string; summary?: string; children: React.ReactNode; testID?: string }) {
  const [open, setOpen] = useState(false);
  const filled = !!(summary && summary.trim().length > 0);
  return (
    <View style={styles.collapseWrap} testID={testID}>
      <TouchableOpacity
        testID={testID ? `${testID}-toggle` : undefined}
        style={[styles.collapseHeader, filled && styles.collapseHeaderFilled, open && styles.collapseHeaderOpen]}
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.7}
      >
        <Ionicons name={icon} size={16} color={filled ? COLORS.success : COLORS.primary} />
        <Text style={[styles.collapseTitle, filled && { color: COLORS.success }]}>{title}</Text>
        {filled ? (
          <Text style={styles.collapseSummary} numberOfLines={1}>{summary}</Text>
        ) : (
          <Text style={styles.collapseAdd}>Tap to add</Text>
        )}
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={COLORS.textMuted} />
      </TouchableOpacity>
      {open ? <View style={styles.collapseBody}>{children}</View> : null}
    </View>
  );
}

function PincodeHint({ info, pin, testID }: any) {
  if (!pin || pin.length < 6) return null;
  if (!info) return <Text style={styles.hintMuted} testID={testID}>Looking up...</Text>;
  if (!info.valid) return <Text style={[styles.hintMuted, { color: COLORS.danger }]} testID={testID}>Pincode not found</Text>;
  return <Text style={styles.hintOk} testID={testID}><Ionicons name="checkmark-circle" size={12} color={COLORS.success} /> {info.city}, {info.state}</Text>;
}

function VoiceListenOverlay({ visible, onCancel, status }: { visible: boolean; onCancel: () => void; status: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) { pulse.setValue(0); return; }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  const ring = () => ({
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.voiceBackdrop} testID="voice-overlay">
        <View style={styles.voiceCard}>
          <View style={styles.voicePulseWrap}>
            <Animated.View style={[styles.voiceRing, ring()]} />
            <Animated.View style={[styles.voiceRing, ring()]} />
            <View style={styles.voiceMicBox}><Ionicons name="mic" size={42} color={COLORS.surface} /></View>
          </View>
          <Text style={styles.voiceTitle}>Listening…</Text>
          <Text style={styles.voiceSub}>{status}</Text>
          <TouchableOpacity testID="voice-cancel-btn" onPress={onCancel} style={styles.voiceCancelBtn}>
            <Text style={styles.voiceCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ============== RouteSearchModal ==============
const RECENT_KEY_PREFIX = "recent_routes_";

async function getRecentSearches(prefix: string): Promise<CitySuggestion[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY_PREFIX + prefix);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveRecentSearch(prefix: string, s: CitySuggestion) {
  try {
    const existing = await getRecentSearches(prefix);
    const filtered = existing.filter((r) => r.pincode !== s.pincode);
    const updated = [s, ...filtered].slice(0, 5);
    await AsyncStorage.setItem(RECENT_KEY_PREFIX + prefix, JSON.stringify(updated));
  } catch {}
}

function RouteSearchModal({ visible, label, testIDPrefix, onClose, onSelect }: {
  visible: boolean;
  label: string;
  testIDPrefix: string;
  onClose: () => void;
  onSelect: (text: string, pin: string, info: RouteInfo) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CitySuggestion[]>([]);
  const [recents, setRecents] = useState<CitySuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Speak the city name or pincode");
  const inputRef = useRef<TextInput>(null);

  const isPincodeMode = query.length === 0 || /^\d/.test(query);

  useEffect(() => {
    if (visible) {
      setQuery("");
      setResults([]);
      setListening(false);
      getRecentSearches(testIDPrefix).then(setRecents);
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [visible]);

  // Name/city search via Mappls places API (mirrors web autocomplete)
  useEffect(() => {
    if (isPincodeMode) { setResults([]); return; }
    const q = query.trim();
    if (q.length < 3) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/places?query=${encodeURIComponent(q)}`);
        const data = await r.json();

        const all = [
          ...(data.suggestedLocations || []),
          ...(data.userAddedLocations || []),
        ];

        // Build a name→pincode index from any result that has a pincode
        const pincodeByWord: Record<string, string> = {};
        all.forEach((s: any) => {
          const m = (s.placeAddress || "").match(/\b(\d{6})\b/);
          if (m) {
            (s.placeName || "").toLowerCase().split(/\s+/).forEach((w: string) => {
              if (w.length > 3 && !pincodeByWord[w]) pincodeByWord[w] = m[1];
            });
          }
        });

        // Take top 7 from API order, attach pincode (direct or via name lookup), keep order, no dedup
        const mapped: CitySuggestion[] = all.slice(0, 7).map((s: any) => {
          const direct = (s.placeAddress || "").match(/\b(\d{6})\b/);
          const nameWords = (s.placeName || "").toLowerCase().split(/\s+/);
          const lookedUp = nameWords.map((w: string) => pincodeByWord[w]).find(Boolean);
          const pincode = direct ? direct[1] : (lookedUp || "");

          // city/state/locality preserved for the existing row UI
          const parts = (s.placeAddress || "").split(",").map((p: string) => p.trim()).filter(Boolean);
          const state = parts.length >= 1 ? parts[parts.length - 1] : "";
          const city = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "";
          const locality = s.placeName || "";

          return { name: s.placeName, city, locality, state, pincode };
        }).filter((s: CitySuggestion) => s.pincode);

        if (!cancelled) setResults(mapped);
      } catch { if (!cancelled) setResults([]); }
      finally { if (!cancelled) setSearching(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, isPincodeMode]);

  // Pincode lookup
  useEffect(() => {
    if (!isPincodeMode || query.length !== 6) return;
    let cancelled = false;
    (async () => {
      setSearching(true);
      try {
        const r = await fetch(`${API}/pincode/${query}`);
        const j = await r.json();
        if (!cancelled && j.valid) {
          const s: CitySuggestion = { name: j.locality || j.city || query, city: j.city || "", locality: j.locality || j.city || "", state: j.state || "", pincode: query };
          setResults([s]);
        } else if (!cancelled) setResults([]);
      } catch { if (!cancelled) setResults([]); }
      finally { if (!cancelled) setSearching(false); }
    })();
    return () => { cancelled = true; };
  }, [query, isPincodeMode]);

  const handleChange = (t: string) => {
    if (/^\d/.test(t) || t.length === 0) {
      setQuery(t.replace(/\D/g, "").slice(0, 6));
    } else {
      setQuery(t);
    }
  };

  const pick = async (s: CitySuggestion) => {
    // Always fetch the authoritative city/state from the pincode endpoint
    // so the UI shows the instantly-recognizable district name (e.g., Rewari,
    // Thane), even if the search result's parsed city/state was incomplete.
    let finalCity = s.city;
    let finalState = s.state;
    let finalLocality = s.locality || s.name;
    try {
      const r = await fetch(`${API}/pincode/${s.pincode}`);
      const j = await r.json();
      if (j && j.valid) {
        if (j.city) finalCity = j.city;
        if (j.state) finalState = j.state;
        // Preserve original locality if richer than backend's; else use city.
        if (!finalLocality) finalLocality = j.city || s.name;
      }
    } catch {}
    // Guard: if city ended up identical to state (e.g., "Haryana"/"Haryana"),
    // fall back to the locality from the original search.
    if (finalCity && finalState && finalCity.trim().toLowerCase() === finalState.trim().toLowerCase()) {
      const fallback = (s.locality || s.name || "").split(",")[0].trim();
      if (fallback && fallback.toLowerCase() !== finalState.trim().toLowerCase()) {
        finalCity = fallback;
      }
    }
    const enriched: CitySuggestion = { ...s, city: finalCity, state: finalState, locality: finalLocality };
    await saveRecentSearch(testIDPrefix, enriched);
    onSelect(enriched.name, enriched.pincode, { city: finalCity, locality: finalLocality, state: finalState, valid: true });
    onClose();
  };

  const stopVoice = useCallback(() => { try { ExpoSpeechRecognitionModule.stop(); } catch {} setListening(false); }, []);

  useSpeechRecognitionEvent("result", (event: any) => {
    if (!listening) return;
    const transcript: string = event?.results?.[0]?.transcript || "";
    if (event?.isFinal) {
      const cleaned = transcript.replace(/[.,!?]/g, "").replace(/\s+/g, " ").trim();
      if (cleaned) handleChange(cleaned);
      stopVoice();
    } else if (transcript) setVoiceStatus(`Heard: "${transcript.trim()}"`);
  });

  useSpeechRecognitionEvent("error", (event: any) => {
    if (!listening) return;
    const msg = event?.error || "error";
    if (msg === "not-allowed" || msg === "service-not-allowed" || msg === "permissions") setVoiceStatus("Microphone permission denied");
    else if (msg === "no-speech") setVoiceStatus("Didn't catch that. Try again.");
    else setVoiceStatus(`Error: ${msg}`);
    setTimeout(stopVoice, 1200);
  });

  useSpeechRecognitionEvent("end", () => { if (listening) setListening(false); });

  const startVoice = async () => {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm?.granted) { Alert.alert("Microphone needed", "Please grant microphone permission to use voice input."); return; }
      try { ExpoSpeechRecognitionModule.stop(); } catch {}
      setVoiceStatus("Speak the city name or pincode");
      setListening(true);
      ExpoSpeechRecognitionModule.start({ lang: "en-IN", interimResults: true, continuous: false, maxAlternatives: 1, addsPunctuation: false });
    } catch (err) { setListening(false); Alert.alert("Voice not available", "Voice input is not available on this device."); }
  };

  const showRecents = query.length === 0 && recents.length > 0;
  const list: CitySuggestion[] = showRecents ? recents : results;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.fill, { backgroundColor: COLORS.bg }]} edges={["top"]}>
        {/* Header */}
        <View style={srm.header}>
          <TouchableOpacity onPress={onClose} style={srm.backBtn} testID={`${testIDPrefix}-modal-back`}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <View style={srm.searchBar}>
            <Ionicons name="search" size={18} color={COLORS.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              ref={inputRef}
              testID={`${testIDPrefix}-modal-input`}
              style={srm.searchInput}
              placeholder={`Search ${label.toLowerCase()}…`}
              placeholderTextColor={COLORS.textSubtle}
              value={query}
              onChangeText={handleChange}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 ? (
              <TouchableOpacity onPress={() => { setQuery(""); setResults([]); }}>
                <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity onPress={listening ? stopVoice : startVoice} style={srm.micBtn} testID={`${testIDPrefix}-modal-mic`}>
            <Ionicons name="mic" size={22} color={listening ? COLORS.secondary : COLORS.primary} />
          </TouchableOpacity>
        </View>

        {listening ? (
          <View style={srm.voiceRow}>
            <Ionicons name="radio-outline" size={13} color={COLORS.primary} />
            <Text style={srm.voiceText}>{voiceStatus}</Text>
          </View>
        ) : null}

        {/* Section label */}
        {showRecents ? (
          <Text style={srm.sectionLabel}>Recent Searches</Text>
        ) : query.length >= 2 && !searching && results.length === 0 ? (
          <Text style={srm.noResultText}>No results found. Try a different name or pincode.</Text>
        ) : searching ? (
          <View style={srm.searchingRow}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={srm.searchingText}>Searching…</Text>
          </View>
        ) : null}

        <FlatList
          data={list}
          keyExtractor={(s, i) => `${s.pincode}-${i}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item: s, index: i }) => (
            <TouchableOpacity
              key={`${s.pincode}-${i}`}
              testID={`${testIDPrefix}-modal-suggest-${i}`}
              style={srm.row}
              onPress={() => pick(s)}
              activeOpacity={0.7}
            >
              <View style={srm.rowIcon}>
                <Ionicons name={showRecents ? "time-outline" : "location-outline"} size={20} color={COLORS.textMuted} />
              </View>
              <View style={srm.rowBody}>
                <Text style={srm.rowName} numberOfLines={1}>{s.name}</Text>
                <Text style={srm.rowSub} numberOfLines={1}>{s.city}</Text>
              </View>
              <Text style={srm.rowPin}>{s.pincode}</Text>
            </TouchableOpacity>
          )}
        />
        <VoiceListenOverlay visible={false} onCancel={stopVoice} status={voiceStatus} />
      </SafeAreaView>
    </Modal>
  );
}

// Styles for weight modal
const wmStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 32 },
  sheet: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 24, width: "100%", maxWidth: 360 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, marginBottom: 14, textAlign: "center" },
  input: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14, fontSize: 22, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, textAlign: "center", marginBottom: 16 },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 18 },
  preset: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 100, backgroundColor: "#EEF2FA", borderWidth: 1, borderColor: COLORS.border },
  presetText: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.primary },
  btn: { backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  btnText: { color: COLORS.surface, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
});

// Styles for RouteSearchModal
const srm = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 8 },
  backBtn: { padding: 6 },
  searchBar: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: COLORS.bg, borderRadius: 14, paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 10 : 6 },
  searchInput: { flex: 1, fontSize: 16, color: COLORS.text },
  micBtn: { padding: 6 },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#EFF3FF" },
  voiceText: { fontSize: 13, color: COLORS.primary },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  noResultText: { fontSize: 14, color: COLORS.danger, paddingHorizontal: 16, paddingTop: 20, textAlign: "center" },
  searchingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 20 },
  searchingText: { fontSize: 14, color: COLORS.textMuted },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface },
  rowIcon: { width: 36, alignItems: "center" },
  rowBody: { flex: 1, marginHorizontal: 10 },
  rowName: { fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.text },
  rowSub: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  rowPin: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.primary },
});

// ============== SmartRouteInput (Post Load - tap-to-open modal) ==============
function SmartRouteInput({ label, testIDPrefix, text, pin, info, onChange }: {
  label: string; testIDPrefix: string; text: string; pin: string; info: RouteInfo;
  onChange: (text: string, pin: string, info: RouteInfo) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  const hasValue = pin && info?.valid;

  return (
    <View style={sriStyles.wrap}>
      <Text style={sriStyles.label}>{label}</Text>
      <TouchableOpacity
        testID={`${testIDPrefix}-tap-card`}
        style={[sriStyles.card, hasValue && sriStyles.cardFilled]}
        onPress={() => setModalOpen(true)}
        activeOpacity={0.75}
      >
        {hasValue ? (
          <>
            {(() => {
              const loc = (info.locality || "").trim();
              const cty = (info.city || "").trim();
              // Line 1 = locality (fall back to city if locality is missing or
              // identical to city). Line 2 = district (city). If locality and
              // city are the same, we collapse to a single big line so we
              // don't show duplicate text.
              const sameLocCity = !!loc && !!cty && loc.toLowerCase() === cty.toLowerCase();
              const line1 = loc && !sameLocCity ? loc : cty;
              const line2 = sameLocCity ? "" : (loc ? cty : "");

              // Length-based adaptive scaling (Android's adjustsFontSizeToFit
              // is unreliable, so we precompute the size from text length).
              const adapt = (len: number) =>
                len <= 11 ? 17 :
                len <= 13 ? 16 :
                len <= 15 ? 15 :
                len <= 17 ? 14 :
                len <= 19 ? 13 :
                len <= 22 ? 12 :
                len <= 25 ? 11 : 10;

              return (
                <>
                  {line1 ? (
                    <Text
                      style={[sriStyles.locality, { fontSize: rf(adapt(line1.length)) }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      allowFontScaling={false}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {line1}
                    </Text>
                  ) : null}
                  {line2 ? (
                    <Text
                      style={[sriStyles.locality, { fontSize: rf(adapt(line2.length)) }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      allowFontScaling={false}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {line2}
                    </Text>
                  ) : null}
                </>
              );
            })()}
            <Text style={sriStyles.cityState} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false}>
              {stateAbbr(info.state)}{stateAbbr(info.state) && pin ? " · " : ""}{pin}
            </Text>
          </>
        ) : (
          <View style={sriStyles.placeholder}>
            <Ionicons name="search" size={16} color={COLORS.textMuted} style={{ marginRight: 6 }} />
            <Text style={sriStyles.placeholderText}>Pincode or city…</Text>
          </View>
        )}
        {hasValue ? (
          <TouchableOpacity
            style={sriStyles.clearBtn}
            onPress={(e) => { e.stopPropagation(); onChange("", "", null); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
      <RouteSearchModal
        visible={modalOpen}
        label={label}
        testIDPrefix={testIDPrefix}
        onClose={() => setModalOpen(false)}
        onSelect={(t, p, i) => { onChange(t, p, i); setModalOpen(false); }}
      />
    </View>
  );
}

const sriStyles = StyleSheet.create({
  wrap: { flex: 1, minWidth: 0 },
  label: { fontSize: rf(11), fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingHorizontal: rs(12),
    paddingVertical: rs(12),
    minHeight: rs(96),
    justifyContent: "center",
  },
  cardFilled: { borderColor: COLORS.success, borderWidth: 1.5 },
  pin: { fontSize: rf(17), fontFamily: "Inter_700Bold", fontWeight: "800", color: COLORS.text, marginBottom: 4, letterSpacing: 0.2 },
  locality: { fontSize: rf(17), fontFamily: "Inter_700Bold", fontWeight: "800", color: COLORS.text, marginBottom: 3 },
  cityState: { fontSize: rf(11), color: COLORS.textMuted, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  city: { fontSize: rf(15), fontFamily: "Inter_700Bold", fontWeight: "800", color: COLORS.text, marginBottom: 3 },
  state: { fontSize: rf(11), color: COLORS.textMuted, fontStyle: "italic", fontFamily: "Inter_500Medium", fontWeight: "500" },
  placeholder: { flexDirection: "row", alignItems: "center" },
  placeholderText: { fontSize: rf(13), color: COLORS.textSubtle, flexShrink: 1 },
  clearBtn: { position: "absolute", top: 8, right: 8 },
});
// ============== Load Market ==============
const geoCache = new Map<string, { lat: number; lon: number; found: boolean }>();

async function geocodePin(pin: string) {
  if (geoCache.has(pin)) return geoCache.get(pin)!;
  try {
    const r = await fetch(`${API}/geocode/${pin}`);
    const j = await r.json();
    const out = { lat: j.lat || 0, lon: j.lon || 0, found: !!j.found };
    if (out.found) geoCache.set(pin, out);
    return out;
  } catch { return { lat: 0, lon: 0, found: false }; }
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function bearingRad(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat), dLon = toRad(b.lon - a.lon);
  return Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon));
}

function trackDistancesKm(start: { lat: number; lon: number }, end: { lat: number; lon: number }, p: { lat: number; lon: number }) {
  const R = 6371;
  const d13 = haversineKm(start, p) / R, t13 = bearingRad(start, p), t12 = bearingRad(start, end);
  const xt = Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * R;
  const at = Math.acos(Math.cos(d13) / Math.cos(xt / R)) * R;
  return { cross: Math.abs(xt), along: at };
}

type ActiveFilter = { origin: string; dest: string; weightKg: number; volumeCuft: number | null; originCoord: { lat: number; lon: number }; destCoord: { lat: number; lon: number } };
type Distances = Record<string, { origin: number; dest: number; offRoute: boolean }>;

function LoadMarketScreen({ profile }: { profile: Profile }) {
  const [allLoads, setAllLoads] = useState<Load[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter | null>(null);
  const [filteredLoads, setFilteredLoads] = useState<Load[] | null>(null);
  const [distances, setDistances] = useState<Distances>({});

  const fetchLoads = useCallback(async () => {
    try { const r = await fetch(`${API}/loads`); const j = await r.json(); setAllLoads(j); }
    catch { Alert.alert("Error", "Failed to fetch loads"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchLoads(); }, [fetchLoads]);

  const applyFilter = useCallback(async (f: ActiveFilter) => {
    const dist: Distances = {};
    const survivors: { load: Load; total: number }[] = [];
    for (const load of allLoads) {
      if (load.weight_tons * 1000 < f.weightKg) continue;
      if (f.volumeCuft != null && load.space_cuft != null && load.space_cuft < f.volumeCuft) continue;
      const lo = await geocodePin(load.origin_pincode); if (!lo.found) continue;
      const ld = await geocodePin(load.destination_pincode); if (!ld.found) continue;
      const dOrigin = haversineKm(f.originCoord, lo), dDest = haversineKm(f.destCoord, ld);
      if (dOrigin <= 30 && dDest <= 30) { dist[load.id] = { origin: dOrigin, dest: dDest, offRoute: false }; survivors.push({ load, total: dOrigin + dDest }); continue; }
      const routeLen = haversineKm(lo, ld);
      if (routeLen > 400) {
        const oTrack = trackDistancesKm(lo, ld, f.originCoord), dTrack = trackDistancesKm(lo, ld, f.destCoord);
        const inSegment = (at: number) => at >= 0 && at <= routeLen;
        if (oTrack.cross <= 30 && dTrack.cross <= 30 && inSegment(oTrack.along) && inSegment(dTrack.along) && oTrack.along <= dTrack.along) {
          dist[load.id] = { origin: oTrack.cross, dest: dTrack.cross, offRoute: true };
          survivors.push({ load, total: oTrack.cross + dTrack.cross });
        }
      }
    }
    survivors.sort((a, b) => a.total - b.total);
    setFilteredLoads(survivors.map((s) => s.load));
    setDistances(dist);
  }, [allLoads]);

  const onApplyFilter = async (f: ActiveFilter) => { setActiveFilter(f); setShowFilter(false); await applyFilter(f); };
  const onClearFilter = () => { setActiveFilter(null); setFilteredLoads(null); setDistances({}); };
  const isFiltered = activeFilter !== null;
  const displayLoads = isFiltered ? filteredLoads || [] : allLoads;

  return (
    <View style={styles.fill}>
      <View style={styles.marketTop}>
        <Text style={styles.marketCount} testID="loads-count">{displayLoads.length} {displayLoads.length === 1 ? "truck" : "trucks"} {isFiltered ? "matched" : "available"}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {isFiltered && (
            <TouchableOpacity testID="clear-filter-btn" onPress={onClearFilter} style={styles.clearChip}>
              <Ionicons name="close" size={14} color={COLORS.textMuted} />
              <Text style={styles.clearChipText}>Clear</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity testID="find-space-btn" style={[styles.filterBtn, isFiltered && styles.filterBtnActive]} onPress={() => setShowFilter(true)}>
            <Ionicons name="options-outline" size={16} color={isFiltered ? COLORS.surface : COLORS.primary} />
            <Text style={[styles.filterBtnText, isFiltered && { color: COLORS.surface }]}>Filter</Text>
            {isFiltered && <View style={styles.filterDot} />}
          </TouchableOpacity>
        </View>
      </View>
      {loading ? (
        <View style={[styles.fill, styles.center]}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <FlatList
          testID="loads-list"
          data={displayLoads}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLoads(); }} />}
          ListFooterComponent={isFiltered && displayLoads.length > 0 ? <Text style={styles.approxNote}>* Distances are approximate (straight-line)</Text> : null}
          ListEmptyComponent={
            <View style={styles.emptyWrap} testID="empty-state">
              <Ionicons name={isFiltered ? "search" : "cube-outline"} size={48} color={COLORS.textSubtle} />
              <Text style={styles.emptyTitle}>{isFiltered ? "No matching trucks found" : "No loads yet"}</Text>
              <Text style={styles.emptySub}>{isFiltered ? "Try adjusting your cargo details or search within a wider area." : "Be the first to post a load!"}</Text>
            </View>
          }
          renderItem={({ item }) => <LoadCard load={item} isMine={item.poster_phone === profile.phone} distance={isFiltered ? distances[item.id] : undefined} />}
        />
      )}
      <FindSpaceModal visible={showFilter} initial={activeFilter} onClose={() => setShowFilter(false)} onApply={onApplyFilter} />
    </View>
  );
}

// ============== ImageViewerModal (full-screen swipeable images) ==============
function ImageViewerModal({ visible, images, initialIndex, onClose }: { visible: boolean; images: string[]; initialIndex: number; onClose: () => void }) {
  const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
  const flatRef = useRef<FlatList<string>>(null);
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    if (visible) {
      setIndex(initialIndex);
      // ensure list scrolls to the tapped image after layout
      setTimeout(() => flatRef.current?.scrollToOffset({ offset: initialIndex * SCREEN_W, animated: false }), 50);
    }
  }, [visible, initialIndex, SCREEN_W]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={ivStyles.backdrop} testID="image-viewer-modal">
        <TouchableOpacity testID="image-viewer-close" onPress={onClose} style={ivStyles.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
        {images.length > 1 ? (
          <View style={ivStyles.counter}>
            <Text style={ivStyles.counterText}>{index + 1} / {images.length}</Text>
          </View>
        ) : null}
        <FlatList
          ref={flatRef}
          data={images}
          keyExtractor={(_, i) => `iv-${i}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i })}
          onMomentumScrollEnd={(e) => {
            const x = e.nativeEvent.contentOffset.x;
            setIndex(Math.round(x / SCREEN_W));
          }}
          renderItem={({ item }) => (
            <View style={{ width: SCREEN_W, height: SCREEN_H, alignItems: "center", justifyContent: "center" }}>
              <Image source={{ uri: item }} style={{ width: SCREEN_W, height: SCREEN_H * 0.85 }} resizeMode="contain" />
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

const ivStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)" },
  closeBtn: { position: "absolute", top: 48, right: 20, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  counter: { position: "absolute", top: 56, alignSelf: "center", zIndex: 10, backgroundColor: "rgba(255,255,255,0.14)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 100 },
  counterText: { color: "#fff", fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13 },
});

function LoadCard({ load, isMine, distance }: { load: Load; isMine: boolean; distance?: { origin: number; dest: number; offRoute: boolean } }) {
  const [viewerStart, setViewerStart] = useState<number | null>(null);
  const [showImages, setShowImages] = useState(false);
  const callPoster = () => Linking.openURL(`tel:${load.poster_phone}`).catch(() => Alert.alert("Error", "Cannot open dialer"));
  const shareOnWhatsApp = async () => {
    // Same message format as the "Post & Share" button on the post-truck-space screen.
    const dateStrShare = (() => {
      try { return new Date(load.loading_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
      catch { return load.loading_date; }
    })();
    const oLoc = load.origin_locality || load.origin_city || "";
    const dLoc = load.destination_locality || load.destination_city || "";
    const originLine = `📍 ${load.origin_pincode}${oLoc ? `, ${oLoc}` : ""}${load.origin_state ? `, ${load.origin_state}` : ""}`;
    const destLine   = `📍 ${load.destination_pincode}${dLoc ? `, ${dLoc}` : ""}${load.destination_state ? `, ${load.destination_state}` : ""}`;
    const loadLink = load.id
      ? `\n\n🔗 More info & pics: https://www.trucktraffic.in?load=${load.id}`
      : `\n\n🔗 More info & pics: https://www.trucktraffic.in`;
    const text =
      `🚛 *Truck Space Available – Truck Traffic PTL*\n\n` +
      `*Route:*\n${originLine}\n   ⬇️\n${destLine}\n\n` +
      `🚚 *Truck:* ${load.truck_type}\n` +
      `⚖️ *Weight:* ${load.weight_tons} Tons\n` +
      `📅 *Loading:* ${dateStrShare}\n` +
      (load.cargo_placement ? `🧱 *Placement:* ${load.cargo_placement}` : "") +
      `\n\n📞 *Contact:* ${load.poster_name}` +
      (load.poster_company ? ` — ${load.poster_company}` : "") +
      `\n+91 ${load.poster_phone}` +
      loadLink;
    try { await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`); }
    catch { Alert.alert("Error", "WhatsApp could not be opened."); }
  };
   const dateStr = useMemo(() => { try { return new Date(load.loading_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return load.loading_date; } }, [load.loading_date]);

  // Format route location: pincode, city (bold) + state (smaller emphasis)
  // shows recognizable city instead of locality for instant recognition.
  const oCity = load.origin_city || load.origin_locality || "";
  const dCity = load.destination_city || load.destination_locality || "";

  // Fix: use API constant (not process.env) for image URLs
  const getImageUri = (i: number) => `${API}/loads/${load.id}/image/${i}`;

  const imageCount = load.image_count || 0;
  const hasInlineImages = load.images && load.images.length > 0;
  const hasRemoteImages = !hasInlineImages && imageCount > 0;

  // Build array of image URIs for the viewer modal
  const viewerImages: string[] = hasInlineImages
    ? (load.images as string[])
    : hasRemoteImages
      ? Array.from({ length: imageCount }).map((_, i) => getImageUri(i))
      : [];

  const truckImg = TRUCK_TYPES.find(t => t.name === load.truck_type)?.image;
  const hasDim = load.dimension_length || load.dimension_breadth || load.dimension_height;
  const dimStr = hasDim ? `${load.dimension_length || "-"}×${load.dimension_breadth || "-"}×${load.dimension_height || "-"}ft` : null;

  return (
    <View style={styles.card} testID={`load-card-${load.id}`}>
      {/* LINE 1: Route */}
      <View style={styles.cardRouteRow}>
        <View style={styles.flex1}>
          <View style={cardStyles.routeEndpoint}>
            <Ionicons name="location" size={13} color={COLORS.secondary} style={{ marginTop: 3 }} />
            <View style={{ flex: 1 }}>
              <Text style={cardStyles.routePinCity} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false}>
                <Text style={cardStyles.routePin}>{load.origin_pincode}</Text>
                <Text style={cardStyles.routeComma}>, </Text>
                <Text style={cardStyles.routeCity}>{oCity}</Text>
              </Text>
              {load.origin_state ? <Text style={cardStyles.routeState} numberOfLines={1}>{load.origin_state}</Text> : null}
            </View>
          </View>
          <View style={[cardStyles.routeEndpoint, { marginTop: 8 }]}>
            <Ionicons name="flag" size={13} color={COLORS.primary} style={{ marginTop: 3 }} />
            <View style={{ flex: 1 }}>
              <Text style={cardStyles.routePinCity} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false}>
                <Text style={cardStyles.routePin}>{load.destination_pincode}</Text>
                <Text style={cardStyles.routeComma}>, </Text>
                <Text style={cardStyles.routeCity}>{dCity}</Text>
              </Text>
              {load.destination_state ? <Text style={cardStyles.routeState} numberOfLines={1}>{load.destination_state}</Text> : null}
            </View>
          </View>
        </View>
      </View>

      {distance ? (
        <View style={styles.distanceRow} testID={`distance-${load.id}`}>
          <View style={styles.distanceChip}><Ionicons name="location-outline" size={12} color={COLORS.success} /><Text style={styles.distanceText}>Origin: {distance.origin.toFixed(1)} km {distance.offRoute ? "off-route" : "away"}</Text></View>
          <View style={styles.distanceChip}><Ionicons name="flag-outline" size={12} color={COLORS.success} /><Text style={styles.distanceText}>Dest: {distance.dest.toFixed(1)} km {distance.offRoute ? "off-route" : "away"}</Text></View>
        </View>
      ) : null}

      <View style={styles.divider} />

      {/* LINE 2: Date · Weight · Truck · Space · Price · Placement — single horizontal row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cardStyles.metaScrollContent}>
        <View style={cardStyles.metaChip}>
          <Ionicons name="calendar-outline" size={12} color={COLORS.textMuted} />
          <Text style={cardStyles.metaText}>{dateStr}</Text>
        </View>
        <View style={cardStyles.metaChip}>
          <Ionicons name="barbell-outline" size={12} color={COLORS.textMuted} />
          <Text style={cardStyles.metaText}>{load.weight_tons}T</Text>
        </View>
        {truckImg ? (
          <View style={cardStyles.truckMiniWrap}>
            <Image source={truckImg} style={cardStyles.truckMiniImg} resizeMode="contain" />
          </View>
        ) : null}
        {dimStr ? (
          <View style={cardStyles.metaChip}>
            <Ionicons name="resize-outline" size={12} color={COLORS.textMuted} />
            <Text style={cardStyles.metaText}>{dimStr}</Text>
          </View>
        ) : null}
        {load.price_per_ton ? (
          <View style={cardStyles.metaChip}>
            <Ionicons name="pricetag-outline" size={12} color={COLORS.textMuted} />
            <Text style={cardStyles.metaText}>₹{load.price_per_ton}/T</Text>
          </View>
        ) : null}
        {load.cargo_placement ? (
          <View style={[cardStyles.metaChip, cardStyles.placementMeta]}>
            <Text style={[cardStyles.metaText, { color: COLORS.secondary }]}>{load.cargo_placement}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.divider} />

      {/* LINE 3: Contact + Call */}
      <View style={cardStyles.line3Row}>
        <View style={cardStyles.contactSection}>
          <Text style={styles.posterName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false}>{load.poster_name}{isMine && <Text style={styles.youTag}> · You</Text>}</Text>
          {load.poster_company ? <Text style={styles.posterCompany} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false}>{load.poster_company}</Text> : null}
          <Text style={styles.posterPhone}>+91 {load.poster_phone}</Text>
        </View>

        {!isMine && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <TouchableOpacity testID={`share-wa-${load.id}`} style={cardStyles.shareBtn} onPress={shareOnWhatsApp}>
              <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
            </TouchableOpacity>
            <TouchableOpacity testID={`call-btn-${load.id}`} style={[styles.callBtn, { alignSelf: "center" }]} onPress={callPoster}>
              <Ionicons name="call" size={16} color={COLORS.surface} />
              <Text style={styles.callBtnText}>Call</Text>
            </TouchableOpacity>
          </View>
        )}

        {isMine && (
          <TouchableOpacity testID={`share-wa-${load.id}`} style={cardStyles.shareWaPill} onPress={shareOnWhatsApp}>
            <Ionicons name="logo-whatsapp" size={16} color={COLORS.surface} />
            <Text style={cardStyles.shareWaPillText}>Share</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Photos: lazy-load with Show Images button */}
      {viewerImages.length > 0 ? (
        showImages ? (
          <View style={cardStyles.photosSectionFull}>
            {viewerImages.slice(0, 3).map((src, i) => (
              <TouchableOpacity
                key={i}
                testID={`thumb-${load.id}-${i}`}
                activeOpacity={0.8}
                onPress={() => setViewerStart(i)}
                style={cardStyles.thumbWrap}
              >
                <Image source={{ uri: src }} style={cardStyles.thumbBig} resizeMode="cover" />
                {i === 2 && viewerImages.length > 3 ? (
                  <View style={cardStyles.thumbMoreOverlay}>
                    <Text style={cardStyles.thumbMoreText}>+{viewerImages.length - 3}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <TouchableOpacity
            testID={`show-images-btn-${load.id}`}
            style={styles.showImagesBtn}
            onPress={() => setShowImages(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="images-outline" size={16} color={COLORS.primary} />
            <Text style={styles.showImagesBtnText}>Show Images ({viewerImages.length})</Text>
          </TouchableOpacity>
        )
      ) : null}

      <ImageViewerModal
        visible={viewerStart !== null}
        images={viewerImages}
        initialIndex={viewerStart || 0}
        onClose={() => setViewerStart(null)}
      />
    </View>
  );
}

const cardStyles = StyleSheet.create({
  routeEndpoint: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  routeLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.text },
  routePinCity: { fontSize: 14, lineHeight: 18, color: COLORS.text },
  routePin: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "800", color: COLORS.text },
  routeComma: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text },
  routeCity: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "800", color: COLORS.text },
  routeState: { fontSize: 10, color: COLORS.textMuted, fontStyle: "italic", marginTop: 1 },
  metaScrollContent: { flexDirection: "row", alignItems: "center", gap: 10, paddingRight: 8 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, color: COLORS.text, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  metaSep: { fontSize: 12, color: COLORS.textSubtle },
  truckMiniWrap: { width: 44, height: 28, alignItems: "center", justifyContent: "center", marginRight: 2 },
  truckMiniImg: { width: 44, height: 28 },
  truckMeta: { backgroundColor: COLORS.primary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 100 },
  placementMeta: { backgroundColor: "#FFF4EE", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 100 },
  line3Row: { flexDirection: "row", alignItems: "center", gap: 10 },
  photosSection: { flexDirection: "row", gap: 6, alignItems: "center" },
  photosSectionFull: { flexDirection: "row", gap: 8, marginTop: 12 },
  thumbWrap: { position: "relative", borderRadius: 8, overflow: "hidden" },
  thumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: COLORS.bg },
  thumbBig: { width: 90, height: 90, borderRadius: 8, backgroundColor: COLORS.bg },
  thumbMoreOverlay: { position: "absolute", inset: 0, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  thumbMoreText: { color: COLORS.surface, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "800" },
  showImagesBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg },
  showImagesBtnText: { color: COLORS.primary, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 12 },
  saveBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: "#EEF2FA", alignItems: "center", justifyContent: "center" },
  shareBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: "#25D366", backgroundColor: "#E8F8EE", alignItems: "center", justifyContent: "center" },
  shareWaPill: { backgroundColor: "#25D366", paddingVertical: 10, paddingHorizontal: 16, borderRadius: 100, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center" },
  shareWaPillText: { color: COLORS.surface, fontFamily: "Inter_600SemiBold", fontWeight: "600", fontSize: 14, letterSpacing: 0.2 },
  noPhotos: { fontSize: 11, color: COLORS.textSubtle, fontStyle: "italic" },
  contactSection: { flex: 1 },
});

function Spec({ icon, label, value }: any) {
  return (
    <View style={styles.specItem}>
      <Ionicons name={icon} size={14} color={COLORS.textMuted} />
      <Text style={styles.specLabel}>{label}</Text>
      <Text style={styles.specValue}>{value}</Text>
    </View>
  );
}

// ============== FindSpaceModal with RouteSearchModal autosuggest ==============
function FindSpaceModal({ visible, initial, onClose, onApply }: {
  visible: boolean; initial: ActiveFilter | null; onClose: () => void; onApply: (f: ActiveFilter) => Promise<void>;
}) {
  const [originText, setOriginText] = useState("");
  const [originPin, setOriginPin] = useState("");
  const [originInfo, setOriginInfo] = useState<RouteInfo>(null);
  const [destText, setDestText] = useState("");
  const [destPin, setDestPin] = useState("");
  const [destInfo, setDestInfo] = useState<RouteInfo>(null);
  const [weightTons, setWeightTons] = useState("");
  const [originErr, setOriginErr] = useState("");
  const [destErr, setDestErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setOriginPin(initial?.origin || ""); setOriginText(initial?.origin || ""); setOriginInfo(null);
      setDestPin(initial?.dest || ""); setDestText(initial?.dest || ""); setDestInfo(null);
      setWeightTons(initial?.weightKg ? String(initial.weightKg / 1000) : "");
      setOriginErr(""); setDestErr("");
    }
  }, [visible, initial]);

  const submit = async () => {
    setOriginErr(""); setDestErr("");
    if (!/^\d{6}$/.test(originPin)) { setOriginErr("Select a valid origin from the list or enter a 6-digit pincode"); return; }
    if (!/^\d{6}$/.test(destPin)) { setDestErr("Select a valid destination from the list or enter a 6-digit pincode"); return; }
    const wTons = parseFloat(weightTons);
    if (!wTons || wTons <= 0) return Alert.alert("Required", "Enter cargo weight in tons");
    const w = wTons * 1000; // convert tons to kg for downstream filter
    setBusy(true);
    try {
      const [oc, dc] = await Promise.all([geocodePin(originPin), geocodePin(destPin)]);
      if (!oc.found) { setOriginErr("Pincode not found, please check and try again."); return; }
      if (!dc.found) { setDestErr("Pincode not found, please check and try again."); return; }
      await onApply({ origin: originPin, dest: destPin, weightKg: w, volumeCuft: null, originCoord: { lat: oc.lat, lon: oc.lon }, destCoord: { lat: dc.lat, lon: dc.lon } });
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={[styles.fill, { backgroundColor: COLORS.bg }]} edges={["top"]}>
        <View style={styles.fsHeader}>
          <TouchableOpacity onPress={onClose} testID="fs-back-btn" style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.fsHeaderTitle}>Filter</Text>
          <View style={{ width: 32 }} />
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.fill}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalSubtitle}>Enter your cargo details to find matching trucks within 30 km of your route.</Text>

            <SectionTitle icon="navigate-outline" title="Route" />
            <View style={styles.routeInputsRow}>
              <SmartRouteInput
                label="My Origin"
                testIDPrefix="fs-origin"
                text={originText}
                pin={originPin}
                info={originInfo}
                onChange={(t, p, i) => { setOriginText(t); setOriginPin(p); setOriginInfo(i); setOriginErr(""); }}
              />
              <View style={styles.routeArrowMid}>
                <Ionicons name="arrow-forward" size={20} color={COLORS.secondary} />
              </View>
              <SmartRouteInput
                label="My Destination"
                testIDPrefix="fs-dest"
                text={destText}
                pin={destPin}
                info={destInfo}
                onChange={(t, p, i) => { setDestText(t); setDestPin(p); setDestInfo(i); setDestErr(""); }}
              />
            </View>
            {originErr ? <Text style={[styles.errorText, { marginTop: -8, marginBottom: 8 }]}>{originErr}</Text> : null}
            {destErr ? <Text style={[styles.errorText, { marginTop: -8, marginBottom: 8 }]}>{destErr}</Text> : null}

            <Field label="Cargo Weight (tons)">
              <TextInput testID="fs-weight-input" style={[styles.input, weightTons && styles.filledBorder]} placeholder="e.g., 5" placeholderTextColor={COLORS.textSubtle} value={weightTons} onChangeText={(t) => setWeightTons(t.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" />
            </Field>

            <View style={styles.row}>
              <TouchableOpacity testID="fs-cancel-btn" style={[styles.outlineBtn, styles.flex1]} onPress={onClose} disabled={busy}>
                <Text style={styles.outlineBtnText}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ width: 12 }} />
              <TouchableOpacity testID="fs-apply-btn" style={[styles.primaryBtn, styles.flex1, { marginTop: 0 }]} onPress={submit} disabled={busy}>
                {busy ? <ActivityIndicator color={COLORS.surface} /> : <Text style={styles.primaryBtnText}>Show Matching Trucks</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ============== Helpers ==============
function Field({ label, children }: any) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} allowFontScaling={false}>{label}</Text>
      {children}
    </View>
  );
}

function SectionTitle({ icon, title }: { icon: any; title: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Ionicons name={icon} size={16} color={COLORS.primary} />
      <Text style={styles.sectionTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} allowFontScaling={false}>{title}</Text>
    </View>
  );
}

// ============== Styles ==============
const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: COLORS.bg },
  center: { alignItems: "center", justifyContent: "center" },
  flex1: { flex: 1 },
  row: { flexDirection: "row" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: rs(20), paddingVertical: rs(14), backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: rs(12), flex: 1, marginRight: rs(8) },
  logoBox: { width: 40, height: 40, backgroundColor: COLORS.primary, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  logoImg: { width: 44, height: 44, borderRadius: 12 },
  headerTitle: { fontSize: rf(18), fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, lineHeight: rf(24), letterSpacing: -0.2 },
  headerSubtitle: { fontSize: rf(13), color: COLORS.textMuted, marginTop: 2, lineHeight: rf(18), letterSpacing: 0.1 },
  iconBtn: { padding: 4 },
  tabs: { flexDirection: "row", backgroundColor: COLORS.surface, paddingHorizontal: rs(12), paddingTop: rs(10), paddingBottom: rs(10), borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: rs(8) },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: rs(12), paddingHorizontal: rs(6), borderRadius: 12, backgroundColor: COLORS.bg, gap: rs(4), minWidth: 0 },
  tabBtnActive: { backgroundColor: "#EEF2FA" },
  tabText: { color: COLORS.textMuted, fontFamily: "Inter_500Medium", fontWeight: "500", fontSize: rf(13), letterSpacing: 0.1, flexShrink: 1 },
  tabTextActive: { color: COLORS.primary, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  profileWrap: { padding: rs(20), paddingTop: rs(48) },
  profileLogo: { width: rs(72), height: rs(72), backgroundColor: COLORS.primary, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  profileTitle: { fontSize: rf(24), fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, lineHeight: rf(32), letterSpacing: -0.3 },
  profileSubtitle: { fontSize: rf(15), color: COLORS.textMuted, marginTop: 8, lineHeight: rf(22), letterSpacing: 0.1 },
  // ===== OTP / Phone-verify styles =====
  phoneInputRow: { flexDirection: "row", alignItems: "stretch", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, overflow: "hidden", minHeight: 64 },
  phonePrefix: { backgroundColor: "#EEF2FA", paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRightWidth: 1, borderRightColor: COLORS.border },
  phonePrefixText: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.primary },
  phoneInput: { flex: 1, paddingHorizontal: 14, fontSize: 18, color: COLORS.text, letterSpacing: 1,fontFamily: "Inter_600SemiBold", fontSize: 16, letterSpacing: 0.2 },
  otpCodeInput: { fontSize: 28, letterSpacing: 12, textAlign: "center", fontFamily: "Inter_700Bold", fontWeight: "700" },
  otpHint: { fontSize: 12, color: COLORS.textMuted, marginTop: 16, textAlign: "center", lineHeight: 18 },
  otpFooterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 24, paddingHorizontal: 4 },
  otpLinkText: { color: COLORS.primary, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
  otpHintMuted: { color: COLORS.textMuted, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  lockedPhoneRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#F0F8F2", borderWidth: 1, borderColor: COLORS.success, borderRadius: 12, paddingHorizontal: 14, minHeight: 64 },
  lockedPhonePrefix: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.success, marginRight: 10 },
  lockedPhoneText: { fontSize: 18, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, letterSpacing: 1 },
  formWrap: { padding: rs(16), paddingBottom: rs(40) },
  fieldWrap: { marginBottom: rs(16) },
  label: { fontSize: rf(13), fontFamily: "Inter_500Medium", fontWeight: "500", color: COLORS.textMuted, marginBottom: 8, lineHeight: rf(18), letterSpacing: 0.3 },
  input: {
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: 14,
  padding: rs(14),
  fontSize: rf(17),
  color: COLORS.text,
  minHeight: rs(52),
  paddingVertical: rs(14),
  fontFamily: "Inter_700Bold",
  lineHeight: rf(22),
  letterSpacing: 0.2,
},  
  hintMuted: { fontSize: 12, color: COLORS.textMuted, marginTop: 6 },
  hintOk: { fontSize: 12, color: COLORS.success, marginTop: 6, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  inputWithIconWrap: { position: "relative", justifyContent: "center" },
  micBtnAbs: { position: "absolute", right: 6, top: 6, bottom: 6, width: 38, borderRadius: 100, backgroundColor: "#EEF2FA", alignItems: "center", justifyContent: "center" },
  voiceBackdrop: { flex: 1, backgroundColor: "rgba(10,36,99,0.55)", alignItems: "center", justifyContent: "center", padding: 32 },
  voiceCard: { backgroundColor: COLORS.surface, borderRadius: 24, paddingVertical: 36, paddingHorizontal: 28, alignItems: "center", width: "100%", maxWidth: 340 },
  voicePulseWrap: { width: 140, height: 140, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  voiceRing: { position: "absolute", width: 90, height: 90, borderRadius: 45, backgroundColor: COLORS.primary },
  voiceMicBox: { width: 90, height: 90, borderRadius: 45, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center", shadowColor: COLORS.primary, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  voiceTitle: { fontSize: 20, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, marginBottom: 6 },
  voiceSub: { fontSize: 13, color: COLORS.textMuted, textAlign: "center", marginBottom: 24, lineHeight: 18 },
  voiceCancelBtn: { paddingVertical: 12, paddingHorizontal: 32, borderRadius: 100, borderWidth: 1.5, borderColor: COLORS.border },
  voiceCancelText: { color: COLORS.text, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 14 },
  voiceInlineStatus: { flexDirection: "row", alignItems: "center", marginTop: 6, gap: 6 },
  voiceInlineText: { fontSize: 12, color: COLORS.primary, fontFamily: "Inter_600SemiBold", fontWeight: "600", fontStyle: "italic" },
 suggestList: {
  position: "absolute",
  top: 78,
  left: -170,
  right: -170,
  zIndex: 999,
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: 16,
  overflow: "hidden",
  elevation: 12,
},
  suggestRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 12 },
  suggestName: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text },
  suggestSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  suggestPin: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.primary },
  suggestMore: { fontSize: 11, color: COLORS.textSubtle, paddingVertical: 8, paddingHorizontal: 14, fontStyle: "italic", textAlign: "center" },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: rs(12), marginBottom: rs(10) },
  sectionTitle: { fontSize: rf(13), fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.primary, textTransform: "uppercase", letterSpacing: 0.8, flexShrink: 1 },
  segment: { flexDirection: "row", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 4 },
  segmentBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  segmentBtnOn: { backgroundColor: COLORS.primary },
  segmentText: { color: COLORS.textMuted, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  segmentTextOn: { color: COLORS.surface },
 
  
  primaryBtn: { backgroundColor: COLORS.primary, paddingVertical: rs(14), paddingHorizontal: rs(20), borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16 },
  primaryBtnText: { color: COLORS.surface, fontSize: rf(16), fontFamily: "Inter_600SemiBold", fontWeight: "600", lineHeight: rf(22), letterSpacing: 0.2, flexShrink: 1 },
  whatsappBtn: { backgroundColor: "#25D366", paddingVertical: rs(14), paddingHorizontal: rs(14), borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  outlineBtn: { paddingVertical: rs(14), paddingHorizontal: rs(20), borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  outlineBtnText: { color: COLORS.text, fontSize: rf(16), fontFamily: "Inter_600SemiBold", fontWeight: "600", lineHeight: rf(22), letterSpacing: 0.2, flexShrink: 1 },
  marketTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  marketCount: { fontSize: 14, color: COLORS.textMuted, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 100, borderWidth: 1.5, borderColor: COLORS.primary },
  filterBtnActive: { backgroundColor: COLORS.primary },
  filterBtnText: { color: COLORS.primary, fontFamily: "Inter_600SemiBold", fontWeight: "600", fontSize: 13 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: COLORS.border, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  cardRouteRow: { flexDirection: "row", alignItems: "center" },
  routePin: { fontSize: 18, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text },
  routeCity: { fontSize: 13, color: COLORS.textMuted, marginTop: 2, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  routeState: { fontSize: 11, color: COLORS.textSubtle, marginTop: 1 },
  routeArrow: { width: 60, alignItems: "center", paddingHorizontal: 8 },
  routeLine: { position: "absolute", top: 9, left: 4, right: 4, height: 1, backgroundColor: COLORS.border, zIndex: -1 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 14 },
  specsRow: { flexDirection: "row", justifyContent: "space-between" },
  specItem: { flex: 1, alignItems: "flex-start", gap: 2 },
  specLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 4 },
  specValue: { fontSize: 14, color: COLORS.text, fontFamily: "Inter_700Bold", fontWeight: "700" },
  cargoChipsRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 12 },
  photoRow: { flexDirection: "row", marginHorizontal: -4 },
  photoCell: { flex: 1, aspectRatio: 1, marginHorizontal: 4, borderRadius: 14, overflow: "hidden", backgroundColor: COLORS.surface, position: "relative" },
  photoEmpty: { borderWidth: 1.5, borderColor: COLORS.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  photoImg: { width: "100%", height: "100%" },
  photoRemoveBtn: { position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  photoAddLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 4, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  cardPhotosRow: { flexDirection: "row", marginTop: 12, gap: 8 },
  cardPhoto: { width: 80, height: 80, borderRadius: 8, backgroundColor: COLORS.bg },
  showImagesBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg },
  showImagesBtnText: { color: COLORS.primary, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13 },
  miniChip: { backgroundColor: "#EEF2FA", paddingVertical: 4, paddingHorizontal: 10, borderRadius: 100, marginRight: 6, marginBottom: 6, flexDirection: "row", alignItems: "center" },
  miniChipText: { fontSize: 11, color: COLORS.primary, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  truckChip: { backgroundColor: COLORS.primary, paddingHorizontal: 10 },
  truckRow: { flexDirection: "row", marginHorizontal: -4 },
  truckCard: { flex: 1, marginHorizontal: 4, backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 14, paddingVertical: rs(12), paddingHorizontal: rs(4), alignItems: "center", minWidth: 0 },
  truckCardOn: { borderColor: COLORS.primary, backgroundColor: "#F0F4FB" },
  truckImg: { width: rs(72), height: rs(42), maxWidth: "100%" },
  truckImgOn: {},
  truckLabel: { fontSize: rf(12), fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.textMuted, textAlign: "center", marginTop: rs(6) },
  truckLabelOn: { color: COLORS.primary, fontFamily: "Inter_700Bold", fontWeight: "700" },
  posterRow: { flexDirection: "row", alignItems: "center" },
  posterName: { fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.text, lineHeight: 20, letterSpacing: -0.1 },
  posterCompany: { fontSize: 13, color: COLORS.textMuted, marginTop: 4, lineHeight: 18, fontFamily: "Inter_400Regular" },
  posterPhone: { fontSize: 12, color: COLORS.textSubtle, marginTop: 4, lineHeight: 16, fontFamily: "Inter_400Regular" },
  youTag: { color: COLORS.secondary, fontFamily: "Inter_600SemiBold", fontWeight: "600", fontSize: 12 },
  callBtn: { backgroundColor: COLORS.success, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 100, flexDirection: "row", alignItems: "center", gap: 6 },
  callBtnText: { color: COLORS.surface, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 14 },
  emptyWrap: { alignItems: "center", paddingTop: 80, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.text, marginTop: 16, lineHeight: 26, letterSpacing: -0.1 },
  emptySub: { fontSize: 14, color: COLORS.textMuted, marginTop: 8, textAlign: "center", lineHeight: 20, letterSpacing: 0.1 },
  profileCard: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 28, alignItems: "center", borderWidth: 1, borderColor: COLORS.border },
  avatarBig: { width: 84, height: 84, borderRadius: 42, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  avatarBigText: { fontSize: 30, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.surface, letterSpacing: 1 },
  profileCardName: { fontSize: 20, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, lineHeight: 28, letterSpacing: -0.2 },
  profileCardCompany: { fontSize: 14, color: COLORS.textMuted, marginTop: 6, fontFamily: "Inter_500Medium", fontWeight: "500", lineHeight: 20 },
  profilePhoneRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  profileCardPhone: { fontSize: 14, color: COLORS.textMuted, fontFamily: "Inter_500Medium", fontWeight: "500", lineHeight: 20 },
  statsRow: { flexDirection: "row", backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, marginTop: 16, paddingVertical: 18 },
  statBox: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.primary, lineHeight: 28, letterSpacing: -0.2 },
  statLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 6, fontFamily: "Inter_500Medium", fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.8 },
  sectionHeading: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 24, marginBottom: 12 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingTop: 12, maxHeight: "92%" },
  modalSheetBottom: { width: "100%", alignSelf: "stretch", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  modalHandle: { width: 40, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  modalTitle: { fontSize: 22, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, marginBottom: 8, lineHeight: 30, letterSpacing: -0.2 },
  fsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 12, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  fsHeaderTitle: { fontSize: 18, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text },
  modalSubtitle: { fontSize: 14, color: COLORS.textMuted, marginBottom: 20, lineHeight: 20, letterSpacing: 0.1 },
  inputError: { borderColor: COLORS.danger },
  filledBorder: { borderColor: COLORS.success, borderWidth: 1.5 },
  optionalHeading: { fontSize: rf(12), fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginTop: rs(20), marginBottom: rs(10) },
  collapseWrap: { marginBottom: rs(10) },
  collapseHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: rs(12), paddingVertical: rs(12), borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: COLORS.border, backgroundColor: COLORS.surface },
  collapseHeaderFilled: { borderStyle: "solid", borderColor: COLORS.success, backgroundColor: "#F1F8F1" },
  collapseHeaderOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0 },
  collapseTitle: { fontSize: rf(14), fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, flexShrink: 1 },
  collapseSummary: { flex: 1, textAlign: "right", fontSize: rf(12), color: COLORS.success, fontFamily: "Inter_700Bold", fontWeight: "700" },
  collapseAdd: { flex: 1, textAlign: "right", fontSize: rf(12), color: COLORS.textSubtle, fontStyle: "italic" },
  collapseBody: { padding: 14, borderWidth: 1, borderTopWidth: 0, borderColor: COLORS.border, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, backgroundColor: COLORS.surface },
  dimRow: { flexDirection: "row", gap: 10 },
  dimItem: { flex: 1 },
  dimLabel: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, textAlign: "center" },
  dimInputWrap: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 8 },
  dimInputText: { fontSize: 20, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, textAlign: "center", padding: 0, minWidth: 30 },
  dimSuffix: { fontSize: 13, color: COLORS.textMuted, fontFamily: "Inter_700Bold", fontWeight: "700", marginLeft: 4 },
  dimInput: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 10, fontSize: 20, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, textAlign: "center" },
  dimUnit: { fontSize: 10, color: COLORS.textSubtle, textAlign: "center", marginTop: 4 },
  priceRow: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 4 },
  priceSymbol: { fontSize: 22, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.primary, marginRight: 6 },
  priceInput: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, paddingVertical: 14 },
  priceSuffix: { fontSize: 14, color: COLORS.textMuted, fontFamily: "Inter_600SemiBold", fontWeight: "600", marginLeft: 6 },
  errorText: { fontSize: 12, color: COLORS.danger, marginTop: 6, fontFamily: "Inter_500Medium", fontWeight: "500" },
  filterDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.secondary, marginLeft: 6 },
  clearChip: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 100, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, gap: 4 },
  clearChipText: { color: COLORS.textMuted, fontFamily: "Inter_600SemiBold", fontWeight: "600", fontSize: 12 },
  distanceRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 10, gap: 8 },
  distanceChip: { flexDirection: "row", alignItems: "center", backgroundColor: "#E8F5EA", paddingVertical: 5, paddingHorizontal: 10, borderRadius: 100, gap: 4 },
  distanceText: { fontSize: 11, color: COLORS.success, fontFamily: "Inter_700Bold", fontWeight: "700" },
  approxNote: { fontSize: 11, color: COLORS.textSubtle, textAlign: "center", marginTop: 12, fontStyle: "italic" },
  chipRow: { flexDirection: "row", flexWrap: "wrap" },
  chip: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 100, paddingVertical: 10, paddingHorizontal: 16, marginRight: 8, marginBottom: 8 },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textMuted, fontFamily: "Inter_600SemiBold", fontWeight: "600", fontSize: 14 },
  chipTextOn: { color: COLORS.surface },
	
placementRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
placementCard: {
  flex: 1,
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: COLORS.surface,
  borderWidth: 1.5,
  borderColor: COLORS.border,
  borderRadius: 16,
  paddingVertical: 16,
  paddingHorizontal: 8,
  marginHorizontal: 5,
},

	
placementCardGreen: { borderColor: "#1B5E20", backgroundColor: "#F1F8F1" },
placementCardRed: { borderColor: "#C62828", backgroundColor: "#FDF1F1" },
placementImg: {
  width: 72,
  height: 72,
  marginBottom: 10,
},
placementLabel: {
  fontSize: 14,
  fontFamily: "Inter_700Bold", fontWeight: "700",
  color: COLORS.text,
},
	
placementLabelGreen: { color: "#1B5E20" },
placementLabelRed: { color: "#C62828" },



routeInputBox: {
  flex: 1,
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: 14,
  padding: 12,
  minHeight: 160,
  minWidth: 150,	
},
routeBoxLabel: {
  fontSize: 11,
  fontFamily: "Inter_700Bold", fontWeight: "700",
  color: COLORS.textMuted,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 6,
},
routeArrowMid: {
  paddingHorizontal: 4,
  alignSelf: "center",
  paddingBottom: 0,
},
stepperRow: {
  flexDirection: "row",
  alignItems: "center",
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: 14,
  paddingVertical: rs(8),
  paddingHorizontal: rs(8),
  marginBottom: rs(14),
  gap: rs(8),
},
stepperBtn: {
  width: rs(36),
  height: rs(36),
  borderRadius: rs(18),
  borderWidth: 1,
  borderColor: COLORS.border,
  backgroundColor: COLORS.bg,
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
},
stepperBtnText: {
  fontSize: rf(22),
  color: COLORS.text,
  lineHeight: rf(26),
},
stepperCenter: {
  flex: 1,
  flexDirection: "row",
  alignItems: "baseline",
  justifyContent: "center",
  gap: 6,
  minWidth: 0,
},
stepperValue: {
  fontSize: rf(22),
  fontFamily: "Inter_700Bold", fontWeight: "700",
  color: COLORS.text,
},
stepperUnit: {
  fontSize: rf(13),
  color: COLORS.textMuted,
},
stepperDateText: {
  fontSize: rf(20),
  fontFamily: "Inter_700Bold", fontWeight: "700",
  color: COLORS.text,
  marginLeft: 6,
  flexShrink: 1,
},
	
	routeInputsRow: {
  flexDirection: "row",
  alignItems: "flex-start",
  marginBottom: rs(14),
  gap: rs(4),
},





selectedRouteCard: {
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.primary,
  borderRadius: 14,
  paddingVertical: 10,
  paddingHorizontal: 14,
  paddingRight: 80,
  minHeight: 80,
  justifyContent: "center",
},
selectedRoutePin: {
  fontSize: 16,
  fontFamily: "Inter_700Bold", fontWeight: "700",
  color: COLORS.text,
},
selectedRouteCity: {
  marginTop: 4,
  fontSize: 12,
  color: COLORS.textMuted,
  lineHeight: 16,
},
changeRouteBtn: {
  position: "absolute",
  right: 46,
  top: 20,
  flexDirection: "row",
  alignItems: "center",
},

changeRouteText: {
  marginLeft: 4,
  color: COLORS.primary,
  fontSize: 12,
  fontFamily: "Inter_600SemiBold", fontWeight: "600",
},

  suggestModalSheet: {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  backgroundColor: COLORS.surface,
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  paddingHorizontal: 16,
  paddingBottom: 40,
  maxHeight: "70%",
  shadowColor: "#000",
  shadowOpacity: 0.15,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: -4 },
  elevation: 12,
},
suggestModalHandle: {
  width: 40,
  height: 4,
  backgroundColor: COLORS.border,
  borderRadius: 2,
  alignSelf: "center",
  marginVertical: 12,
},
suggestModalTitle: {
  fontSize: 14,
  fontFamily: "Inter_700Bold", fontWeight: "700",
  color: COLORS.textMuted,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 8,
},
inlineSuggestList: {
  marginTop: 6,
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: 16,
  overflow: "hidden",
  elevation: 12,
  maxHeight: 260,
},
	placementCardCompact: {
  flex: 1,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  paddingVertical: 10,
  paddingHorizontal: 12,
  borderRadius: 16,
  borderWidth: 1.5,
  borderColor: COLORS.border,
  backgroundColor: COLORS.surface,
},

placementImgCompact: {
  width: 42,
  height: 42,
},

placementLabelCompact: {
  fontSize: 14,
  fontFamily: "Inter_700Bold", fontWeight: "700",
  color: COLORS.text,
},
selectedRouteBox: {
  minHeight: 72,
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: 16,
  paddingHorizontal: 16,
  paddingVertical: 12,
  flexDirection: "row",
  alignItems: "center",
},

selectedRoutePinBig: {
  fontSize: 18,
  fontFamily: "Inter_700Bold", fontWeight: "700",
  color: COLORS.text,
},

selectedRouteCityBig: {
  fontSize: 15,
  fontFamily: "Inter_600SemiBold", fontWeight: "600",
  color: COLORS.text,
  marginTop: 2,
},

selectedRouteState: {
  fontSize: 13,
  color: COLORS.textMuted,
  marginTop: 2,
},

selectedRouteEditBtn: {
  marginLeft: 12,
  padding: 8,
},
	
	
});
