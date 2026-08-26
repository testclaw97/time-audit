// A small floating "feedback" button pinned bottom-right, always visible over the tab screens.
// Tapping opens a quick menu: report a problem, suggest a feature, or share the app. Report/
// suggest open an in-app compose box that POSTs to the private VPS endpoint, which forwards the
// message to TJ's Telegram — NO email address is ever shown to the user. Share uses the OS sheet.
// This is the app's ONLY network call, and only when the user explicitly submits feedback.
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import PressableScale from "./PressableScale";
import Button from "./Button";

const FEEDBACK_URL = "https://lumieremedia.agency/timeaudit/feedback";
const FEEDBACK_TOKEN = "c8cfca7a16dfa15dcb081c8f0b6338ad"; // stops casual abuse; not secret-grade
const APP_VERSION = "1.0.0";

const SHARE_TEXT =
  "I'm auditing my time with Time Audit — every 15 minutes it asks what I'm doing, " +
  "then shows where my week actually went. You get ~1,000 fifteen-minute blocks a week. " +
  "Where do yours go?";

type Compose = "bug" | "idea" | null;

async function sendFeedback(kind: "bug" | "idea", message: string): Promise<boolean> {
  try {
    const res = await fetch(FEEDBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Feedback-Token": FEEDBACK_TOKEN },
      body: JSON.stringify({
        type: kind,
        message,
        meta: `Time Audit v${APP_VERSION} · ${Platform.OS} ${Platform.Version}`,
      }),
    });
    const json = await res.json().catch(() => ({ ok: false }));
    return res.ok && json?.ok === true;
  } catch {
    return false;
  }
}

export default function FeedbackFab() {
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const [compose, setCompose] = useState<Compose>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const openCompose = (kind: "bug" | "idea") => {
    setMenu(false);
    setText("");
    setSent(false);
    setCompose(kind);
  };
  const closeCompose = () => {
    setCompose(null);
    setText("");
    setSending(false);
    setSent(false);
  };
  const share = () => {
    setMenu(false);
    void Share.share({ message: SHARE_TEXT }).catch(() => {});
  };

  const submit = async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    const ok = await sendFeedback(compose === "idea" ? "idea" : "bug", msg);
    setSending(false);
    if (ok) {
      setSent(true);
      setTimeout(closeCompose, 1300);
    } else {
      setSent(false);
      // leave the text so they can retry; a failed send just re-enables the button.
    }
  };

  const composeTitle = compose === "idea" ? "Suggest a feature" : "Report a problem";
  const composePlaceholder =
    compose === "idea"
      ? "Your idea — what would make Time Audit better?"
      : "What went wrong? What did you expect vs. what happened?";

  return (
    <>
      {/* Absolute positioning lives on the WRAPPER View, not the PressableScale (which only
          forwards flex/size to its Pressable, not position) — so the button pins bottom-right. */}
      <View style={[styles.fabWrap, { bottom: insets.bottom + FAB_LIFT }]}>
        <PressableScale
          onPress={() => setMenu(true)}
          accessibilityLabel="Feedback and sharing"
          accessibilityRole="button"
          style={styles.fab}
          scaleTo={0.9}
        >
          <Text style={styles.fabGlyph}>💬</Text>
        </PressableScale>
      </View>

      {/* Quick menu */}
      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <View style={styles.scrim}>
          <Pressable style={styles.backdrop} onPress={() => setMenu(false)} accessibilityLabel="Close" />
          <View style={[styles.menu, { bottom: insets.bottom + FAB_LIFT + 56 }]}>
            <MenuItem emoji="🐞" label="Report a problem" onPress={() => openCompose("bug")} />
            <View style={styles.divider} />
            <MenuItem emoji="💡" label="Suggest a feature" onPress={() => openCompose("idea")} />
            <View style={styles.divider} />
            <MenuItem emoji="↗" label="Share Time Audit" onPress={share} />
          </View>
        </View>
      </Modal>

      {/* Compose box */}
      <Modal visible={compose !== null} transparent animationType="fade" onRequestClose={closeCompose}>
        <KeyboardAvoidingView
          style={styles.composeScrim}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.backdrop} onPress={closeCompose} accessibilityLabel="Close" />
          <View style={styles.composeCard}>
            <Text style={[type.heading, styles.composeTitle]}>{composeTitle}</Text>
            {sent ? (
              <View style={styles.sentBox}>
                <Text style={styles.sentEmoji}>✓</Text>
                <Text style={[type.bodyStrong, styles.sentText]}>Sent — thank you!</Text>
              </View>
            ) : (
              <>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder={composePlaceholder}
                  placeholderTextColor={colors.faint}
                  style={[type.body, styles.input]}
                  multiline
                  autoFocus
                  maxLength={2000}
                  editable={!sending}
                />
                <Text style={styles.privacyNote}>
                  Goes straight to the developer. No account, no email needed.
                </Text>
                <View style={styles.composeActions}>
                  <View style={styles.composeCol}>
                    <Button label="Cancel" variant="ghost" onPress={closeCompose} />
                  </View>
                  <View style={styles.composeCol}>
                    {sending ? (
                      <View style={styles.sendingBtn}>
                        <ActivityIndicator color={colors.onAccent} />
                      </View>
                    ) : (
                      <Button label="Send" icon="↗" onPress={submit} disabled={!text.trim()} />
                    )}
                  </View>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// Height the FAB sits above the bottom inset — clears the ~68pt tab bar with margin.
const FAB_LIFT = 84;

function MenuItem({ emoji, label, onPress }: { emoji: string; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} style={styles.item} scaleTo={0.97}>
      <Text style={styles.itemEmoji}>{emoji}</Text>
      <Text style={[type.bodyStrong, styles.itemLabel]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  fabWrap: { position: "absolute", right: space.s3 },
  fab: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  fabGlyph: { fontSize: 22 },

  scrim: { flex: 1 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  menu: {
    position: "absolute",
    right: space.s3,
    minWidth: 220,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    paddingVertical: space.s0,
    ...(Platform.OS === "android" ? { elevation: 12 } : {}),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
  item: { flexDirection: "row", alignItems: "center", gap: space.s2, paddingVertical: space.s2, paddingHorizontal: space.s3 },
  itemEmoji: { fontSize: 18, width: 22, textAlign: "center" },
  itemLabel: { color: colors.fg },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginHorizontal: space.s2 },

  // compose
  composeScrim: { flex: 1, justifyContent: "center", padding: space.s3 },
  composeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    padding: space.s3,
    gap: space.s2,
  },
  composeTitle: { color: colors.fg },
  input: {
    color: colors.fg,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: space.s2,
    paddingTop: space.s2,
    paddingBottom: space.s2,
    minHeight: 120,
    textAlignVertical: "top",
  },
  privacyNote: { ...type.caption, color: colors.muted },
  composeActions: { flexDirection: "row", gap: space.s2, marginTop: space.s1 },
  composeCol: { flex: 1 },
  sendingBtn: {
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  sentBox: { alignItems: "center", gap: space.s1, paddingVertical: space.s3 },
  sentEmoji: { color: colors.teal, fontSize: 34, fontWeight: "800" },
  sentText: { color: colors.fg },
});
