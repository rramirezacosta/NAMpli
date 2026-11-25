import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bank, PresetMeta, PresetPayload, RigSnapshot } from '../types/preset';
import { DEFAULT_RIG, slotLabel } from '../types/preset';
import { notifyError, notifySuccess } from '../notifications';
import {
  deletePreset,
  listPresets,
  loadPreset,
  loadRigAssets,
  renamePreset,
  savePreset,
} from '../tauri';

interface PreviewBackup {
  snapshot: RigSnapshot;
  bank: Bank;
  slot: number;
  activeName: string | null;
  baseline: RigSnapshot;
}

const KNOB_KEYS = [
  'inputVolume',
  'gate',
  'bass',
  'middle',
  'treble',
  'outputVolume',
  'reverb',
] as const;

function sameAsset(a: RigSnapshot['model'], b: RigSnapshot['model']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.name === b.name;
}

/** Knob setters round-trip through f32 in the backend, so allow tiny drift. */
const KNOB_EPSILON = 1e-4;

/** Only front-panel knob edits trigger auto-save; asset changes are explicit. */
function sameKnobs(a: RigSnapshot, b: RigSnapshot): boolean {
  return KNOB_KEYS.every((key) => Math.abs(a[key] - b[key]) <= KNOB_EPSILON);
}

function sameRig(a: RigSnapshot, b: RigSnapshot): boolean {
  return (
    KNOB_KEYS.every((key) => Math.abs(a[key] - b[key]) <= KNOB_EPSILON) &&
    sameAsset(a.model, b.model) &&
    sameAsset(a.ir, b.ir)
  );
}

export function usePresetManager(
  snapshot: RigSnapshot,
  applySnapshot: (rig: RigSnapshot) => void,
  clearModelAndIr: () => Promise<void>,
) {
  const [metas, setMetas] = useState<PresetMeta[]>([]);
  const [bank, setBank] = useState<Bank>('A');
  const [slot, setSlot] = useState(1);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<RigSnapshot>(DEFAULT_RIG);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewBackup | null>(null);

  /** Ref mirror so an in-flight recall cannot overwrite the original backup. */
  const previewRef = useRef<PreviewBackup | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMetas(await listPresets());
    } catch (err) {
      console.error('Failed to list presets:', err);
      notifyError(`Could not list presets: ${err}`);
    }
  }, []);

  useEffect(() => {
    // Async data load; the setter runs after the first render.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh();
  }, [refresh]);

  /**
   * "Dirty = would Save change anything?" For a saved preset we compare against
   * its recalled rig; for an empty slot the baseline is a blank preset
   * (DEFAULT_RIG), so the dot appears once the working state differs from it.
   */
  const dirty = !sameRig(snapshot, baseline);

  const metaAt = useCallback(
    (targetBank: Bank, targetSlot: number) =>
      metas.find((meta) => meta.bank === targetBank && meta.slot === targetSlot),
    [metas],
  );

  /** Push a rig to the live sound without reloading NAM/IR (knob-only edits). */
  const applyRig = useCallback((rig: RigSnapshot) => applySnapshot(rig), [applySnapshot]);

  /** Push a rig plus its NAM/IR into the engine (asset edits and editor cancel). */
  const applyLiveRig = useCallback(
    async (rig: RigSnapshot) => {
      try {
        await loadRigAssets(rig);
      } catch (err) {
        console.error('Failed to load rig assets:', err);
        notifyError(`Could not load preset assets: ${err}`);
      }
      applySnapshot(rig);
    },
    [applySnapshot],
  );

  /** Remember the sound we are leaving so an audition can always be undone. */
  const beginPreview = useCallback(() => {
    if (previewRef.current) return;
    const backup = { snapshot, bank, slot, activeName, baseline };
    previewRef.current = backup;
    setPreview(backup);
  }, [snapshot, bank, slot, activeName, baseline]);

  /**
   * Audition: load the preset immediately. Escape reverts, Enter keeps it.
   * A second audition does not replace the backup, so revert always returns
   * to the sound the user started from.
   */
  const recallAt = useCallback(
    async (targetBank: Bank, targetSlot: number) => {
      const meta = metaAt(targetBank, targetSlot);
      if (!meta) {
        notifyError(`Slot ${targetBank}${targetSlot} is empty`);
        return;
      }
      beginPreview();
      setBusy(true);
      try {
        const preset = await loadPreset(meta.name);
        applySnapshot(preset.rig);
        setBank(targetBank);
        setSlot(targetSlot);
        setActiveName(meta.name);
        setBaseline(preset.rig);
        notifySuccess(`Loaded ${meta.name}`);
      } catch (err) {
        console.error('Failed to recall preset:', err);
        notifyError(`Could not load preset: ${err}`);
      } finally {
        setBusy(false);
      }
    },
    [metaAt, applySnapshot, beginPreview],
  );

  /**
   * Select an empty slot: it holds no NAM or IR, so load bypass (keep the knob
   * positions) and make it the Save target. Also auditionable/revertible.
   */
  const selectAt = useCallback(
    (targetBank: Bank, targetSlot: number) => {
      beginPreview();
      setBank(targetBank);
      setSlot(targetSlot);
      setActiveName(null);
      // An empty slot compares against a blank preset, not the current knobs.
      setBaseline(DEFAULT_RIG);
      void clearModelAndIr();
    },
    [clearModelAndIr, beginPreview],
  );

  /** Keep the auditioned sound as the current working state. */
  const commitPreview = useCallback(() => {
    if (!previewRef.current) return;
    previewRef.current = null;
    setPreview(null);
    notifySuccess('Preview kept');
  }, []);

  /** Revert an audition, including the NAM/IR loaded into the audio engine. */
  const revertPreview = useCallback(async () => {
    const backup = previewRef.current;
    if (!backup) return;
    setBusy(true);
    try {
      await loadRigAssets(backup.snapshot);
      applySnapshot(backup.snapshot);
      setBank(backup.bank);
      setSlot(backup.slot);
      setActiveName(backup.activeName);
      setBaseline(backup.baseline);
      previewRef.current = null;
      setPreview(null);
      notifySuccess('Reverted to previous sound');
    } catch (err) {
      console.error('Failed to revert preview:', err);
      notifyError(`Could not revert: ${err}`);
    } finally {
      setBusy(false);
    }
  }, [applySnapshot]);

  const save = useCallback(
    async (name?: string, targetBank: Bank = bank, targetSlot: number = slot, silent = false) => {
      const finalName = (name ?? activeName ?? `Preset ${targetBank}${targetSlot}`).trim();
      if (!finalName) {
        notifyError('Enter a preset name first.');
        return;
      }
      const occupant = metaAt(targetBank, targetSlot);
      if (
        occupant &&
        occupant.name !== finalName &&
        !window.confirm(`Replace "${occupant.name}" in ${targetBank}${targetSlot}?`)
      ) {
        return;
      }

      const payload: PresetPayload = {
        schemaVersion: 1,
        name: finalName,
        bank: targetBank,
        slot: targetSlot,
        updatedAt: Date.now(),
        rig: snapshot,
      };
      setBusy(true);
      try {
        if (occupant && occupant.name !== finalName) {
          await deletePreset(occupant.name);
        }
        await savePreset(payload);
        await refresh();
        setBank(targetBank);
        setSlot(targetSlot);
        setActiveName(finalName);
        setBaseline(snapshot);
        // Saving means the sound is no longer a preview.
        previewRef.current = null;
        setPreview(null);
        if (!silent) notifySuccess(`Saved ${finalName}`);
      } catch (err) {
        console.error('Failed to save preset:', err);
        notifyError(`Could not save preset: ${err}`);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [activeName, bank, slot, metaAt, snapshot, refresh],
  );

  /**
   * Knob edits are persisted to the active preset automatically. The debounce
   * coalesces a knob drag into one write; auditions are excluded so Revert
   * still restores the stored preset.
   */
  useEffect(() => {
    if (!activeName || preview || busy) return;
    if (sameKnobs(snapshot, baseline)) return;
    const timer = window.setTimeout(() => {
      void save(activeName, bank, slot, true);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [activeName, bank, slot, preview, busy, snapshot, baseline, save]);

  const rename = useCallback(
    async (sourceName: string, newName: string): Promise<boolean> => {
      const clean = newName.trim();
      if (!clean) {
        notifyError('Enter a preset name first.');
        return false;
      }
      setBusy(true);
      try {
        await renamePreset(sourceName, clean);
        await refresh();
        if (activeName === sourceName) setActiveName(clean);
        if (previewRef.current?.activeName === sourceName) {
          const updated = { ...previewRef.current, activeName: clean };
          previewRef.current = updated;
          setPreview(updated);
        }
        notifySuccess(`Renamed to ${clean}`);
        return true;
      } catch (err) {
        console.error('Failed to rename preset:', err);
        notifyError(`Could not rename preset: ${err}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [activeName, refresh],
  );

  /**
   * Full-rig edit: write an arbitrary stored payload in place. Unlike save(),
   * this never touches the live snapshot or the audition backup. The live sound
   * only changes when the user recalls the edited preset.
   */
  const update = useCallback(
    async (source: string, next: PresetPayload): Promise<boolean> => {
      const clean = next.name.trim();
      if (!clean) {
        notifyError('Enter a preset name first.');
        return false;
      }
      // Renaming must happen first: writing the new name while the old file
      // still occupies the same slot would be rejected by the backend.
      const renamed = clean !== source;
      setBusy(true);
      try {
        if (renamed) await renamePreset(source, clean);
        await savePreset({ ...next, name: clean });
        await refresh();
        // The editor previews the edited rig live, so saving makes it the
        // current, clean sound rather than leaving a phantom "unsaved" dot.
        setActiveName(clean);
        setBaseline(next.rig);
        previewRef.current = null;
        setPreview(null);
        notifySuccess(`Updated ${slotLabel(next.bank, next.slot)} · ${clean}`);
        return true;
      } catch (err) {
        console.error('Failed to update preset:', err);
        if (renamed) {
          try {
            await renamePreset(clean, source);
          } catch (rollbackErr) {
            console.error('Failed to roll back preset rename:', rollbackErr);
          }
        }
        notifyError(`Could not update preset: ${err}`);
        await refresh();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (name: string) => {
      if (!name || !window.confirm(`Delete preset "${name}"?`)) return;
      setBusy(true);
      try {
        await deletePreset(name);
        await refresh();
        if (previewRef.current?.activeName === name) {
          previewRef.current = null;
          setPreview(null);
        }
        if (activeName === name) {
          setActiveName(null);
          setBaseline(DEFAULT_RIG);
        }
        notifySuccess(`Deleted ${name}`);
      } catch (err) {
        console.error('Failed to delete preset:', err);
        notifyError(`Could not delete preset: ${err}`);
      } finally {
        setBusy(false);
      }
    },
    [activeName, refresh],
  );

  return {
    metas,
    bank,
    slot,
    activeName,
    liveSnapshot: snapshot,
    applyRig,
    applyLiveRig,
    dirty,
    busy,
    preview,
    commitPreview,
    revertPreview,
    setBank,
    metaAt,
    recallAt,
    selectAt,
    save,
    rename,
    update,
    remove,
    refresh,
  };
}

export type PresetManager = ReturnType<typeof usePresetManager>;
