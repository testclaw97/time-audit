// Categories — its own tab now. Edit the set of one-tap answers the check-in offers: add, rename,
// recolor, reorder, delete, or reset to defaults. Everything writes straight to the store (which
// syncs to the native chooser), so changes show up on the very next check-in.
import React, { useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import Card from "../ui/Card";
import FadeIn from "../ui/FadeIn";
import PressableScale from "../ui/PressableScale";
import Button from "../ui/Button";
import type { Category, CategoryKind } from "../lib/store";
import {
  addCategory,
  removeCategory,
  reorderCategories,
  resetCategories,
  updateCategory,
  useStore,
} from "../lib/store";

// Preset color palette for the category editor (mirrors the default category hues).
const SWATCHES = [
  "#f5a623", "#ffb84d", "#ff5d6c", "#38c8b0", "#7bd88f",
  "#6c8cff", "#b98cff", "#ff9f43", "#8a94a6", "#4dd0e1",
];

// Deep / Shallow / Reactive — the kind drives the Insights split, so it's worth setting per category.
const KINDS: { key: CategoryKind; label: string; color: string }[] = [
  { key: "deep", label: "Deep", color: colors.teal },
  { key: "shallow", label: "Shallow", color: colors.accent },
  { key: "reactive", label: "Reactive", color: colors.danger },
];

type EditorState =
  | { mode: "add" | "edit"; id?: string; label: string; emoji: string; color: string; kind: CategoryKind }
  | null;

export default function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const { settings } = useStore();
  const [editor, setEditor] = useState<EditorState>(null);

  const moveCategory = (index: number, dir: -1 | 1) => {
    const ids = settings.categories.map((c) => c.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorderCategories(ids);
  };

  const confirmDelete = (cat: Category) => {
    Alert.alert("Delete category?", `"${cat.label}" will be removed from the check-in.`, [
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
    if (editor.mode === "add")
      await addCategory({ label, emoji, color: editor.color, kind: editor.kind });
    else if (editor.id)
      await updateCategory(editor.id, { label, emoji, color: editor.color, kind: editor.kind });
    setEditor(null);
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
        <Text style={[type.label, styles.kicker]}>CATEGORIES</Text>
        <Text style={[type.title, styles.title]}>Your one-tap answers</Text>
        <Text style={[type.caption, styles.lead]}>
          These are the buttons on every check-in. Tap one to edit; drag order with the arrows.
        </Text>
      </FadeIn>

      <FadeIn delay={70}>
        <Card padded={false}>
          <PressableScale
            onPress={() => setEditor({ mode: "add", label: "", emoji: "", color: SWATCHES[0], kind: "shallow" })}
            accessibilityLabel="Add category"
            style={styles.catRow}
          >
            <View style={styles.addPlus}>
              <Text style={styles.addPlusText}>＋</Text>
            </View>
            <Text style={[type.bodyStrong, styles.addLabel]}>Add category</Text>
          </PressableScale>
          {settings.categories.map((cat, i) => (
            <View key={cat.id}>
              <View style={styles.catDivider} />
              <View style={styles.catRow}>
                <PressableScale
                  onPress={() =>
                    setEditor({
                      mode: "edit",
                      id: cat.id,
                      label: cat.label,
                      emoji: cat.emoji,
                      color: cat.color,
                      kind: cat.kind,
                    })
                  }
                  accessibilityLabel={`Edit ${cat.label}`}
                  style={styles.catMain}
                >
                  <View style={[styles.catDot, { backgroundColor: cat.color }]} />
                  <Text style={styles.catEmoji}>{cat.emoji}</Text>
                  <View style={styles.catText}>
                    <Text style={[type.bodyStrong, styles.catLabel]} numberOfLines={1}>
                      {cat.label}
                    </Text>
                    <Text style={styles.catKind}>{cat.kind}</Text>
                  </View>
                </PressableScale>
                <View style={styles.catActions}>
                  <IconBtn label={`Move ${cat.label} up`} glyph="↑" disabled={i === 0} onPress={() => moveCategory(i, -1)} />
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
        </Card>
        <PressableScale onPress={confirmReset} accessibilityLabel="Reset categories to defaults" style={styles.resetRow}>
          <Text style={styles.resetText}>Reset to defaults</Text>
        </PressableScale>
      </FadeIn>

      <CategoryEditor editor={editor} onChange={setEditor} onSave={saveEditor} onCancel={() => setEditor(null)} />
    </ScrollView>
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

              <Text style={[type.label, styles.fieldLabel]}>TYPE</Text>
              <View style={styles.kindRow}>
                {KINDS.map((k) => {
                  const active = editor.kind === k.key;
                  return (
                    <PressableScale
                      key={k.key}
                      onPress={() => onChange({ ...editor, kind: k.key })}
                      accessibilityLabel={`Type ${k.label}`}
                      accessibilityState={{ selected: active }}
                      style={[styles.kindChip, active && { backgroundColor: k.color + "26", borderColor: k.color }]}
                      scaleTo={0.94}
                    >
                      <View style={[styles.kindDot, { backgroundColor: k.color }]} />
                      <Text style={[styles.kindText, active && { color: colors.fg }]}>{k.label}</Text>
                    </PressableScale>
                  );
                })}
              </View>

              <Text style={[type.label, styles.fieldLabel]}>COLOR</Text>
              <View style={styles.swatchRow}>
                {SWATCHES.map((c) => (
                  <PressableScale
                    key={c}
                    onPress={() => onChange({ ...editor, color: c })}
                    accessibilityLabel={`Color ${c}`}
                    accessibilityState={{ selected: editor.color === c }}
                    scaleTo={0.9}
                    style={[styles.swatch, { backgroundColor: c }, editor.color === c && styles.swatchActive]}
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
  title: { color: colors.fg, marginBottom: space.s0 },
  lead: { color: colors.muted, marginBottom: space.s1 },

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
  catText: { flexShrink: 1 },
  catLabel: { color: colors.fg },
  catKind: { ...type.caption, color: colors.muted, textTransform: "capitalize" },
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

  // modal editor
  modalScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: space.s3 },
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
  kindRow: { flexDirection: "row", gap: space.s1 },
  kindChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  kindDot: { width: 9, height: 9, borderRadius: 5 },
  kindText: { color: colors.fg2, fontWeight: "700", fontSize: 13 },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: space.s1 },
  swatch: { width: 34, height: 34, borderRadius: radius.pill, borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: colors.fg },
  modalActions: { flexDirection: "row", gap: space.s2, marginTop: space.s3 },
  modalActionCol: { flex: 1 },
});
