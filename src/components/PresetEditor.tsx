import { useEffect, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getPreset, importAsset, listLibraryAssets } from '../tauri';
import { notifyError, notifySuccess } from '../notifications';
import type { PresetManager } from '../hooks/usePresetManager';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { fileNameFromPath } from '../utils/platform';
import type { AssetRef, PresetPayload, RigSnapshot } from '../types/preset';
import './PresetEditor.css';

const KNOBS: { key: keyof Pick<RigSnapshot, 'inputVolume' | 'gate' | 'bass' | 'middle' | 'treble' | 'outputVolume' | 'reverb'>; label: string }[] = [
  { key: 'inputVolume', label: 'Input' },
  { key: 'gate', label: 'Gate' },
  { key: 'bass', label: 'Bass' },
  { key: 'middle', label: 'Middle' },
  { key: 'treble', label: 'Treble' },
  { key: 'outputVolume', label: 'Output' },
  { key: 'reverb', label: 'Reverb' },
];

interface PresetEditorProps {
  sourceName: string;
  manager: PresetManager;
  onClose: () => void;
}

/** Edit a stored preset while hearing every change live; Cancel restores the old rig. */
export default function PresetEditor({ sourceName, manager, onClose }: PresetEditorProps) {
  const [draft, setDraft] = useState<PresetPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assets, setAssets] = useState<{ nam: AssetRef[]; ir: AssetRef[] }>({ nam: [], ir: [] });

  // The manager object is recreated each render, so keep a stable ref for the
  // load effect/cleanup while using the current value everywhere else.
  const managerRef = useRef(manager);
  const backupRef = useRef<RigSnapshot | null>(null);
  const shouldRestoreRef = useRef(false);
  const editorRef = useRef<HTMLFormElement>(null);

  // Focus stays in the editor and returns to the slot menu trigger on close.
  useDialogFocus(true, onClose, editorRef);

  useEffect(() => {
    managerRef.current = manager;
  }, [manager]);

  // Escape cancels (and the unmount cleanup restores the previous live rig).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    backupRef.current = managerRef.current.liveSnapshot;
    void (async () => {
      try {
        const [preset, nam, ir] = await Promise.all([
          getPreset(sourceName),
          listLibraryAssets('nam'),
          listLibraryAssets('ir'),
        ]);
        if (cancelled) return;
        setDraft(preset);
        setAssets({ nam, ir });
        // Opening the editor auditions the stored rig, assets included.
        shouldRestoreRef.current = true;
        await managerRef.current.applyLiveRig(preset.rig);
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
      }
    })();
    return () => {
      cancelled = true;
      if (shouldRestoreRef.current && backupRef.current) {
        void managerRef.current.applyLiveRig(backupRef.current);
      }
    };
  }, [sourceName]);

  const setKnob = (key: (typeof KNOBS)[number]['key'], value: string) => {
    if (!draft) return;
    const next: PresetPayload = {
      ...draft,
      rig: { ...draft.rig, [key]: Math.round(Number(value) * 10) / 10 },
    };
    setDraft(next);
    // Knob-only update: no need to reload the NAM/IR on every slider tick.
    managerRef.current.applyRig(next.rig);
  };

  const setAsset = (key: 'model' | 'ir', id: string) => {
    if (!draft) return;
    const options = key === 'model' ? assets.nam : assets.ir;
    const next: PresetPayload = {
      ...draft,
      rig: { ...draft.rig, [key]: options.find((asset) => asset.id === id) ?? null },
    };
    setDraft(next);
    void managerRef.current.applyLiveRig(next.rig);
  };

  const importFile = async (kind: 'nam' | 'ir') => {
    try {
      const path = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: kind === 'nam' ? 'NAM model' : 'Cabinet IR', extensions: [kind === 'nam' ? 'nam' : 'wav'] }],
      });
      if (!path || Array.isArray(path)) return;
      const filename = fileNameFromPath(path);
      const asset = await importAsset(kind, filename, path);
      setAssets((prev) => ({ ...prev, [kind]: [...prev[kind], asset] }));
      if (!draft) return;
      const next: PresetPayload = {
        ...draft,
        rig: { ...draft.rig, [kind === 'nam' ? 'model' : 'ir']: asset },
      };
      setDraft(next);
      void managerRef.current.applyLiveRig(next.rig);
      notifySuccess(`Imported ${asset.name}`);
    } catch (err) {
      notifyError(`Could not import asset: ${err}`);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || manager.busy) return;
    const name = draft.name.trim();
    if (!name) {
      notifyError('Enter a preset name first.');
      return;
    }
    const payload: PresetPayload = { ...draft, name, updatedAt: Date.now() };
    void (async () => {
      const saved = await managerRef.current.update(sourceName, payload);
      if (!saved) return;
      // Sound is now the saved preset — don't restore on unmount.
      shouldRestoreRef.current = false;
      onClose();
    })();
  };

  const assetSelect = (kind: 'nam' | 'ir', current: AssetRef | null) => {
    const options = assets[kind];
    const key = kind === 'nam' ? 'model' : 'ir';
    const missing = current && !options.some((asset) => asset.id === current.id);
    return (
      <div className="preset-editor-asset">
        <div className="preset-editor-asset-head">
          <label htmlFor={`preset-editor-${kind}`}>{kind === 'nam' ? 'Model' : 'Cabinet IR'}</label>
          <button type="button" onClick={() => void importFile(kind)} disabled={manager.busy}>
            Import…
          </button>
        </div>
        <select
          id={`preset-editor-${kind}`}
          value={current?.id ?? ''}
          disabled={manager.busy}
          onChange={(event) => setAsset(key, event.target.value)}
        >
          <option value="">None ({kind === 'nam' ? 'bypass' : 'no IR'})</option>
          {missing && <option value={current.id}>{current.name} (not in library)</option>}
          {options.map((asset) => (
            <option key={asset.id} value={asset.id}>{asset.name}</option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div className="preset-editor-overlay overlay" onClick={onClose}>
      <form
        ref={editorRef}
        className="preset-editor card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-editor-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <h3 id="preset-editor-title">Edit preset · {draft ? `${draft.bank}${draft.slot}` : '…'}</h3>
        <p className="preset-editor-hint">Changes play live. Cancel restores the sound you had before.</p>

        {loadError && <p className="preset-editor-error">Could not load preset: {loadError}</p>}

        {draft && (
          <>
            <label htmlFor="preset-editor-name">Name</label>
            <input
              id="preset-editor-name"
              data-autofocus
              autoFocus
              value={draft.name}
              disabled={manager.busy}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />

            <div className="preset-editor-section-title">Knobs</div>
            <div className="preset-editor-knobs">
              {KNOBS.map(({ key, label }) => (
                <label className="preset-editor-knob" key={key}>
                  <span>{label}</span>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.1}
                    value={draft.rig[key]}
                    disabled={manager.busy}
                    onChange={(event) => setKnob(key, event.target.value)}
                  />
                  <output>{draft.rig[key].toFixed(1)}</output>
                </label>
              ))}
            </div>

            <div className="preset-editor-section-title">Assets</div>
            <div className="preset-editor-assets">
              {assetSelect('nam', draft.rig.model)}
              {assetSelect('ir', draft.rig.ir)}
            </div>

            <div className="preset-editor-buttons">
              <button type="button" className="btn" onClick={onClose} disabled={manager.busy}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={manager.busy}>{manager.busy ? 'Saving…' : 'Save changes'}</button>
            </div>
          </>
        )}

        {!draft && !loadError && <p className="preset-editor-loading">Loading preset…</p>}
        {loadError && (
          <div className="preset-editor-buttons">
            <button type="button" className="btn" onClick={onClose}>Close</button>
          </div>
        )}
      </form>
    </div>
  );
}
