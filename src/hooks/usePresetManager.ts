import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bank, PresetMeta, PresetPayload, RigSnapshot } from '../types/preset';
import { DEFAULT_RIG } from '../types/preset';
import { notifyError, notifySuccess } from '../notifications';
import {
  deletePreset,
  exportPreset,
  importPreset,
  listPresets,
  loadPreset,
  renamePreset,
  savePreset,
} from '../tauri';

interface CompareBackup {
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

function sameRig(a: RigSnapshot, b: RigSnapshot): boolean {
  return (
    KNOB_KEYS.every((key) => a[key] === b[key]) &&
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
  const [comparing, setComparing] = useState(false);
  const compareBackup = useRef<CompareBackup | null>(null);

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

  const dirty = !sameRig(snapshot, baseline);

  const metaAt = useCallback(
    (targetBank: Bank, targetSlot: number) =>
      metas.find((meta) => meta.bank === targetBank && meta.slot === targetSlot),
    [metas],
  );

  const recallAt = useCallback(
    async (targetBank: Bank, targetSlot: number) => {
      const meta = metaAt(targetBank, targetSlot);
      if (!meta) {
        notifyError(`Slot ${targetBank}${targetSlot} is empty`);
        return;
      }
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
    [metaAt, applySnapshot],
  );

  const recall = useCallback(() => recallAt(bank, slot), [recallAt, bank, slot]);

  /**
   * Select an empty slot: it holds no NAM or IR, so load bypass (keep the knob
   * positions) and make it the Save target. Clearing the active name makes Save
   * default to a name for this slot instead of reusing one stored elsewhere.
   */
  const selectAt = useCallback(
    (targetBank: Bank, targetSlot: number) => {
      setBank(targetBank);
      setSlot(targetSlot);
      setActiveName(null);
      setBaseline({ ...snapshot, model: null, ir: null });
      void clearModelAndIr();
    },
    [snapshot, clearModelAndIr],
  );

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
    async (sourceName: string, newName: string) => {
      const clean = newName.trim();
      if (!clean) {
        notifyError('Enter a preset name first.');
        return;
      }
      setBusy(true);
      try {
        await renamePreset(sourceName, clean);
        await refresh();
        if (activeName === sourceName) setActiveName(clean);
        notifySuccess(`Renamed to ${clean}`);
      } catch (err) {
        console.error('Failed to rename preset:', err);
        notifyError(`Could not rename preset: ${err}`);
      } finally {
        setBusy(false);
      }
    },
    [activeName, refresh],
  );

  const remove = useCallback(
    async (name: string) => {
      if (!name || !window.confirm(`Delete preset "${name}"?`)) return;
      setBusy(true);
      try {
        await deletePreset(name);
        await refresh();
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

  /** A/B compare: swap to the other bank's matching slot, then restore. */
  const compare = useCallback(async () => {
    if (comparing) {
      const backup = compareBackup.current;
      if (backup) {
        applySnapshot(backup.snapshot);
        setBank(backup.bank);
        setSlot(backup.slot);
        setActiveName(backup.activeName);
        setBaseline(backup.baseline);
      }
      compareBackup.current = null;
      setComparing(false);
      return;
    }

    const otherBank: Bank = bank === 'A' ? 'B' : 'A';
    compareBackup.current = { snapshot, bank, slot, activeName, baseline };
    setComparing(true);
    // An empty slot holds no NAM/IR, so comparing against it means bypass.
    if (metaAt(otherBank, slot)) await recallAt(otherBank, slot);
    else selectAt(otherBank, slot);
    if (compareBackup.current === null) setComparing(false);
  }, [comparing, bank, slot, metaAt, snapshot, activeName, baseline, applySnapshot, recallAt, selectAt]);

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
    comparing,
    setBank,
    setSlot,
    metaAt,
    recall,
    recallAt,
    selectAt,
    save,
    rename,
    remove,
    compare,
    exportJson,
    importJson,
    refresh,
  };
}

export type PresetManager = ReturnType<typeof usePresetManager>;
