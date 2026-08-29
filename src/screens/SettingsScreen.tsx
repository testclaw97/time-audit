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
import AndroidExtraRow from "../ui/AndroidExtraRow";
import type { Category } from "../lib/store";
import {
  addCategory,
  clearAllData,
  clearAllEntries,
  pausePopups,
  removeCategory,
  reorderCategories,
  resetCategories,
  resumePopups,
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
import { formatClock, formatDuration } from "../lib/time";

// 0.5/1/2 = fast test cadences (30s / 1min / 2min); the rest are the normal minute options.
const INTERVALS = [0.5, 1, 2, 5, 10, 15, 20, 30, 45, 60] as const;
/** Chip / a11y label for an interval in minutes: "30s" for sub-minute, else "15m". */
const intervalLabel = (m: number) => (m < 1 ? `${Math.round(m * 60)}s` : `${m}m`);
// OEM skins (Xiaomi/MIUI, Samsung, …) hide extra pop-up / autostart / battery switches that
// standard Android permissions DON'T cover — the popup is silently blocked until they're on.
const OEM_BRANDS = /xiaomi|redmi|poco|samsung|oppo|realme|oneplus|vivo|huawei|honor/;
// Snooze presets for the "Pause popups" control (matches the Home screen).
const SNOOZE_PRESETS = [
  { label: "30 min", ms: 30 * 60 * 1000 },
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "2 hours", ms: 2 * 60 * 60 * 1000 },
] as const;

/** Milliseconds until the next local wake boundary (today if still ahead, else tomorrow). */
function msUntilNextWake(wakeMinutes: number): number {
  const now = new Date();
  const wake = new Date(now);
  wake.setHours(Math.floor(wakeMinutes / 60), wakeMinutes % 60, 0, 0);
  if (wake.getTime() <= now.getTime()) wake.setDate(wake.getDate() + 1);
  return wake.getTime() - now.getTime();
}
// Preset color palette for the category editor (mirrors the default category hues).
const SWATCHES = [
  "#f5a623", "#ffb84d", "#ff5d6c", "#38c8b0", "#7bd88f",
  "#6c8cff", "#b98cff", "#ff9f43", "#8a94a6", "#4dd0e1",
];

type EditorState =
  | { mode: "add" | "edit"; id?: string; label: string; emoji: string; color: string }
  | null;

type Perms = { overlay: boolean; exact: boolean; fsi: boolean; battery: boolean };

export default function SettingsScreen({
  onReset,
  onClose,
  onGoHome,
  onRequestCatchUp,
}: {
  onReset: () => void;
  /** Close the Settings modal (App.tsx wires this to the header "Done" button). */
  onClose?: () => void;
  /** Jump back to the Today tab (after clearing, so the user can re-enter their day). */
  onGoHome?: () => void;
  /** Ask App to re-open the (mandatory) catch-up wall — used after clearing so the empty day
   *  immediately prompts to be re-filled. */
  onRequestCatchUp?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { settings } = useStore();
  const [scheduled, setScheduled] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [perms, setPerms] = useState<Perms>({ overlay: true, exact: true, fsi: true, battery: true });
  const [engineRunning, setEngineRunning] = useState<boolean | null>(null);
  const [manufacturer, setManufacturer] = useState("");
  const [showSnooze, setShowSnooze] = useState(false);
  const isOem = OEM_BRANDS.test(manufacturer);
  const brand = manufacturer
    ? manufacturer.charAt(0).toUpperCase() + manufacturer.slice(1)
    : "phone";
  // 1s heartbeat while paused so the "paused until …" line stays fresh and the control flips
  // back to "Pause popups" the moment the snooze expires.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const paused = settings.pausedUntil > nowMs;

  const native = isAvailable();

  useEffect(() => {
    if (settings.pausedUntil <= Date.now()) {
      setNowMs(Date.now());
      return;
    }
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [settings.pausedUntil]);

  const snooze = (ms: number) => {
    void pausePopups(ms);
    setShowSnooze(false);
  };
  const resumeSnooze = () => {
    void resumePopups();
    setShowSnooze(false);
  };

  const refreshScheduled = async () => setScheduled(await countScheduled());
  useEffect(() => {
    refreshScheduled();
  }, [settings.tracking, settings.wakeMinutes, settings.sleepMinutes, settings.intervalMinutes]);

  // Re-check the native special-access permission states on mount + whenever we return to the
  // foreground (the user grants them in system Settings, so the value changes off-screen).
  const refreshPerms = useCallback(async () => {
    if (!isAvailable() || !TimePing) return;
    try {
      const [overlay, exact, fsi, battery, engine] = await Promise.all([
        TimePing.hasOverlayPermission(),
        TimePing.hasExactAlarm(),
        TimePing.hasFullScreenIntent(),
        TimePing.hasBatteryExemption(),
        TimePing.isEngineRunning(),
      ]);
      setPerms({ overlay, exact, fsi, battery });
      setEngineRunning(engine);
    } catch (e) {
      console.warn("[settings] refreshPerms failed", e);
    }
  }, []);

  // Re-check perms + engine health on mount and on every foreground (focus). Fetch the OEM brand
  // once — it never changes for the life of the process.
  useEffect(() => {
    refreshPerms();
    void (async () => {
      if (isAvailable() && TimePing) {
        try {
          setManufacturer((await TimePing.getManufacturer()) || "");
        } catch (e) {
          console.warn("[settings] getManufacturer failed", e);
        }
      }
    })();
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

  // Clear only the logged entries (every day's data) — keeps categories/window/setup. Confirm →
  // clear → send them home and re-open the catch-up so the now-empty day prompts a re-fill.
  const clearLogs = () => {
    Alert.alert(
      "Clear all logged data?",
      "Every logged block (all days) is deleted. Your categories, window and settings stay.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await clearAllEntries();
            onGoHome?.();
            onRequestCatchUp?.();
            Alert.alert("Logged data cleared", "Fill in your day on the catch-up screen.");
          },
        },
      ],
    );
  };

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
  // "Test the popup" now fires through the REAL alarm path ~4s later, so you can lock the phone
  // and confirm the popup shows over the lock screen. Confirm inline so the delay isn't confusing.
  const testPopup = () => {
    if (isAvailable() && TimePing) {
      TimePing.triggerTestPing().catch((e) => console.warn("[settings] triggerTestPing", e));
      Alert.alert(
        "Popup coming in ~4s",
        "Lock your phone now to test the lock-screen popup.",
      );
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

  // OEM (Xiaomi/Samsung/…) extra switches: open the OEM screen, then re-check on return. The app
  // can't read the MIUI ops directly, so these are best-effort bounces to the right settings page.
  const runOem = async (fn: () => Promise<void>, label: string) => {
    if (!isAvailable() || !TimePing) return;
    try {
      await fn();
    } catch (e) {
      console.warn(`[settings] ${label} failed`, e);
    }
    refreshPerms();
  };
  const openOemPerms = () =>
    runOem(() => TimePing!.openOemAppPermissions(), "openOemAppPermissions");
  const openAutostart = () => runOem(() => TimePing!.openOemAutostart(), "openOemAutostart");
  const openOemBattery = () =>
    runOem(() => TimePing!.requestBatteryExemption(), "requestBatteryExemption");

  const toggleLockScreen = () => {
    void updateSettings({ lockScreenPopup: !settings.lockScreenPopup });
  };
  const toggleAutostartDone = () => void updateSettings({ autostartDone: !settings.autostartDone });
  const togglePopupDone = () => void updateSettings({ popupDone: !settings.popupDone });
  const toggleHardcore = () => void updateSettings({ hardcoreMode: !settings.hardcoreMode });

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.s3, paddingBottom: insets.bottom + space.s6 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {onClose ? (
        <View style={styles.topBar}>
          <PressableScale onPress={onClose} accessibilityLabel="Close settings" style={styles.doneBtn} scaleTo={0.95}>
            <Text style={styles.doneText}>‹ Done</Text>
          </PressableScale>
        </View>
      ) : null}

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

      <FadeIn delay={95}>
        <Text style={[type.label, styles.sectionLabel]}>PAUSE POPUPS</Text>
        {paused ? (
          <Card tone="accent" style={styles.snoozePaused}>
            <View style={styles.rowText}>
              <Text style={[type.bodyStrong, styles.snoozePausedTitle]} numberOfLines={1}>
                🔕 Paused until {formatClock(settings.pausedUntil)}
              </Text>
              <Text style={[type.caption, styles.rowSub]}>
                No check-ins will pop up until then.
              </Text>
            </View>
            <PressableScale
              onPress={resumeSnooze}
              accessibilityLabel="Resume popups now"
              style={styles.resumeBtn}
            >
              <Text style={styles.resumeText}>Resume</Text>
            </PressableScale>
          </Card>
        ) : (
          <>
            <PressableScale
              onPress={() => setShowSnooze((v) => !v)}
              accessibilityLabel="Pause popups"
              style={styles.snoozeRow}
              scaleTo={0.99}
            >
              <Text style={[type.bodyStrong, styles.snoozeRowText]}>🔕 Pause popups</Text>
              <Text style={styles.snoozeChevron}>{showSnooze ? "▴" : "▾"}</Text>
            </PressableScale>
            {showSnooze ? (
              <View style={styles.snoozeOptions}>
                {SNOOZE_PRESETS.map((p) => (
                  <PressableScale
                    key={p.label}
                    onPress={() => snooze(p.ms)}
                    accessibilityLabel={`Pause popups for ${p.label}`}
                    style={styles.snoozeChip}
                    scaleTo={0.94}
                  >
                    <Text style={styles.snoozeChipText}>{p.label}</Text>
                  </PressableScale>
                ))}
                <PressableScale
                  onPress={() => snooze(msUntilNextWake(settings.wakeMinutes))}
                  accessibilityLabel="Pause popups until tomorrow"
                  style={styles.snoozeChip}
                  scaleTo={0.94}
                >
                  <Text style={styles.snoozeChipText}>Until tomorrow</Text>
                </PressableScale>
              </View>
            ) : null}
          </>
        )}
        <Text style={styles.hint}>Silence the check-in popups for a while without turning tracking off.</Text>
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
                accessibilityLabel={m < 1 ? `Every ${Math.round(m * 60)} seconds` : `Every ${m} minutes`}
                accessibilityState={{ selected: active }}
                scaleTo={0.94}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{intervalLabel(m)}</Text>
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

      <FadeIn delay={220}>
        <Text style={[type.label, styles.sectionLabel]}>THE POPUP</Text>
        <Button label="Test the popup" icon="⚡" onPress={testPopup} testID="test-popup" />
        <Text style={styles.hint}>
          Fires in a few seconds — lock your phone now to test the lock-screen popup.
        </Text>

        {native ? (
          <Card tone="flat" style={styles.engineCard}>
            <View style={styles.rowBetween}>
              <View style={styles.rowText}>
                <Text style={[type.bodyStrong, styles.rowTitle]}>
                  Tracking engine:{" "}
                  {engineRunning === null
                    ? "checking…"
                    : engineRunning
                    ? "running ✓"
                    : "not running"}
                </Text>
                {engineRunning === false ? (
                  <Text style={[type.caption, styles.rowSub]}>
                    Tap "Test the popup" above, or check battery / autostart below.
                  </Text>
                ) : null}
              </View>
              <Text style={engineRunning ? styles.engineOk : styles.engineBad}>
                {engineRunning === null ? "…" : engineRunning ? "✓" : "!"}
              </Text>
            </View>
          </Card>
        ) : null}

        <Card style={styles.lockToggleCard}>
          <View style={styles.rowBetween}>
            <View style={styles.rowText}>
              <Text style={[type.bodyStrong, styles.rowTitle]}>Show over lock screen</Text>
              <Text style={[type.caption, styles.rowSub]}>
                Off = the popup only appears while you're using the phone.
              </Text>
            </View>
            <Toggle value={settings.lockScreenPopup} onToggle={toggleLockScreen} />
          </View>
        </Card>

        <Card tone={settings.hardcoreMode ? "accent" : undefined} style={styles.lockToggleCard}>
          <View style={styles.rowBetween}>
            <View style={styles.rowText}>
              <Text style={[type.bodyStrong, styles.rowTitle]}>🔒 Hardcore mode</Text>
              <Text style={[type.caption, styles.rowSub]}>
                Every time you unlock your phone, the check-in takes over the screen until you answer
                the last block — once per 15 minutes. The most reliable way to never miss one.
              </Text>
            </View>
            <Toggle value={settings.hardcoreMode} onToggle={toggleHardcore} />
          </View>
        </Card>

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

        {native ? (
          <Card tone="flat" style={styles.oemCard}>
            <Text style={styles.oemHeader}>ANDROID EXTRAS (OPTIONAL)</Text>
            <Text style={[type.caption, styles.oemBody]}>
              Some Androids hide extra switches the app can't read. Turn them on for the most
              reliable pings, then mark them done.
            </Text>
            <AndroidExtraRow
              title="Android autostart"
              note="Let Time Audit wake itself to ping you after a reboot or when killed."
              done={settings.autostartDone}
              onOpen={openAutostart}
              onToggleDone={toggleAutostartDone}
              testID="android-autostart"
            />
            <View style={styles.divider} />
            <AndroidExtraRow
              title="Android background pop-up"
              note='A "show pop-up while in background" switch some skins hide — on = the full popup can appear.'
              done={settings.popupDone}
              onOpen={openOemPerms}
              onToggleDone={togglePopupDone}
              testID="android-popup"
            />
          </Card>
        ) : null}
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
        <Button label="Clear logged data" variant="ghost" onPress={clearLogs} testID="clear-logs" />
        <Text style={styles.hint}>
          Wipes every logged block (all days) but keeps your categories, window and settings.
        </Text>
        <View style={styles.dangerGap} />
        <Button
          label={armed ? "Tap again to erase everything" : "Clear all data"}
          variant="danger"
          onPress={clearData}
          testID="clear-data"
        />
        <Text style={styles.hint}>
          Deletes every logged slot AND resets the app to a fresh install. This can't be undone.
        </Text>
      </FadeIn>

      <Text style={styles.version}>Time Audit · v1.0 · on-device only</Text>
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
  topBar: { flexDirection: "row", alignItems: "center", marginBottom: space.s0 },
  doneBtn: {
    paddingVertical: space.s1,
    paddingHorizontal: space.s2,
    marginLeft: -space.s2,
    borderRadius: radius.pill,
  },
  doneText: { ...type.subheading, color: colors.accent, fontWeight: "800" },
  kicker: { color: colors.accent, marginBottom: 2 },
  title: { color: colors.fg, marginBottom: space.s1 },
  sectionLabel: { color: colors.muted, marginTop: space.s2, marginBottom: space.s1 },

  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowText: { flex: 1, paddingRight: space.s2 },
  rowTitle: { color: colors.fg },
  rowSub: { color: colors.muted, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.s0 },
  hint: { ...type.caption, color: colors.muted, marginTop: space.s1 },
  dangerGap: { height: space.s2 },
  note: { color: colors.fg2, lineHeight: 20 },
  version: { ...type.caption, color: colors.faint, textAlign: "center", marginTop: space.s4 },

  // pause popups (snooze)
  snoozeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1 + 4,
  },
  snoozeRowText: { color: colors.fg2 },
  snoozeChevron: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  snoozeOptions: { flexDirection: "row", flexWrap: "wrap", gap: space.s1, marginTop: space.s1 },
  snoozeChip: {
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  snoozeChipText: { color: colors.fg2, fontWeight: "700", fontSize: 14 },
  snoozePaused: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
  },
  snoozePausedTitle: { color: colors.accent2 },
  resumeBtn: {
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  resumeText: { color: colors.onAccent, fontWeight: "800", fontSize: 14 },

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

  // engine health + lock-screen toggle + OEM extra switches
  engineCard: { marginTop: space.s1 },
  engineOk: { color: colors.teal, fontSize: 18, fontWeight: "800" },
  engineBad: { color: colors.accent, fontSize: 18, fontWeight: "800" },
  lockToggleCard: { marginTop: space.s1 },
  oemCard: { marginTop: space.s1, gap: space.s1 },
  oemHeader: { ...type.label, color: colors.accent },
  oemBody: { color: colors.fg2, marginBottom: space.s0 },

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
