import { useEffect, useState } from 'react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { exportPresetToPath, importPresetFromPath } from '../tauri';
import { notifyError, notifySuccess } from '../notifications';
import type { PresetManager } from '../hooks/usePresetManager';
import { slotLabel } from '../types/preset';
import './PresetLibrary.css';

interface PresetLibraryProps {
  open: boolean;
  onClose: () => void;
  manager: PresetManager;
}

export default function PresetLibrary({ open, onClose, manager }: PresetLibraryProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const current = manager.metas.find((meta) => meta.name === selected);

  const handleExport = async () => {
    if (!current) return;
    try {
      const path = await saveDialog({
        defaultPath: `${current.name}.json`,
        filters: [{ name: 'NAMpli preset', extensions: ['json'] }],
      });
      if (!path || Array.isArray(path)) return;
      await exportPresetToPath(current.name, path);
      notifySuccess(`Exported ${current.name}`);
    } catch (err) {
      notifyError(`Could not export preset: ${err}`);
    }
  };

  const handleImport = async () => {
    try {
      const path = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'NAMpli preset', extensions: ['json'] }],
      });
      if (!path || Array.isArray(path)) return;
      await importPresetFromPath(path);
      await manager.refresh();
      notifySuccess('Preset imported');
    } catch (err) {
      notifyError(`Could not import preset: ${err}`);
    }
  };

  return (
    <div className="preset-library-overlay" onClick={onClose}>
      <div className="preset-library" onClick={(event) => event.stopPropagation()}>
        <div className="preset-library-header">
          <h2>Preset Library</h2>
          <button type="button" onClick={onClose} aria-label="Close library">&times;</button>
        </div>

        <div className="preset-library-body">
          <div className="preset-library-list">
            {manager.metas.length === 0 && <p className="preset-library-empty">No presets saved yet.</p>}
            {manager.metas.map((meta) => (
              <button
                type="button"
                key={meta.name}
                className={`preset-library-row ${selected === meta.name ? 'selected' : ''}`}
                onClick={() => {
                  setSelected(meta.name);
                  setRenameValue(meta.name);
                }}
                onDoubleClick={() => void manager.recallAt(meta.bank, meta.slot)}
              >
                <span className="preset-library-slot">{slotLabel(meta.bank, meta.slot)}</span>
                <span className="preset-library-name">{meta.name}</span>
                <span className="preset-library-assets">
                  {meta.modelName ?? 'bypass'} · {meta.irName ?? 'no IR'}
                </span>
              </button>
            ))}
          </div>

          <div className="preset-library-side">
            {current ? (
              <>
                <div className="preset-library-info">
                  <strong>{current.name}</strong>
                  <span>{slotLabel(current.bank, current.slot)}</span>
                  <span>Model: {current.modelName ?? 'bypass'}</span>
                  <span>IR: {current.irName ?? 'none'}</span>
                </div>
                <button type="button" onClick={() => void manager.recallAt(current.bank, current.slot)}>
                  Recall
                </button>
                <label htmlFor="preset-library-rename">Rename</label>
                <input
                  id="preset-library-rename"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                />
                <button type="button" onClick={() => void manager.rename(current.name, renameValue)}>
                  Apply rename
                </button>
                <button type="button" onClick={() => void handleExport()}>Export…</button>
                <button type="button" className="danger" onClick={() => void manager.remove(current.name)}>
                  Delete
                </button>
              </>
            ) : (
              <p className="preset-library-empty">Select a preset to manage it.</p>
            )}
            <button type="button" onClick={() => void handleImport()}>Import…</button>
          </div>
        </div>
      </div>
    </div>
  );
}
