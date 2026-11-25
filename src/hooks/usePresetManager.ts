import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bank, PresetMeta, PresetPayload, RigSnapshot } from '../types/preset';
import { DEFAULT_RIG } from '../types/preset';
import { notifyError, notifySuccess } from '../notifications';
import {
  deletePreset,
  exportPreset,
  getPreset,
  importPreset,
  listPresets,
  loadPreset,
  loadRigAssets,
  movePreset,
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

  const recall = useCallback(() => recallAt(bank, slot), [recallAt, bank, slot]);

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
    async (name?: string, targetBank: Bank = bank, targetSlot: number = slot) => {
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
        notifySuccess(`Saved ${finalName}`);
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

  /** Relocate a preset to another bank/slot. */
  const move = useCallback(
    async (name: string, targetBank: Bank, targetSlot: number): Promise<boolean> => {
      const occupant = metaAt(targetBank, targetSlot);
      if (
        occupant &&
        occupant.name !== name &&
        !window.confirm(`Replace "${occupant.name}" in ${targetBank}${targetSlot}?`)
      ) {
        return false;
      }
      setBusy(true);
      try {
        await movePreset(name, targetBank, targetSlot, !!occupant && occupant.name !== name);
        await refresh();
        if (activeName === name) {
          setBank(targetBank);
          setSlot(targetSlot);
        }
        notifySuccess(`Moved ${name} to ${targetBank}${targetSlot}`);
        return true;
      } catch (err) {
        console.error('Failed to move preset:', err);
        notifyError(`Could not move preset: ${err}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [metaAt, refresh, activeName],
  );

  /** Duplicate a preset into another slot under a fresh, unique name. */
  const copy = useCallback(
    async (name: string, targetBank: Bank, targetSlot: number): Promise<string | null> => {
      setBusy(true);
      try {
        const source = await getPreset(name);
        const used = new Set(metas.map((meta) => meta.name));
        let newName = `${source.name} copy`;
        let suffix = 2;
        while (used.has(newName)) newName = `${source.name} copy ${suffix++}`;

        const occupant = metaAt(targetBank, targetSlot);
        if (
          occupant &&
          !window.confirm(`Replace "${occupant.name}" in ${targetBank}${targetSlot}?`)
        ) {
          return null;
        }
        if (occupant) await deletePreset(occupant.name);

        await savePreset({
          schemaVersion: 1,
          name: newName,
          bank: targetBank,
          slot: targetSlot,
          updatedAt: Date.now(),
          rig: source.rig,
        });
        await refresh();
        notifySuccess(`Copied ${name} to ${targetBank}${targetSlot} as ${newName}`);
        return newName;
      } catch (err) {
        console.error('Failed to copy preset:', err);
        notifyError(`Could not copy preset: ${err}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [metas, metaAt, refresh],
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

  const exportJson = useCallback(async () => {
    if (!activeName) {
      notifyError('Select a preset first.');
      return null;
    }
    try {
      return await exportPreset(activeName);
    } catch (err) {
      notifyError(`Could not export preset: ${err}`);
      return null;
    }
  }, [activeName]);

  const importJson = useCallback(
    async (json: string) => {
      try {
        await importPreset(json);
        await refresh();
        notifySuccess('Preset imported');
      } catch (err) {
        console.error('Failed to import preset:', err);
        notifyError(`Could not import preset: ${err}`);
      }
    },
    [refresh],
  );

  return {
    metas,
    bank,
    slot,
    activeName,
    dirty,
    busy,
    preview,
    commitPreview,
    revertPreview,
    setBank,
    setSlot,
    metaAt,
    recall,
    recallAt,
    selectAt,
    save,
    rename,
    move,
    copy,
    remove,
    exportJson,
    importJson,
    refresh,
  };
}

export type PresetManager = ReturnType<typeof usePresetManager>;
