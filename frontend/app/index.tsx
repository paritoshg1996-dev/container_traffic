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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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

// Cargo type options with emoji pictograms (no image assets needed)
const CARGO_TYPE_OPTIONS = [
  { key: "Bags",          label: "Bags",          image: require("../assets/images/cargo_bags.png") },
  { key: "Carton Box",    label: "Carton Box",    image: require("../assets/images/cargo_carton.png") },
  { key: "Pipes",         label: "Pipes",         image: require("../assets/images/cargo_pipes.png") },
  { key: "Drums",         label: "Drums",         image: require("../assets/images/cargo_drums.png") },
  { key: "Fresh Produce", label: "Fresh Produce", image: require("../assets/images/cargo_produce.png") },
  { key: "Others",        label: "Others",        image: require("../assets/images/cargo_others.png") },
];
const TRUCK_TYPES: { name: string; image: any }[] = [
  { name: "Open", image: require("../assets/trucks/open.png") },
  { name: "Container", image: require("../assets/trucks/container.png") },
  { name: "Trailer", image: require("../assets/trucks/trailer.png") },
];

type Profile = { name: string; phone: string; company: string; profile_verified?: boolean; verification_submitted?: boolean };

type Load = {
  id: string;
  short_id?: string;
  verified?: boolean;
  origin_pincode: string;
  origin_locality: string;
  origin_city: string;
  origin_state: string;
  // Mappls-precision fields (optional; preserved exactly from autosuggest).
  origin_place_name?: string;
  origin_full_address?: string;
  origin_latitude?: number | null;
  origin_longitude?: number | null;
  origin_eloc?: string;
  destination_pincode: string;
  destination_locality: string;
  destination_city: string;
  destination_state: string;
  destination_place_name?: string;
  destination_full_address?: string;
  destination_latitude?: number | null;
  destination_longitude?: number | null;
  destination_eloc?: string;
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

// ============== PTL (Partial Truck Load) types ==============
type PtlLoad = {
  id: string;
  poster_phone: string;
  poster_name: string;
  poster_company?: string;
  origin_locality: string;
  origin_city: string;
  origin_state?: string;
  origin_pincode: string;
  origin_place_name?: string;
  origin_full_address?: string;
  origin_eloc?: string;
  origin_latitude?: number | null;
  origin_longitude?: number | null;
  destination_locality: string;
  destination_city: string;
  destination_state?: string;
  destination_pincode: string;
  destination_place_name?: string;
  destination_full_address?: string;
  destination_eloc?: string;
  destination_latitude?: number | null;
  destination_longitude?: number | null;
  cargo_type: string;
  cargo_category: string;
  weight_kg: number;
  status: "OPEN" | "MATCHED" | "CONFIRMED" | "CANCELLED";
  group_id?: string | null;
  posted_at: string;
  truck_type?: string;
  loading_date?: string;
  dimension_length?: number | null;
  dimension_breadth?: number | null;
  dimension_height?: number | null;
  cargo_placement?: string;
  images?: string[];
};

type PtlMember = {
  load_id?: string;
  phone?: string | null;
  name: string;
  company?: string;
  origin_locality: string;
  origin_city?: string;
  origin_state?: string;
  origin_pincode?: string;
  destination_locality?: string;
  destination_city?: string;
  destination_state?: string;
  destination_pincode?: string;
  weight_kg: number;
  cargo_type: string;
  cargo_category?: string;
  confirmed?: boolean;
  is_me?: boolean;
  truck_type?: string;
  loading_date?: string;
  dimension_length?: number | null;
  dimension_breadth?: number | null;
  dimension_height?: number | null;
  cargo_placement?: string;
  images?: string[];
};

type AppNotification = {
  id: string;
  recipient_phone: string;
  type: "INTEREST_RECEIVED";
  group_id?: string;
  viewer_name?: string;
  viewer_company?: string;
  viewer_phone?: string;
  viewer_verified?: boolean;
  listing_id?: string;
  listing_type?: string;
  listing_summary?: { origin?: string; destination?: string; weight?: string };
  read: boolean;
  created_at: string;
};

type Interest = {
  id: string;
  viewer_phone: string;
  viewer_name: string;
  viewer_company?: string;
  viewer_verified?: boolean;
  listing_id: string;
  listing_type: string;
  listing_summary?: { origin?: string; destination?: string; weight?: string };
  created_at: string;
};

type PtlGroup = {
  id: string;
  corridor: string;
  origin_display: string;
  destination_display: string;
  load_ids: string[];
  total_weight_kg: number;
  capacity_kg: number;
  capacity_remaining_kg: number;
  fill_pct: number;
  cargo_categories: string[];
  status: "FORMING" | "PAIRED" | "CONFIRMED" | "FULL" | "DISPATCHED";
  created_at: string;
  members?: PtlMember[];
};

const TRUCK_CAPACITY_KG = 20000;
const PTL_CARGO_TYPES = ["Bags", "Carton Box", "Drums", "Loose", "Others"];
const CARGO_TYPE_TO_CATEGORY: Record<string, string> = {
  "Bags": "GENERAL",
  "Carton Box": "GENERAL",
  "Loose": "GENERAL",
  "Others": "GENERAL",
  "Drums": "GENERAL", // Drums prompts for HAZMAT confirmation in UI
};

function ptlFillColor(pct: number): string {
  if (pct >= 85) return "#FF6B00";
  if (pct >= 60) return "#F59E0B";
  return "#22C55E";
}

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
  const [tab, setTab] = useState<"myPosts" | "market">("market");
  const [postFlow, setPostFlow] = useState<null | "selection" | "truckSpace" | "adjustment">(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // Origin/destination filter to auto-apply on the Find (market) page right
  // after a Truck Space or Partial Load post — whether the WhatsApp share
  // redirect happens or the user returns straight to the app.
  const [pendingMarketFilter, setPendingMarketFilter] = useState<ActiveFilter | null>(null);

  const fetchUnread = useCallback(async (phone: string) => {
    try {
      const r = await fetch(`${API}/notifications/${encodeURIComponent(phone)}`);
      if (r.ok) {
        const notifs: AppNotification[] = await r.json();
        setUnreadCount(notifs.filter(n => !n.read).length);
      }
    } catch {}
  }, []);

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

  const saveProfile = async (p: Profile) => {
    // Fetch latest verified status from backend before saving
    let enriched = { ...p };
    try {
      const r = await fetch(`${API}/users/${encodeURIComponent(p.phone)}`);
      if (r.ok) {
        const data = await r.json();
        enriched.profile_verified = data.profile_verified ?? false;
        enriched.verification_submitted = data.verification_submitted ?? false;
      }
    } catch {}
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(enriched));
    setProfile(enriched);
    // Persist name/company to backend (best-effort; doesn't block UX if offline).
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

  if (showEditProfile && profile) {
    return (
      <ProfileSetup
        onSave={async (p) => { await saveProfile({ ...p, phone: profile.phone }); setShowEditProfile(false); }}
        onBack={() => setShowEditProfile(false)}
        lockedPhone={profile.phone}
        initialName={profile.name}
        initialCompany={profile.company}
        isEditing
      />
    );
  }

  if (showProfile) {
    return (
      <ProfileScreen
        profile={profile}
        onClose={() => setShowProfile(false)}
        onEdit={() => { setShowProfile(false); setShowEditProfile(true); }}
      />
    );
  }

  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.fill} edges={["top"]}>
      <View style={styles.header} testID="app-header">
        <View style={styles.headerLeft}>
          {(postFlow === "truckSpace" || postFlow === "adjustment") ? (
            <TouchableOpacity
              testID="post-flow-back-btn"
              onPress={() => setPostFlow("selection")}
              style={newStyles.headerBackBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
            </TouchableOpacity>
          ) : (
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
          )}
        </View>
        <TouchableOpacity testID="open-profile-btn" onPress={() => setShowProfile(true)} style={styles.iconBtn}>
          <Ionicons name="person-circle-outline" size={28} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {postFlow === "selection" && (
          <PostSelectionScreen
            onSelectTruckSpace={() => setPostFlow("truckSpace")}
            onSelectAdjustment={() => setPostFlow("adjustment")}
          />
        )}
        {postFlow === "truckSpace" && (
          <PostLoadScreen
            profile={profile}
            onPosted={(filter) => { setPendingMarketFilter(filter ?? null); setPostFlow(null); setTab("market"); }}
          />
        )}
        {postFlow === "adjustment" && (
          <PostPtlLoadScreen
            profile={profile}
            onNotificationsRead={() => setUnreadCount(0)}
            onPosted={(filter) => { setPendingMarketFilter(filter ?? null); setPostFlow(null); setTab("market"); }}
          />
        )}
        {!postFlow && tab === "market"  && (
          <LoadMarketScreen
            profile={profile}
            pendingFilter={pendingMarketFilter}
            onConsumePendingFilter={() => setPendingMarketFilter(null)}
          />
        )}
        {!postFlow && tab === "myPosts" && <MyPostsScreen profile={profile} />}
      </View>

      {/* ── New bottom nav with floating FAB ── */}
      <View style={[newStyles.bottomNavNew, { paddingBottom: Math.max(8, insets.bottom) }]} testID="bottom-nav">
        <BottomNavBtn
          icon="clipboard-outline"
          label="My Posts"
          active={!postFlow && tab === "myPosts"}
          onPress={() => { setPostFlow(null); setTab("myPosts"); }}
          testID="bottom-nav-myposts"
        />
        <View style={newStyles.fabContainer}>
          <TouchableOpacity
            testID="bottom-nav-post"
            onPress={() => setPostFlow("selection")}
            style={newStyles.fabBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={32} color={COLORS.surface} />
          </TouchableOpacity>
          <Text style={[styles.bottomNavLabel, !!postFlow && styles.bottomNavLabelActive]}>Post</Text>
        </View>
        <BottomNavBtn
          icon="search-outline"
          label="Find"
          active={!postFlow && tab === "market"}
          onPress={() => { setPostFlow(null); setTab("market"); }}
          testID="bottom-nav-market"
        />
      </View>
    </SafeAreaView>
  );
}

// ============== Bottom Nav Button ==============
function BottomNavBtn({ icon, label, active, onPress, testID, badge }: {
  icon: any; label: string; active: boolean; onPress: () => void; testID?: string; badge?: number;
}) {
  return (
    <TouchableOpacity testID={testID} onPress={onPress} style={styles.bottomNavBtn} activeOpacity={0.7}>
      <View style={{ position: "relative" }}>
        <Ionicons name={icon} size={24} color={active ? COLORS.primary : COLORS.textMuted} />
        {badge && badge > 0 ? (
          <View style={styles.navBadge}>
            <Text style={styles.navBadgeText}>{badge > 9 ? "9+" : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.bottomNavLabel, active && styles.bottomNavLabelActive]}>{label}</Text>
      {active ? <View style={styles.bottomNavDot} /> : null}
    </TouchableOpacity>
  );
}

// Swipe-left/right between tabs
function SwipeableTabs({ tab, setTab, children }: { tab: "myPosts" | "market"; setTab: (t: "myPosts" | "market") => void; children: React.ReactNode }) {
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dy) < 24,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -60) setTabRef.current("market");
        else if (g.dx > 60) setTabRef.current("myPosts");
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
function ProfileSetup({ onSave, lockedPhone, initialName, initialCompany, isEditing, onBack }: {
  onSave: (p: Profile) => void;
  lockedPhone?: string;
  initialName?: string;
  initialCompany?: string;
  isEditing?: boolean;
  onBack?: () => void;
}) {
  const [name, setName] = useState(initialName || "");
  const [phone, setPhone] = useState(lockedPhone || "");
  const [company, setCompany] = useState(initialCompany || "");
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
          {isEditing && onBack ? (
            <TouchableOpacity testID="edit-profile-back-btn" onPress={onBack} style={{ alignSelf: "flex-start", marginBottom: 8 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            </TouchableOpacity>
          ) : null}
          <Text style={styles.profileTitle}>{isEditing ? "Edit Profile" : "Welcome to Truck Traffic"}</Text>
          <Text style={styles.profileSubtitle}>{isEditing ? "Update your name or company details" : "Set up your profile to start posting and finding loads"}</Text>
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
            <Text style={styles.primaryBtnText}>{isEditing ? "Save Changes" : "Continue"}</Text>
            <Ionicons name={isEditing ? "checkmark" : "arrow-forward"} size={20} color={COLORS.surface} />
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
type CitySuggestion = {
  name: string;
  city: string;
  locality: string;
  state: string;
  pincode: string;
  // Mappls-precision (preserved through selection → storage). Optional so
  // legacy code paths (manual pincode lookup) continue to work.
  placeName?: string;
  fullAddress?: string;
  latitude?: number | null;
  longitude?: number | null;
  eLoc?: string;
};
// RouteInfo is the display+storage payload carried by the route input.
// It always reflects the user's selection — including the exact Mappls
// place_name, full_address, coordinates and eLoc so the backend can
// reconstruct precise location data later.
type RouteInfo = {
  city: string;
  locality: string;
  state: string;
  valid: boolean;
  placeName?: string;
  fullAddress?: string;
  latitude?: number | null;
  longitude?: number | null;
  eLoc?: string;
} | null;

// Defensive sanitizer: if a legacy DB record accidentally stored the pincode
// in `state` (or `city`), treat that field as empty for display purposes.
// Mappls/postalpincode garbage is filtered at the boundary; never trusted.
function sanitizeStateForDisplay(state: string, pincode: string): string {
  const s = (state || "").trim();
  if (!s) return "";
  if (/^\d{6}$/.test(s)) return "";          // state can never be a 6-digit pincode
  if (pincode && s === pincode) return "";   // exact match with pincode
  return s;
}
function sanitizeCityForDisplay(city: string, pincode: string, state: string): string {
  const c = (city || "").trim();
  if (!c) return "";
  if (/^\d{6}$/.test(c)) return "";
  if (pincode && c === pincode) return "";
  // Avoid "Pune, MH" duplicating to "Maharashtra, MH"
  if (state && c.toLowerCase() === state.trim().toLowerCase()) return "";
  return c;
}

// Shared origin/destination row used by both the Truck Space card (LoadCard)
// and the Partial Load card (MyPtlLoadsList), so both listing types render
// route info identically: icon + 3-line stack (locality / city,ST / pincode).
function RouteEndpointBlock({ iconName, iconColor, locality, city, state, pincode }: {
  iconName: any; iconColor: string; locality: string; city: string; state: string; pincode: string;
}) {
  const stClean = sanitizeStateForDisplay(state, pincode);
  const ctyClean = sanitizeCityForDisplay(city, pincode, stClean);
  const locClean = (locality || "").trim();
  const abbr = stateAbbr(stClean);

  const sameLocCity = !!locClean && !!ctyClean && locClean.toLowerCase() === ctyClean.toLowerCase();
  const line1 = (locClean && !sameLocCity) ? locClean : (locClean || ctyClean);
  const line2 = ctyClean && abbr ? `${ctyClean}, ${abbr}` : (ctyClean || abbr || "");
  const line3 = pincode || "";

  return (
    <View style={cardStyles.routeEndpoint}>
      <Ionicons name={iconName} size={13} color={iconColor} style={{ marginTop: 3 }} />
      <View style={{ flex: 1 }}>
        {line1 ? (
          <Text style={cardStyles.routeL1} numberOfLines={1} ellipsizeMode="tail" adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false}>
            {line1}
          </Text>
        ) : null}
        {line2 ? (
          <Text style={cardStyles.routeL2} numberOfLines={1} ellipsizeMode="tail" adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false}>
            {line2}
          </Text>
        ) : null}
        {line3 ? (
          <Text style={cardStyles.routeL3} numberOfLines={1} ellipsizeMode="tail" adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false}>
            {line3}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ============== EditLoadModal ==============
function EditLoadModal({ load, visible, onClose, onSaved }: { load: Load; visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [originText, setOriginText] = useState(load.origin_locality || load.origin_city || load.origin_pincode);
  const [originPin, setOriginPin] = useState(load.origin_pincode);
  const [originInfo, setOriginInfo] = useState<RouteInfo>({
    city: load.origin_city,
    locality: load.origin_locality || "",
    state: load.origin_state,
    valid: true,
    placeName: load.origin_place_name || "",
    fullAddress: load.origin_full_address || "",
    latitude: load.origin_latitude ?? null,
    longitude: load.origin_longitude ?? null,
    eLoc: load.origin_eloc || "",
  });
  const [destText, setDestText] = useState(load.destination_locality || load.destination_city || load.destination_pincode);
  const [destPin, setDestPin] = useState(load.destination_pincode);
  const [destInfo, setDestInfo] = useState<RouteInfo>({
    city: load.destination_city,
    locality: load.destination_locality || "",
    state: load.destination_state,
    valid: true,
    placeName: load.destination_place_name || "",
    fullAddress: load.destination_full_address || "",
    latitude: load.destination_latitude ?? null,
    longitude: load.destination_longitude ?? null,
    eLoc: load.destination_eloc || "",
  });
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

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const pickImage = async () => {
    if (images.length >= 3) { Alert.alert("Limit", "You can attach up to 3 photos."); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Please grant photo library access to attach images."); return; }
    const remaining = 3 - images.length;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.7, base64: true });
    if (!res.canceled && res.assets && res.assets.length > 0) {
      const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
      const validAssets = res.assets.slice(0, remaining).filter((a: any) => {
        if (!a.base64) return false;
        const sizeBytes = (a.base64.length * 3) / 4;
        if (sizeBytes > MAX_SIZE_BYTES) {
          Alert.alert("File too large", `"${a.fileName || "Photo"}" exceeds the 50 MB limit. Please choose a smaller image.`);
          return false;
        }
        return true;
      });
      if (validAssets.length === 0) return;
      setUploadProgress(0);
      const total = validAssets.length;
      const newOnes: string[] = [];
      for (let i = 0; i < total; i++) {
        const a = validAssets[i];
        newOnes.push(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
        setUploadProgress(Math.round(((i + 1) / total) * 100));
        await new Promise(r => setTimeout(r, 80)); // brief tick for progress UI
      }
      setImages((prev) => [...prev, ...newOnes].slice(0, 3));
      setTimeout(() => setUploadProgress(null), 600);
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
    
	  
const originValid =
  /^\d{6}$/.test(originPin) ||
  (
    originInfo?.valid &&
    (
      (originInfo?.latitude != null && originInfo?.longitude != null) ||
      !!(originInfo?.city || originInfo?.locality || originInfo?.placeName)
    )
  );

const destValid =
  /^\d{6}$/.test(destPin) ||
  (
    destInfo?.valid &&
    (
      (destInfo?.latitude != null && destInfo?.longitude != null) ||
      !!(destInfo?.city || destInfo?.locality || destInfo?.placeName)
    )
  );

if (!originValid)
  return Alert.alert("Invalid Origin", "Select a valid origin.");

if (!destValid)
  return Alert.alert("Invalid Destination", "Select a valid destination."); 
	  
	  
	if (!truckType) return Alert.alert("Required", "Select a truck type.");
    if (!weight || weight <= 0) return Alert.alert("Invalid", "Enter valid weight.");
    if (weight > 40) return Alert.alert("Weight limit exceeded", "Maximum allowed weight is 40 tons.");
    if (pricePerTon && parseInt(pricePerTon, 10) > 10000) return Alert.alert("Price limit exceeded", "Maximum allowed price is ₹10,000 per ton.");
    setBusy(true);
    try {
      const lengthVal = dimL ? parseInt(dimL, 10) : null;
      const breadthVal = dimB ? parseInt(dimB, 10) : null;
      const heightVal = dimH ? parseInt(dimH, 10) : null;
      if (lengthVal !== null && lengthVal > 40) return Alert.alert("Invalid length", "Length cannot exceed 40 ft.");
      if (breadthVal !== null && breadthVal > 8) return Alert.alert("Invalid breadth", "Breadth cannot exceed 8 ft.");
      if (heightVal !== null && heightVal > 9) return Alert.alert("Invalid height", "Height cannot exceed 9 ft.");
      const priceVal = pricePerTon ? parseInt(pricePerTon, 10) : null;
      const payload = {
        origin_pincode: originPin, origin_locality: originInfo?.locality || "", origin_city: originInfo?.city || "", origin_state: originInfo?.state || "",
        origin_place_name: originInfo?.placeName || "",
        origin_full_address: originInfo?.fullAddress || "",
        origin_latitude: originInfo?.latitude ?? null,
        origin_longitude: originInfo?.longitude ?? null,
        origin_eloc: originInfo?.eLoc || "",
        destination_pincode: destPin, destination_locality: destInfo?.locality || "", destination_city: destInfo?.city || "", destination_state: destInfo?.state || "",
        destination_place_name: destInfo?.placeName || "",
        destination_full_address: destInfo?.fullAddress || "",
        destination_latitude: destInfo?.latitude ?? null,
        destination_longitude: destInfo?.longitude ?? null,
        destination_eloc: destInfo?.eLoc || "",
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
                        if (parseInt(digits, 10) > 40) { setDimL(""); return; }
                        setDimL(digits);
                      }}
                      keyboardType="number-pad"
                      maxLength={3}
                      placeholder="0"
                      placeholderTextColor={COLORS.textSubtle}
                    />
                    <Text style={styles.dimSuffix}>ft</Text>
                  </View>
                  {dimL && parseInt(dimL, 10) > 40 ? <Text style={styles.errorText}>Max length: 40 ft</Text> : null}
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
                        if (parseInt(digits, 10) > 8) { setDimB(""); return; }
                        setDimB(digits);
                      }}
                      keyboardType="number-pad"
                      maxLength={2}
                      placeholder="0"
                      placeholderTextColor={COLORS.textSubtle}
                    />
                    <Text style={styles.dimSuffix}>ft</Text>
                  </View>
                  {dimB && parseInt(dimB, 10) > 8 ? <Text style={styles.errorText}>Max breadth: 8 ft</Text> : null}
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
                        if (parseInt(digits, 10) > 9) { setDimH(""); return; }
                        setDimH(digits);
                      }}
                      keyboardType="number-pad"
                      maxLength={2}
                      placeholder="0"
                      placeholderTextColor={COLORS.textSubtle}
                    />
                    <Text style={styles.dimSuffix}>ft</Text>
                  </View>
                  {dimH && parseInt(dimH, 10) > 9 ? <Text style={styles.errorText}>Max height: 9 ft</Text> : null}
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

// ============== VerificationDocsScreen ==============
// ============== VerificationDocsScreen ==============
function VerificationDocsScreen({ phone, alreadySubmitted, onClose }: {
  phone: string;
  alreadySubmitted: boolean;
  onClose: () => void;
}) {
  const [pan, setPan] = useState("");
  const [aadhar, setAadhar] = useState("");
  const [aadharFrontImg, setAadharFrontImg] = useState<string | null>(null);
  const [aadharBackImg, setAadharBackImg] = useState<string | null>(null);
  const [panImg, setPanImg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(alreadySubmitted);

  const pickDocPhoto = async (setter: (uri: string) => void) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Please grant photo library access."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });
    if (!res.canceled && res.assets?.[0]?.base64) {
      const a = res.assets[0];
      const MAX = 5 * 1024 * 1024 * 4 / 3;
      if (a.base64!.length > MAX) {
        Alert.alert("File too large", "Please choose an image under 5 MB.");
        return;
      }
      setter(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
    }
  };

  const takeDocPhoto = async (setter: (uri: string) => void) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Please grant camera access."); return; }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });
    if (!res.canceled && res.assets?.[0]?.base64) {
      const a = res.assets[0];
      setter(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
    }
  };

  const showPhotoOptions = (setter: (uri: string) => void, label: string) => {
    Alert.alert(`Upload ${label}`, "Choose source", [
      { text: "Camera", onPress: () => takeDocPhoto(setter) },
      { text: "Gallery", onPress: () => pickDocPhoto(setter) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const submit = async () => {
    const panClean = pan.trim().toUpperCase();
    const aadharClean = aadhar.replace(/\D/g, "");

    if (panClean && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panClean))
      return Alert.alert("Invalid PAN", "PAN must be in format ABCDE1234F");
    if (aadharClean && aadharClean.length !== 12)
      return Alert.alert("Invalid Aadhar", "Aadhar must be exactly 12 digits");
    if (!panClean && !panImg)
      return Alert.alert("PAN required", "Please enter your PAN number or upload a photo of your PAN card.");
    if (!aadharClean && !aadharFrontImg)
      return Alert.alert("Aadhar required", "Please enter your Aadhar number or upload a photo of the front of your Aadhar card.");

    setLoading(true);
    try {
      const body: any = {};
      if (panClean) body.pan_number = panClean;
      if (aadharClean) body.aadhar_number = aadharClean;
      if (aadharFrontImg) body.aadhar_front_img = aadharFrontImg;
      if (aadharBackImg) body.aadhar_back_img = aadharBackImg;
      if (panImg) body.pan_img = panImg;

      const res = await fetch(`${API}/users/${encodeURIComponent(phone)}/verify-docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return Alert.alert("Error", data.detail || "Submission failed");
      setSubmitted(true);
      Alert.alert("Submitted ✅", "Your documents have been submitted. You will be verified within 24–48 hours.");
    } catch {
      Alert.alert("Error", "Could not submit. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Reusable photo upload tile
  const DocPhotoTile = ({ label, img, setter }: { label: string; img: string | null; setter: (uri: string) => void }) => (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.label, { marginBottom: 6 }]}>{label}</Text>
      <TouchableOpacity
        style={{
          borderWidth: 1.5,
          borderColor: img ? COLORS.primary : COLORS.border,
          borderStyle: img ? "solid" : "dashed",
          borderRadius: 12,
          height: 110,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: img ? "#F0F4FF" : COLORS.bg,
          overflow: "hidden",
        }}
        onPress={() => showPhotoOptions(setter, label)}
        activeOpacity={0.75}
      >
        {img ? (
          <>
            <Image source={{ uri: img }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
            <View style={{ position: "absolute", bottom: 6, right: 8, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: "#fff", fontSize: 10, fontFamily: "Inter_600SemiBold" }}>Tap to change</Text>
            </View>
          </>
        ) : (
          <View style={{ alignItems: "center", gap: 6 }}>
            <Ionicons name="camera-outline" size={28} color={COLORS.textMuted} />
            <Text style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_500Medium" }}>Tap to upload</Text>
            <Text style={{ fontSize: 10, color: COLORS.textSubtle, fontFamily: "Inter_400Regular" }}>Camera or Gallery</Text>
          </View>
        )}
      </TouchableOpacity>
      {img && (
        <TouchableOpacity onPress={() => setter("")} style={{ alignSelf: "flex-end", marginTop: 4 }}>
          <Text style={{ fontSize: 11, color: COLORS.danger, fontFamily: "Inter_600SemiBold" }}>Remove</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.fill, { backgroundColor: COLORS.bg }]} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Get Verified</Text>
          <View style={{ width: 40 }} />
        </View>
        <SafeScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {submitted ? (
            <View style={{ alignItems: "center", paddingTop: 40, gap: 16 }}>
              <Ionicons name="time-outline" size={56} color={COLORS.secondary} />
              <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text, textAlign: "center" }}>
                Verification Under Review
              </Text>
              <Text style={{ fontSize: 14, color: COLORS.textMuted, textAlign: "center", lineHeight: 22 }}>
                Your documents have been submitted. Our team will verify your details within 24–48 hours. You will get a verified badge once approved.
              </Text>
            </View>
          ) : (
            <>
              <View style={{ backgroundColor: "#EEF2FA", borderRadius: 12, padding: 14, marginBottom: 20 }}>
                <Text style={{ fontSize: 13, color: COLORS.primary, fontFamily: "Inter_600SemiBold", lineHeight: 20 }}>
                  Verified transporters get a ✅ badge on their profile, building trust with customers. Your documents are stored securely and never shared.
                </Text>
              </View>

              {/* ── PAN ── */}
              <Text style={[styles.sectionHeading, { marginBottom: 8 }]}>PAN Card</Text>
              <Field label="PAN Number (optional if photo uploaded)">
                <TextInput
                  style={styles.input}
                  value={pan}
                  onChangeText={(t) => setPan(t.toUpperCase())}
                  placeholder="e.g. ABCDE1234F"
                  placeholderTextColor={COLORS.textSubtle}
                  autoCapitalize="characters"
                  maxLength={10}
                />
              </Field>
              <DocPhotoTile label="PAN Card Photo" img={panImg} setter={setPanImg} />

              <View style={[styles.divider, { marginVertical: 16 }]} />

              {/* ── AADHAR ── */}
              <Text style={[styles.sectionHeading, { marginBottom: 8 }]}>Aadhar Card</Text>
              <Field label="Aadhar Number (optional if photo uploaded)">
                <TextInput
                  style={styles.input}
                  value={aadhar}
                  onChangeText={(t) => setAadhar(t.replace(/\D/g, "").slice(0, 12))}
                  placeholder="12-digit Aadhar number"
                  placeholderTextColor={COLORS.textSubtle}
                  keyboardType="number-pad"
                  maxLength={12}
                />
              </Field>
              <DocPhotoTile label="Aadhar Front *" img={aadharFrontImg} setter={setAadharFrontImg} />
              <DocPhotoTile label="Aadhar Back (optional)" img={aadharBackImg} setter={setAadharBackImg} />

              <Text style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 20, lineHeight: 17 }}>
                Your details are encrypted and used only for identity verification. We do not share this with any third party.
              </Text>

              <TouchableOpacity style={styles.primaryBtn} onPress={submit} disabled={loading}>
                {loading
                  ? <ActivityIndicator color={COLORS.surface} />
                  : <><Ionicons name="shield-checkmark" size={18} color={COLORS.surface} /><Text style={styles.primaryBtnText}>Submit for Verification</Text></>
                }
              </TouchableOpacity>
            </>
          )}
        </SafeScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ============== Profile Screen ==============
function ProfileScreen({ profile, onClose, onEdit }: { profile: Profile; onClose: () => void; onEdit: () => void }) {
  const [myLoads, setMyLoads] = useState<Load[]>([]);
  const [myPtlLoads, setMyPtlLoads] = useState<PtlLoad[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editLoad, setEditLoad] = useState<Load | null>(null);
  const [showVerifyDocs, setShowVerifyDocs] = useState(false);

const handleInvite = async () => {
    const msg = `🚛 *Join me on Truck Traffic!*\n\nFind truck space & post loads instantly across India.\n\n📲 Download: https://play.google.com/store/apps/details?id=com.ptlmarket.trucktraffic\n🌐 Website: https://www.trucktraffic.in\n\nLet\'s connect on the platform!`;
    try {
      await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(msg)}`);
    } catch {
      Alert.alert("Error", "WhatsApp could not be opened.");
    }
  };

  const fetchMy = useCallback(async () => {
    try {
      const r = await fetch(`${API}/loads`);
      const j: Load[] = await r.json();
      setMyLoads(j.filter((l) => l.poster_phone === profile.phone));
    } catch {}
    try {
      const pr = await fetch(`${API}/ptl/loads/my/${encodeURIComponent(profile.phone)}`);
      const pj = await pr.json();
      setMyPtlLoads(Array.isArray(pj) ? pj.filter((l: PtlLoad) => l.status !== "CANCELLED") : []);
    } catch {}
    setLoading(false); setRefreshing(false);
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <TouchableOpacity testID="profile-invite-btn" onPress={handleInvite} style={[styles.iconBtn, { backgroundColor: "#E8F8EE", borderRadius: 8, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 4 }]}>
            <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
            <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700", color: "#25D366" }}>Invite</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="profile-edit-btn" onPress={onEdit} style={styles.iconBtn}>
            <Ionicons name="create-outline" size={22} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView
        testID="profile-scroll"
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchMy(); }} />}
      >
        <View style={styles.profileCard} testID="profile-card">
          <View style={styles.avatarBig}><Text style={styles.avatarBigText}>{initials || "?"}</Text></View>
          <Text style={styles.profileCardName} testID="profile-card-name">{profile.name}</Text>
          {profile.company ? <Text style={styles.profileCardCompany} testID="profile-card-company">{profile.company}</Text> : null}
          <View style={styles.profilePhoneRow}>
            <Ionicons name="call-outline" size={14} color={COLORS.textMuted} />
            <Text style={styles.profileCardPhone} testID="profile-card-phone">+91 {profile.phone}</Text>
          </View>
          {/* Verification badge / CTA */}
          {profile.profile_verified ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, backgroundColor: "#E6F9F0", borderRadius: 100, paddingVertical: 5, paddingHorizontal: 14, borderWidth: 1, borderColor: COLORS.success }}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
              <Text style={{ fontSize: 12, color: COLORS.success, fontFamily: "Inter_700Bold", fontWeight: "700" }}>Verified Transporter</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, backgroundColor: "#FFF4EE", borderRadius: 100, paddingVertical: 5, paddingHorizontal: 14, borderWidth: 1, borderColor: COLORS.secondary }}
              onPress={() => setShowVerifyDocs(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="shield-checkmark-outline" size={16} color={COLORS.secondary} />
              <Text style={{ fontSize: 12, color: COLORS.secondary, fontFamily: "Inter_700Bold", fontWeight: "700" }}>
                {profile.verification_submitted ? "Verification Under Review" : "Get Verified →"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.statsRow}>
          <View style={[styles.statBox, profileStyles.statBoxOutline, { borderColor: COLORS.primary }]}>
            <Text style={[styles.statValue, { color: COLORS.primary }]} testID="my-loads-count">{myLoads.length}</Text>
            <Text style={styles.statLabel}>Truck Space</Text>
          </View>
          <View style={[styles.statBox, profileStyles.statBoxOutline, { borderColor: COLORS.secondary }]}>
            <Text style={[styles.statValue, { color: COLORS.secondary }]} testID="my-ptl-count">{myPtlLoads.length}</Text>
            <Text style={styles.statLabel}>Adjustment Loads</Text>
          </View>
        </View>
        {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 24 }} /> : null}
      </ScrollView>
      {showVerifyDocs && (
        <VerificationDocsScreen
          phone={profile.phone}
          alreadySubmitted={!!profile.verification_submitted}
          onClose={() => setShowVerifyDocs(false)}
        />
      )}
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
  statBoxOutline: { marginHorizontal: 6, borderWidth: 1.5, borderRadius: 12, paddingVertical: 10 },
  actionRow: { flexDirection: "row", gap: 10, marginTop: -6, marginBottom: 14, paddingHorizontal: 2 },
  editBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: "#EEF2FA" },
  editBtnText: { color: COLORS.primary, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13 },
  deleteBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.danger, backgroundColor: "#FDF1F1" },
  deleteBtnText: { color: COLORS.danger, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13 },
  bidsBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 11, borderRadius: 12, backgroundColor: COLORS.success, marginTop: -6, marginBottom: 10, paddingHorizontal: 14, alignSelf: "stretch" },
  bidsBtnText: { color: COLORS.surface, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13, letterSpacing: 0.2 },
  bidsCountPill: { backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, minWidth: 24, alignItems: "center" },
  bidsCountText: { color: COLORS.surface, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 12 },
});

// ============== Post Load ==============
function PostLoadScreen({ profile, onPosted }: { profile: Profile; onPosted: (filter?: ActiveFilter | null) => void }) {
  const [originText, setOriginText] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
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
  const [priceError, setPriceError] = useState("");
  const [cargoTypes, setCargoTypes] = useState<string[]>([]);
  const [cargoOther, setCargoOther] = useState("");
  const [showCargoOtherInput, setShowCargoOtherInput] = useState(false);

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
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.7, base64: true });
    if (!res.canceled && res.assets && res.assets.length > 0) {
      const MAX_SIZE_BYTES = 50 * 1024 * 1024;
      const validAssets = res.assets.slice(0, remaining).filter((a: any) => {
        if (!a.base64) return false;
        const sizeBytes = (a.base64.length * 3) / 4;
        if (sizeBytes > MAX_SIZE_BYTES) {
          Alert.alert("File too large", `"${a.fileName || "Photo"}" exceeds the 50 MB limit. Please choose a smaller image.`);
          return false;
        }
        return true;
      });
      if (validAssets.length === 0) return;
      setUploadProgress(0);
      const total = validAssets.length;
      const newOnes: string[] = [];
      for (let i = 0; i < total; i++) {
        const a = validAssets[i];
        newOnes.push(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
        setUploadProgress(Math.round(((i + 1) / total) * 100));
        await new Promise(r => setTimeout(r, 80));
      }
      setImages((prev) => [...prev, ...newOnes].slice(0, 3));
      setTimeout(() => setUploadProgress(null), 600);
    }
  };

  const removeImage = (idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx));

  const submit = async (alsoShare: boolean) => {

	  const originValid =
  /^\d{6}$/.test(originPin) ||
  (
    originInfo?.valid &&
    (
      (originInfo?.latitude != null && originInfo?.longitude != null) ||
      !!(originInfo?.city || originInfo?.locality || originInfo?.placeName)
    )
  );

const destValid =
  /^\d{6}$/.test(destPin) ||
  (
    destInfo?.valid &&
    (
      (destInfo?.latitude != null && destInfo?.longitude != null) ||
      !!(destInfo?.city || destInfo?.locality || destInfo?.placeName)
    )
  );

if (!originValid) {
  return Alert.alert(
    "Invalid Origin",
    "Select a valid origin from the list."
  );
}

if (!destValid) {
  return Alert.alert(
    "Invalid Destination",
    "Select a valid destination from the list."
  );
}


	  
    if (!truckType) return Alert.alert("Required", "Select a truck type");
const w = weight;
if (!w || w <= 0) return Alert.alert("Invalid", "Enter valid weight in tons");
if (w > 40) return Alert.alert("Weight limit exceeded", "Maximum allowed weight is 40 tons.");
if (pricePerTon && parseInt(pricePerTon, 10) > 10000) return Alert.alert("Price limit exceeded", "Maximum allowed price is ₹10,000 per ton.");
    
    setLoadingPost(true);
    try {
      const lengthVal = dimL ? parseInt(dimL, 10) : null;
      const breadthVal = dimB ? parseInt(dimB, 10) : null;
      const heightVal = dimH ? parseInt(dimH, 10) : null;
      if (lengthVal !== null && lengthVal > 40) return Alert.alert("Invalid length", "Length cannot exceed 40 ft.");
      if (breadthVal !== null && breadthVal > 8) return Alert.alert("Invalid breadth", "Breadth cannot exceed 8 ft.");
      if (heightVal !== null && heightVal > 9) return Alert.alert("Invalid height", "Height cannot exceed 9 ft.");
      const priceVal = pricePerTon ? parseInt(pricePerTon, 10) : null;
      const payload = {
        origin_pincode: originPin, origin_locality: originInfo?.locality || "", origin_city: originInfo?.city || "", origin_state: originInfo?.state || "",
        origin_place_name: originInfo?.placeName || "",
        origin_full_address: originInfo?.fullAddress || "",
        origin_latitude: originInfo?.latitude ?? null,
        origin_longitude: originInfo?.longitude ?? null,
        origin_eloc: originInfo?.eLoc || "",
        destination_pincode: destPin, destination_locality: destInfo?.locality || "", destination_city: destInfo?.city || "", destination_state: destInfo?.state || "",
        destination_place_name: destInfo?.placeName || "",
        destination_full_address: destInfo?.fullAddress || "",
        destination_latitude: destInfo?.latitude ?? null,
        destination_longitude: destInfo?.longitude ?? null,
        destination_eloc: destInfo?.eLoc || "",
        cargo_types: cargoTypes.filter(c => !c.startsWith("Others:") || !!cargoOther.trim()), cargo_placement: placement, truck_type: truckType, weight_tons: w, space_cuft: null,
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
        setDimL(""); setDimB(""); setDimH(""); setPricePerTon(""); setPriceError("");
        setCargoTypes([]); setCargoOther(""); setShowCargoOtherInput(false);
      };

      if (alsoShare) {
        const dateStr = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        const oStateName = sanitizeStateForDisplay(originInfo?.state || "", originPin);
        const dStateName = sanitizeStateForDisplay(destInfo?.state || "", destPin);
        const oCityClean = sanitizeCityForDisplay(originInfo?.city || "", originPin, oStateName);
        const dCityClean = sanitizeCityForDisplay(destInfo?.city || "", destPin, dStateName);
        const oLocClean = (originInfo?.locality || originInfo?.city || "").trim();
        const dLocClean = (destInfo?.locality || destInfo?.city || "").trim();
        const oAbbr = stateAbbr(oStateName);
        const dAbbr = stateAbbr(dStateName);
        const originLine =
          `📍 ${oLocClean || oCityClean || originPin}` +
          (oCityClean && oAbbr ? `\n   ${oCityClean}, ${oAbbr}` : (oCityClean ? `\n   ${oCityClean}` : (oAbbr ? `\n   ${oAbbr}` : ""))) +
          `\n   ${originPin}`;
        const destLine =
          `📍 ${dLocClean || dCityClean || destPin}` +
          (dCityClean && dAbbr ? `\n   ${dCityClean}, ${dAbbr}` : (dCityClean ? `\n   ${dCityClean}` : (dAbbr ? `\n   ${dAbbr}` : ""))) +
          `\n   ${destPin}`;
        const truckLabelPost = truckType === "Open" ? "Open Truck" : truckType === "Container" ? "Container Truck" : truckType === "Trailer" ? "Trailer Truck" : truckType;
        const poArea = oLocClean || oCityClean || originPin;
        const poCity = oCityClean && oCityClean !== oLocClean ? `, ${oCityClean}` : "";
        const poState = oAbbr ? `, ${oAbbr}` : "";
        const pdArea = dLocClean || dCityClean || destPin;
        const pdCity = dCityClean && dCityClean !== dLocClean ? `, ${dCityClean}` : "";
        const pdState = dAbbr ? `, ${dAbbr}` : "";
        const postOriginLabel = `📍 From: ${poArea}${poCity}${poState}, ${originPin}`;
        const postDestLabel   = `📍 To: ${pdArea}${pdCity}${pdState}, ${destPin}`;
        const postShareUrl = loadSharePath(created);
        const text = `🚛 *Truck Space Available - Truck Traffic*\n\n` +
          `${postOriginLabel}\n${postDestLabel}\n\n` +
          `🚚 ${truckLabelPost}\n` +
          `⚖️ *Weight:* ${w} Tons\n` +
          `📅 *Loading:* ${dateStr}\n\n` +
          `📞 *Contact:* ${profile.name}` +
          (profile.company ? ` — ${profile.company}` : "") +
          `\n+91 ${profile.phone}\n\n` +
          `🔗 *More info:* ${postShareUrl}\n` +
          `📲 *Playstore:* https://play.google.com/store/apps/details?id=com.ptlmarket.trucktraffic`;
        const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
        const canOpen = await Linking.canOpenURL(waUrl).catch(() => false);
        if (canOpen) {
          await Linking.openURL(waUrl).catch(() => {});
        } else {
          Alert.alert("Load Posted Successfully! 🎉", "Your load has been posted. WhatsApp is not installed on this device.");
        }
        const routeFilter = await buildRouteFilterFromPost(originPin, originInfo, destPin, destInfo);
        reset(); onPosted(routeFilter);
      } else {
        const routeFilter = await buildRouteFilterFromPost(originPin, originInfo, destPin, destInfo);
        Alert.alert("Posted!", "Your load has been added to the market.", [{ text: "View Market", onPress: () => { reset(); onPosted(routeFilter); } }]);
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
            onPress={() => setWeight(w => Math.min(40, parseFloat((w + 0.5).toFixed(1))))}
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
                if (!isNaN(n) && n > 40) {
                  setWeightInput("");
                  Alert.alert("Weight limit exceeded", "Maximum allowed weight is 40 tons.");
                  return;
                }
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
                    if (parseInt(digits, 10) > 40) { setDimL(""); return; }
                    setDimL(digits);
                  }}
                  keyboardType="number-pad"
                  maxLength={3}
                  placeholder="0"
                  placeholderTextColor={COLORS.textSubtle}
                />
                <Text style={styles.dimSuffix}>ft</Text>
              </View>
              {dimL && parseInt(dimL, 10) > 40 ? <Text style={styles.errorText}>Max length: 40 ft</Text> : null}
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
                    if (parseInt(digits, 10) > 8) { setDimB(""); return; }
                    setDimB(digits);
                  }}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="0"
                  placeholderTextColor={COLORS.textSubtle}
                />
                <Text style={styles.dimSuffix}>ft</Text>
              </View>
              {dimB && parseInt(dimB, 10) > 8 ? <Text style={styles.errorText}>Max breadth: 8 ft</Text> : null}
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
                    if (parseInt(digits, 10) > 9) { setDimH(""); return; }
                    setDimH(digits);
                  }}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="0"
                  placeholderTextColor={COLORS.textSubtle}
                />
                <Text style={styles.dimSuffix}>ft</Text>
              </View>
              {dimH && parseInt(dimH, 10) > 9 ? <Text style={styles.errorText}>Max height: 9 ft</Text> : null}
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
              onChangeText={(t) => {
                const digits = t.replace(/\D/g, "");
                if (!digits) { setPricePerTon(""); setPriceError(""); return; }
                const val = parseInt(digits, 10);
                if (val > 10000) {
                  setPricePerTon("");
                  setPriceError("Max price is ₹10,000 per ton");
                } else {
                  setPricePerTon(digits);
                  setPriceError("");
                }
              }}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={COLORS.textSubtle}
            />
            <Text style={styles.priceSuffix}>/ ton</Text>
          </View>
          {priceError ? <Text style={styles.errorText}>{priceError}</Text> : null}
        </CollapsibleSection>

        <CollapsibleSection
          icon="cube-outline"
          title="Cargo in Truck"
          summary={cargoTypes.length > 0 ? cargoTypes.map(c => c.startsWith("Others:") ? c.slice(8).trim() : c).join(", ") : ""}
          testID="opt-cargo-type"
        >
          <View style={cargoStyles.grid}>
            {CARGO_TYPE_OPTIONS.map((opt) => {
              const selected = cargoTypes.includes(opt.key);
              const isOthers = opt.key === "Others";
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[cargoStyles.tile, selected && cargoStyles.tileSelected]}
                  onPress={() => {
                    // Single-select: selecting a new type deselects the previous one
                    if (selected) {
                      // Tapping selected item deselects it
                      setCargoTypes([]);
                      setCargoOther("");
                      setShowCargoOtherInput(false);
                    } else {
                      setCargoTypes([opt.key]);
                      setCargoOther("");
                      if (isOthers) {
                        setShowCargoOtherInput(true);
                      } else {
                        setShowCargoOtherInput(false);
                      }
                    }
                    if (false) { // dead branch to keep linter happy
                    }
                  }}
                  activeOpacity={0.75}
                >
                  <Image
                    source={opt.image}
                    style={cargoStyles.tileImage}
                    resizeMode="contain"
                  />
                  <Text style={[cargoStyles.tileLabel, selected && cargoStyles.tileLabelSelected]} numberOfLines={1}>{opt.label}</Text>
                  {selected && <View style={cargoStyles.checkDot}><Ionicons name="checkmark" size={9} color="#fff" /></View>}
                </TouchableOpacity>
              );
            })}
          </View>
          {showCargoOtherInput && (
            <View style={cargoStyles.otherInputWrap}>
              <TextInput
                style={cargoStyles.otherInput}
                value={cargoOther}
                onChangeText={(t) => {
                  setCargoOther(t);
                  // Single-select: cargoTypes is always just one entry
                  setCargoTypes(t.trim() ? [`Others: ${t.trim()}`] : ["Others"]);
                }}
                placeholder="Describe cargo (e.g. Steel coils, Marble slabs…)"
                placeholderTextColor={COLORS.textSubtle}
                returnKeyType="done"
              />
            </View>
          )}
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
          <Text style={styles.label}>Attach up to 3 photos of the truck or available space (max 50 MB each)</Text>
          {uploadProgress !== null && (
            <View style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                <Text style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_500Medium" }}>Uploading photos…</Text>
                <Text style={{ fontSize: 12, color: COLORS.primary, fontFamily: "Inter_700Bold" }}>{uploadProgress}%</Text>
              </View>
              <View style={{ height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: "hidden" }}>
                <View style={{ height: 6, backgroundColor: COLORS.primary, borderRadius: 3, width: `${uploadProgress}%` as any }} />
              </View>
            </View>
          )}
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

        <TouchableOpacity
          testID="submit-load-share-btn"
          style={[styles.whatsappBtn, { marginTop: 24, width: "100%", paddingVertical: 16 }]}
          onPress={() => submit(true)}
          disabled={loadingPost}
          activeOpacity={0.82}
        >
          {loadingPost
            ? <ActivityIndicator color={COLORS.surface} />
            : <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }}>
                <Ionicons name="logo-whatsapp" size={22} color={COLORS.surface} />
                <Text style={[styles.primaryBtnText, { fontSize: 16 }]}>Post & Share</Text>
              </View>
          }
        </TouchableOpacity>
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
const RECENT_GLOBAL_KEY = "recent_routes_global";

// Returns the safe bottom inset padded to at least MIN_BOTTOM so content is
// never obscured by Android gesture bars or iOS home indicators.
const MIN_BOTTOM = 16;
function useBottomInset(): number {
  const insets = useSafeAreaInsets();
  return Math.max(MIN_BOTTOM, insets.bottom);
}

// Drop-in replacement for ScrollView that always adds a safe bottom inset on
// top of whatever paddingBottom the caller passes in contentContainerStyle.
// This is the single source of truth for bottom-safe-area across the whole app.
function SafeScrollView({ contentContainerStyle, children, ...rest }: React.ComponentProps<typeof ScrollView>) {
  const bottomInset = useBottomInset();
  const base = StyleSheet.flatten(contentContainerStyle) || {};
  const extraBottom = typeof base.paddingBottom === "number" ? base.paddingBottom : 0;
  return (
    <ScrollView
      contentContainerStyle={[base, { paddingBottom: extraBottom + bottomInset }]}
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

// Mappls Autosuggest — mirrors the TruckTraffic web autocomplete exactly:
//   1. Concatenate suggestedLocations + userAddedLocations in returned order.
//   2. Map to CitySuggestion using addressTokens (canonical) with placeAddress
//      tail as last-resort fallback.
//   3. Keep only results that resolve to a valid 6-digit pincode.
//   4. Preserve Mappls' native ordering — no client-side re-ranking, no type
//      whitelist, no POI exclusion. The web app receives the same payload and
//      shows it as-is, and the mobile app must match.
//
// Backend storage (place_name, full_address, lat/lon, eLoc) is unchanged.

async function getRecentSearches(_prefix: string): Promise<CitySuggestion[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_GLOBAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveRecentSearch(_prefix: string, s: CitySuggestion) {
  try {
    const existing = await getRecentSearches("");
    const filtered = existing.filter((r) => r.pincode !== s.pincode);
    const updated = [s, ...filtered].slice(0, 8);
    await AsyncStorage.setItem(RECENT_GLOBAL_KEY, JSON.stringify(updated));
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
        // Mappls pod only accepts ONE value per request — send three parallel
        // requests (CITY, LC=Locality, SLC=SubLocality) and merge the results.
        // This gives us area-level suggestions only, no POIs or addresses.
        // Mappls pod only accepts ONE value per request — send two parallel
        // requests (CITY and LC=Locality) and merge the results.
        // SLC (SubLocality) is excluded — results are too granular (specific
        // chowks, micro-zones) and not how logistics users describe locations.
        const [rCity, rLoc] = await Promise.all([
          fetch(`${API}/places?query=${encodeURIComponent(q)}&pod=CITY`),
          fetch(`${API}/places?query=${encodeURIComponent(q)}&pod=LC`),
        ]);
        const [dCity, dLoc] = await Promise.all([
          rCity.json(), rLoc.json(),
        ]);

        // Merge both, dedup by eLoc, preserve relevance order within each pod
        const seen = new Set<string>();
        const all: any[] = [];
        for (const item of [
          ...(dCity.suggestedLocations || []),
          ...(dLoc.suggestedLocations  || []),
        ]) {
          if (!seen.has(item.eLoc)) { seen.add(item.eLoc); all.push(item); }
        }

		  

		  console.log(
  "MAPPLS_RAW",
  all.map((x: any) => ({
    name: x.placeName,
    type: x.type,
    address: x.placeAddress,
    pincode: x.addressTokens?.pincode,
  }))
);
        // Dev-only: log raw Mappls items (type + placeName) so any future
        // divergence vs the website can be diagnosed quickly. No filtering
        // happens here — this is purely observational. Stripped from
        // production bundles by Metro.
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log(
            `[Mappls] q="${q}" types=`,
            all.map((s: any) => ({ type: s?.type, name: s?.placeName }))
          );
        }

        // Match the website exactly: preserve Mappls' native order — no
        // client-side re-ranking, no type whitelist. The only filter is the
        // post-mapping pincode-validity check (`.filter(s.pincode)` below),
        // which mirrors the web app's behaviour of dropping any result we
        // can't resolve to a 6-digit pincode.

        // Map Mappls autosuggest items to CitySuggestion using the structured
        // `addressTokens` payload (the canonical source). Comma-splitting the
        // placeAddress is fragile and was the root cause of state==pincode
        // bugs — we only fall back to it when tokens are missing.
        const mapped: CitySuggestion[] = all.slice(0, 10).map((s: any) => {
          const tokens = s.addressTokens || {};

          // Pincode: prefer tokens, then regex on address string.
        const directPin = (s.placeAddress || "").match(/\b(\d{6})\b/);



const pincode: string =
  (tokens.pincode && /^\d{6}$/.test(tokens.pincode)
    ? tokens.pincode
    : "") ||
  (directPin ? directPin[1] : "");



          // State: ONLY from tokens. Never from address tail (that's often
          // a pincode and caused the Vashi/400703/400703 bug).
          let state: string = (tokens.state || "").trim();
          // Final safety: if tokens.state is somehow a 6-digit number, drop it.
          if (/^\d{6}$/.test(state)) state = "";

          // City: tokens.city → district → locality.
          let city: string =
            (tokens.city || tokens.district || tokens.locality || "").trim();

          // Locality: most specific available — subLocality → locality →
          // village → POI → city. The user's spec.
          const poiName = (s.poi || s.placeName || "").trim();
          let locality: string =
            (tokens.subLocality || tokens.locality || tokens.village || poiName || city).trim();

          // Address tail fallback ONLY when tokens are absent.
          if (!state || !city) {
            const parts = (s.placeAddress || "")
              .split(",")
              .map((p: string) => p.trim())
              .filter(Boolean);
            // Drop a trailing pincode segment, if present.
            const cleaned = parts.filter((p: string) => !/^\d{6}$/.test(p));
            if (!state && cleaned.length >= 1) state = cleaned[cleaned.length - 1];
            if (!city && cleaned.length >= 2) city = cleaned[cleaned.length - 2];
            if (/^\d{6}$/.test(state)) state = "";
            if (/^\d{6}$/.test(city)) city = "";
          }

          return {
            name: s.placeName,
            city,
            locality,
            state,
            pincode,
            placeName: s.placeName || "",
            fullAddress: s.placeAddress || "",
            latitude: typeof s.latitude === "number" ? s.latitude : (s.latitude ? parseFloat(s.latitude) : null),
            longitude: typeof s.longitude === "number" ? s.longitude : (s.longitude ? parseFloat(s.longitude) : null),
            eLoc: s.eLoc || "",
          };
        });

        // Results are already area-level (CITY / LOCALITY / SUB_LOCALITY)
        // because we used pod=CITY and pod=LC in the fetch above.
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
          const s: CitySuggestion = {
            name: j.locality || j.city || query,
            city: j.city || "",
            locality: j.locality || j.city || "",
            state: j.state || "",
            pincode: query,
            placeName: j.locality || j.city || query,
            fullAddress: [j.locality || j.city, j.city, j.state, query].filter(Boolean).join(", "),
            latitude: null,
            longitude: null,
            eLoc: "",
          };
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
  console.log("PICKED", s);
	 
	  
	 if (!s.pincode) {
  // Autosuggest never returns lat/lon — but placeAddress always contains
  // the pincode (e.g. "Mumbai, Maharashtra, 400053"). Extract it and use
  // geocodePin (Nominatim) to get coords. This is the only reliable path
  // given that the Place Detail API does not return coords on our plan.
  const addressPin = (s.fullAddress || "").match(/\b(\d{6})\b/)?.[1] || "";

  await saveRecentSearch(testIDPrefix, { ...s, pincode: addressPin });

  const displayLocality = (s.placeName || s.locality || s.name || "").trim();
  onSelect(
    displayLocality,
    addressPin,
    {
      city: s.city || "",
      locality: displayLocality,
      state: s.state || "",
      valid: true,
      placeName: s.placeName || s.name || "",
      fullAddress: s.fullAddress || "",
      latitude: null,
      longitude: null,
      eLoc: s.eLoc || "",
    }
  );

  onClose();
  return;
}
    // Always fetch the authoritative city/state from the pincode endpoint
    // so the UI shows the instantly-recognizable district name (e.g., Rewari,
    // Thane), even if the search result's parsed city/state was incomplete.
    let finalCity = s.city || "";
    let finalState = s.state || "";
    // Use s.placeName as the display locality — it is exactly the text shown
    // in the dropdown row that the user saw and tapped. s.locality is derived
    // from addressTokens and can differ from placeName. j.locality from the
    // postal API is a post office name (e.g. "Sanpada", "KU Bazar") that the
    // user never saw — we must never use it as the display label.
    let finalLocality = (s.placeName || s.locality || s.name || "").trim();

    // Hard guard: state must never equal the pincode (frequent Mappls quirk).
    if (finalState && /^\d{6}$/.test(finalState.trim())) finalState = "";
    if (finalCity  && /^\d{6}$/.test(finalCity.trim()))  finalCity  = "";
    if (finalState && s.pincode && finalState.trim() === s.pincode) finalState = "";

    try {
      const r = await fetch(`${API}/pincode/${s.pincode}`);
      const j = await r.json();
      if (j && j.valid) {
        // Postal API is authoritative for city and state only — never locality.
        // j.locality is a post office admin name, not the area name the user knows.
        if (j.city)  finalCity  = j.city;
        if (j.state) finalState = j.state;
        // Only fill locality from postal API if Mappls gave us nothing at all.
        if (!finalLocality) finalLocality = j.locality || j.city || s.name;
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

    // Repeat the state≠pincode guard AFTER all enrichment, just in case.
    if (finalState && /^\d{6}$/.test(finalState.trim())) finalState = "";
    if (finalCity  && /^\d{6}$/.test(finalCity.trim()))  finalCity  = "";

    const enriched: CitySuggestion = {
      ...s,
      city: finalCity,
      state: finalState,
      locality: finalLocality,
    };
    await saveRecentSearch(testIDPrefix, enriched);
    onSelect(finalLocality, enriched.pincode, {
      city: finalCity,
      locality: finalLocality,
      state: finalState,
      valid: true,
      placeName: s.placeName || s.name || "",
      fullAddress: s.fullAddress || "",
      latitude: s.latitude ?? null,
      longitude: s.longitude ?? null,
      eLoc: s.eLoc || "",
    });
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
  // When the input is empty, show recents only.
  // When the user types, show live results.
  type Section = { label?: string; icon?: any; items: CitySuggestion[]; kind: "recent" | "results" };
  const sections: Section[] = query.length === 0
    ? [
        ...(showRecents ? [{ label: "Recent Searches", icon: "time-outline" as const, items: recents, kind: "recent" as const }] : []),
      ]
    : [{ items: results, kind: "results" as const }];
  // Flatten to a single list with optional section headers.
  type Row =
    | { kind: "header"; label: string; sectionKey: string }
    | { kind: "row"; data: CitySuggestion; section: "recent" | "results" };
  const rows: Row[] = [];
  sections.forEach((sec) => {
    if (sec.label) rows.push({ kind: "header", label: sec.label, sectionKey: sec.kind });
    sec.items.forEach((it) =>
      rows.push({
        kind: "row",
        data: it,
        section: sec.kind,
      })
    );
  });

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

        {/* Section labels rendered inline in the list. Only show no-results /
            searching states when the user is actively typing. */}
        {query.length >= 2 && !searching && results.length === 0 ? (
          <Text style={srm.noResultText}>No results found. Try a different name or pincode.</Text>
        ) : searching ? (
          <View style={srm.searchingRow}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={srm.searchingText}>Searching…</Text>
          </View>
        ) : null}

        <FlatList
          data={rows}
          keyExtractor={(r, i) =>
            r.kind === "header"
              ? `h-${r.sectionKey}-${i}`
              : `${r.section}-${r.data.pincode}-${i}`
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 80 }}
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return (
                <View style={srm.sectionHeaderRow}>
                  <Ionicons
                    name="time-outline"
                    size={13}
                    color={COLORS.textMuted}
                  />
                  <Text style={srm.sectionLabel}>{item.label}</Text>
                </View>
              );
            }
            const s = item.data;
            const cleanState = sanitizeStateForDisplay(s.state || "", s.pincode);
            const cleanCity = sanitizeCityForDisplay(s.city || "", s.pincode, cleanState);
            const abbr = stateAbbr(cleanState);
            const subLine = cleanCity && abbr ? `${cleanCity}, ${abbr}` : (cleanCity || abbr || "");
            return (
              <TouchableOpacity
                testID={`${testIDPrefix}-modal-suggest-${s.pincode}`}
                style={srm.row}
                onPress={() => pick(s)}
                activeOpacity={0.7}
              >
                <View style={srm.rowIcon}>
                  <Ionicons
                    name={item.section === "recent" ? "time-outline" : "location-outline"}
                    size={20}
                    color={COLORS.textMuted}
                  />
                </View>
                <View style={srm.rowBody}>
                  <Text style={srm.rowName} numberOfLines={1}>{s.placeName || s.name}</Text>
                  {subLine ? <Text style={srm.rowSub} numberOfLines={1}>{subLine}</Text> : null}
                </View>
                <Text style={srm.rowPin}>{s.pincode}</Text>
              </TouchableOpacity>
            );
          }}
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
  sectionLabel: { fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, paddingTop: 0, paddingBottom: 0 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
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

 const hasValue =
  !!info?.valid &&
  !!(
    pin ||
    info?.locality ||
    info?.city ||
    info?.placeName
  );

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
              const ctyRaw = (info.city || "").trim();
              const stRaw = (info.state || "").trim();
              // Sanitize legacy bad data: state/city must not be a pincode.
              const stClean = sanitizeStateForDisplay(stRaw, pin);
              const ctyClean = sanitizeCityForDisplay(ctyRaw, pin, stClean);
              const abbr = stateAbbr(stClean);

              // L1 = Locality/Area (falls back to city if no locality).
              const sameLocCity = !!loc && !!ctyClean && loc.toLowerCase() === ctyClean.toLowerCase();
              const line1 = (loc && !sameLocCity) ? loc : (loc || ctyClean);
              // L2 = "city, ST" — collapse intelligently when one side is empty.
              const line2 = ctyClean && abbr
                ? `${ctyClean}, ${abbr}`
                : (ctyClean || abbr || "");
              // L3 = Pincode.
              const line3 = pin || "";

              // Per-line adaptive font ladder (length-based). Android's
              // adjustsFontSizeToFit is unreliable, so we precompute size
              // from text length so each line shrinks independently.
              const adaptL1 = (len: number) =>
                len <= 8  ? 20 :
                len <= 11 ? 18 :
                len <= 14 ? 16 :
                len <= 17 ? 14 :
                len <= 20 ? 13 : 12;
              const adaptL2 = (len: number) =>
                len <= 10 ? 14 :
                len <= 13 ? 13 :
                len <= 16 ? 12 :
                len <= 19 ? 11 :
                len <= 22 ? 10 : 9.5;
              const adaptL3 = (len: number) => (len <= 6 ? 12 : 11);

              return (
                <>
                  {line1 ? (
                    <Text
                      testID={`${testIDPrefix}-line1-area`}
                      style={[sriStyles.line1, { fontSize: rf(adaptL1(line1.length)) }]}
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
                      testID={`${testIDPrefix}-line2-state`}
                      style={[sriStyles.line2, { fontSize: rf(adaptL2(line2.length)) }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      allowFontScaling={false}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {line2}
                    </Text>
                  ) : null}
                  {line3 ? (
                    <Text
                      testID={`${testIDPrefix}-line3-pincode`}
                      style={[sriStyles.line3, { fontSize: rf(adaptL3(line3.length)) }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      allowFontScaling={false}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {line3}
                    </Text>
                  ) : null}
                </>
              );
            })()}
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
  // 3-line display: L1 = Area/City (largest), L2 = State (medium), L3 = Pincode (smallest)
  line1: { fontFamily: "Inter_700Bold", fontWeight: "800", color: COLORS.text, marginBottom: 3, lineHeight: rf(22) },
  line2: { fontFamily: "Inter_600SemiBold", fontWeight: "700", color: COLORS.text, marginBottom: 2, lineHeight: rf(18) },
  line3: { fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.textMuted, letterSpacing: 0.5, lineHeight: rf(15) },
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

// Resolves lat/lon from a city/locality name via Nominatim.
// Used when a CITY-type Mappls result has no pincode in placeAddress
// (e.g. Mumbai → placeAddress = "Maharashtra" with no 6-digit pin).
async function geocodeCityName(name: string) {
  if (!name) return { lat: 0, lon: 0, found: false };
  const key = `city:${name.toLowerCase()}`;
  if (geoCache.has(key)) return geoCache.get(key)!;
  try {
    const r = await fetch(`${API}/geocode-city/${encodeURIComponent(name)}`);
    const j = await r.json();
    if (j.found) {
      const out = { lat: j.lat, lon: j.lon, found: true };
      geoCache.set(key, out);
      return out;
    }
  } catch {}
  return { lat: 0, lon: 0, found: false };
}

// geocodeEloc: resolves coords for a load stored without lat/lon.
// 1. Extract pincode from fullAddress (e.g. "Mumbai, Maharashtra, 400053" → 400053)
// 2. If no pincode (e.g. CITY results where placeAddress = "Maharashtra"),
//    fall back to city-name geocoding via Nominatim.
async function geocodeEloc(eLoc: string, fallbackName?: string, fullAddress?: string) {
  if (!eLoc) return { lat: 0, lon: 0, found: false };
  const key = `eloc:${eLoc}`;
  if (geoCache.has(key)) return geoCache.get(key)!;

  // Step 1: pincode from stored full address
  const pin = (fullAddress || "").match(/\b(\d{6})\b/)?.[1] || "";
  if (pin) {
    const result = await geocodePin(pin);
    if (result.found) {
      geoCache.set(key, result);
      return result;
    }
  }

  // Step 2: city name geocoding (for CITY-type results with no pincode)
  if (fallbackName) {
    const result = await geocodeCityName(fallbackName);
    if (result.found) {
      geoCache.set(key, result);
      return result;
    }
  }

  return { lat: 0, lon: 0, found: false };
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

type ActiveFilter = { origin: string; dest: string; originCity?: string; destCity?: string; weightKg: number; volumeCuft: number | null; originCoord: { lat: number; lon: number }; destCoord: { lat: number; lon: number } };
type Distances = Record<string, { origin: number; dest: number; offRoute: boolean }>;

// Builds an ActiveFilter (same shape the Find/Filter modal produces) from a
// route the user just posted (origin/destination pin + autosuggest info).
// Used to auto-apply origin/destination filters on the Find page right
// after a Truck Space or Partial Load post, regardless of whether the
// WhatsApp share redirect happens or the user comes straight back.
async function buildRouteFilterFromPost(
  originPin: string,
  originInfo: RouteInfo,
  destPin: string,
  destInfo: RouteInfo,
): Promise<ActiveFilter | null> {
  try {
    let oc: { lat: number; lon: number; found: boolean };
    if (originInfo?.latitude != null && originInfo?.longitude != null) {
      oc = { lat: originInfo.latitude, lon: originInfo.longitude, found: true };
    } else if (/^\d{6}$/.test(originPin)) {
      oc = await geocodePin(originPin);
    } else if (originInfo?.eLoc) {
      oc = await geocodeEloc(originInfo.eLoc, originInfo.placeName || originInfo.city || "", originInfo.fullAddress || "");
    } else {
      return null;
    }

    let dc: { lat: number; lon: number; found: boolean };
    if (destInfo?.latitude != null && destInfo?.longitude != null) {
      dc = { lat: destInfo.latitude, lon: destInfo.longitude, found: true };
    } else if (/^\d{6}$/.test(destPin)) {
      dc = await geocodePin(destPin);
    } else if (destInfo?.eLoc) {
      dc = await geocodeEloc(destInfo.eLoc, destInfo.placeName || destInfo.city || "", destInfo.fullAddress || "");
    } else {
      return null;
    }

    if (!oc.found || !dc.found) return null;

    return {
      origin: originPin,
      dest: destPin,
      originCity: originInfo?.city || originInfo?.locality || originInfo?.placeName || "",
      destCity: destInfo?.city || destInfo?.locality || destInfo?.placeName || "",
      weightKg: 0,
      volumeCuft: null,
      originCoord: { lat: oc.lat, lon: oc.lon },
      destCoord: { lat: dc.lat, lon: dc.lon },
    };
  } catch {
    return null;
  }
}

// Map of 10-digit phone -> saved contact name from the user's address book.
// Loaded once per app session if contacts permission is granted, so we can
// show a "Saved" badge next to load posters the user already knows.
// Also syncs {phone, name} entries to the backend for mutual-contacts matching.
function useContactsMap(userPhone?: string): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Contacts.requestPermissionsAsync();
        if (perm.status !== "granted") return;
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
        });
        const m = new Map<string, string>();
        // Each entry sent to the backend carries both the phone and the
        // display name so the server can store them together.
        const contactEntries: { phone: string; name: string }[] = [];
        for (const c of data) {
          const nums = (c as any).phoneNumbers || [];
          for (const n of nums) {
            const digits = String(n?.number || "").replace(/\D/g, "");
            if (digits.length >= 10) {
              const local = digits.slice(-10);
              if (!m.has(local)) {
                const displayName = (c.name || "").trim();
                m.set(local, displayName);
                contactEntries.push({ phone: local, name: displayName });
              }
            }
          }
        }
        if (cancelled) return;
        setMap(m);
        // Upload {phone, name} entries to backend for mutual contact matching
        if (userPhone && contactEntries.length > 0) {
          fetch(`${API}/users/${encodeURIComponent(userPhone)}/contacts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(contactEntries),
          }).catch(() => {});
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  // Run once on mount only — userPhone is stable (set at login, never changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return map;
}

function LoadMarketScreen({ profile, pendingFilter, onConsumePendingFilter }: { profile: Profile; pendingFilter?: ActiveFilter | null; onConsumePendingFilter?: () => void }) {
  // Independent, toggle-able type filters — both OFF by default, which means
  // "show everything". Selecting one narrows the combined list to just that
  // type; selecting both is equivalent to neither being selected (shows all).
  const [showTrucks, setShowTrucks] = useState(false);
  const [showPartials, setShowPartials] = useState(false);
  const includeTrucks = showTrucks || !showPartials;
  const includePartials = showPartials || !showTrucks;
  const [allLoads, setAllLoads] = useState<Load[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter | null>(null);
  const [filteredLoads, setFilteredLoads] = useState<Load[] | null>(null);
  const [distances, setDistances] = useState<Distances>({});
  const contactsMap = useContactsMap(profile.phone);

  // PTL state
  const [ptlGroups, setPtlGroups] = useState<PtlGroup[]>([]);
  const [ptlLoading, setPtlLoading] = useState(false);
  const [ptlRefreshing, setPtlRefreshing] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<PtlGroup | null>(null);
  const [showPtlDetail, setShowPtlDetail] = useState(false);

  const fetchPtlGroups = useCallback(async (filter?: { originCity: string; destCity: string; weightKg: number } | null) => {
    setPtlLoading(true);
    try {
      const f = filter !== undefined ? filter : (activeFilter ? { originCity: activeFilter.originCity || "", destCity: activeFilter.destCity || "", weightKg: activeFilter.weightKg } : null);
      const params = new URLSearchParams();
      if (f?.originCity) params.set("origin_city", f.originCity);
      if (f?.destCity) params.set("dest_city", f.destCity);
      if (f?.weightKg) params.set("weight_kg", String(f.weightKg));
      params.set("viewer_phone", profile.phone);
      const qs = params.toString();
      const r = await fetch(`${API}/ptl/groups${qs ? "?" + qs : ""}`);
      const j = await r.json();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const active = (Array.isArray(j) ? j : []).filter((g: PtlGroup) => {
        // Find the earliest loading_date among members; hide if it's in the past
        const dates = (g.members || [])
          .map((m: any) => m.loading_date)
          .filter(Boolean)
          .map((d: string) => { try { const dt = new Date(d); dt.setHours(0,0,0,0); return dt; } catch { return null; } })
          .filter(Boolean) as Date[];
        if (dates.length === 0) return true; // no loading date = always show
        return dates.some(d => d >= today);   // show if at least one member's date is today or future
      });
      setPtlGroups(active);
    } catch {
      Alert.alert("Error", "Failed to fetch PTL groups");
    } finally {
      setPtlLoading(false);
      setPtlRefreshing(false);
    }
  }, [activeFilter, profile.phone]);

  useEffect(() => { fetchPtlGroups(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

      // Resolve origin coords: stored lat/lon (best) → pincode geocode → eLoc geocode
      let lo: { lat: number; lon: number; found: boolean };
      if (load.origin_latitude != null && load.origin_longitude != null) {
        lo = { lat: load.origin_latitude, lon: load.origin_longitude, found: true };
      } else if (/^\d{6}$/.test(load.origin_pincode)) {
        lo = await geocodePin(load.origin_pincode);
      } else if (load.origin_eloc) {
        lo = await geocodeEloc(load.origin_eloc, load.origin_place_name || load.origin_city || "", load.origin_full_address || "");
      } else {
        continue;
      }
      if (!lo.found) continue;

      // Resolve destination coords: stored lat/lon (best) → pincode geocode → eLoc geocode
      let ld: { lat: number; lon: number; found: boolean };
      if (load.destination_latitude != null && load.destination_longitude != null) {
        ld = { lat: load.destination_latitude, lon: load.destination_longitude, found: true };
      } else if (/^\d{6}$/.test(load.destination_pincode)) {
        ld = await geocodePin(load.destination_pincode);
      } else if (load.destination_eloc) {
        ld = await geocodeEloc(load.destination_eloc, load.destination_place_name || load.destination_city || "", load.destination_full_address || "");
      } else {
        continue;
      }
      if (!ld.found) continue;

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

  // Common filter: applies to trucks (client-side haversine route match) and
  // to partial loads (server-side city/weight match) at the same time.
  const onApplyFilter = async (f: ActiveFilter) => {
    setActiveFilter(f);
    setShowFilter(false);
    await Promise.all([
      applyFilter(f),
      fetchPtlGroups({ originCity: f.originCity || "", destCity: f.destCity || "", weightKg: f.weightKg }),
    ]);
  };
  const onClearFilter = () => {
    setActiveFilter(null);
    setFilteredLoads(null);
    setDistances({});
    fetchPtlGroups(null);
  };
  // Auto-apply the origin/destination filter carried over from a just-completed
  // Truck Space / Partial Load post, once loads have finished loading. This
  // fires whether the user was redirected to WhatsApp and came back, or
  // skipped the redirect entirely — either way they land here pre-filtered.
  useEffect(() => {
    if (pendingFilter && !loading) {
      onApplyFilter(pendingFilter);
      onConsumePendingFilter?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFilter, loading]);

  const isFiltered = activeFilter !== null;
  const displayLoads = isFiltered ? filteredLoads || [] : allLoads;

  // Combine both listing types into one feed, tagged by type so the
  // renderer knows which card component to use. When unfiltered, sort by
  // recency so newer truck-space and partial-load posts interleave
  // naturally; when filtered, truck matches (already sorted by relevance)
  // come first, followed by matching partial-load groups.
  type FeedItem = { kind: "truck"; key: string; load: Load } | { kind: "ptl"; key: string; group: PtlGroup };
  const feed = useMemo<FeedItem[]>(() => {
    const truckItems: FeedItem[] = includeTrucks ? displayLoads.map((l) => ({ kind: "truck" as const, key: `t-${l.id}`, load: l })) : [];
    const ptlItems: FeedItem[] = includePartials ? ptlGroups.map((g) => ({ kind: "ptl" as const, key: `p-${g.id}`, group: g })) : [];
    if (isFiltered) return [...truckItems, ...ptlItems];
    return [...truckItems, ...ptlItems].sort((a, b) => {
      const ta = a.kind === "truck" ? a.load.created_at : a.group.created_at;
      const tb = b.kind === "truck" ? b.load.created_at : b.group.created_at;
      return new Date(tb).getTime() - new Date(ta).getTime();
    });
  }, [includeTrucks, includePartials, displayLoads, ptlGroups, isFiltered]);

  const isBusy = loading || ptlLoading;
  const isRefreshing = refreshing || ptlRefreshing;
  const onRefreshAll = () => {
    setRefreshing(true); setPtlRefreshing(true);
    fetchLoads();
    fetchPtlGroups();
  };

  return (
    <View style={styles.fill}>
      <View style={styles.modeToggleBar} testID="market-mode-toggle">
        <TouchableOpacity
          testID="market-mode-full"
          style={[styles.modeToggleBtn, showTrucks && [styles.modeToggleBtnActive, { backgroundColor: COLORS.primary }]]}
          onPress={() => setShowTrucks((v) => !v)}
        >
          <Ionicons name="car-outline" size={14} color={showTrucks ? COLORS.surface : COLORS.textMuted} />
          <Text style={[styles.modeToggleText, showTrucks && styles.modeToggleTextActive]}>Truck Space</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="market-mode-ptl"
          style={[styles.modeToggleBtn, showPartials && [styles.modeToggleBtnActive, { backgroundColor: COLORS.secondary }]]}
          onPress={() => setShowPartials((v) => !v)}
        >
          <Ionicons name="cube-outline" size={14} color={showPartials ? COLORS.surface : COLORS.textMuted} />
          <Text style={[styles.modeToggleText, showPartials && styles.modeToggleTextActive]}>Partial Load</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.marketTop}>
        <Text style={styles.marketCount} testID="loads-count">
          {feed.length} {feed.length === 1 ? "result" : "results"} {isFiltered ? "matched" : "available"}
        </Text>
        {isFiltered && (
          <TouchableOpacity testID="clear-filter-btn" onPress={onClearFilter} style={styles.clearChip}>
            <Ionicons name="close" size={14} color={COLORS.textMuted} />
            <Text style={styles.clearChipText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.searchBarWrap}>
        <TouchableOpacity
          testID="find-space-btn"
          style={[styles.searchFullBtn, isFiltered && styles.searchFullBtnActive]}
          onPress={() => setShowFilter(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="search" size={18} color={isFiltered ? COLORS.surface : COLORS.primary} />
          <Text style={[styles.searchFullBtnText, isFiltered && { color: COLORS.surface }]}>
            Search by Origin &amp; Destination
          </Text>
          {isFiltered && <View style={styles.filterDot} />}
        </TouchableOpacity>
      </View>


      {isBusy && feed.length === 0 ? (
        <View style={[styles.fill, styles.center]}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <FlatList
          testID="market-feed-list"
          data={feed}
          keyExtractor={(it) => it.key}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefreshAll} />}
          ListFooterComponent={isFiltered && feed.length > 0 ? <Text style={styles.approxNote}>* Truck-space distances are approximate (straight-line)</Text> : null}
          ListEmptyComponent={
            <View style={styles.emptyWrap} testID="empty-state">
              <Ionicons name={isFiltered ? "search" : "cube-outline"} size={48} color={COLORS.textSubtle} />
              <Text style={styles.emptyTitle}>{isFiltered ? "No matching listings found" : "No listings yet"}</Text>
              <Text style={styles.emptySub}>{isFiltered ? "Try adjusting your cargo details or search within a wider area." : "Be the first to post a truck space or partial load!"}</Text>
            </View>
          }
          extraData={contactsMap.size}
          renderItem={({ item }) =>
            item.kind === "truck" ? (
              <LoadCard load={item.load} isMine={item.load.poster_phone === profile.phone} distance={isFiltered ? distances[item.load.id] : undefined} contactName={contactsMap.get(item.load.poster_phone)} contactsMap={contactsMap} viewerPhone={profile.phone} />
            ) : (
              <PtlGroupCard group={item.group} profile={profile} contactsMap={contactsMap} onPress={() => { setSelectedGroup(item.group); setShowPtlDetail(true); }} />
            )
          }
        />
      )}

      <FindSpaceModal visible={showFilter} initial={activeFilter} onClose={() => setShowFilter(false)} onApply={onApplyFilter} />
      {selectedGroup && (
        <ListingDetailModal
          visible={showPtlDetail}
          ptlGroup={selectedGroup}
          viewerPhone={profile.phone}
          viewerName={profile.name}
          onClose={() => { setShowPtlDetail(false); setSelectedGroup(null); }}
        />
      )}
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


// Returns the short-link path using the server-assigned short_id.
// Falls back to the full UUID query-param URL if short_id isn't on the load yet
// (e.g. loads created before the short_id feature was deployed).
function loadSharePath(load: any): string {
  if (load?.short_id) return `https://www.trucktraffic.in/l/${load.short_id}`;
  if (load?.id) return `https://www.trucktraffic.in?load=${load.id}`;
  return "https://www.trucktraffic.in";
}

function LoadCard({ load, isMine, distance, contactName, contactsMap, viewerPhone }: { load: Load; isMine: boolean; distance?: { origin: number; dest: number; offRoute: boolean }; contactName?: string; contactsMap?: Map<string, string>; viewerPhone?: string }) {
  const [showPosterProfile, setShowPosterProfile] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const callPoster = () => Linking.openURL(`tel:${load.poster_phone}`).catch(() => Alert.alert("Error", "Cannot open dialer"));
  const shareOnWhatsApp = async () => {
    // Same message format as the "Post & Share" button on the post-truck-space screen.
    const dateStrShare = (() => {
      try { return new Date(load.loading_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
      catch { return load.loading_date; }
    })();
    const oLocClean = (load.origin_locality || load.origin_city || "").trim();
    const dLocClean = (load.destination_locality || load.destination_city || "").trim();
    const oStateName = sanitizeStateForDisplay(load.origin_state || "", load.origin_pincode || "");
    const dStateName = sanitizeStateForDisplay(load.destination_state || "", load.destination_pincode || "");
    const oCityClean = sanitizeCityForDisplay(load.origin_city || "", load.origin_pincode || "", oStateName);
    const dCityClean = sanitizeCityForDisplay(load.destination_city || "", load.destination_pincode || "", dStateName);
    const oAbbr = stateAbbr(oStateName);
    const dAbbr = stateAbbr(dStateName);
    // 3-line block: Locality / City, ST / Pincode
    const originLine =
      `📍 ${oLocClean || oCityClean || load.origin_pincode}` +
      (oCityClean && oAbbr ? `\n   ${oCityClean}, ${oAbbr}` : (oCityClean ? `\n   ${oCityClean}` : (oAbbr ? `\n   ${oAbbr}` : ""))) +
      `\n   ${load.origin_pincode}`;
    const destLine   =
      `📍 ${dLocClean || dCityClean || load.destination_pincode}` +
      (dCityClean && dAbbr ? `\n   ${dCityClean}, ${dAbbr}` : (dCityClean ? `\n   ${dCityClean}` : (dAbbr ? `\n   ${dAbbr}` : ""))) +
      `\n   ${load.destination_pincode}`;
    const truckLabelCard = load.truck_type === "Open" ? "Open Truck" : load.truck_type === "Container" ? "Container Truck" : load.truck_type === "Trailer" ? "Trailer Truck" : load.truck_type;
    const oArea = oLocClean || oCityClean || load.origin_pincode;
    const oPin = load.origin_pincode;
    const dArea = dLocClean || dCityClean || load.destination_pincode;
    const dPin = load.destination_pincode;
    const oCity = oCityClean && oCityClean !== oLocClean ? `, ${oCityClean}` : "";
    const oState = oAbbr ? `, ${oAbbr}` : "";
    const dCity = dCityClean && dCityClean !== dLocClean ? `, ${dCityClean}` : "";
    const dState = dAbbr ? `, ${dAbbr}` : "";
    const originLabel = `📍 From: ${oArea}${oCity}${oState}, ${oPin}`;
    const destLabel   = `📍 To: ${dArea}${dCity}${dState}, ${dPin}`;
    const shareUrl = loadSharePath(load);
    const text =
      `🚛 *Truck Space Available - Truck Traffic*\n\n` +
      `${originLabel}\n${destLabel}\n\n` +
      `🚚 ${truckLabelCard}\n` +
      `⚖️ *Weight:* ${load.weight_tons} Tons\n` +
      `📅 *Loading:* ${dateStrShare}\n\n` +
      `📞 *Contact:* ${load.poster_name}` +
      (load.poster_company ? ` — ${load.poster_company}` : "") +
      `\n+91 ${load.poster_phone}\n\n` +
      `🔗 *More info:* ${shareUrl}\n` +
      `📲 *Playstore:* https://play.google.com/store/apps/details?id=com.ptlmarket.trucktraffic`;
    try { await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`); }
    catch { Alert.alert("Error", "WhatsApp could not be opened."); }
  };
   const dateStr = useMemo(() => { try { return new Date(load.loading_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return load.loading_date; } }, [load.loading_date]);

  const truckImg = TRUCK_TYPES.find(t => t.name === load.truck_type)?.image;

  return (
    <TouchableOpacity activeOpacity={0.92} onPress={() => setShowDetail(true)} testID={`load-card-${load.id}`}>
    <View style={[styles.card, marketCardStyles.truckCardOutline]}>
      {/* At-a-glance type badge, pinned top-right. Blue = Truck Space,
          matching the card's border color and the app's Truck Space theme
          elsewhere. The share button sits directly below it in the same
          right-hand column, so both live in the corner instead of the
          badge eating its own full-width row (keeps the card shorter). */}
      <View style={[marketCardStyles.typeBadgeAbs, marketCardStyles.typeBadgeTruck]}>
        <Ionicons name="car-outline" size={10} color={COLORS.surface} />
        <Text style={marketCardStyles.typeBadgeText}>TRUCK SPACE</Text>
      </View>
      {/* Share-to-WhatsApp button, below the badge, top-right of the card.
          The combined "share-social" icon makes it clear this *forwards*
          the load details to a WhatsApp chat (it does NOT start a direct
          chat with the poster). */}
      <TouchableOpacity
        testID={`share-wa-${load.id}`}
        style={cardStyles.shareTopPill}
        onPress={shareOnWhatsApp}
        activeOpacity={0.85}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="share-social" size={14} color="#25D366" />
      </TouchableOpacity>

      {/* LINE 1: Route */}
      <View style={styles.cardRouteRow}>
        <View style={[styles.flex1, { paddingRight: 84 }]}>
          <RouteEndpointBlock
            iconName="location" iconColor={COLORS.secondary}
            locality={load.origin_locality || ""} city={load.origin_city || ""} state={load.origin_state || ""} pincode={load.origin_pincode || ""}
          />
          <View style={{ height: 8 }} />
          <RouteEndpointBlock
            iconName="flag" iconColor={COLORS.primary}
            locality={load.destination_locality || ""} city={load.destination_city || ""} state={load.destination_state || ""} pincode={load.destination_pincode || ""}
          />
        </View>
      </View>

      {distance ? (
        <View style={styles.distanceRow} testID={`distance-${load.id}`}>
          <View style={styles.distanceChip}><Ionicons name="location-outline" size={12} color={COLORS.success} /><Text style={styles.distanceText}>Origin: {distance.origin.toFixed(1)} km {distance.offRoute ? "off-route" : "away"}</Text></View>
          <View style={styles.distanceChip}><Ionicons name="flag-outline" size={12} color={COLORS.success} /><Text style={styles.distanceText}>Dest: {distance.dest.toFixed(1)} km {distance.offRoute ? "off-route" : "away"}</Text></View>
        </View>
      ) : null}

      <View style={styles.divider} />

      {/* LINE 2: Date · Weight Free · Truck type name + logo */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cardStyles.metaScrollContent}>
        <View style={cardStyles.metaChip}>
          <Ionicons name="calendar-outline" size={12} color={COLORS.textMuted} />
          <Text style={cardStyles.metaText}>{dateStr}</Text>
        </View>
        <View style={cardStyles.metaChip}>
          <Ionicons name="barbell-outline" size={12} color={COLORS.textMuted} />
          <Text style={cardStyles.metaText}>{load.weight_tons}T Free</Text>
        </View>
        {load.truck_type ? (
          <View style={cardStyles.metaChip}>
            {truckImg ? <Image source={truckImg} style={cardStyles.truckMiniImg} resizeMode="contain" /> : null}
            <Text style={cardStyles.metaText}>{load.truck_type}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.divider} />

      {/* LINE 3: Contact + Call */}
      <View style={cardStyles.line3Row}>
        <View style={cardStyles.contactSection}>
          <View style={cardStyles.posterNameRow}>
            <TouchableOpacity onPress={() => !isMine && setShowPosterProfile(true)} activeOpacity={isMine ? 1 : 0.7}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={[styles.posterName, !isMine && { color: COLORS.primary, textDecorationLine: "underline" }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false}>
                  {load.poster_name}{isMine && <Text style={styles.youTag}> · You</Text>}
                </Text>
                {load.verified && (
                  <View style={cardStyles.verifiedBadge}>
                    <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                  </View>
                )}
              </View>
            </TouchableOpacity>
            {!isMine && contactName ? (
              <View
                style={cardStyles.savedBadge}
                testID={`contact-saved-${load.id}`}
              >
                <Ionicons name="person" size={10} color={COLORS.primary} />
                <Text style={cardStyles.savedBadgeText} numberOfLines={1}>
                  {contactName ? `Saved · ${contactName}` : "In contacts"}
                </Text>
              </View>
            ) : null}

          </View>
          {load.poster_company ? <Text style={styles.posterCompany} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false}>{load.poster_company}</Text> : null}
        </View>

        {!isMine && (
          <TouchableOpacity testID={`call-btn-${load.id}`} style={[styles.callBtn, { alignSelf: "center" }]} onPress={callPoster}>
            <Ionicons name="call" size={16} color={COLORS.surface} />
            <Text style={styles.callBtnText}>Call</Text>
          </TouchableOpacity>
        )}
      </View>

      {showPosterProfile && !isMine && (
        <PosterProfileModal
          visible={showPosterProfile}
          load={load}
          contactName={contactName}
          contactsMap={contactsMap}
          viewerPhone={viewerPhone}
          onClose={() => setShowPosterProfile(false)}
        />
      )}
    </View>
    <ListingDetailModal
      visible={showDetail}
      load={load}
      viewerPhone={viewerPhone || ""}
      viewerName=""
      contactName={contactName}
      onClose={() => setShowDetail(false)}
    />
    </TouchableOpacity>
  );
}


// ============== Bid types ==============
type Bid = {
  id: string;
  listing_id: string;
  listing_type: "load" | "ptl";
  poster_phone: string;
  bidder_phone: string;
  bidder_name: string;
  bidder_company?: string;
  origin_locality: string;
  origin_city: string;
  origin_pincode: string;
  origin_latitude?: number | null;
  origin_longitude?: number | null;
  destination_locality: string;
  destination_city: string;
  destination_pincode: string;
  destination_latitude?: number | null;
  destination_longitude?: number | null;
  weight_tons: number;
  cargo_type: string;
  origin_deviation_km?: number | null;
  destination_deviation_km?: number | null;
  created_at: string;
  updated_at: string;
};

const BID_CARGO_TYPES = ["Bags", "Carton Box", "Pipes", "Drums", "Fresh Produce", "Others"];

// ============== BidFormModal ==============
// Small bottom-sheet form that lets a non-poster offer a bid on a listing.
// Captures origin/destination/weight/cargo_type. Deviation from the listing's
// origin/destination is computed server-side from pincode → lat/lon lookup.
function BidFormModal({
  visible, listingId, listingType, viewerPhone, existingBid, onClose, onSubmitted,
}: {
  visible: boolean;
  listingId: string;
  listingType: "load" | "ptl";
  viewerPhone: string;
  existingBid: Bid | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const bottomInset = useBottomInset();
  const [originText, setOriginText] = useState("");
  const [originPin, setOriginPin] = useState("");
  const [originInfo, setOriginInfo] = useState<RouteInfo>(null);
  const [destText, setDestText] = useState("");
  const [destPin, setDestPin] = useState("");
  const [destInfo, setDestInfo] = useState<RouteInfo>(null);
  const [weight, setWeight] = useState("");
  const [cargoType, setCargoType] = useState("Bags");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (existingBid) {
      setOriginPin(existingBid.origin_pincode || "");
      setOriginText(existingBid.origin_pincode || "");
      setOriginInfo(existingBid.origin_city || existingBid.origin_locality ? {
        city: existingBid.origin_city || "", locality: existingBid.origin_locality || "", state: "", valid: true,
        latitude: existingBid.origin_latitude ?? null, longitude: existingBid.origin_longitude ?? null,
      } : null);
      setDestPin(existingBid.destination_pincode || "");
      setDestText(existingBid.destination_pincode || "");
      setDestInfo(existingBid.destination_city || existingBid.destination_locality ? {
        city: existingBid.destination_city || "", locality: existingBid.destination_locality || "", state: "", valid: true,
        latitude: existingBid.destination_latitude ?? null, longitude: existingBid.destination_longitude ?? null,
      } : null);
      setWeight(existingBid.weight_tons ? String(existingBid.weight_tons) : "");
      setCargoType(existingBid.cargo_type || "Bags");
    } else {
      setOriginPin(""); setOriginText(""); setOriginInfo(null);
      setDestPin(""); setDestText(""); setDestInfo(null);
      setWeight(""); setCargoType("Bags");
    }
  }, [visible, existingBid]);

  const submit = async () => {
    if (!/^\d{6}$/.test(originPin)) return Alert.alert("Origin", "Select a valid origin");
    if (!/^\d{6}$/.test(destPin)) return Alert.alert("Destination", "Select a valid destination");
    const w = parseFloat(weight);
    if (!w || w <= 0) return Alert.alert("Weight", "Enter a valid weight in tons");
    if (!cargoType) return Alert.alert("Cargo type", "Select a cargo type");
    setSubmitting(true);
    try {
      // Best-effort geocode for both endpoints to compute deviation server-side
      const [og, dg] = await Promise.all([
        fetch(`${API}/geocode/${originPin}`).then(r => r.json()).catch(() => null),
        fetch(`${API}/geocode/${destPin}`).then(r => r.json()).catch(() => null),
      ]);
      const body = {
        listing_id: listingId,
        listing_type: listingType,
        bidder_phone: viewerPhone,
        origin_pincode: originPin,
        origin_city: originInfo?.city || "",
        origin_locality: originInfo?.locality || "",
        origin_latitude: og?.found ? og.lat : null,
        origin_longitude: og?.found ? og.lon : null,
        destination_pincode: destPin,
        destination_city: destInfo?.city || "",
        destination_locality: destInfo?.locality || "",
        destination_latitude: dg?.found ? dg.lat : null,
        destination_longitude: dg?.found ? dg.lon : null,
        weight_tons: w,
        cargo_type: cargoType,
      };
      const r = await fetch(`${API}/bids`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.detail || "Failed to place bid");
      Alert.alert(j.updated ? "Bid updated ✓" : "Bid placed ✓", "The poster has been notified of your offer.");
      onSubmitted();
    } catch (e: any) {
      Alert.alert("Bid failed", e?.message || "Try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={bidStyles.backdrop}>
        <View style={[bidStyles.sheet, { paddingBottom: bottomInset + 12 }]}>
          <View style={bidStyles.sheetHeader}>
            <Text style={bidStyles.sheetTitle}>{existingBid ? "Update your bid" : "Place your bid"}</Text>
            <TouchableOpacity onPress={onClose} testID="bid-form-close" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.routeInputsRow}>
              <SmartRouteInput
                label="Your Origin"
                testIDPrefix="bid-origin"
                text={originText}
                pin={originPin}
                info={originInfo}
                onChange={(t, p, i) => { setOriginText(t); setOriginPin(p); setOriginInfo(i); }}
              />
              <View style={styles.routeArrowMid}>
                <Ionicons name="arrow-forward" size={20} color={COLORS.secondary} />
              </View>
              <SmartRouteInput
                label="Your Destination"
                testIDPrefix="bid-dest"
                text={destText}
                pin={destPin}
                info={destInfo}
                onChange={(t, p, i) => { setDestText(t); setDestPin(p); setDestInfo(i); }}
              />
            </View>

            <Text style={[bidStyles.fieldLabel, { marginTop: 14 }]}>WEIGHT (TONS)</Text>
            <TextInput
              testID="bid-weight"
              style={bidStyles.input}
              placeholder="e.g. 5"
              placeholderTextColor={COLORS.textSubtle}
              keyboardType="decimal-pad"
              value={weight}
              onChangeText={setWeight}
            />

            <Text style={[bidStyles.fieldLabel, { marginTop: 14 }]}>CARGO TYPE</Text>
            <View style={bidStyles.cargoGrid}>
              {BID_CARGO_TYPES.map((ct) => {
                const active = cargoType === ct;
                return (
                  <TouchableOpacity
                    key={ct}
                    testID={`bid-cargo-${ct}`}
                    onPress={() => setCargoType(ct)}
                    style={[bidStyles.cargoPill, active && bidStyles.cargoPillOn]}
                    activeOpacity={0.85}
                  >
                    <Text style={[bidStyles.cargoPillText, active && bidStyles.cargoPillTextOn]}>{ct}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <TouchableOpacity
            testID="bid-submit"
            style={[bidStyles.submitBtn, submitting && { opacity: 0.6 }]}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? <ActivityIndicator color={COLORS.surface} /> : (
              <>
                <Ionicons name="cash-outline" size={18} color={COLORS.surface} />
                <Text style={bidStyles.submitBtnText}>{existingBid ? "Update Bid" : "Submit Bid"}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const bidStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, maxHeight: "92%" },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, letterSpacing: -0.2 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  input: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  cargoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cargoPill: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  cargoPillOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  cargoPillText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  cargoPillTextOn: { color: COLORS.surface, fontFamily: "Inter_700Bold", fontWeight: "700" },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 15, marginTop: 8 },
  submitBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.surface, letterSpacing: 0.2 },
});

// ============== BidsReceivedModal ==============
// Shown when the post owner taps "Bids Received" on one of their posts.
// Lists every bid placed on that listing with the bidder's contact + deviation.
function BidsReceivedModal({
  visible, listingId, viewerPhone, postRouteLabel, onClose,
}: {
  visible: boolean;
  listingId: string;
  viewerPhone: string;
  postRouteLabel: string;
  onClose: () => void;
}) {
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible || !listingId) return;
    setLoading(true);
    fetch(`${API}/bids/listing/${encodeURIComponent(listingId)}?viewer_phone=${encodeURIComponent(viewerPhone)}`)
      .then(r => r.json())
      .then((j) => { setBids(Array.isArray(j) ? j : []); })
      .catch(() => setBids([]))
      .finally(() => setLoading(false));
  }, [visible, listingId, viewerPhone]);

  const call = (phone: string) => {
    if (phone) Linking.openURL(`tel:${phone}`).catch(() => Alert.alert("Error", "Cannot open dialer"));
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={[styles.fill, { backgroundColor: COLORS.bg }]} edges={["top"]}>
        <View style={styles.fsHeader}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} testID="bids-received-back">
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.fsHeaderTitle}>Bids Received</Text>
          <View style={{ width: 32 }} />
        </View>
        {postRouteLabel ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted }}>
              {postRouteLabel}
            </Text>
          </View>
        ) : null}
        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 32 }} />
        ) : bids.length === 0 ? (
          <View style={styles.emptyWrap} testID="bids-received-empty">
            <Ionicons name="cash-outline" size={42} color={COLORS.textSubtle} />
            <Text style={styles.emptyTitle}>No bids yet</Text>
            <Text style={styles.emptySub}>You'll see offers from interested transporters here.</Text>
          </View>
        ) : (
          <FlatList
            testID="bids-received-list"
            data={bids}
            keyExtractor={(b) => b.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
            renderItem={({ item }) => (
              <View style={brStyles.card} testID={`bid-card-${item.id}`}>
                <View style={brStyles.headerRow}>
                  <View style={brStyles.avatar}>
                    <Text style={brStyles.avatarText}>
                      {(item.bidder_name || "?").split(" ").map(p => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={brStyles.bidderName}>{item.bidder_name || "Unknown"}</Text>
                    {item.bidder_company ? <Text style={brStyles.bidderCompany}>{item.bidder_company}</Text> : null}
                  </View>
                  <TouchableOpacity
                    style={brStyles.callBtn}
                    onPress={() => call(item.bidder_phone)}
                    testID={`bid-call-${item.bidder_phone}`}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="call" size={16} color={COLORS.surface} />
                    <Text style={brStyles.callBtnText}>Call</Text>
                  </TouchableOpacity>
                </View>

                <View style={brStyles.routeBlock}>
                  <View style={brStyles.routeRow}>
                    <Ionicons name="location" size={14} color={COLORS.secondary} />
                    <Text style={brStyles.routeText} numberOfLines={1}>
                      {[item.origin_locality, item.origin_city].filter(Boolean).join(", ") || "—"}
                      {item.origin_pincode ? ` · ${item.origin_pincode}` : ""}
                    </Text>
                  </View>
                  <View style={brStyles.routeRow}>
                    <Ionicons name="flag" size={14} color={COLORS.primary} />
                    <Text style={brStyles.routeText} numberOfLines={1}>
                      {[item.destination_locality, item.destination_city].filter(Boolean).join(", ") || "—"}
                      {item.destination_pincode ? ` · ${item.destination_pincode}` : ""}
                    </Text>
                  </View>
                </View>

                <View style={brStyles.metaRow}>
                  <View style={brStyles.metaChip}>
                    <Ionicons name="barbell-outline" size={13} color={COLORS.textMuted} />
                    <Text style={brStyles.metaText}>{item.weight_tons} T</Text>
                  </View>
                  <View style={brStyles.metaChip}>
                    <Ionicons name="cube-outline" size={13} color={COLORS.textMuted} />
                    <Text style={brStyles.metaText}>{item.cargo_type}</Text>
                  </View>
                </View>

                {(item.origin_deviation_km != null || item.destination_deviation_km != null) && (
                  <View style={brStyles.deviationBlock}>
                    <Ionicons name="git-network-outline" size={13} color={COLORS.secondary} />
                    <Text style={brStyles.deviationText}>
                      Deviation:
                      {item.origin_deviation_km != null ? ` origin ${item.origin_deviation_km} km` : ""}
                      {item.origin_deviation_km != null && item.destination_deviation_km != null ? " · " : ""}
                      {item.destination_deviation_km != null ? `dest ${item.destination_deviation_km} km` : ""}
                    </Text>
                  </View>
                )}
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const brStyles = StyleSheet.create({
  card: { backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#EEF2FA", alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.primary },
  bidderName: { fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text },
  bidderCompany: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  callBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: COLORS.success, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  callBtnText: { fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.surface },
  routeBlock: { backgroundColor: COLORS.bg, borderRadius: 10, padding: 10, gap: 6, marginBottom: 10 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, flex: 1 },
  metaRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: COLORS.bg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  metaText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  deviationBlock: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFF3EB", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  deviationText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.secondary, flex: 1 },
});


// ============== ListingDetailModal ==============
function ListingDetailModal({ visible, load, ptlGroup, viewerPhone, viewerName, contactName, onClose }: {
  visible: boolean; load?: Load | null; ptlGroup?: PtlGroup | null;
  viewerPhone: string; viewerName: string; contactName?: string; onClose: () => void;
}) {
  const bottomInset = useBottomInset();
  const [interestSent, setInterestSent] = useState(false);
  const [interestLoading, setInterestLoading] = useState(false);
  const [alreadyExpressed, setAlreadyExpressed] = useState(false);
  const [showImagesLocal, setShowImagesLocal] = useState(false);
  const [viewerStart, setViewerStart] = useState<number | null>(null);
  const [showBidForm, setShowBidForm] = useState(false);
  const [myBid, setMyBid] = useState<Bid | null>(null);
  const [showPtlPosterProfile, setShowPtlPosterProfile] = useState(false);

  // For bidding, we need the bid target = the post the user is looking at.
  // Truck Space → load.id  (listing_type "load")
  // Partial Load → the PTL load_id of the post's owner (not the group_id).
  //   FORMING groups have exactly 1 member = the poster; in market view the
  //   modal is opened with a single-member group, so members[0] is the poster.
  const ptlPosterMember = (ptlGroup?.members || []).find(m => !m.is_me) || (ptlGroup?.members || [])[0];
  const bidListingId = load?.id || ptlPosterMember?.load_id || "";
  const bidListingType: "load" | "ptl" = load ? "load" : "ptl";
  const listingId = load?.id || ptlGroup?.id || "";
  const listingType = load ? "load" : "ptl_group";
  const isMine = load ? load.poster_phone === viewerPhone : (ptlGroup?.members || []).some(m => m.phone === viewerPhone);

  useEffect(() => {
    if (!visible || !listingId || !viewerPhone || isMine) return;
    setInterestSent(false); setAlreadyExpressed(false); setMyBid(null);
    fetch(`${API}/interests/check?viewer_phone=${encodeURIComponent(viewerPhone)}&listing_id=${encodeURIComponent(listingId)}`)
      .then(r => r.json()).then(d => { if (d.expressed) setAlreadyExpressed(true); }).catch(() => {});
    // Has the viewer already bid on this post?
    if (bidListingId) {
      fetch(`${API}/bids/check?viewer_phone=${encodeURIComponent(viewerPhone)}&listing_id=${encodeURIComponent(bidListingId)}`)
        .then(r => r.json()).then(d => { if (d.bid_placed && d.bid) setMyBid(d.bid); }).catch(() => {});
    }
  }, [visible, listingId, bidListingId]);

  const sendInterest = async () => {
    if (interestSent || alreadyExpressed || isMine) return;
    setInterestLoading(true);
    try {
      const r = await fetch(`${API}/interests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewer_phone: viewerPhone, listing_id: listingId, listing_type: listingType }),
      });
      if (r.ok) { setInterestSent(true); Alert.alert("Interest Sent ✓", "The poster has been notified. They will reach out to you."); }
      else { const e = await r.json(); Alert.alert("Error", e.detail || "Could not send interest"); }
    } catch { Alert.alert("Error", "Network error — please try again"); }
    finally { setInterestLoading(false); }
  };

  const callPoster = () => {
    const phone = load?.poster_phone || (ptlGroup?.members?.[0]?.phone ?? "");
    if (phone) Linking.openURL(`tel:${phone}`).catch(() => Alert.alert("Error", "Cannot open dialer"));
  };

  const renderLoadDetail = (l: Load) => {
    const dateStr = (() => { try { return new Date(l.loading_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return l.loading_date; } })();
    const stO = sanitizeStateForDisplay(l.origin_state || "", l.origin_pincode || "");
    const cO = sanitizeCityForDisplay(l.origin_city || "", l.origin_pincode || "", stO);
    const stD = sanitizeStateForDisplay(l.destination_state || "", l.destination_pincode || "");
    const cD = sanitizeCityForDisplay(l.destination_city || "", l.destination_pincode || "", stD);
    const hasDim = l.dimension_length || l.dimension_breadth || l.dimension_height;
    const dimStr = hasDim ? `${l.dimension_length || "-"} × ${l.dimension_breadth || "-"} × ${l.dimension_height || "-"} ft` : null;
    const truckImg = TRUCK_TYPES.find(t => t.name === l.truck_type)?.image;
    const imageCount = l.image_count || 0;
    const hasInlineImages = l.images && l.images.length > 0;
    const viewerImages: string[] = hasInlineImages
      ? (l.images as string[])
      : imageCount > 0 ? Array.from({ length: imageCount }).map((_, i) => `${API}/loads/${l.id}/image/${i}`) : [];
    return (
      <>
        <View style={detailStyles.section}>
          <Text style={detailStyles.sectionTitle}>Route</Text>
          <View style={detailStyles.routeBlock}>
            <View style={detailStyles.routeRow}>
              <Ionicons name="location" size={16} color={COLORS.secondary} />
              <View style={{ flex: 1 }}>
                <Text style={detailStyles.routeLocality}>{l.origin_locality || cO}</Text>
                {cO && cO !== l.origin_locality ? <Text style={detailStyles.routeCity}>{cO}{stO ? `, ${stateAbbr(stO)}` : ""}</Text> : null}
                <Text style={detailStyles.routePin}>{l.origin_pincode}</Text>
              </View>
            </View>
            <View style={detailStyles.routeDividerLine} />
            <View style={detailStyles.routeRow}>
              <Ionicons name="flag" size={16} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={detailStyles.routeLocality}>{l.destination_locality || cD}</Text>
                {cD && cD !== l.destination_locality ? <Text style={detailStyles.routeCity}>{cD}{stD ? `, ${stateAbbr(stD)}` : ""}</Text> : null}
                <Text style={detailStyles.routePin}>{l.destination_pincode}</Text>
              </View>
            </View>
          </View>
        </View>
        <View style={detailStyles.section}>
          <Text style={detailStyles.sectionTitle}>Truck Details</Text>
          <DetailRow icon="calendar-outline" label="Loading Date" value={dateStr} />
          <DetailRow icon="barbell-outline" label="Weight" value={`${l.weight_tons} Tons free`} />
          {l.truck_type ? <DetailRow icon="car-outline" label="Truck Type" value={l.truck_type} truckImg={truckImg} /> : null}
          {dimStr ? <DetailRow icon="resize-outline" label="Dimensions (L×B×H)" value={dimStr} /> : null}
          {l.cargo_placement ? <DetailRow icon="layers-outline" label="Cargo Placement" value={l.cargo_placement} /> : null}
          {(l.cargo_types || []).filter(Boolean).length > 0 ? <DetailRow icon="cube-outline" label="Cargo Types" value={(l.cargo_types || []).map((c: string) => c.startsWith("Others:") ? c.slice(8).trim() : c).join(", ")} /> : null}
          {l.price_per_ton ? <DetailRow icon="pricetag-outline" label="Rate" value={`₹${l.price_per_ton} per Ton`} highlight /> : null}
        </View>
        {viewerImages.length > 0 && (
          <View style={detailStyles.section}>
            <Text style={detailStyles.sectionTitle}>Photos</Text>
            {showImagesLocal ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {viewerImages.slice(0, 6).map((src, i) => (
                  <TouchableOpacity key={i} onPress={() => setViewerStart(i)} activeOpacity={0.8}>
                    <Image source={{ uri: src }} style={{ width: 100, height: 100, borderRadius: 8 }} resizeMode="cover" />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <TouchableOpacity style={styles.showImagesBtn} onPress={() => setShowImagesLocal(true)}>
                <Ionicons name="images-outline" size={16} color={COLORS.primary} />
                <Text style={styles.showImagesBtnText}>Show Photos ({viewerImages.length})</Text>
              </TouchableOpacity>
            )}
            <ImageViewerModal visible={viewerStart !== null} images={viewerImages} initialIndex={viewerStart || 0} onClose={() => setViewerStart(null)} />
          </View>
        )}
        <View style={detailStyles.section}>
          <Text style={detailStyles.sectionTitle}>Posted By</Text>
          <View style={detailStyles.posterBlock}>
            <View style={detailStyles.avatarCircle}>
              <Text style={detailStyles.avatarText}>{(l.poster_name || "?").split(" ").map((p: string) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={detailStyles.posterName}>{l.poster_name}</Text>
                {l.verified && <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />}
              </View>
              {l.poster_company ? <Text style={detailStyles.posterCompany}>{l.poster_company}</Text> : null}
              {contactName ? <Text style={{ fontSize: 11, color: COLORS.primary, fontFamily: "Inter_500Medium", marginTop: 2 }}>Saved as "{contactName}"</Text> : null}
            </View>
            {!isMine && <TouchableOpacity style={styles.callBtn} onPress={callPoster}><Ionicons name="call" size={16} color={COLORS.surface} /><Text style={styles.callBtnText}>Call</Text></TouchableOpacity>}
          </View>
        </View>
      </>
    );
  };

  const renderPtlDetail = (g: PtlGroup) => {
    // Represent the group as a single listing: use the primary member's
    // (the poster who owns this card) own load details rather than
    // group-level aggregates like fill % or co-loader counts.
    const primary = (g.members || []).find(m => m.is_me) || (g.members || [])[0];
    const weightKg = primary?.weight_kg ?? g.total_weight_kg ?? 0;
    const cargoLabel = (primary?.cargo_type || (g.cargo_categories || []).join(", ") || "").replace(/^Others:\s*/, "");
    const dateStr = primary?.loading_date ? (() => { try { return new Date(primary.loading_date as string).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return primary.loading_date; } })() : null;
    const hasDim = primary?.dimension_length || primary?.dimension_breadth || primary?.dimension_height;
    const dimStr = hasDim ? `${primary?.dimension_length || "-"} × ${primary?.dimension_breadth || "-"} × ${primary?.dimension_height || "-"} ft` : null;
    const truckImg = TRUCK_TYPES.find(t => t.name === primary?.truck_type)?.image;
    const viewerImages: string[] = primary?.images && primary.images.length > 0 ? primary.images : [];
    return (
      <>
        <View style={detailStyles.section}>
          <Text style={detailStyles.sectionTitle}>Route</Text>
          <View style={detailStyles.routeBlock}>
            <View style={detailStyles.routeRow}>
              <Ionicons name="location" size={16} color={COLORS.secondary} />
              <View style={{ flex: 1 }}>
                <Text style={detailStyles.routeLocality}>{primary?.origin_locality || g.origin_display}</Text>
                {primary?.origin_city && primary.origin_city !== primary?.origin_locality ? <Text style={detailStyles.routeCity}>{primary.origin_city}{primary?.origin_state ? `, ${stateAbbr(primary.origin_state)}` : ""}</Text> : null}
                {primary?.origin_pincode ? <Text style={detailStyles.routePin}>{primary.origin_pincode}</Text> : null}
              </View>
            </View>
            <View style={detailStyles.routeDividerLine} />
            <View style={detailStyles.routeRow}>
              <Ionicons name="flag" size={16} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={detailStyles.routeLocality}>{primary?.destination_locality || g.destination_display}</Text>
                {primary?.destination_city && primary.destination_city !== primary?.destination_locality ? <Text style={detailStyles.routeCity}>{primary.destination_city}{primary?.destination_state ? `, ${stateAbbr(primary.destination_state)}` : ""}</Text> : null}
                {primary?.destination_pincode ? <Text style={detailStyles.routePin}>{primary.destination_pincode}</Text> : null}
              </View>
            </View>
          </View>
        </View>
        <View style={detailStyles.section}>
          <Text style={detailStyles.sectionTitle}>Load Details</Text>
          {dateStr ? <DetailRow icon="calendar-outline" label="Loading Date" value={dateStr} /> : null}
          <DetailRow icon="barbell-outline" label="Weight" value={`${(weightKg / 1000).toFixed(1)} Tons posted`} />
          {cargoLabel ? <DetailRow icon="cube-outline" label="Cargo Type" value={cargoLabel} /> : null}
          {primary?.truck_type ? <DetailRow icon="car-outline" label="Truck Type" value={primary.truck_type} truckImg={truckImg} /> : null}
          {dimStr ? <DetailRow icon="resize-outline" label="Dimensions (L×B×H)" value={dimStr} /> : null}
          {primary?.cargo_placement ? <DetailRow icon="layers-outline" label="Cargo Placement" value={primary.cargo_placement} /> : null}
        </View>
        {viewerImages.length > 0 && (
          <View style={detailStyles.section}>
            <Text style={detailStyles.sectionTitle}>Photos</Text>
            {showImagesLocal ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {viewerImages.slice(0, 6).map((src, i) => (
                  <TouchableOpacity key={i} onPress={() => setViewerStart(i)} activeOpacity={0.8}>
                    <Image source={{ uri: src }} style={{ width: 100, height: 100, borderRadius: 8 }} resizeMode="cover" />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <TouchableOpacity style={styles.showImagesBtn} onPress={() => setShowImagesLocal(true)}>
                <Ionicons name="images-outline" size={16} color={COLORS.primary} />
                <Text style={styles.showImagesBtnText}>Show Photos ({viewerImages.length})</Text>
              </TouchableOpacity>
            )}
            <ImageViewerModal visible={viewerStart !== null} images={viewerImages} initialIndex={viewerStart || 0} onClose={() => setViewerStart(null)} />
          </View>
        )}
        {primary && (
          <View style={detailStyles.section}>
            <Text style={detailStyles.sectionTitle}>Posted By</Text>
            <TouchableOpacity activeOpacity={isMine ? 1 : 0.8} onPress={() => !isMine && primary.phone && setShowPtlPosterProfile(true)}>
              <View style={detailStyles.posterBlock}>
                <View style={detailStyles.avatarCircle}><Text style={detailStyles.avatarText}>{(primary.name || "?").split(" ").map((p: string) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[detailStyles.posterName, !isMine && { color: COLORS.primary, textDecorationLine: "underline" }]}>{primary.name}</Text>
                    {isMine && <Text style={styles.youTag}>· You</Text>}
                  </View>
                  {primary.company ? <Text style={detailStyles.posterCompany}>{primary.company}</Text> : null}
                  {contactName ? <Text style={{ fontSize: 11, color: COLORS.primary, fontFamily: "Inter_500Medium", marginTop: 2 }}>Saved as "{contactName}"</Text> : null}
                </View>
                {!isMine && primary.phone && <TouchableOpacity style={styles.callBtn} onPress={callPoster}><Ionicons name="call" size={16} color={COLORS.surface} /><Text style={styles.callBtnText}>Call</Text></TouchableOpacity>}
              </View>
            </TouchableOpacity>
          </View>
        )}
      </>
    );
  };

  const interested = interestSent || alreadyExpressed;
  void interested; void sendInterest; void interestLoading;  // kept for future use; CTA replaced by Bid button

  const shareDetailOnWhatsApp = async () => {
    try {
      let text = "";
      if (load) {
        const oLocClean = (load.origin_locality || load.origin_city || "").trim();
        const dLocClean = (load.destination_locality || load.destination_city || "").trim();
        const dateShareStr = (() => { try { return new Date(load.loading_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return load.loading_date; } })();
        const shareUrl = loadSharePath(load);
        text =
          `🚛 *Truck Space Available - Truck Traffic*\n\n` +
          `📍 From: ${oLocClean}, ${load.origin_pincode}\n` +
          `📍 To: ${dLocClean}, ${load.destination_pincode}\n\n` +
          `🚚 ${load.truck_type || "Truck"}\n` +
          `⚖️ *Weight Free:* ${load.weight_tons} Tons\n` +
          `📅 *Loading:* ${dateShareStr}\n\n` +
          `📞 ${load.poster_name}${load.poster_company ? ` — ${load.poster_company}` : ""}\n` +
          `+91 ${load.poster_phone}\n\n` +
          `🔗 *More info:* ${shareUrl}\n` +
          `📲 *Playstore:* https://play.google.com/store/apps/details?id=com.ptlmarket.trucktraffic`;
      } else if (ptlGroup) {
        const primary = (ptlGroup.members || [])[0];
        const weightT = ((primary?.weight_kg ?? ptlGroup.total_weight_kg ?? 0) / 1000).toFixed(1);
        const cargo = (primary?.cargo_type || (ptlGroup.cargo_categories || []).join(", ") || "").replace(/^Others:\s*/, "");
        const loadingDateStr = primary?.loading_date
          ? (() => { try { return new Date(primary.loading_date as string).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return primary.loading_date as string; } })()
          : null;
        const contactLine = primary?.name
          ? `📞 *Contact:* ${primary.name}${primary.company ? ` — ${primary.company}` : ""}\n+91 ${primary.phone || ""}`
          : "";
        text =
          `📦 *Partial Load Looking to Combine - Truck Traffic*\n\n` +
          `📍 Route: ${ptlGroup.origin_display} → ${ptlGroup.destination_display}\n\n` +
          `A partial load is available on this route and is looking for another load to combine and fill a truck together.\n\n` +
          `⚖️ *Weight:* ${weightT} T\n` +
          (cargo ? `📦 *Cargo:* ${cargo}\n` : "") +
          (loadingDateStr ? `📅 *Loading Date:* ${loadingDateStr}\n` : "") +
          `\n${contactLine}\n\n` +
          `🔗 *More info:* https://www.trucktraffic.in/a/${ptlGroup.id}\n` +
          `📲 *Playstore:* https://play.google.com/store/apps/details?id=com.ptlmarket.trucktraffic`;
      }
      await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`);
    } catch { Alert.alert("Error", "WhatsApp could not be opened."); }
  };

  const ptlPosterForModal = (() => {
    if (!ptlGroup) return null;
    const primary = (ptlGroup.members || []).find(m => !m.is_me) || (ptlGroup.members || [])[0];
    if (!primary) return null;
    return {
      id: ptlGroup.id, origin_pincode: primary.origin_pincode || "", origin_locality: primary.origin_locality || "",
      origin_city: primary.origin_city || "", origin_state: "", destination_pincode: primary.destination_pincode || "",
      destination_locality: primary.destination_locality || "", destination_city: primary.destination_city || "",
      destination_state: "", cargo_types: primary.cargo_type ? [primary.cargo_type] : [],
      cargo_placement: "", weight_tons: (primary.weight_kg || 0) / 1000, space_cuft: null,
      loading_date: primary.loading_date || ptlGroup.created_at, poster_name: primary.name || "Shipper",
      poster_phone: primary.phone || "", poster_company: primary.company || "", created_at: ptlGroup.created_at,
    } as unknown as Load;
  })();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={[styles.fill, { backgroundColor: COLORS.bg }]} edges={["top"]}>
        <View style={styles.fsHeader}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></TouchableOpacity>
          <Text style={styles.fsHeaderTitle}>{load ? "Truck Space Detail" : "Partial Load Detail"}</Text>
          <TouchableOpacity onPress={shareDetailOnWhatsApp} style={[styles.iconBtn, { flexDirection: "row", gap: 4, alignItems: "center" }]} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 + bottomInset }} showsVerticalScrollIndicator={false}>
          {load ? renderLoadDetail(load) : ptlGroup ? renderPtlDetail(ptlGroup) : null}
        </ScrollView>
        {!isMine && (
          <View style={[detailStyles.ctaBar, { paddingBottom: bottomInset + 12 }]}>
            <TouchableOpacity
              testID="open-bid-form"
              style={[detailStyles.bidBtn, !!myBid && detailStyles.bidBtnDone]}
              onPress={() => setShowBidForm(true)}
              activeOpacity={0.85}
            >
              <Ionicons name={myBid ? "checkmark-circle" : "cash-outline"} size={20} color={COLORS.surface} />
              <Text style={detailStyles.bidBtnText}>{myBid ? "Bid Placed · Edit" : "Bid"}</Text>
            </TouchableOpacity>
          </View>
        )}
        {!isMine && bidListingId ? (
          <BidFormModal
            visible={showBidForm}
            listingId={bidListingId}
            listingType={bidListingType}
            viewerPhone={viewerPhone}
            existingBid={myBid}
            onClose={() => setShowBidForm(false)}
            onSubmitted={() => {
              setShowBidForm(false);
              fetch(`${API}/bids/check?viewer_phone=${encodeURIComponent(viewerPhone)}&listing_id=${encodeURIComponent(bidListingId)}`)
                .then(r => r.json()).then(d => { if (d.bid_placed && d.bid) setMyBid(d.bid); }).catch(() => {});
            }}
          />
        ) : null}
        {ptlPosterForModal && showPtlPosterProfile && (
          <PosterProfileModal
            visible={showPtlPosterProfile}
            load={ptlPosterForModal}
            viewerPhone={viewerPhone}
            onClose={() => setShowPtlPosterProfile(false)}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

function DetailRow({ icon, label, value, highlight, truckImg }: { icon: any; label: string; value: string; highlight?: boolean; truckImg?: any }) {
  return (
    <View style={detailStyles.detailRow}>
      <Ionicons name={icon} size={15} color={COLORS.textMuted} style={{ marginTop: 1 }} />
      <Text style={detailStyles.detailLabel}>{label}</Text>
      <View style={{ flex: 1, alignItems: "flex-end", flexDirection: "row", justifyContent: "flex-end", gap: 6 }}>
        {truckImg ? <Image source={truckImg} style={{ width: 28, height: 18 }} resizeMode="contain" /> : null}
        <Text style={[detailStyles.detailValue, highlight && { color: COLORS.success, fontFamily: "Inter_700Bold" }]}>{value}</Text>
      </View>
    </View>
  );
}

const detailStyles = StyleSheet.create({
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },
  routeBlock: { backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 14 },
  routeRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  routeDividerLine: { width: 1, height: 16, backgroundColor: COLORS.border, marginLeft: 7, marginVertical: 4 },
  routeLocality: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text },
  routeCity: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted, marginTop: 1 },
  routePin: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textSubtle, marginTop: 1 },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.bgMuted },
  detailLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted, flex: 1 },
  detailValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, textAlign: "right", flexShrink: 1 },
  posterBlock: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 14 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.bgMuted, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.primary },
  posterName: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text },
  posterCompany: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.bgMuted },
  fillLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  ctaBar: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border, padding: 16, flexDirection: "row", gap: 10 },
  interestedBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14 },
  interestedBtnDone: { backgroundColor: COLORS.success },
  interestedBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.surface },
  bidBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14 },
  bidBtnDone: { backgroundColor: COLORS.success },
  bidBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.surface, letterSpacing: 0.3 },
  callBarBtn: { width: 52, height: 52, borderRadius: 12, backgroundColor: COLORS.bgMuted, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border },
});

// ============== FindPtlModal ==============
function FindPtlModal({ visible, initial, onClose, onApply }: {
  visible: boolean;
  initial: { originCity: string; destCity: string; weightKg: number } | null;
  onClose: () => void;
  onApply: (f: { originCity: string; destCity: string; weightKg: number }) => void;
}) {
  const [originText, setOriginText] = useState("");
  const [originPin, setOriginPin] = useState("");
  const [originInfo, setOriginInfo] = useState<RouteInfo>(null);
  const [destText, setDestText] = useState("");
  const [destPin, setDestPin] = useState("");
  const [destInfo, setDestInfo] = useState<RouteInfo>(null);
  const [weightKg, setWeightKg] = useState("");

  useEffect(() => {
    if (visible) {
      setOriginText(initial?.originCity || ""); setOriginPin(""); setOriginInfo(null);
      setDestText(initial?.destCity || ""); setDestPin(""); setDestInfo(null);
      setWeightKg(initial?.weightKg ? String(initial.weightKg) : "");
    }
  }, [visible]);

  const submit = () => {
    const oCity = originInfo?.city || originText.trim();
    const dCity = destInfo?.city || destText.trim();
    if (!oCity) { Alert.alert("Required", "Enter an origin city"); return; }
    if (!dCity) { Alert.alert("Required", "Enter a destination city"); return; }
    const w = parseFloat(weightKg);
    if (!w || w <= 0) { Alert.alert("Required", "Enter your cargo weight in kg"); return; }
    onApply({ originCity: oCity, destCity: dCity, weightKg: w });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={[styles.fill, { backgroundColor: COLORS.bg }]} edges={["top"]}>
        <View style={styles.fsHeader}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></TouchableOpacity>
          <Text style={styles.fsHeaderTitle}>Filter Partial Loads</Text>
          <View style={{ width: 32 }} />
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.fill}>
          <SafeScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Text style={[styles.modalSubtitle, { marginBottom: 16 }]}>Find groups that match your route and have space for your cargo.</Text>
            <SectionTitle icon="navigate-outline" title="Route" />
            <View style={styles.routeInputsRow}>
              <SmartRouteInput label="Origin" testIDPrefix="ptl-filter-origin" text={originText} pin={originPin} info={originInfo} onChange={(t, p, i) => { setOriginText(t); setOriginPin(p); setOriginInfo(i); }} />
              <View style={styles.routeArrowMid}><Ionicons name="arrow-forward" size={20} color={COLORS.secondary} /></View>
              <SmartRouteInput label="Destination" testIDPrefix="ptl-filter-dest" text={destText} pin={destPin} info={destInfo} onChange={(t, p, i) => { setDestText(t); setDestPin(p); setDestInfo(i); }} />
            </View>
            <Field label="My Cargo Weight (kg)">
              <TextInput style={[styles.input, weightKg && styles.filledBorder]} placeholder="e.g., 3500" placeholderTextColor={COLORS.textSubtle} value={weightKg} onChangeText={(t) => setWeightKg(t.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" />
            </Field>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.outlineBtn, styles.flex1]} onPress={onClose}><Text style={styles.outlineBtnText}>Cancel</Text></TouchableOpacity>
              <View style={{ width: 12 }} />
              <TouchableOpacity style={[styles.primaryBtn, styles.flex1, { marginTop: 0 }]} onPress={submit}><Text style={styles.primaryBtnText}>Show Matching Groups</Text></TouchableOpacity>
            </View>
          </SafeScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const notifStyles = StyleSheet.create({
  card: { flexDirection: "row", gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.bgMuted, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, marginBottom: 3 },
  body: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, lineHeight: 17 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  actionBtnText: { fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.surface },
});

// ============== PosterProfileModal ==============
function PosterProfileModal({ visible, load, contactName, contactsMap, viewerPhone, onClose }: {
  visible: boolean;
  load: Load;
  contactName?: string;
  contactsMap?: Map<string, string>;
  viewerPhone?: string;
  onClose: () => void;
}) {
  const [posterLoads, setPosterLoads] = useState<Load[]>([]);
  const [posterPtlLoads, setPosterPtlLoads] = useState<PtlLoad[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutualContacts, setMutualContacts] = useState<string[]>([]);
  const [showMutuals, setShowMutuals] = useState(false);

  // Keep a ref to contactsMap so the fetch effect can read it without
  // listing it as a dependency (Map reference changes every render).
  const contactsMapRef = useRef(contactsMap);
  contactsMapRef.current = contactsMap;   // assign directly — no useEffect needed

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setPosterLoads([]);
    setPosterPtlLoads([]);
    setMutualContacts([]);
    setShowMutuals(false);
    (async () => {
      try {
        // Poster's loads — still need to fetch these
        const loadsRes = await fetch(`${API}/loads`);
        const all: Load[] = await loadsRes.json();
        const posterPosts = all.filter(l => l.poster_phone === load.poster_phone);
        setPosterLoads(posterPosts);

        try {
          const ptlRes = await fetch(`${API}/ptl/loads/my/${encodeURIComponent(load.poster_phone)}`);
          const ptlAll = await ptlRes.json();
          setPosterPtlLoads(Array.isArray(ptlAll) ? ptlAll.filter((l: PtlLoad) => l.status !== "CANCELLED") : []);
        } catch {}

        // Mutual contacts: fetch on demand when profile is opened
        let mutualPhones: string[] = [];
        if (viewerPhone) {
          try {
            const mutualsRes = await fetch(
              `${API}/users/${encodeURIComponent(viewerPhone)}/mutuals/${encodeURIComponent(load.poster_phone)}`
            );
            if (mutualsRes.ok) {
              const mutualsData = await mutualsRes.json();
              mutualPhones = mutualsData.mutual_phones || [];
            }
          } catch {}
        }

        // Resolve phone numbers → display names via viewer's local phonebook
        const mutualNames: string[] = [];
        for (const phone of mutualPhones) {
          const name = contactsMapRef.current?.get(phone);
          if (name) mutualNames.push(name);
        }
        setMutualContacts(mutualNames.slice(0, 5));
      } catch {} finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, load.poster_phone, viewerPhone]);

  const initials = load.poster_name.split(" ").map((p: string) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const isDirectContact = !!contactName;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.fill, { backgroundColor: COLORS.bg }]} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Poster Profile</Text>
          <View style={{ width: 40 }} />
        </View>
        <SafeScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {/* Profile card */}
          <View style={styles.profileCard}>
            <View style={styles.avatarBig}>
              <Text style={styles.avatarBigText}>{initials || "?"}</Text>
            </View>
            <Text style={styles.profileCardName}>{load.poster_name}</Text>
            {load.poster_company ? <Text style={styles.profileCardCompany}>{load.poster_company}</Text> : null}
            <View style={styles.profilePhoneRow}>
              <Ionicons name="call-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.profileCardPhone}>+91 {load.poster_phone}</Text>
            </View>

            {/* Contact relationship badges */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10, justifyContent: "center" }}>
              {load.verified && (
                <View style={[posterProfileStyles.badge, { backgroundColor: "#E6F9F0", borderWidth: 1, borderColor: COLORS.success }]}>
                  <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                  <Text style={{ fontSize: 11, color: COLORS.success, fontFamily: "Inter_700Bold", fontWeight: "700" }}>Verified Transporter</Text>
                </View>
              )}
              {isDirectContact ? (
                <View style={[posterProfileStyles.badge, posterProfileStyles.directBadge]}>
                  <Ionicons name="person-circle" size={14} color={COLORS.primary} />
                  <Text style={posterProfileStyles.directBadgeText}>In your contacts as "{contactName}"</Text>
                </View>
              ) : (
                <View style={[posterProfileStyles.badge, posterProfileStyles.unknownBadge]}>
                  <Ionicons name="person-outline" size={14} color={COLORS.textMuted} />
                  <Text style={posterProfileStyles.unknownBadgeText}>Not in your contacts</Text>
                </View>
              )}
            </View>

            {/* Mutual contacts — tappable count, expands to show names */}
            {!loading && mutualContacts.length > 0 && (
              <View style={{ marginTop: 10, alignItems: "center" }}>
                <TouchableOpacity
                  onPress={() => setShowMutuals(v => !v)}
                  activeOpacity={0.75}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 6,
                    backgroundColor: "#E8F8EE", borderRadius: 100,
                    paddingVertical: 5, paddingHorizontal: 12,
                    borderWidth: 1, borderColor: "#25D366",
                  }}
                >
                  <Ionicons name="people" size={14} color="#0F6B36" />
                  <Text style={{ fontSize: 12, color: "#0F6B36", fontFamily: "Inter_700Bold", fontWeight: "700" }}>
                    {mutualContacts.length} mutual contact{mutualContacts.length > 1 ? "s" : ""} in common
                  </Text>
                  <Ionicons name={showMutuals ? "chevron-up" : "chevron-down"} size={13} color="#0F6B36" />
                </TouchableOpacity>
                {showMutuals && (
                  <View style={{ marginTop: 8, width: "100%", gap: 4 }}>
                    <Text style={{ fontSize: 11, color: COLORS.textMuted, textAlign: "center", marginBottom: 2, fontFamily: "Inter_500Medium" }}>
                      Contacts saved in your phone who also know this person:
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
                      {mutualContacts.map((name, i) => (
                        <View key={i} style={[posterProfileStyles.badge, posterProfileStyles.mutualBadge]}>
                          <Ionicons name="person" size={11} color="#0F6B36" />
                          <Text style={posterProfileStyles.mutualBadgeText}>{name}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}
            {/* For direct contacts with no mutuals found — poster likely on older app version */}
            {!loading && mutualContacts.length === 0 && isDirectContact && (
              <View style={{ marginTop: 8, alignItems: "center", paddingHorizontal: 16 }}>
                <Text style={{ fontSize: 11, color: COLORS.textSubtle, fontStyle: "italic", textAlign: "center" }}>
                  No mutual contacts found — this person may be using an older version of the app.
                </Text>
              </View>
            )}
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={[styles.statBox, profileStyles.statBoxOutline, { borderColor: COLORS.primary }]}>
              <Text style={[styles.statValue, { color: COLORS.primary }]}>{posterLoads.length}</Text>
              <Text style={styles.statLabel}>Truck Space</Text>
            </View>
            <View style={[styles.statBox, profileStyles.statBoxOutline, { borderColor: COLORS.secondary }]}>
              <Text style={[styles.statValue, { color: COLORS.secondary }]}>{posterPtlLoads.length}</Text>
              <Text style={styles.statLabel}>Adjustment Loads</Text>
            </View>
          </View>

          {/* Action buttons removed per UX feedback */}

          {/* Truck space postings */}
          <Text style={styles.sectionHeading}>Truck Space Postings</Text>
          {loading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginTop: 24 }} />
          ) : posterLoads.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="cube-outline" size={36} color={COLORS.textSubtle} />
              <Text style={styles.emptyTitle}>No loads posted</Text>
            </View>
          ) : (
            posterLoads.map(l => <LoadCard key={l.id} load={l} isMine={false} contactName={contactName} />)
          )}

          {/* Adjustment (partial load) postings */}
          {!loading && posterPtlLoads.length > 0 && (
            <>
              <Text style={[styles.sectionHeading, { marginTop: 8 }]}>Adjustment Postings</Text>
              {posterPtlLoads.map(item => (
                <PtlGroupCard
                  key={item.id}
                  group={ptlLoadToGroup(item, load.poster_name)}
                  profile={{ name: "", phone: viewerPhone || "", company: "" }}
                  contactsMap={contactsMap}
                  onPress={() => {}}
                />
              ))}
            </>
          )}
        </SafeScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const posterProfileStyles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 100 },
  directBadge: { backgroundColor: "#EEF2FA", borderWidth: 1, borderColor: COLORS.primary },
  directBadgeText: { fontSize: 11, color: COLORS.primary, fontFamily: "Inter_700Bold", fontWeight: "700" },
  unknownBadge: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border },
  unknownBadgeText: { fontSize: 11, color: COLORS.textMuted, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  mutualBadge: { backgroundColor: "#E8F8EE", borderWidth: 1, borderColor: "#25D366" },
  mutualBadgeText: { fontSize: 11, color: "#0F6B36", fontFamily: "Inter_700Bold", fontWeight: "700" },
});

const cargoStyles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 4,
    paddingBottom: 4,
  },
  tile: {
    width: "30%",
    aspectRatio: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    position: "relative",
  },
  tileSelected: {
    backgroundColor: "#EEF2FA",
    borderColor: COLORS.primary,
  },
  tileImage: {
    width: 52,
    height: 52,
    marginBottom: 4,
  },
  tileLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: COLORS.textMuted,
    textAlign: "center",
  },
  tileLabelSelected: {
    color: COLORS.primary,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
  },
  checkDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  otherInputWrap: {
    marginTop: 10,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.bg,
  },
  otherInput: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.text,
    minHeight: 36,
  },
});

const cardStyles = StyleSheet.create({
  routeEndpoint: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  routeLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.text },
  routePinCity: { fontSize: 14, lineHeight: 18, color: COLORS.text },
  routePin: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "800", color: COLORS.text },
  routeComma: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text },
  routeCity: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "800", color: COLORS.text },
  routeState: { fontSize: 10, color: COLORS.textMuted, fontStyle: "italic", marginTop: 1 },
  // Standardized 3-line route display (used by both endpoints).
  // L1 (locality) > L2 (city, ST) > L3 (pincode).
  routeL1: { fontSize: 16, lineHeight: 19, color: COLORS.text, fontFamily: "Inter_700Bold", fontWeight: "800" },
  routeL2: { fontSize: 13, lineHeight: 16, color: COLORS.text, fontFamily: "Inter_600SemiBold", fontWeight: "700", marginTop: 1 },
  routeL3: { fontSize: 11, lineHeight: 14, color: COLORS.textMuted, fontFamily: "Inter_600SemiBold", fontWeight: "600", letterSpacing: 0.4, marginTop: 1 },
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
  shareTopPill: {
    // Sits directly beneath typeBadgeAbs in the same top-right column
    // (badge top 10 + ~21px badge height + 6px gap).
    position: "absolute",
    top: 37,
    right: 10,
    zIndex: 5,
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "#25D366",
    backgroundColor: "#E8F8EE",
  },
  shareTopPillText: { color: "#0F6B36", fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 11, letterSpacing: 0.2 },
  posterNameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  savedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 100,
    backgroundColor: "#EEF2FA",
    borderWidth: 1,
    borderColor: COLORS.primary,
    maxWidth: 160,
  },
  savedBadgeText: { fontSize: 10, color: COLORS.primary, fontFamily: "Inter_700Bold", fontWeight: "700", letterSpacing: 0.2 },
  mutualBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 100,
    backgroundColor: "#E8F8EE",
    borderWidth: 1,
    borderColor: "#25D366",
    maxWidth: 200,
    marginTop: 2,
  },
  mutualBadgeText: { fontSize: 10, color: "#0F6B36", fontFamily: "Inter_700Bold", fontWeight: "700", letterSpacing: 0.2 },
  noPhotos: { fontSize: 11, color: COLORS.textSubtle, fontStyle: "italic" },
  contactSection: { flex: 1 },
  verifiedBadge: { flexDirection: "row", alignItems: "center" },
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
  const [originErr, setOriginErr] = useState("");
  const [destErr, setDestErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setOriginPin(initial?.origin || ""); setOriginText(initial?.origin || ""); setOriginInfo(null);
      setDestPin(initial?.dest || ""); setDestText(initial?.dest || ""); setDestInfo(null);
      setOriginErr(""); setDestErr("");
    }
  }, [visible, initial]);

  const submit = async () => {
   
	  
	  setOriginErr("");
setDestErr("");

const originValid =
  /^\d{6}$/.test(originPin) ||
  (
    originInfo?.valid &&
    (
      (originInfo?.latitude != null && originInfo?.longitude != null) ||
      !!(originInfo?.city || originInfo?.locality || originInfo?.placeName)
    )
  );

const destValid =
  /^\d{6}$/.test(destPin) ||
  (
    destInfo?.valid &&
    (
      (destInfo?.latitude != null && destInfo?.longitude != null) ||
      !!(destInfo?.city || destInfo?.locality || destInfo?.placeName)
    )
  );

if (!originValid) {
  setOriginErr("Select a valid origin from the list");
  return;
}

if (!destValid) {
  setDestErr("Select a valid destination from the list");
  return;
}
    
	  
    setBusy(true);
    try {
      
		
		let oc;
let dc;

if (
  originInfo?.latitude != null &&
  originInfo?.longitude != null
) {
  oc = {
    lat: originInfo.latitude,
    lon: originInfo.longitude,
    found: true,
  };
} else if (/^\d{6}$/.test(originPin)) {
  oc = await geocodePin(originPin);
} else if (originInfo?.eLoc) {
  oc = await geocodeEloc(originInfo.eLoc, originInfo.placeName || originInfo.city || "", originInfo.fullAddress || "");
} else {
  setOriginErr("Location coordinates unavailable. Please select a different origin.");
  return;
}

if (
  destInfo?.latitude != null &&
  destInfo?.longitude != null
) {
  dc = {
    lat: destInfo.latitude,
    lon: destInfo.longitude,
    found: true,
  };
} else if (/^\d{6}$/.test(destPin)) {
  dc = await geocodePin(destPin);
} else if (destInfo?.eLoc) {
  dc = await geocodeEloc(destInfo.eLoc, destInfo.placeName || destInfo.city || "", destInfo.fullAddress || "");
} else {
  setDestErr("Location coordinates unavailable. Please select a different destination.");
  return;
}

if (!oc.found) {
  setOriginErr("Location could not be resolved.");
  return;
}

if (!dc.found) {
  setDestErr("Location could not be resolved.");
  return;
}
		
      await onApply({ origin: originPin, dest: destPin, originCity: originInfo?.city || originInfo?.locality || originInfo?.placeName || "", destCity: destInfo?.city || destInfo?.locality || destInfo?.placeName || "", weightKg: 0, volumeCuft: null, originCoord: { lat: oc.lat, lon: oc.lon }, destCoord: { lat: dc.lat, lon: dc.lon } });
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
          <SafeScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalSubtitle}>Enter your cargo details to find matching truck space and partial loads within 30 km of your route.</Text>

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

            <View style={styles.row}>
              <TouchableOpacity testID="fs-apply-btn" style={[styles.primaryBtn, styles.flex1, { marginTop: 0 }]} onPress={submit} disabled={busy}>
                {busy ? <ActivityIndicator color={COLORS.surface} /> : (
                  <>
                    <Ionicons name="search" size={18} color={COLORS.surface} />
                    <Text style={styles.primaryBtnText}>Find Results</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </SafeScrollView>
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

// ==========================================================================
// ============== PTL (Partial Truck Load) Components ==============
// ==========================================================================

function PtlGroupCard({ group, profile, onPress, contactsMap }: { group: PtlGroup; profile: Profile; onPress: () => void; contactsMap?: Map<string, string> }) {
  const member = (group.members || [])[0];
  const isMine = !!member?.is_me || (group.members || []).some(m => !!m.phone && m.phone === profile.phone);
  const [showPosterProfile, setShowPosterProfile] = useState(false);

  const shareOnWhatsApp = async () => {
    const primary = member;
    const weightT = ((primary?.weight_kg ?? group.total_weight_kg ?? 0) / 1000).toFixed(1);
    const cargo = (primary?.cargo_type || (group.cargo_categories || []).join(", ") || "").replace(/^Others:\s*/, "");
    const loadingDateStr = primary?.loading_date
      ? (() => { try { return new Date(primary.loading_date as string).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return primary.loading_date as string; } })()
      : null;
    const contactLine = primary?.name
      ? `📞 *Contact:* ${primary.name}${primary.company ? ` — ${primary.company}` : ""}\n+91 ${primary.phone || ""}`
      : "";
    const text =
      `📦 *Partial Load Looking to Combine - Truck Traffic*\n\n` +
      `📍 Route: ${group.origin_display} → ${group.destination_display}\n\n` +
      `A partial load is available on this route and is looking for another load to combine and fill a truck together.\n\n` +
      `⚖️ *Weight:* ${weightT} T\n` +
      (cargo ? `📦 *Cargo:* ${cargo}\n` : "") +
      (loadingDateStr ? `📅 *Loading Date:* ${loadingDateStr}\n` : "") +
      `\n${contactLine}\n\n` +
      `🔗 *More info:* https://www.trucktraffic.in/a/${group.id}\n` +
      `📲 *Playstore:* https://play.google.com/store/apps/details?id=com.ptlmarket.trucktraffic`;
    try { await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`); }
    catch { Alert.alert("Error", "WhatsApp could not be opened."); }
  };

  const dateStr = useMemo(() => {
    try { return new Date(group.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return group.created_at; }
  }, [group.created_at]);

  const cargoLabel = (member?.cargo_type || (group.cargo_categories || []).join(", ") || "").replace(/^Others:\s*/, "");

  // Adapter: PosterProfileModal expects a `Load`-shaped object. PTL members
  // aren't truck-space loads, so we build a minimal stand-in carrying only
  // the fields the modal actually reads (poster name/phone/company); the
  // rest are harmless placeholders since the modal never touches them.
  const posterAsLoad = member ? ({
    id: group.id,
    origin_pincode: "", origin_locality: group.origin_display, origin_city: "", origin_state: "",
    destination_pincode: "", destination_locality: group.destination_display, destination_city: "", destination_state: "",
    cargo_types: group.cargo_categories || [], cargo_placement: "", weight_tons: (group.total_weight_kg || 0) / 1000,
    space_cuft: null, loading_date: group.created_at,
    poster_name: member.name || "Shipper", poster_phone: member.phone || "", poster_company: member.company || "",
    created_at: group.created_at,
  } as unknown as Load) : null;

  return (
    <TouchableOpacity testID={`ptl-group-card-${group.id}`} onPress={onPress} activeOpacity={0.92} style={[styles.card, marketCardStyles.cardOutline]}>
      {/* At-a-glance type badge, pinned top-right. Orange = Partial Load,
          matching the card's border color and the app's Adjustment Load
          theme elsewhere. Share pill sits directly below it, same
          right-hand column as LoadCard, so the badge no longer eats its
          own full-width row (keeps the card shorter). */}
      <View style={[marketCardStyles.typeBadgeAbs, marketCardStyles.typeBadgePtl]}>
        <Ionicons name="cube-outline" size={10} color={COLORS.surface} />
        <Text style={marketCardStyles.typeBadgeText}>PARTIAL LOAD</Text>
      </View>
      {/* Share pill — below the badge, top right, same column as LoadCard */}
      <TouchableOpacity style={cardStyles.shareTopPill} onPress={shareOnWhatsApp} activeOpacity={0.85} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="share-social" size={14} color="#25D366" />
      </TouchableOpacity>

      {/* LINE 1: Route — origin / destination stacked, same layout as Find Truck card */}
      <View style={[styles.cardRouteRow, { paddingRight: 84 }]}>
        <View style={styles.flex1}>
          <RouteEndpointBlock
            iconName="location" iconColor={COLORS.secondary}
            locality={member?.origin_locality || group.origin_display || ""}
            city={member?.origin_city || ""}
            state={member?.origin_state || ""}
            pincode={member?.origin_pincode || ""}
          />
          <View style={{ height: 8 }} />
          <RouteEndpointBlock
            iconName="flag" iconColor={COLORS.primary}
            locality={member?.destination_locality || group.destination_display || ""}
            city={member?.destination_city || ""}
            state={member?.destination_state || ""}
            pincode={member?.destination_pincode || ""}
          />
        </View>
      </View>

      <View style={styles.divider} />

      {/* LINE 2: Loading date · Weight posted · Cargo type — matching Find Truck card's meta line */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cardStyles.metaScrollContent}>
        <View style={cardStyles.metaChip}>
          <Ionicons name="calendar-outline" size={12} color={COLORS.textMuted} />
          <Text style={cardStyles.metaText}>{dateStr}</Text>
        </View>
        <View style={cardStyles.metaChip}>
          <Ionicons name="barbell-outline" size={12} color={COLORS.textMuted} />
          <Text style={cardStyles.metaText}>{((group.total_weight_kg || 0) / 1000).toFixed(1)}T posted</Text>
        </View>
        {cargoLabel ? (
          <View style={cardStyles.metaChip}>
            <Ionicons name="cube-outline" size={12} color={COLORS.textMuted} />
            <Text style={cardStyles.metaText}>{cargoLabel}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.divider} />

      {/* LINE 3: Poster (tappable → profile) + call, same as Find Truck card */}
      {member && (
        <View style={cardStyles.line3Row}>
          <View style={cardStyles.contactSection}>
            <View style={cardStyles.posterNameRow}>
              <TouchableOpacity onPress={() => !isMine && member.phone && setShowPosterProfile(true)} activeOpacity={isMine ? 1 : 0.7}>
                <Text style={[styles.posterName, !isMine && { color: COLORS.primary, textDecorationLine: "underline" }]} numberOfLines={1}>
                  {member.name || "Shipper"}{isMine ? <Text style={styles.youTag}> · You</Text> : ""}
                </Text>
              </TouchableOpacity>
              {!isMine && member.phone && contactsMap?.get(member.phone) ? (
                <View style={cardStyles.savedBadge} testID={`ptl-contact-saved-${group.id}`}>
                  <Ionicons name="person" size={10} color={COLORS.primary} />
                  <Text style={cardStyles.savedBadgeText} numberOfLines={1}>{`Saved · ${contactsMap.get(member.phone)}`}</Text>
                </View>
              ) : null}
            </View>
            {member.company ? <Text style={styles.posterCompany} numberOfLines={1}>{member.company}</Text> : null}
          </View>
          {!isMine && member.phone ? (
            <TouchableOpacity testID={`ptl-call-btn-${group.id}`} style={[styles.callBtn, { alignSelf: "center" }]} onPress={() => Linking.openURL(`tel:${member.phone}`).catch(() => {})}>
              <Ionicons name="call" size={16} color={COLORS.surface} />
              <Text style={styles.callBtnText}>Call</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {posterAsLoad && showPosterProfile && !isMine && (
        <PosterProfileModal
          visible={showPosterProfile}
          load={posterAsLoad}
          viewerPhone={profile.phone}
          onClose={() => setShowPosterProfile(false)}
        />
      )}
    </TouchableOpacity>
  );
}

const marketCardStyles = StyleSheet.create({
  cardOutline: { borderColor: COLORS.secondary, borderWidth: 1.5 },
  truckCardOutline: { borderColor: COLORS.primary, borderWidth: 1.5 },
  typeBadge: {
    position: "absolute",
    top: -1,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    zIndex: 2,
  },
  typeBadgeInline: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 10,
  },
  // Pinned top-right, sharing the same corner "column" as shareTopPill
  // (which sits directly below it). Keeping the badge out of normal flow
  // removes what used to be its own full-width row, so cards are shorter.
  typeBadgeAbs: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeBadgeTruck: { backgroundColor: COLORS.primary },
  typeBadgePtl: { backgroundColor: COLORS.secondary },
  typeBadgeText: { fontSize: 9, fontWeight: "800", color: COLORS.surface, letterSpacing: 0.3 },
});

function PostPtlModal({ visible, profile, onClose, onPosted, prefillRoute, editLoad }: {
  visible: boolean;
  profile: Profile;
  onClose: () => void;
  onPosted: (resp: { load_id: string; group_id: string | null }) => void;
  prefillRoute?: { origin?: { locality: string; city: string; pincode: string; latitude?: number | null; longitude?: number | null }; dest?: { locality: string; city: string; pincode: string; latitude?: number | null; longitude?: number | null } };
  editLoad?: PtlLoad | null;
}) {
  const [originText, setOriginText] = useState("");
  const [originPin, setOriginPin] = useState("");
  const [originInfo, setOriginInfo] = useState<any>(null);
  const [destText, setDestText] = useState("");
  const [destPin, setDestPin] = useState("");
  const [destInfo, setDestInfo] = useState<any>(null);
  const [cargoType, setCargoType] = useState("Bags");
  const [cargoCategory, setCargoCategory] = useState("GENERAL");
  const [weightKg, setWeightKg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && editLoad) {
      setOriginText(editLoad.origin_locality || editLoad.origin_city || "");
      setOriginPin(editLoad.origin_pincode || "");
      setOriginInfo({
        locality: editLoad.origin_locality,
        city: editLoad.origin_city,
        state: (editLoad as any).origin_state,
        pincode: editLoad.origin_pincode,
        placeName: (editLoad as any).origin_place_name,
        fullAddress: (editLoad as any).origin_full_address,
        eLoc: (editLoad as any).origin_eloc,
        latitude: editLoad.origin_latitude,
        longitude: editLoad.origin_longitude,
      });
      setDestText(editLoad.destination_locality || editLoad.destination_city || "");
      setDestPin(editLoad.destination_pincode || "");
      setDestInfo({
        locality: editLoad.destination_locality,
        city: editLoad.destination_city,
        state: (editLoad as any).destination_state,
        pincode: editLoad.destination_pincode,
        placeName: (editLoad as any).destination_place_name,
        fullAddress: (editLoad as any).destination_full_address,
        eLoc: (editLoad as any).destination_eloc,
        latitude: editLoad.destination_latitude,
        longitude: editLoad.destination_longitude,
      });
      setCargoType(editLoad.cargo_type || "Bags");
      setCargoCategory(editLoad.cargo_category || "GENERAL");
      setWeightKg(editLoad.weight_kg ? String(Math.round(editLoad.weight_kg)) : "");
    }
  }, [visible, editLoad]);

  useEffect(() => {
    if (visible && prefillRoute && !editLoad) {
      if (prefillRoute.origin) {
        setOriginText(prefillRoute.origin.locality || prefillRoute.origin.city || "");
        setOriginPin(prefillRoute.origin.pincode || "");
        setOriginInfo({
          locality: prefillRoute.origin.locality,
          city: prefillRoute.origin.city,
          pincode: prefillRoute.origin.pincode,
          latitude: prefillRoute.origin.latitude,
          longitude: prefillRoute.origin.longitude,
        });
      }
      if (prefillRoute.dest) {
        setDestText(prefillRoute.dest.locality || prefillRoute.dest.city || "");
        setDestPin(prefillRoute.dest.pincode || "");
        setDestInfo({
          locality: prefillRoute.dest.locality,
          city: prefillRoute.dest.city,
          pincode: prefillRoute.dest.pincode,
          latitude: prefillRoute.dest.latitude,
          longitude: prefillRoute.dest.longitude,
        });
      }
    }
  }, [visible, prefillRoute]);

  const handleCargoSelect = (ct: string) => {
    setCargoType(ct);
    if (ct === "Drums") {
      Alert.alert(
        "Hazardous cargo?",
        "Do these drums contain hazardous material (chemicals, fuel, solvents)?",
        [
          { text: "No, general cargo", onPress: () => setCargoCategory("GENERAL") },
          { text: "Yes, HAZMAT", style: "destructive", onPress: () => setCargoCategory("HAZMAT") },
        ],
        { cancelable: true },
      );
    } else {
      setCargoCategory(CARGO_TYPE_TO_CATEGORY[ct] || "GENERAL");
    }
  };

  const reset = () => {
    setOriginText(""); setOriginPin(""); setOriginInfo(null);
    setDestText(""); setDestPin(""); setDestInfo(null);
    setCargoType("Bags"); setCargoCategory("GENERAL"); setWeightKg("");
  };

  const submit = async () => {
    const originValid =
      /^\d{6}$/.test(originPin) ||
      (originInfo && (
        (originInfo.latitude != null && originInfo.longitude != null) ||
        !!(originInfo.city || originInfo.locality || originInfo.placeName)
      ));
    const destValid =
      /^\d{6}$/.test(destPin) ||
      (destInfo && (
        (destInfo.latitude != null && destInfo.longitude != null) ||
        !!(destInfo.city || destInfo.locality || destInfo.placeName)
      ));
    if (!originValid) return Alert.alert("Origin", "Please select a valid origin from the list.");
    if (!destValid) return Alert.alert("Destination", "Please select a valid destination from the list.");
    const w = parseFloat(weightKg);
    if (!w || w <= 0) return Alert.alert("Weight", "Please enter a valid weight in kg.");
    if (w > TRUCK_CAPACITY_KG) return Alert.alert("Too heavy", `A single PTL load can't exceed ${TRUCK_CAPACITY_KG} kg. Use full-truck booking instead.`);

    setBusy(true);
    try {
      if (editLoad) {
        try {
          await fetch(`${API}/ptl/loads/${editLoad.id}?phone=${encodeURIComponent(profile.phone)}`, { method: "DELETE" });
        } catch {}
      }
      const res = await fetch(`${API}/ptl/loads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poster_phone: profile.phone,
          origin_locality: originInfo?.locality || originText || originInfo?.placeName || "",
          origin_city: originInfo?.city || originInfo?.locality || originInfo?.placeName || originText || "",
          origin_state: originInfo?.state || "",
          origin_pincode: originPin || "",
          origin_place_name: originInfo?.placeName || "",
          origin_full_address: originInfo?.fullAddress || "",
          origin_eloc: originInfo?.eLoc || "",
          origin_latitude: originInfo?.latitude ?? null,
          origin_longitude: originInfo?.longitude ?? null,
          destination_locality: destInfo?.locality || destText || destInfo?.placeName || "",
          destination_city: destInfo?.city || destInfo?.locality || destInfo?.placeName || destText || "",
          destination_state: destInfo?.state || "",
          destination_pincode: destPin || "",
          destination_place_name: destInfo?.placeName || "",
          destination_full_address: destInfo?.fullAddress || "",
          destination_eloc: destInfo?.eLoc || "",
          destination_latitude: destInfo?.latitude ?? null,
          destination_longitude: destInfo?.longitude ?? null,
          cargo_type: cargoType,
          cargo_category: cargoCategory,
          weight_kg: w,
        }),
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { detail: text }; }
      if (!res.ok) {
        const reason =
          res.status === 404
            ? "The PTL endpoint isn't available on the server yet. Please ask the team to deploy the latest backend."
            : (data?.detail || `Server returned HTTP ${res.status}.`);
        Alert.alert("Could not post", reason);
        return;
      }
      Alert.alert(
        editLoad ? "Posting updated!" : "Load posted!",
        "Your partial load is now listed.",
      );
      reset();
      onPosted(data);
    } catch (e: any) {
      Alert.alert("Network error", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.ptlModalBackdrop}>
        <View style={styles.ptlModalSheet} testID="post-ptl-modal">
          <View style={styles.ptlModalHeader}>
            <Text style={styles.ptlModalTitle}>{editLoad ? "Edit partial load" : "Post partial load"}</Text>
            <TouchableOpacity onPress={onClose} testID="post-ptl-close">
              <Ionicons name="close" size={26} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          <SafeScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
            <SmartRouteInput
              label="Origin"
              testIDPrefix="ptl-origin"
              text={originText}
              pin={originPin}
              info={originInfo}
              onChange={(t, p, i) => { setOriginText(t); setOriginPin(p); setOriginInfo(i); }}
            />
            <View style={{ height: 12 }} />
            <SmartRouteInput
              label="Destination"
              testIDPrefix="ptl-dest"
              text={destText}
              pin={destPin}
              info={destInfo}
              onChange={(t, p, i) => { setDestText(t); setDestPin(p); setDestInfo(i); }}
            />

            <Text style={[styles.label, { marginTop: 18 }]}>Cargo type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {PTL_CARGO_TYPES.map((ct) => (
                <TouchableOpacity
                  key={ct}
                  testID={`ptl-cargo-${ct}`}
                  style={[styles.ptlCargoChip, cargoType === ct && styles.ptlCargoChipActive]}
                  onPress={() => handleCargoSelect(ct)}
                >
                  <Text style={[styles.ptlCargoChipText, cargoType === ct && styles.ptlCargoChipTextActive]}>{ct}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {cargoCategory === "HAZMAT" && (
              <View style={styles.ptlHazmatBanner}>
                <Ionicons name="warning" size={16} color="#B91C1C" />
                <Text style={styles.ptlHazmatText}>HAZMAT — will be grouped only with other HAZMAT loads</Text>
              </View>
            )}

            <Text style={[styles.label, { marginTop: 18 }]}>Weight (kg)</Text>
            <TextInput
              testID="ptl-weight-input"
              style={styles.input}
              placeholder="e.g. 3500"
              placeholderTextColor={COLORS.textSubtle}
              keyboardType="number-pad"
              value={weightKg}
              onChangeText={(t) => setWeightKg(t.replace(/[^0-9]/g, "").slice(0, 5))}
            />
            <Text style={styles.hintMuted}>Max {TRUCK_CAPACITY_KG.toLocaleString()} kg per partial load</Text>

            <TouchableOpacity
              testID="ptl-submit-btn"
              style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
              onPress={submit}
              disabled={busy}
            >
              {busy ? <ActivityIndicator color={COLORS.surface} /> : (
                <>
                  <Text style={styles.primaryBtnText}>Save changes</Text>
                  <Ionicons name="checkmark" size={18} color={COLORS.surface} />
                </>
              )}
            </TouchableOpacity>
          </SafeScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ============== Post Partial Load Screen (3rd bottom-nav tab) ==============
// Mirrors PostLoadScreen layout 1:1 — same stepper UI for date & weight, same
// CollapsibleSection blocks for optional fields. On submit, creates a
// standalone partial-load listing and opens WhatsApp with a pre-filled
// share message (deep link → https://www.trucktraffic.in/a/{group_id}).
function PostPtlLoadScreen({ profile, onNotificationsRead, onPosted }: { profile: Profile; onNotificationsRead?: () => void; onPosted?: (filter?: ActiveFilter | null) => void }) {
  // Received interests (from bidders / interested viewers)
  const [receivedInterests, setReceivedInterests] = useState<Interest[]>([]);

  useEffect(() => { fetchNotifications(); }, []);

  const fetchNotifications = async () => {
    try {
      const ir = await fetch(`${API}/interests/received/${encodeURIComponent(profile.phone)}`);
      if (ir.ok) setReceivedInterests(await ir.json());
      // Mark PTL notifications as read so the bottom-tab badge clears.
      fetch(`${API}/notifications/${encodeURIComponent(profile.phone)}/read`, { method: "POST" }).catch(() => {});
      onNotificationsRead?.();
    } catch {}
  };

  // Route
  const [originText, setOriginText] = useState("");
  const [originPin, setOriginPin] = useState("");
  const [originInfo, setOriginInfo] = useState<any>(null);
  const [destText, setDestText] = useState("");
  const [destPin, setDestPin] = useState("");
  const [destInfo, setDestInfo] = useState<any>(null);

  // Date & weight (tons)
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const maxDate = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() + 14); return d; }, [today]);
  const [date, setDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [weight, setWeight] = useState(1.0);                   // tons
  const [weightModalVisible, setWeightModalVisible] = useState(false);
  const [weightInput, setWeightInput] = useState("");

  // Product type
  const [cargoTypes, setCargoTypes] = useState<string[]>([]);   // single-select array
  const [cargoOther, setCargoOther] = useState("");
  const [showCargoOtherInput, setShowCargoOtherInput] = useState(false);

  // Optional sections
  const [dimL, setDimL] = useState("");
  const [dimB, setDimB] = useState("");
  const [dimH, setDimH] = useState("");
  const [truckType, setTruckType] = useState<string>("");
  const [placement, setPlacement] = useState<string>("");
  const [images, setImages] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Result-flow
  const [busy, setBusy] = useState(false);

  const cargoType = cargoTypes[0] || "";
  const cargoCategory = useMemo(() => {
    const ct = (cargoType || "").startsWith("Others:") ? "Others" : cargoType;
    if (ct === "Fresh Produce") return "PERISHABLE";
    if (ct === "Drums") return _drumsCat;   // resolved below
    return "GENERAL";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargoType]);
  // For "Drums" we need to prompt HAZMAT/GENERAL. Keep that choice in a ref.
  const [_drumsCat, setDrumsCat] = useState<"GENERAL" | "HAZMAT">("GENERAL");

  const onDateChange = (event: any, selected?: Date) => {
    if (Platform.OS !== "ios") setShowDatePicker(false);
    if (event?.type === "dismissed") return;
    if (selected) {
      if (selected < today) setDate(today);
      else if (selected > maxDate) setDate(maxDate);
      else setDate(selected);
    }
  };

  const selectCargoType = (key: string) => {
    const isOthers = key === "Others";
    if (cargoTypes.includes(key)) {
      // Tap selected → deselect
      setCargoTypes([]);
      setCargoOther("");
      setShowCargoOtherInput(false);
      return;
    }
    setCargoTypes([key]);
    setCargoOther("");
    setShowCargoOtherInput(isOthers);
    if (key === "Drums") {
      Alert.alert(
        "Hazardous cargo?",
        "Do these drums contain hazardous material (chemicals, fuel, solvents)?",
        [
          { text: "No, general cargo", onPress: () => setDrumsCat("GENERAL") },
          { text: "Yes, HAZMAT", style: "destructive", onPress: () => setDrumsCat("HAZMAT") },
        ],
        { cancelable: true },
      );
    }
  };

  const pickImage = async () => {
    if (images.length >= 3) { Alert.alert("Limit", "You can attach up to 3 photos."); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Please grant photo library access to attach images."); return; }
    const remaining = 3 - images.length;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false, allowsMultipleSelection: true, selectionLimit: remaining,
      quality: 0.7, base64: true,
    });
    if (!res.canceled && res.assets && res.assets.length > 0) {
      const MAX = 50 * 1024 * 1024;
      const valid = res.assets.slice(0, remaining).filter((a: any) => {
        if (!a.base64) return false;
        const bytes = (a.base64.length * 3) / 4;
        if (bytes > MAX) { Alert.alert("File too large", `"${a.fileName || "Photo"}" exceeds the 50 MB limit.`); return false; }
        return true;
      });
      if (!valid.length) return;
      setUploadProgress(0);
      const newOnes: string[] = [];
      for (let i = 0; i < valid.length; i++) {
        const a = valid[i];
        newOnes.push(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
        setUploadProgress(Math.round(((i + 1) / valid.length) * 100));
        await new Promise(r => setTimeout(r, 80));
      }
      setImages(prev => [...prev, ...newOnes].slice(0, 3));
      setTimeout(() => setUploadProgress(null), 600);
    }
  };

  const removeImage = (idx: number) => setImages(prev => prev.filter((_, i) => i !== idx));

  const reset = () => {
    setOriginText(""); setOriginPin(""); setOriginInfo(null);
    setDestText(""); setDestPin(""); setDestInfo(null);
    setDate(new Date()); setWeight(1.0); setWeightInput("");
    setCargoTypes([]); setCargoOther(""); setShowCargoOtherInput(false); setDrumsCat("GENERAL");
    setDimL(""); setDimB(""); setDimH("");
    setTruckType(""); setPlacement(""); setImages([]);
  };

  const submit = async () => {
    const originValid =
      /^\d{6}$/.test(originPin) ||
      (originInfo && (
        (originInfo.latitude != null && originInfo.longitude != null) ||
        !!(originInfo.city || originInfo.locality || originInfo.placeName)
      ));
    const destValid =
      /^\d{6}$/.test(destPin) ||
      (destInfo && (
        (destInfo.latitude != null && destInfo.longitude != null) ||
        !!(destInfo.city || destInfo.locality || destInfo.placeName)
      ));
    if (!originValid) return Alert.alert("Origin", "Please select a valid origin from the list.");
    if (!destValid) return Alert.alert("Destination", "Please select a valid destination from the list.");
    if (!cargoType) return Alert.alert("Product type", "Please select a product type.");
    if (weight <= 0) return Alert.alert("Weight", "Please enter a valid weight in tons.");
    if (weight > 20) return Alert.alert("Too heavy", "A single partial load can't exceed 20 tons. Use Post Space for a full truck.");

    // Dimension validation (only if entered)
    const L = dimL ? parseInt(dimL, 10) : null;
    const B = dimB ? parseInt(dimB, 10) : null;
    const H = dimH ? parseInt(dimH, 10) : null;
    if (L !== null && L > 40) return Alert.alert("Invalid length", "Length cannot exceed 40 ft.");
    if (B !== null && B > 8) return Alert.alert("Invalid breadth", "Breadth cannot exceed 8 ft.");
    if (H !== null && H > 9) return Alert.alert("Invalid height", "Height cannot exceed 9 ft.");

    setBusy(true);
    try {
      const cargoTypeFinal = cargoType.startsWith("Others:") && cargoOther.trim()
        ? `Others: ${cargoOther.trim()}` : cargoType;
      const res = await fetch(`${API}/ptl/loads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poster_phone: profile.phone,
          origin_locality: originInfo?.locality || originText || originInfo?.placeName || "",
          origin_city: originInfo?.city || originInfo?.locality || originInfo?.placeName || originText || "",
          origin_state: originInfo?.state || "",
          origin_pincode: originPin || "",
          origin_place_name: originInfo?.placeName || "",
          origin_full_address: originInfo?.fullAddress || "",
          origin_eloc: originInfo?.eLoc || "",
          origin_latitude: originInfo?.latitude ?? null,
          origin_longitude: originInfo?.longitude ?? null,
          destination_locality: destInfo?.locality || destText || destInfo?.placeName || "",
          destination_city: destInfo?.city || destInfo?.locality || destInfo?.placeName || destText || "",
          destination_state: destInfo?.state || "",
          destination_pincode: destPin || "",
          destination_place_name: destInfo?.placeName || "",
          destination_full_address: destInfo?.fullAddress || "",
          destination_eloc: destInfo?.eLoc || "",
          destination_latitude: destInfo?.latitude ?? null,
          destination_longitude: destInfo?.longitude ?? null,
          cargo_type: cargoTypeFinal,
          cargo_category: cargoCategory,
          weight_kg: Math.round(weight * 1000),    // tons → kg
          truck_type: truckType,
          loading_date: date.toISOString().slice(0, 10),
          dimension_length: L,
          dimension_breadth: B,
          dimension_height: H,
          cargo_placement: placement,
          images,
        }),
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { detail: text }; }
      if (!res.ok) {
        const reason =
          res.status === 404
            ? "The PTL endpoint isn't available on the server yet. Please ask the team to deploy the latest backend."
            : (data?.detail || `Server returned HTTP ${res.status}.`);
        Alert.alert("Could not post", reason);
        return;
      }

      // Build WhatsApp share message (mirrors the Truck Space "Post & Share" flow)
      const dateStr = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const oStateName = sanitizeStateForDisplay(originInfo?.state || "", originPin);
      const dStateName = sanitizeStateForDisplay(destInfo?.state || "", destPin);
      const oCityClean = sanitizeCityForDisplay(originInfo?.city || "", originPin, oStateName);
      const dCityClean = sanitizeCityForDisplay(destInfo?.city || "", destPin, dStateName);
      const oLocClean = (originInfo?.locality || originInfo?.city || originText || "").trim();
      const dLocClean = (destInfo?.locality || destInfo?.city || destText || "").trim();
      const oAbbr = stateAbbr(oStateName);
      const dAbbr = stateAbbr(dStateName);
      const poArea = oLocClean || oCityClean || originPin;
      const poCity = oCityClean && oCityClean !== oLocClean ? `, ${oCityClean}` : "";
      const poState = oAbbr ? `, ${oAbbr}` : "";
      const pdArea = dLocClean || dCityClean || destPin;
      const pdCity = dCityClean && dCityClean !== dLocClean ? `, ${dCityClean}` : "";
      const pdState = dAbbr ? `, ${dAbbr}` : "";
      const postOriginLabel = `📍 From: ${poArea}${poCity}${poState}${originPin ? `, ${originPin}` : ""}`;
      const postDestLabel   = `📍 To: ${pdArea}${pdCity}${pdState}${destPin ? `, ${destPin}` : ""}`;
      const cargoDisplay = cargoTypeFinal.replace(/^Others:\s*/, "");
      const truckLabelPost = truckType === "Open" ? "Open Truck" : truckType === "Container" ? "Container Truck" : truckType === "Trailer" ? "Trailer Truck" : truckType;

      const waText =
        `📦 *Partial Load Available - Truck Traffic*\n\n` +
        `${postOriginLabel}\n${postDestLabel}\n\n` +
        (truckLabelPost ? `🚚 ${truckLabelPost}\n` : "") +
        `⚖️ *Weight:* ${weight.toFixed(1)} Tons\n` +
        (cargoDisplay ? `📦 *Cargo:* ${cargoDisplay}\n` : "") +
        `📅 *Loading:* ${dateStr}\n\n` +
        `📞 *Contact:* ${profile.name}` +
        (profile.company ? ` — ${profile.company}` : "") +
        `\n+91 ${profile.phone}\n\n` +
        (data?.group_id ? `🔗 *More info:* https://www.trucktraffic.in/a/${data.group_id}\n` : `🔗 *Website:* https://www.trucktraffic.in\n`) +
        `📲 *Playstore:* https://play.google.com/store/apps/details?id=com.ptlmarket.trucktraffic`;

      const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;
      const canOpen = await Linking.canOpenURL(waUrl).catch(() => false);
      if (canOpen) {
        await Linking.openURL(waUrl).catch(() => {});
      } else {
        Alert.alert("Partial Load Posted! 🎉", "Your partial load has been posted. WhatsApp is not installed on this device.");
      }
      const routeFilter = await buildRouteFilterFromPost(originPin, originInfo, destPin, destInfo);
      reset();
      onPosted?.(routeFilter);
    } catch (e: any) {
      Alert.alert("Network error", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.fill}>
      <ScrollView contentContainerStyle={styles.formWrap} keyboardShouldPersistTaps="handled" testID="post-ptl-screen">

        {/* ── Received Interests ── */}
        {receivedInterests.length > 0 && (
          <>
            <Text style={[styles.sectionHeading, { marginBottom: 8 }]}>Interests in Your Listings</Text>
            {receivedInterests.map(interest => (
              <View key={interest.id} style={[notifStyles.card, { borderColor: COLORS.primary }]}>
                <View style={[notifStyles.iconWrap, { backgroundColor: "#EEF2FA" }]}><Ionicons name="hand-right-outline" size={20} color={COLORS.primary} /></View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={notifStyles.title}>{interest.viewer_name}</Text>
                    {interest.viewer_verified && <Ionicons name="checkmark-circle" size={13} color={COLORS.success} />}
                  </View>
                  {interest.viewer_company ? <Text style={notifStyles.body}>{interest.viewer_company}</Text> : null}
                  <Text style={notifStyles.body}>Interested in your {interest.listing_type === "ptl_group" ? "partial load group" : "truck space"}{interest.listing_summary?.origin ? ` (${interest.listing_summary.origin} → ${interest.listing_summary.destination})` : ""}</Text>
                  {interest.viewer_phone ? (
                    <TouchableOpacity style={[notifStyles.actionBtn, { backgroundColor: "#E8F8EE", marginTop: 8, alignSelf: "flex-start" }]} onPress={() => Linking.openURL(`tel:${interest.viewer_phone}`).catch(() => {})}>
                      <Ionicons name="call-outline" size={13} color={COLORS.success} /><Text style={[notifStyles.actionBtnText, { color: COLORS.success }]}>Call {interest.viewer_name.split(" ")[0]}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ))}
          </>
        )}

        {/* 1. Route */}
        <SectionTitle icon="navigate-outline" title="Route" />
        <View style={styles.routeInputsRow}>
          <SmartRouteInput
            label="Origin"
            testIDPrefix="ptl-post-origin"
            text={originText}
            pin={originPin}
            info={originInfo}
            onChange={(t, p, i) => { setOriginText(t); setOriginPin(p); setOriginInfo(i); }}
          />
          <View style={styles.routeArrowMid}>
            <Ionicons name="arrow-forward" size={20} color={COLORS.secondary} />
          </View>
          <SmartRouteInput
            label="Destination"
            testIDPrefix="ptl-post-dest"
            text={destText}
            pin={destPin}
            info={destInfo}
            onChange={(t, p, i) => { setDestText(t); setDestPin(p); setDestInfo(i); }}
          />
        </View>

        {/* 2. Loading Date — same stepper as Post Space */}
        <SectionTitle icon="calendar-outline" title="Loading Date" />
        <View style={[styles.stepperRow, styles.filledBorder]}>
          <TouchableOpacity
            testID="ptl-date-minus"
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
            testID="ptl-date-btn"
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
            testID="ptl-date-plus"
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

        {/* 3. Weight in Tons — same stepper + modal as Post Space */}
        <SectionTitle icon="scale-outline" title="Weight" />
        <View style={[styles.stepperRow, weight > 0 && styles.filledBorder]}>
          <TouchableOpacity
            testID="ptl-weight-minus"
            style={styles.stepperBtn}
            onPress={() => setWeight(w => Math.max(0.5, parseFloat((w - 0.5).toFixed(1))))}
          >
            <Text style={styles.stepperBtnText}>-</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="ptl-weight-btn"
            style={styles.stepperCenter}
            activeOpacity={0.8}
            onPress={() => { setWeightInput(String(weight)); setWeightModalVisible(true); }}
          >
            <Text style={styles.stepperValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} allowFontScaling={false}>{weight.toFixed(1)}</Text>
            <Text style={styles.stepperUnit} numberOfLines={1} allowFontScaling={false}>tons</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="ptl-weight-plus"
            style={styles.stepperBtn}
            onPress={() => setWeight(w => Math.min(20, parseFloat((w + 0.5).toFixed(1))))}
          >
            <Text style={styles.stepperBtnText}>+</Text>
          </TouchableOpacity>
        </View>

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
                placeholder="e.g. 3.5"
                placeholderTextColor={COLORS.textSubtle}
              />
              <View style={wmStyles.presets}>
                {[1, 2, 3, 5, 8, 12, 18].map(n => (
                  <TouchableOpacity key={n} style={wmStyles.preset} onPress={() => setWeightInput(String(n))}>
                    <Text style={wmStyles.presetText}>{n}T</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={wmStyles.btn} onPress={() => {
                const n = parseFloat(weightInput);
                if (!isNaN(n) && n > 20) {
                  setWeightInput("");
                  Alert.alert("Weight limit exceeded", "A partial load can't exceed 20 tons. Use Post Space for a full truck.");
                  return;
                }
                if (!isNaN(n) && n > 0) setWeight(parseFloat(n.toFixed(1)));
                setWeightModalVisible(false);
              }}>
                <Text style={wmStyles.btnText}>Set Weight</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* 4. Product Type */}
        <SectionTitle icon="cube-outline" title="Product Type" />
        <View style={cargoStyles.grid} testID="ptl-cargo-grid">
          {CARGO_TYPE_OPTIONS.map((opt) => {
            const selected = cargoTypes.includes(opt.key);
            return (
              <TouchableOpacity
                key={opt.key}
                testID={`ptl-cargo-${opt.key}`}
                style={[cargoStyles.tile, selected && cargoStyles.tileSelected]}
                onPress={() => selectCargoType(opt.key)}
                activeOpacity={0.75}
              >
                <Image source={opt.image} style={cargoStyles.tileImage} resizeMode="contain" />
                <Text style={[cargoStyles.tileLabel, selected && cargoStyles.tileLabelSelected]} numberOfLines={1}>{opt.label}</Text>
                {selected && <View style={cargoStyles.checkDot}><Ionicons name="checkmark" size={9} color="#fff" /></View>}
              </TouchableOpacity>
            );
          })}
        </View>
        {showCargoOtherInput && (
          <View style={cargoStyles.otherInputWrap}>
            <TextInput
              style={cargoStyles.otherInput}
              value={cargoOther}
              onChangeText={(t) => {
                setCargoOther(t);
                setCargoTypes(t.trim() ? [`Others: ${t.trim()}`] : ["Others"]);
              }}
              placeholder="Describe cargo (e.g. Steel coils, Marble slabs…)"
              placeholderTextColor={COLORS.textSubtle}
              returnKeyType="done"
            />
          </View>
        )}
        {cargoCategory !== "GENERAL" && cargoType ? (
          <View style={[styles.ptlHazmatBanner, cargoCategory === "PERISHABLE" && { backgroundColor: "#DCFCE7" }]}>
            <Ionicons
              name={cargoCategory === "HAZMAT" ? "warning" : "snow-outline"}
              size={16}
              color={cargoCategory === "HAZMAT" ? "#B91C1C" : "#15803D"}
            />
            <Text style={[styles.ptlHazmatText, cargoCategory === "PERISHABLE" && { color: "#15803D" }]}>
              {cargoCategory === "HAZMAT"
                ? "HAZMAT — will only group with other HAZMAT loads"
                : "PERISHABLE — will only group with other perishable loads"}
            </Text>
          </View>
        ) : null}

        {/* ===== Optional fields (collapsible) ===== */}
        <Text style={styles.optionalHeading}>Add more details (optional)</Text>

        <CollapsibleSection
          icon="resize-outline"
          title="Available Space"
          summary={(dimL || dimB || dimH) ? `${dimL || "-"} x ${dimB || "-"} x ${dimH || "-"} ft` : ""}
          testID="ptl-opt-space"
        >
          <View style={styles.dimRow} testID="ptl-dimension-row">
            <View style={styles.dimItem}>
              <Text style={styles.dimLabel}>Length</Text>
              <View style={[styles.dimInputWrap, dimL && styles.filledBorder]}>
                <TextInput
                  testID="ptl-dim-length-input"
                  style={styles.dimInputText}
                  value={dimL}
                  onChangeText={(t) => {
                    const digits = t.replace(/\D/g, "");
                    if (!digits) { setDimL(""); return; }
                    if (parseInt(digits, 10) > 40) { setDimL(""); return; }
                    setDimL(digits);
                  }}
                  keyboardType="number-pad"
                  maxLength={3}
                  placeholder="0"
                  placeholderTextColor={COLORS.textSubtle}
                />
                <Text style={styles.dimSuffix}>ft</Text>
              </View>
              {dimL && parseInt(dimL, 10) > 40 ? <Text style={styles.errorText}>Max length: 40 ft</Text> : null}
            </View>
            <View style={styles.dimItem}>
              <Text style={styles.dimLabel}>Breadth</Text>
              <View style={[styles.dimInputWrap, dimB && styles.filledBorder]}>
                <TextInput
                  testID="ptl-dim-breadth-input"
                  style={styles.dimInputText}
                  value={dimB}
                  onChangeText={(t) => {
                    const digits = t.replace(/\D/g, "");
                    if (!digits) { setDimB(""); return; }
                    if (parseInt(digits, 10) > 8) { setDimB(""); return; }
                    setDimB(digits);
                  }}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="0"
                  placeholderTextColor={COLORS.textSubtle}
                />
                <Text style={styles.dimSuffix}>ft</Text>
              </View>
              {dimB && parseInt(dimB, 10) > 8 ? <Text style={styles.errorText}>Max breadth: 8 ft</Text> : null}
            </View>
            <View style={styles.dimItem}>
              <Text style={styles.dimLabel}>Height</Text>
              <View style={[styles.dimInputWrap, dimH && styles.filledBorder]}>
                <TextInput
                  testID="ptl-dim-height-input"
                  style={styles.dimInputText}
                  value={dimH}
                  onChangeText={(t) => {
                    const digits = t.replace(/\D/g, "");
                    if (!digits) { setDimH(""); return; }
                    if (parseInt(digits, 10) > 9) { setDimH(""); return; }
                    setDimH(digits);
                  }}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="0"
                  placeholderTextColor={COLORS.textSubtle}
                />
                <Text style={styles.dimSuffix}>ft</Text>
              </View>
              {dimH && parseInt(dimH, 10) > 9 ? <Text style={styles.errorText}>Max height: 9 ft</Text> : null}
            </View>
          </View>
        </CollapsibleSection>

        <CollapsibleSection
          icon="bus-outline"
          title="Truck Preference"
          summary={truckType}
          testID="ptl-opt-truck"
        >
          <View style={styles.truckRow} testID="ptl-truck-row">
            {TRUCK_TYPES.map((t) => {
              const on = truckType === t.name;
              return (
                <TouchableOpacity
                  key={t.name}
                  testID={`ptl-truck-${t.name}`}
                  style={[styles.truckCard, on && styles.truckCardOn, on && styles.filledBorder]}
                  onPress={() => setTruckType(prev => prev === t.name ? "" : t.name)}
                  activeOpacity={0.7}
                >
                  <Image source={t.image} style={[styles.truckImg, on && styles.truckImgOn]} resizeMode="contain" />
                  <Text style={[styles.truckLabel, on && styles.truckLabelOn]} numberOfLines={1} allowFontScaling={false}>{t.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </CollapsibleSection>

        <CollapsibleSection
          icon="layers-outline"
          title="Cargo Placement"
          summary={placement}
          testID="ptl-opt-placement"
        >
          <View style={styles.placementRow} testID="ptl-placement-segment">
            {PLACEMENT_OPTIONS.map((p) => {
              const on = placement === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  testID={`ptl-placement-${p.key.replace(" ", "-")}`}
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
          testID="ptl-opt-photos"
        >
          <Text style={styles.label}>Attach up to 3 photos of the cargo (max 50 MB each)</Text>
          {uploadProgress !== null && (
            <View style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                <Text style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_500Medium" }}>Uploading photos…</Text>
                <Text style={{ fontSize: 12, color: COLORS.primary, fontFamily: "Inter_700Bold" }}>{uploadProgress}%</Text>
              </View>
              <View style={{ height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: "hidden" }}>
                <View style={{ height: 6, backgroundColor: COLORS.primary, borderRadius: 3, width: `${uploadProgress}%` as any }} />
              </View>
            </View>
          )}
          <View style={styles.photoRow} testID="ptl-photos-row">
            {[0, 1, 2].map((idx) => {
              const img = images[idx];
              if (img) {
                return (
                  <View key={idx} style={styles.photoCell} testID={`ptl-photo-${idx}`}>
                    <Image source={{ uri: img }} style={styles.photoImg} resizeMode="cover" />
                    <TouchableOpacity testID={`ptl-photo-remove-${idx}`} onPress={() => removeImage(idx)} style={styles.photoRemoveBtn}>
                      <Ionicons name="close" size={14} color={COLORS.surface} />
                    </TouchableOpacity>
                  </View>
                );
              }
              return (
                <TouchableOpacity key={idx} testID={`ptl-photo-add-${idx}`} onPress={pickImage} style={[styles.photoCell, styles.photoEmpty]} activeOpacity={0.7}>
                  <Ionicons name="add" size={28} color={COLORS.textMuted} />
                  <Text style={styles.photoAddLabel}>Add</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </CollapsibleSection>

        <TouchableOpacity
          testID="ptl-post-submit-btn"
          style={[styles.whatsappBtn, { marginTop: 24, width: "100%", paddingVertical: 16 }, busy && { opacity: 0.6 }]}
          onPress={submit}
          disabled={busy}
          activeOpacity={0.82}
        >
          {busy ? <ActivityIndicator color={COLORS.surface} /> : (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <Ionicons name="logo-whatsapp" size={22} color={COLORS.surface} />
              <Text style={[styles.primaryBtnText, { fontSize: 16 }]}>Post & Share on WhatsApp</Text>
            </View>
          )}
        </TouchableOpacity>
        <Text style={[styles.hintMuted, { textAlign: "center", marginTop: 8 }]}>
          You can track this load in your Profile → My Posted Partial Loads.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}


// ============== My Partial Loads list (used inside ProfileScreen) ==============
// Build a PtlGroup-shaped object from a single raw PtlLoad so it can be
// rendered with the same PtlGroupCard used everywhere else in the app
// (Marketplace, My Posts, and poster profile screens).
function ptlLoadToGroup(item: PtlLoad, posterName: string): PtlGroup {
  return {
    id: item.id,
    corridor: "",
    origin_display: item.origin_locality || item.origin_city || "",
    destination_display: item.destination_locality || item.destination_city || "",
    load_ids: [item.id],
    total_weight_kg: item.weight_kg,
    capacity_kg: TRUCK_CAPACITY_KG,
    capacity_remaining_kg: TRUCK_CAPACITY_KG - item.weight_kg,
    fill_pct: 0,
    cargo_categories: item.cargo_category ? [item.cargo_category] : [],
    status: "FORMING",
    created_at: item.posted_at,
    members: [{
      load_id: item.id,
      phone: item.poster_phone,
      name: posterName,
      company: item.poster_company,
      origin_locality: item.origin_locality,
      origin_city: item.origin_city,
      origin_pincode: item.origin_pincode,
      destination_locality: item.destination_locality,
      destination_city: item.destination_city,
      destination_pincode: item.destination_pincode,
      weight_kg: item.weight_kg,
      cargo_type: item.cargo_type,
      cargo_category: item.cargo_category,
      truck_type: item.truck_type,
      loading_date: item.loading_date,
      dimension_length: item.dimension_length,
      dimension_breadth: item.dimension_breadth,
      dimension_height: item.dimension_height,
      cargo_placement: item.cargo_placement,
      images: item.images,
    }],
  };
}

function MyPtlLoadsList({ profile }: { profile: Profile }) {
  const [loads, setLoads] = useState<PtlLoad[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupCache, setGroupCache] = useState<Record<string, PtlGroup>>({});
  const [selectedGroup, setSelectedGroup] = useState<PtlGroup | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [editLoad, setEditLoad] = useState<PtlLoad | null>(null);
  const [bidCounts, setBidCounts] = useState<Record<string, number>>({});
  const [bidsForListing, setBidsForListing] = useState<{ id: string; label: string } | null>(null);

  const fetchMyLoads = useCallback(async () => {
    try {
      const [r, countsRes] = await Promise.all([
        fetch(`${API}/ptl/loads/my/${encodeURIComponent(profile.phone)}`),
        fetch(`${API}/bids/counts/${encodeURIComponent(profile.phone)}`).then(rr => rr.json()).catch(() => ({})),
      ]);
      const data = await r.json();
      let list: PtlLoad[] = Array.isArray(data) ? data : [];

      // Postings whose loading date has passed are no longer relevant — delete
      // them outright (not just hide them client-side) so they don't linger
      // in My Posts forever. Only auto-clean active postings (OPEN/MATCHED);
      // CONFIRMED/CANCELLED loads are left alone since they're terminal states.
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const isExpired = (l: PtlLoad) => {
        if (l.status !== "OPEN" && l.status !== "MATCHED") return false;
        if (!l.loading_date) return false;
        try {
          const d = new Date(l.loading_date);
          d.setHours(0, 0, 0, 0);
          return d < today;
        } catch { return false; }
      };
      const expired = list.filter(isExpired);
      if (expired.length > 0) {
        await Promise.all(
          expired.map((l) =>
            fetch(`${API}/ptl/loads/${l.id}?phone=${encodeURIComponent(profile.phone)}`, { method: "DELETE" }).catch(() => {}),
          ),
        );
        const expiredIds = new Set(expired.map((l) => l.id));
        list = list.filter((l) => !expiredIds.has(l.id));
      }

      setLoads(list);
      setBidCounts(typeof countsRes === "object" && countsRes ? countsRes : {});
      const gids = Array.from(new Set(list.map((l) => l.group_id).filter(Boolean) as string[]));
      const fetched: Record<string, PtlGroup> = {};
      await Promise.all(
        gids.map(async (gid) => {
          try {
            const gr = await fetch(`${API}/ptl/groups/${gid}?viewer_phone=${encodeURIComponent(profile.phone)}`);
            if (gr.ok) {
              const gj = await gr.json();
              fetched[gid] = gj;
            }
          } catch {}
        }),
      );
      setGroupCache(fetched);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [profile.phone]);

  useEffect(() => { fetchMyLoads(); }, [fetchMyLoads]);

  // Build a PtlGroup-shaped object for each of my loads so it can be
  // rendered with the exact same card used in Marketplace → Find Partial Loads.
  // Prefer the real fetched group (has all members/fill info); fall back to a
  // single-member synthetic group when no group has formed yet.
  const groupFor = (item: PtlLoad): PtlGroup => {
    const real = item.group_id ? groupCache[item.group_id] : null;
    if (real) return real;
    return {
      id: item.id,
      corridor: "",
      origin_display: item.origin_locality || item.origin_city || "",
      destination_display: item.destination_locality || item.destination_city || "",
      load_ids: [item.id],
      total_weight_kg: item.weight_kg,
      capacity_kg: TRUCK_CAPACITY_KG,
      capacity_remaining_kg: TRUCK_CAPACITY_KG - item.weight_kg,
      fill_pct: 0,
      cargo_categories: item.cargo_category ? [item.cargo_category] : [],
      status: "FORMING",
      created_at: item.posted_at,
      members: [{
        load_id: item.id,
        phone: profile.phone,
        name: profile.name,
        company: item.poster_company,
        origin_locality: item.origin_locality,
        origin_city: item.origin_city,
        origin_pincode: item.origin_pincode,
        destination_locality: item.destination_locality,
        destination_city: item.destination_city,
        destination_pincode: item.destination_pincode,
        weight_kg: item.weight_kg,
        cargo_type: item.cargo_type,
        cargo_category: item.cargo_category,
        is_me: true,
        truck_type: item.truck_type,
        loading_date: item.loading_date,
        dimension_length: item.dimension_length,
        dimension_breadth: item.dimension_breadth,
        dimension_height: item.dimension_height,
        cargo_placement: item.cargo_placement,
        images: item.images,
      }],
    };
  };

  const deleteLoad = (item: PtlLoad) => {
    Alert.alert(
      "Delete Posting",
      "Are you sure you want to delete this posting? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const r = await fetch(`${API}/ptl/loads/${item.id}?phone=${encodeURIComponent(profile.phone)}`, { method: "DELETE" });
              if (!r.ok) {
                const j = await r.json().catch(() => ({}));
                return Alert.alert("Failed", j?.detail || "Could not delete.");
              }
              fetchMyLoads();
            } catch (e: any) {
              Alert.alert("Network error", e?.message || "Try again");
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 24 }} />;
  }
  if (!loads.length) {
    return (
      <View style={styles.emptyWrap} testID="myptl-empty">
        <Ionicons name="cube-outline" size={42} color={COLORS.textSubtle} />
        <Text style={styles.emptyTitle}>No partial loads yet</Text>
        <Text style={styles.emptySub}>Open the Post Load tab to post your first partial load.</Text>
      </View>
    );
  }

  return (
    <View testID="myptl-list">
      {loads.map((item) => {
        const g = groupFor(item);
        const editable = item.status === "OPEN" || item.status === "MATCHED";
        const cnt = bidCounts[item.id] || 0;
        const label = `${item.origin_locality || item.origin_city || "Origin"} → ${item.destination_locality || item.destination_city || "Destination"}`;
        return (
          <View key={item.id}>
            <PtlGroupCard
              group={g}
              profile={profile}
              onPress={() => { setSelectedGroup(g); setShowDetail(true); }}
            />
            <TouchableOpacity
              testID={`bids-received-${item.id}`}
              style={profileStyles.bidsBtn}
              activeOpacity={0.85}
              onPress={() => setBidsForListing({ id: item.id, label })}
            >
              <Ionicons name="cash-outline" size={15} color={COLORS.surface} />
              <Text style={profileStyles.bidsBtnText}>Bids Received</Text>
              <View style={profileStyles.bidsCountPill}>
                <Text style={profileStyles.bidsCountText}>{cnt}</Text>
              </View>
            </TouchableOpacity>
            {editable && (
              <View style={profileStyles.actionRow}>
                <TouchableOpacity style={profileStyles.editBtn} onPress={() => setEditLoad(item)} testID={`edit-ptl-${item.id}`}>
                  <Ionicons name="create-outline" size={15} color={COLORS.primary} />
                  <Text style={profileStyles.editBtnText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={profileStyles.deleteBtn} onPress={() => deleteLoad(item)} testID={`delete-ptl-${item.id}`}>
                  <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                  <Text style={profileStyles.deleteBtnText}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}
      {selectedGroup && (
        <ListingDetailModal
          visible={showDetail}
          ptlGroup={selectedGroup}
          viewerPhone={profile.phone}
          viewerName={profile.name}
          onClose={() => { setShowDetail(false); setSelectedGroup(null); }}
        />
      )}
      {editLoad && (
        <PostPtlModal
          visible={!!editLoad}
          profile={profile}
          editLoad={editLoad}
          onClose={() => setEditLoad(null)}
          onPosted={() => { setEditLoad(null); fetchMyLoads(); }}
        />
      )}
      {bidsForListing && (
        <BidsReceivedModal
          visible={!!bidsForListing}
          listingId={bidsForListing.id}
          viewerPhone={profile.phone}
          postRouteLabel={bidsForListing.label}
          onClose={() => setBidsForListing(null)}
        />
      )}
    </View>
  );
}


// ============== New nav / post-flow styles ==============
const newStyles = StyleSheet.create({
  bottomNavNew: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingBottom: 8,
    paddingTop: 4,
    alignItems: "flex-end",
  },
  fabContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 2,
  },
  fabBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
    marginTop: -22,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.38,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 10,
  },
  headerBackBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -6,
  },
  postTypeCard: {
    borderRadius: 20,
    marginBottom: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  postTypeCardInner: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 148,
    padding: 20,
    gap: 14,
  },
  postTypeIconLeft: {
    width: 68,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.7,
  },
  postTypeIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  postTypeTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  postTypeDivider: {
    width: 32,
    height: 2.5,
    borderRadius: 2,
    marginVertical: 7,
  },
  postTypeDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
    lineHeight: 19,
  },
  postTypeChevron: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
    alignSelf: "center",
  },
  myPostsSegmentWrap: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
});

// ============== Post Selection Screen ==============
function PostSelectionScreen({
  onSelectTruckSpace,
  onSelectAdjustment,
}: {
  onSelectTruckSpace: () => void;
  onSelectAdjustment: () => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingTop: 28 }}
      testID="post-selection-screen"
      showsVerticalScrollIndicator={false}
    >
      <Text style={{
        fontSize: 26,
        fontFamily: "Inter_700Bold",
        fontWeight: "700",
        color: COLORS.text,
        marginBottom: 28,
        lineHeight: 34,
        letterSpacing: -0.3,
      }}>
        What would you like to post?
      </Text>

      {/* ── Truck Space Card ── */}
      <TouchableOpacity
        testID="select-truck-space"
        activeOpacity={0.85}
        onPress={onSelectTruckSpace}
        style={newStyles.postTypeCard}
      >
        <View style={[newStyles.postTypeCardInner, { backgroundColor: "#EBF2FF" }]}>
          <View style={newStyles.postTypeIconLeft}>
            <Ionicons name="truck-outline" size={52} color="#A8C4F0" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={[newStyles.postTypeIconBadge, { backgroundColor: COLORS.primary }]}>
              <Ionicons name="truck-outline" size={17} color={COLORS.surface} />
            </View>
            <Text style={newStyles.postTypeTitle}>Truck Space</Text>
            <View style={[newStyles.postTypeDivider, { backgroundColor: COLORS.primary }]} />
            <Text style={newStyles.postTypeDesc}>{"Truck already available.\nFill your empty capacity."}</Text>
          </View>
          <View style={[newStyles.postTypeChevron, { backgroundColor: COLORS.primary }]}>
            <Ionicons name="chevron-forward" size={18} color={COLORS.surface} />
          </View>
        </View>
      </TouchableOpacity>

      {/* ── Adjustment Card ── */}
      <TouchableOpacity
        testID="select-adjustment"
        activeOpacity={0.85}
        onPress={onSelectAdjustment}
        style={newStyles.postTypeCard}
      >
        <View style={[newStyles.postTypeCardInner, { backgroundColor: "#FFF3EB" }]}>
          <View style={newStyles.postTypeIconLeft}>
            <Ionicons name="cube-outline" size={52} color="#F4B87E" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={[newStyles.postTypeIconBadge, { backgroundColor: COLORS.secondary }]}>
              <Ionicons name="cube-outline" size={17} color={COLORS.surface} />
            </View>
            <Text style={newStyles.postTypeTitle}>Adjustment</Text>
            <View style={[newStyles.postTypeDivider, { backgroundColor: COLORS.secondary }]} />
            <Text style={newStyles.postTypeDesc}>{"Post your load.\nWe'll find another load to make a full truck."}</Text>
          </View>
          <View style={[newStyles.postTypeChevron, { backgroundColor: COLORS.secondary }]}>
            <Ionicons name="chevron-forward" size={18} color={COLORS.surface} />
          </View>
        </View>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ============== My Truck Space Postings List ==============
function MyTruckSpacePostsList({ profile }: { profile: Profile }) {
  const [myLoads, setMyLoads] = useState<Load[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editLoad, setEditLoad] = useState<Load | null>(null);
  const [bidCounts, setBidCounts] = useState<Record<string, number>>({});
  const [bidsForListing, setBidsForListing] = useState<{ id: string; label: string } | null>(null);

  const fetchMy = useCallback(async () => {
    try {
      const [loadsRes, countsRes] = await Promise.all([
        fetch(`${API}/loads`).then(r => r.json()),
        fetch(`${API}/bids/counts/${encodeURIComponent(profile.phone)}`).then(r => r.json()).catch(() => ({})),
      ]);
      const j: Load[] = Array.isArray(loadsRes) ? loadsRes : [];
      setMyLoads(j.filter((l) => l.poster_phone === profile.phone));
      setBidCounts(typeof countsRes === "object" && countsRes ? countsRes : {});
    } catch {} finally {
      setLoading(false); setRefreshing(false);
    }
  }, [profile.phone]);

  useEffect(() => { fetchMy(); }, [fetchMy]);

  const deleteLoad = (load: Load) => {
    Alert.alert("Delete Posting", "Are you sure you want to delete this posting? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await fetch(`${API}/loads/${load.id}`, { method: "DELETE" });
          setMyLoads(prev => prev.filter(l => l.id !== load.id));
        } catch { Alert.alert("Error", "Failed to delete. Please try again."); }
      }},
    ]);
  };

  return (
    <>
      <FlatList
        testID="my-truck-space-list"
        data={loading ? [] : myLoads}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchMy(); }} />}
        ListHeaderComponent={loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 24 }} /> : null}
        ListEmptyComponent={!loading ? (
          <View style={styles.emptyWrap} testID="my-truck-space-empty">
            <Ionicons name="truck-outline" size={42} color={COLORS.textSubtle} />
            <Text style={styles.emptyTitle}>No truck spaces posted yet</Text>
            <Text style={styles.emptySub}>Tap Post to add your first truck space.</Text>
          </View>
        ) : null}
        renderItem={({ item }) => {
          const cnt = bidCounts[item.id] || 0;
          const label = `${item.origin_locality || item.origin_city || "Origin"} → ${item.destination_locality || item.destination_city || "Destination"}`;
          return (
            <View>
              <LoadCard load={item} isMine={true} />
              <TouchableOpacity
                testID={`bids-received-${item.id}`}
                style={profileStyles.bidsBtn}
                activeOpacity={0.85}
                onPress={() => setBidsForListing({ id: item.id, label })}
              >
                <Ionicons name="cash-outline" size={15} color={COLORS.surface} />
                <Text style={profileStyles.bidsBtnText}>Bids Received</Text>
                <View style={profileStyles.bidsCountPill}>
                  <Text style={profileStyles.bidsCountText}>{cnt}</Text>
                </View>
              </TouchableOpacity>
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
          );
        }}
      />
      {editLoad && (
        <EditLoadModal
          load={editLoad}
          visible={!!editLoad}
          onClose={() => setEditLoad(null)}
          onSaved={() => { setEditLoad(null); fetchMy(); }}
        />
      )}
      {bidsForListing && (
        <BidsReceivedModal
          visible={!!bidsForListing}
          listingId={bidsForListing.id}
          viewerPhone={profile.phone}
          postRouteLabel={bidsForListing.label}
          onClose={() => setBidsForListing(null)}
        />
      )}
    </>
  );
}

// ============== My Posts Screen (segmented: Truck Space | Adjustment) ==============
function MyPostsScreen({ profile }: { profile: Profile }) {
  const [activeTab, setActiveTab] = useState<"truckSpace" | "adjustment">("truckSpace");

  return (
    <View style={styles.fill}>
      {/* Same size/component as the Find page's Truck Space / Partial Load
          toggle (styles.modeToggleBar) for visual and interaction
          consistency — here it acts as a single-select tab switch between
          the two post lists rather than an independent multi-toggle. */}
      <View style={styles.modeToggleBar} testID="myposts-mode-toggle">
        <TouchableOpacity
          testID="myposts-mode-truck"
          style={[styles.modeToggleBtn, activeTab === "truckSpace" && [styles.modeToggleBtnActive, { backgroundColor: COLORS.primary }]]}
          onPress={() => setActiveTab("truckSpace")}
          activeOpacity={0.8}
        >
          <Ionicons name="car-outline" size={14} color={activeTab === "truckSpace" ? COLORS.surface : COLORS.textMuted} />
          <Text style={[styles.modeToggleText, activeTab === "truckSpace" && styles.modeToggleTextActive]}>Truck Space</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="myposts-mode-ptl"
          style={[styles.modeToggleBtn, activeTab === "adjustment" && [styles.modeToggleBtnActive, { backgroundColor: COLORS.secondary }]]}
          onPress={() => setActiveTab("adjustment")}
          activeOpacity={0.8}
        >
          <Ionicons name="cube-outline" size={14} color={activeTab === "adjustment" ? COLORS.surface : COLORS.textMuted} />
          <Text style={[styles.modeToggleText, activeTab === "adjustment" && styles.modeToggleTextActive]}>Partial Load</Text>
        </TouchableOpacity>
      </View>
      {activeTab === "truckSpace" ? (
        <MyTruckSpacePostsList profile={profile} />
      ) : (
        <SafeScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <MyPtlLoadsList profile={profile} />
        </SafeScrollView>
      )}
    </View>
  );
}


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
  searchBarWrap: { paddingHorizontal: 16, paddingBottom: 12 },
  searchFullBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", paddingVertical: 8, borderRadius: 100, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.surface },
  searchFullBtnActive: { backgroundColor: COLORS.primary },
  searchFullBtnText: { color: COLORS.primary, fontFamily: "Inter_600SemiBold", fontWeight: "600", fontSize: 14 },
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
  statLabel: { fontSize: 10, color: COLORS.textMuted, marginTop: 6, fontFamily: "Inter_500Medium", fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.4 },
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

// ===== PTL Styles =====
bottomNav: { flexDirection: "row", borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.surface, paddingBottom: 8, paddingTop: 6 },
bottomNavBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 4, position: "relative" },
bottomNavLabel: { fontSize: 10, fontFamily: "Inter_500Medium", color: COLORS.textMuted, marginTop: 2 },
bottomNavLabelActive: { color: COLORS.primary, fontFamily: "Inter_700Bold", fontWeight: "700" },
bottomNavDot: { position: "absolute", bottom: 0, width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.primary },
navBadge: { position: "absolute", top: -4, right: -8, backgroundColor: COLORS.secondary, borderRadius: 10, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
navBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.surface },
modeToggleBar: { flexDirection: "row", margin: 12, backgroundColor: "#F3F4F6", borderRadius: 10, padding: 3 },
modeToggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 7, borderRadius: 8 },
modeToggleBtnActive: { backgroundColor: COLORS.primary, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
modeToggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.textMuted },
modeToggleTextActive: { color: COLORS.surface },
ptlCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
ptlRouteText: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, flexShrink: 1, maxWidth: "40%" },
ptlStatusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, backgroundColor: "#E0E7FF" },
ptlStatusText: { fontSize: 10, fontFamily: "Inter_700Bold", fontWeight: "700", color: "#3730A3", letterSpacing: 0.5 },
ptlFillBg: { height: 6, backgroundColor: "#F3F4F6", borderRadius: 100, overflow: "hidden", marginVertical: 6 },
ptlFillInner: { height: "100%", borderRadius: 100 },
ptlMetaText: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.textMuted },
ptlChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100, backgroundColor: "#EEF2FA" },
ptlChipText: { fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.primary },
ptlJoinBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12, paddingVertical: 10, borderRadius: 10 },
ptlJoinBtnText: { color: COLORS.surface, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13 },
ptlPostCta: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 14, marginBottom: 12, padding: 14, gap: 12 },
ptlPostCtaTitle: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.surface },
ptlPostCtaSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)", marginTop: 2 },
ptlPostCtaBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
ptlSectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.textMuted, marginTop: 18, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
ptlModalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
ptlModalSheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%" },
ptlModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
ptlModalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text },
ptlCargoChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 100, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
ptlCargoChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
ptlCargoChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.text },
ptlCargoChipTextActive: { color: COLORS.surface },
ptlHazmatBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEE2E2", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 },
ptlHazmatText: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: "#B91C1C", flexShrink: 1 },
ptlDetailHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
ptlDetailHeaderTitle: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text },
ptlDetailRouteCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border },
ptlDetailCorridor: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.textMuted, letterSpacing: 1, textTransform: "uppercase" },
ptlDetailRouteText: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, flexShrink: 1, maxWidth: "42%" },
ptlMemberRow: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
ptlAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },
ptlAvatarText: { color: COLORS.surface, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 16 },
ptlMemberName: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text },
ptlMemberSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
ptlCompatRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
ptlCompatText: { fontSize: 13, color: COLORS.text, flexShrink: 1 },
ptlConfirmedBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#DCFCE7", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#86EFAC" },
ptlConfirmedText: { color: "#15803D", fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 14 },
ptlMyStatusPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100, alignSelf: "flex-start" },
ptlMyStatusText: { fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700" },
ptlCancelBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: "#FECACA" },
ptlCancelText: { color: COLORS.danger, fontFamily: "Inter_600SemiBold", fontWeight: "600", fontSize: 13 },
ptlBanner: { flexDirection: "row", alignItems: "flex-start", padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 14 },
ptlBannerTitle: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
ptlBannerBody: { fontSize: 12, color: COLORS.text, marginTop: 2, lineHeight: 17 },
ptlPairCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border, marginTop: 4 },
ptlPairCardMe: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" },
ptlPairHeader: { flexDirection: "row", alignItems: "center" },
ptlPairName: { fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text },
ptlPairSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
ptlPairRoute: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
ptlPairRouteText: { flex: 1, fontSize: 13, color: COLORS.text, fontFamily: "Inter_500Medium" },
ptlPairChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
ptlCallBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: COLORS.success },
ptlCallBtnText: { color: COLORS.surface, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 15 },
ptlCallLockedRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
ptlCallLockedText: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_500Medium" },
ptlWaitingCard: { alignItems: "center", justifyContent: "center", paddingVertical: 28, paddingHorizontal: 18, backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: COLORS.border },
ptlWaitingTitle: { fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.text, marginTop: 10 },
ptlWaitingSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 6, textAlign: "center", lineHeight: 17 },
ptlDateBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14 },
ptlDateBtnText: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: COLORS.text },
ptlWeightRow: { flexDirection: "row", alignItems: "center", gap: 10 },
ptlWeightUnit: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", color: COLORS.primary, minWidth: 30 },
});
