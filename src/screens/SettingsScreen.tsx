// Settings — tune the ping interval, edit categories, test the full-screen popup + grant its
// special-access permissions, set the awake window, pause/resume pings, and clear all data.
// Changing the interval or window reschedules; "Clear all data" is a two-tap arm-then-confirm.
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import Card from "../ui/Card";
import FadeIn from "../ui/FadeIn";
import TimeField from "../ui/TimeField";
import PressableScale from "../ui/PressableScale";
import Button from "../ui/Button";
import type { Category } from "../lib/store";
import {
  addCategory,
  clearAllData,
  removeCategory,
  reorderCategories,
  resetCategories,
  updateCategory,
  updateSettings,
  useStore,
} from "../lib/store";
import TimePing, { isAvailable } from "../../modules/time-ping";
import {
  cancelAllPings,
  countScheduled,
  requestPermission,
  reschedulePings,
  setupNotificationChannels,
} from "../lib/notifications";
import { formatDuration } from "../lib/time";

const INTERVALS = [5, 10, 15, 20, 30, 45, 60] as const;
// Preset color palette for the category editor (mirrors the default category hues).
const SWATCHES = [
  "#f5a623", "#ffb84d", "#ff5d6c", "#38c8b0", "#7bd88f",
  "#6c8cff", "#b98cff", "#ff9f43", "#8a94a6", "#4dd0e1",
];

type EditorState =
  | { mode: "add" | "edit"; id?: string; label: string; emoji: string; color: string }
  | null;

type Perms = { overlay: boolean; exact: boolean; fsi: boolean; battery: boolean };

export default function SettingsScreen({ onReset }: { onReset: () => void }) {
  const insets = useSafeAreaInsets();
  const { settings } = useStore();
  const [scheduled, setScheduled] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [perms, setPerms] = useState<Perms>({ overlay: true, exact: true, fsi: true, battery: true });

  const native = isAvailable();

  const refreshScheduled = async () => setScheduled(await countScheduled());
  useEffect(() => {
    refreshScheduled();
  }, [settings.tracking, settings.wakeMinutes, settings.sleepMinutes, settings.intervalMinutes]);

  // Re-check the native special-access permission states on mount + whenever we return to the
  // foreground (the user grants them in system Settings, so the value changes off-screen).
  const refreshPerms = useCallback(async () => {
    if (!isAvailable() || !TimePing) return;
    try {
      const [overlay, exact, fsi, battery] = await Promise.all([
        TimePing.hasOverlayPermission(),
        TimePing.hasExactAlarm(),
        TimePing.hasFullScreenIntent(),
        TimePing.hasBatteryExemption(),
      ]);
      setPerms({ overlay, exact, fsi, battery });
    } catch (e) {
      console.warn("[settings] refreshPerms failed", e);
    }
  }, []);

  useEffect(() => {
    refreshPerms();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refreshPerms();
    });
    return () => sub.remove();
  }, [refreshPerms]);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  const windowMinutes =
    (settings.sleepMinutes - settings.wakeMinutes + 24 * 60) % (24 * 60) || 24 * 60;
  const perDay = Math.floor(windowMinutes / settings.intervalMinutes);

  const changeWindow = async (patch: { wakeMinutes?: number; sleepMinutes?: number }) => {
    const next = await updateSettings(patch);
    if (next.tracking) await reschedulePings(next);
    refreshScheduled();
  };

  const changeInterval = async (intervalMinutes: number) => {
    if (intervalMinutes === settings.intervalMinutes) return;
    const next = await updateSettings({ intervalMinutes });
    if (next.tracking) await reschedulePings(next);
    refreshScheduled();
  };

  const toggleTracking = async () => {
    const next = await updateSettings({ tracking: !settings.tracking });
    if (next.tracking) {
      await setupNotificationChannels();
      await requestPermission();
      await reschedulePings(next);
    } else {
      await cancelAllPings();
    }
    refreshScheduled();
  };

  const clearData = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    await cancelAllPings();
    await clearAllData();
    onReset();
  };

  // ---- category actions ----
  const moveCategory = (index: number, dir: -1 | 1) => {
    const ids = settings.categories.map((c) => c.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorderCategories(ids);
  };

  const confirmDelete = (cat: Category) => {
    Alert.alert("Delete category?", `"${cat.label}" will be removed from the popup.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => removeCategory(cat.id) },
    ]);
  };

  const confirmReset = () => {
    Alert.alert("Reset categories?", "Restores the original set. Your logged entries are kept.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: () => resetCategories() },
    ]);
  };

  const saveEditor = async () => {
    if (!editor) return;
    const label = editor.label.trim();
    const emoji = editor.emoji.trim() || "📌";
    if (!label) return;
    if (editor.mode === "add") await addCategory({ label, emoji, color: editor.color });
    else if (editor.id) await updateCategory(editor.id, { label, emoji, color: editor.color });
    setEditor(null);
  };

  // ---- popup actions ----
  const testPopup = () => {
    if (isAvailable() && TimePing) {
      TimePing.triggerTestPing().catch((e) => console.warn("[settings] triggerTestPing", e));
    } else {
      Alert.alert(
        "Only in the installed app",
        "Build & install the app to see the full-screen popup.",
      );
    }
  };

  const request = async (which: "overlay" | "exact" | "fsi" | "battery") => {
    if (!isAvailable() || !TimePing) return;
    try {
      if (which === "overlay") await TimePing.requestOverlayPermission();
      else if (which === "exact") await TimePing.requestExactAlarm();
      else if (which === "fsi") await TimePing.requestFullScreenIntent();
      else await TimePing.requestBatteryExemption();
    } catch (e) {
      console.warn("[settings] request permission failed", e);
    }
    // The grant happens in a system screen; re-check will also fire on AppState 'active'.
    refreshPerms();
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.s3, paddingBottom: insets.bottom + space.s6 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <FadeIn>
        <Text style={[type.label, styles.kicker]}>SETTINGS</Text>
        <Text style={[type.title, styles.title]}>Tune your audit</Text>
      </FadeIn>

      <FadeIn delay={70}>
        <Text style={[type.label, styles.sectionLabel]}>TRACKING</Text>
        <Card>
          <View style={styles.rowBetween}>
            <View style={styles.rowText}>
              <Text style={[type.bodyStrong, styles.rowTitle]}>
                {settings.tracking ? "Pings are on" : "Pings are paused"}
              </Text>
              <Text style={[type.caption, styles.rowSub]}>
                {settings.tracking
                  ? `${scheduled ?? "…"} check-ins queued`
                  : "You won't be pinged until you resume"}
              </Text>
            </View>
            <Toggle value={settings.tracking} onToggle={toggleTracking} />
          </View>
        </Card>
      </FadeIn>

      <FadeIn delay={120}>
        <Text style={[type.label, styles.sectionLabel]}>HOW OFTEN?</Text>
        <View style={styles.chips}>
          {INTERVALS.map((m) => {
            const active = settings.intervalMinutes === m;
            return (
              <PressableScale
                key={m}
                onPress={() => changeInterval(m)}
                accessibilityRole="button"
                accessibilityLabel={`Every ${m} minutes`}
                accessibilityState={{ selected: active }}
                scaleTo={0.94}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{m}m</Text>
                {m === 15 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>HORMOZI</Text>
                  </View>
                ) : null}
              </PressableScale>
            );
          })}
        </View>
        <Text style={styles.hint}>How often the popup asks what you're doing.</Text>
      </FadeIn>

      <FadeIn delay={170}>
        <Text style={[type.label, styles.sectionLabel]}>CATEGORIES</Text>
        <Card padded={false}>
          {settings.categories.map((cat, i) => (
            <View key={cat.id}>
              {i > 0 ? <View style={styles.catDivider} /> : null}
              <View style={styles.catRow}>
                <PressableScale
                  onPress={() => setEditor({ mode: "edit", id: cat.id, label: cat.label, emoji: cat.emoji, color: cat.color })}
                  accessibilityLabel={`Edit ${cat.label}`}
                  style={styles.catMain}
                >
                  <View style={[styles.catDot, { backgroundColor: cat.color }]} />
                  <Text style={styles.catEmoji}>{cat.emoji}</Text>
                  <Text style={[type.bodyStrong, styles.catLabel]} numberOfLines={1}>
                    {cat.label}
                  </Text>
                </PressableScale>
                <View style={styles.catActions}>
                  <IconBtn
                    label={`Move ${cat.label} up`}
                    glyph="↑"
                    disabled={i === 0}
                    onPress={() => moveCategory(i, -1)}
                  />
                  <IconBtn
                    label={`Move ${cat.label} down`}
                    glyph="↓"
                    disabled={i === settings.categories.length - 1}
                    onPress={() => moveCategory(i, 1)}
                  />
                  <IconBtn label={`Delete ${cat.label}`} glyph="✕" danger onPress={() => confirmDelete(cat)} />
                </View>
              </View>
            </View>
          ))}
          <View style={styles.catDivider} />
          <PressableScale
            onPress={() => setEditor({ mode: "add", label: "", emoji: "", color: SWATCHES[0] })}
            accessibilityLabel="Add category"
            style={styles.catRow}
          >
            <View style={styles.addPlus}>
              <Text style={styles.addPlusText}>＋</Text>
            </View>
            <Text style={[type.bodyStrong, styles.addLabel]}>Add category</Text>
          </PressableScale>
        </Card>
        <PressableScale onPress={confirmReset} accessibilityLabel="Reset categories to defaults" style={styles.resetRow}>
          <Text style={styles.resetText}>Reset to defaults</Text>
        </PressableScale>
      </FadeIn>

      <FadeIn delay={220}>
        <Text style={[type.label, styles.sectionLabel]}>THE POPUP</Text>
        <Button label="Test the popup" icon="⚡" onPress={testPopup} testID="test-popup" />
        {native ? (
          <Card style={styles.permCard}>
            <PermissionRow
              title="Show over other apps"
              desc="Required for the popup to cover your screen."
              granted={perms.overlay}
              onAllow={() => request("overlay")}
            />
            <View style={styles.divider} />
            <PermissionRow
              title="Exact alarms"
              granted={perms.exact}
              onAllow={() => request("exact")}
            />
            <View style={styles.divider} />
            <PermissionRow
              title="Show over lock screen"
              granted={perms.fsi}
              onAllow={() => request("fsi")}
            />
            <View style={styles.divider} />
            <PermissionRow
              title="Ignore battery optimization"
              granted={perms.battery}
              onAllow={() => request("battery")}
            />
          </Card>
        ) : (
          <Text style={styles.hint}>
            The full-screen popup runs in the installed Android app.
          </Text>
        )}
      </FadeIn>

      <FadeIn delay={270}>
        <Text style={[type.label, styles.sectionLabel]}>AWAKE WINDOW</Text>
        <Card>
          <TimeField
            label="Wake up"
            icon="☀️"
            minutes={settings.wakeMinutes}
            onChange={(m) => changeWindow({ wakeMinutes: m })}
          />
          <View style={styles.divider} />
          <TimeField
            label="Wind down"
            icon="🌙"
            minutes={settings.sleepMinutes}
            onChange={(m) => changeWindow({ sleepMinutes: m })}
          />
        </Card>
        <Text style={styles.hint}>
          {formatDuration(windowMinutes)} awake · about {perDay} check-ins a day
        </Text>
      </FadeIn>

      <FadeIn delay={320}>
        <Text style={[type.label, styles.sectionLabel]}>HOW PINGS WORK</Text>
        <Card tone="flat">
          <Text style={[type.caption, styles.note]}>
            Pings are scheduled with your phone's alarm system, so they fire even when the
            app is closed. Time Audit keeps the next 24 hours queued and tops them up every
            time you open the app. After a phone restart, open the app once to re-arm them.
          </Text>
        </Card>
      </FadeIn>

      <FadeIn delay={370}>
        <Text style={[type.label, styles.sectionLabel]}>DANGER ZONE</Text>
        <Button
          label={armed ? "Tap again to erase everything" : "Clear all data"}
          variant="danger"
          onPress={clearData}
          testID="clear-data"
        />
        <Text style={styles.hint}>
          Deletes every logged slot and resets the app. This can't be undone.
        </Text>
      </FadeIn>

      <Text style={styles.version}>Time Audit · v1.0 · on-device only</Text>

      <CategoryEditor
        editor={editor}
        onChange={setEditor}
        onSave={saveEditor}
        onCancel={() => setEditor(null)}
      />
    </ScrollView>
  );
}

function Toggle({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  return (
    <PressableScale
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={[styles.toggle, value ? styles.toggleOn : styles.toggleOff]}
      scaleTo={0.94}
    >
      <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
    </PressableScale>
  );
}

function IconBtn({
  glyph,
  label,
  onPress,
  disabled,
  danger,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={[styles.iconBtn, disabled && styles.iconBtnDisabled]}
      hitSlop={4}
    >
      <Text style={[styles.iconGlyph, danger && styles.iconGlyphDanger]}>{glyph}</Text>
    </PressableScale>
  );
}

function PermissionRow({
  title,
  desc,
  granted,
  onAllow,
}: {
  title: string;
  desc?: string;
  granted: boolean;
  onAllow: () => void;
}) {
  return (
    <View style={styles.rowBetween}>
      <View style={styles.rowText}>
        <Text style={[type.bodyStrong, styles.rowTitle]}>{title}</Text>
        {desc ? <Text style={[type.caption, styles.permDesc]}>{desc}</Text> : null}
        <Text style={[type.caption, granted ? styles.permOk : styles.permNeed]}>
          {granted ? "Granted" : "Needed"}
        </Text>
      </View>
      {granted ? (
        <Text style={styles.permCheck}>✓</Text>
      ) : (
        <PressableScale onPress={onAllow} accessibilityLabel={`Allow ${title}`} style={styles.allowBtn}>
          <Text style={styles.allowText}>Allow</Text>
        </PressableScale>
      )}
    </View>
  );
}

function CategoryEditor({
  editor,
  onChange,
  onSave,
  onCancel,
}: {
  editor: EditorState;
  onChange: (e: EditorState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const open = editor !== null;
  const canSave = !!editor && editor.label.trim().length > 0;
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalScrim}>
        <View style={styles.modalCard}>
          <Text style={[type.heading, styles.modalTitle]}>
            {editor?.mode === "add" ? "New category" : "Edit category"}
          </Text>

          {editor ? (
            <>
              <Text style={[type.label, styles.fieldLabel]}>LABEL</Text>
              <TextInput
                value={editor.label}
                onChangeText={(t) => onChange({ ...editor, label: t })}
                placeholder="e.g. Meetings"
                placeholderTextColor={colors.faint}
                style={[type.body, styles.modalInput]}
                maxLength={24}
                autoFocus
              />

              <Text style={[type.label, styles.fieldLabel]}>EMOJI</Text>
              <TextInput
                value={editor.emoji}
                onChangeText={(t) => onChange({ ...editor, emoji: t })}
                placeholder="📌"
                placeholderTextColor={colors.faint}
                style={[type.body, styles.modalInput, styles.emojiInput]}
                maxLength={4}
              />

              <Text style={[type.label, styles.fieldLabel]}>COLOR</Text>
              <View style={styles.swatchRow}>
                {SWATCHES.map((c) => (
                  <PressableScale
                    key={c}
                    onPress={() => onChange({ ...editor, color: c })}
                    accessibilityLabel={`Color ${c}`}
                    accessibilityState={{ selected: editor.color === c }}
                    scaleTo={0.9}
                    style={[
                      styles.swatch,
                      { backgroundColor: c },
                      editor.color === c && styles.swatchActive,
                    ]}
                  >
                    <View />
                  </PressableScale>
                ))}
              </View>

              <View style={styles.modalActions}>
                <View style={styles.modalActionCol}>
                  <Button label="Cancel" variant="ghost" onPress={onCancel} />
                </View>
                <View style={styles.modalActionCol}>
                  <Button label="Save" onPress={onSave} disabled={!canSave} />
                </View>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.s3, gap: space.s2 },
  kicker: { color: colors.accent, marginBottom: 2 },
  title: { color: colors.fg, marginBottom: space.s1 },
  sectionLabel: { color: colors.muted, marginTop: space.s2, marginBottom: space.s1 },

  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowText: { flex: 1, paddingRight: space.s2 },
  rowTitle: { color: colors.fg },
  rowSub: { color: colors.muted, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.s0 },
  hint: { ...type.caption, color: colors.muted, marginTop: space.s1 },
  note: { color: colors.fg2, lineHeight: 20 },
  version: { ...type.caption, color: colors.faint, textAlign: "center", marginTop: space.s4 },

  // interval chips
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s1 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s0 + 2,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  chipText: { color: colors.fg2, fontWeight: "700", fontSize: 15 },
  chipTextActive: { color: colors.accent },
  badge: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { color: colors.onAccent, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },

  // categories
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.s2,
    paddingVertical: space.s1 + 2,
    gap: space.s1,
  },
  catDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginHorizontal: space.s2 },
  catMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.s1 },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  catEmoji: { fontSize: 17 },
  catLabel: { color: colors.fg, flexShrink: 1 },
  catActions: { flexDirection: "row", alignItems: "center", gap: space.s0 + 2 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnDisabled: { opacity: 0.35 },
  iconGlyph: { color: colors.fg2, fontSize: 15, fontWeight: "800" },
  iconGlyphDanger: { color: colors.danger },
  addPlus: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentLine,
    alignItems: "center",
    justifyContent: "center",
  },
  addPlusText: { color: colors.accent, fontSize: 15, fontWeight: "800" },
  addLabel: { color: colors.accent },
  resetRow: { alignSelf: "flex-start", paddingVertical: space.s1 },
  resetText: { ...type.caption, color: colors.muted, fontWeight: "700" },

  // permissions
  permCard: { marginTop: space.s1, gap: space.s0 },
  permDesc: { color: colors.muted, marginTop: 2 },
  permOk: { color: colors.teal, marginTop: 2 },
  permNeed: { color: colors.accent, marginTop: 2 },
  permCheck: { color: colors.teal, fontSize: 18, fontWeight: "800" },
  allowBtn: {
    paddingHorizontal: space.s2,
    paddingVertical: space.s0 + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentLine,
  },
  allowText: { color: colors.accent, fontWeight: "800", fontSize: 13 },

  // toggle
  toggle: { width: 52, height: 32, borderRadius: radius.pill, padding: 3, justifyContent: "center" },
  toggleOn: { backgroundColor: colors.accent },
  toggleOff: { backgroundColor: colors.surface3, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.lineStrong },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  knobOff: { alignSelf: "flex-start", backgroundColor: colors.muted },

  // modal editor
  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: space.s3,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    padding: space.s3,
  },
  modalTitle: { color: colors.fg, marginBottom: space.s2 },
  fieldLabel: { color: colors.muted, marginTop: space.s2, marginBottom: space.s1 },
  modalInput: {
    color: colors.fg,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1 + 2,
  },
  emojiInput: { width: 80, textAlign: "center", fontSize: 22 },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: space.s1 },
  swatch: { width: 34, height: 34, borderRadius: radius.pill, borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: colors.fg },
  modalActions: { flexDirection: "row", gap: space.s2, marginTop: space.s3 },
  modalActionCol: { flex: 1 },
});
