import { useEffect, useMemo, useRef, useState } from 'react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { exportPresetToPath, importPresetFromPath } from '../tauri';
import { notifyError, notifySuccess } from '../notifications';
import type { PresetManager } from '../hooks/usePresetManager';
import type { Bank, PresetMeta } from '../types/preset';
import { BANKS, SLOTS, slotLabel } from '../types/preset';
import './PresetLibrary.css';

type Filter = Bank | 'all';
type SortKey = 'slot' | 'name' | 'updated';

const FILTERS: Filter[] = ['all', ...BANKS];
const BANK_ORDER: Bank[] = ['A', 'B', 'C', 'D'];

interface PresetLibraryProps {
  manager: PresetManager;
  onBack: () => void;
  selected: string | null;
  onSelect: (name: string | null) => void;
}

interface InspectorProps {
  manager: PresetManager;
  meta: PresetMeta | undefined;
  onSelect: (name: string | null) => void;
}

/** Keyed by preset name in the parent so its local fields reset on selection. */
function PresetInspector({ manager, meta, onSelect }: InspectorProps) {
  const [renameValue, setRenameValue] = useState(meta?.name ?? '');
  const [bankChoice, setBankChoice] = useState<Bank>(meta?.bank ?? 'A');
  const [slotChoice, setSlotChoice] = useState(meta?.slot ?? 1);

  if (!meta) {
    return <aside className="preset-library-side"><p className="preset-library-empty">Select a preset to manage it.</p></aside>;
  }

  const handleRename = async () => {
    const clean = renameValue.trim();
    if (!clean || clean === meta.name) return;
    if (await manager.rename(meta.name, clean)) onSelect(clean);
  };

  const handleExport = async () => {
    try {
      const path = await saveDialog({
        defaultPath: `${meta.name}.json`,
        filters: [{ name: 'NAMpli preset', extensions: ['json'] }],
      });
      if (!path || Array.isArray(path)) return;
      await exportPresetToPath(meta.name, path);
      notifySuccess(`Exported ${meta.name}`);
    } catch (err) {
      notifyError(`Could not export preset: ${err}`);
    }
  };

  const handleRemove = async () => {
    await manager.remove(meta.name);
    onSelect(null);
  };

  const handleCopy = async () => {
    const created = await manager.copy(meta.name, bankChoice, slotChoice);
    if (created) onSelect(created);
  };

  return (
    <aside className="preset-library-side">
      <div className="preset-library-info">
        <strong>{meta.name}</strong>
        <span>{slotLabel(meta.bank, meta.slot)}</span>
        <span>Model: {meta.modelName ?? 'bypass'}</span>
        <span>IR: {meta.irName ?? 'none'}</span>
        <span>Updated: {new Date(meta.updatedAt).toLocaleString()}</span>
        {manager.activeName === meta.name && (
          <span className={`preset-library-status ${manager.preview ? 'preview' : ''}`}>
            {manager.preview ? 'Auditioning — not kept yet' : 'Currently loaded'}
          </span>
        )}
      </div>
      <button type="button" disabled={manager.busy} onClick={() => void manager.recallAt(meta.bank, meta.slot)}>
        Audition
      </button>
      <label htmlFor="preset-library-rename">Rename</label>
      <input
        id="preset-library-rename"
        value={renameValue}
        disabled={manager.busy}
        onChange={(event) => setRenameValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void handleRename();
          }
        }}
      />
      <button type="button" disabled={manager.busy} onClick={() => void handleRename()}>Apply rename</button>

      <label>Place in slot</label>
      <div className="preset-library-place">
        <select
          aria-label="Target bank"
          value={bankChoice}
          disabled={manager.busy}
          onChange={(event) => setBankChoice(event.target.value as Bank)}
        >
          {BANKS.map((bank) => <option key={bank} value={bank}>Bank {bank}</option>)}
        </select>
        <select
          aria-label="Target slot"
          value={slotChoice}
          disabled={manager.busy}
          onChange={(event) => setSlotChoice(Number(event.target.value))}
        >
          {SLOTS.map((slot) => <option key={slot} value={slot}>Slot {slot}</option>)}
        </select>
      </div>
      <div className="preset-library-place-actions">
        <button type="button" disabled={manager.busy} onClick={() => void manager.move(meta.name, bankChoice, slotChoice)}>
          Move
        </button>
        <button type="button" disabled={manager.busy} onClick={() => void handleCopy()}>Copy</button>
      </div>

      <button type="button" disabled={manager.busy} onClick={() => void handleExport()}>Export…</button>
      <button type="button" className="danger" disabled={manager.busy} onClick={() => void handleRemove()}>Delete</button>
    </aside>
  );
}

export default function PresetLibrary({ manager, onBack, selected, onSelect }: PresetLibraryProps) {
  const [query, setQuery] = useState('');
  const [bankFilter, setBankFilter] = useState<Filter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('slot');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = manager.metas.filter(
      (meta) =>
        (bankFilter === 'all' || meta.bank === bankFilter) &&
        (!q ||
          meta.name.toLowerCase().includes(q) ||
          (meta.modelName ?? '').toLowerCase().includes(q) ||
          (meta.irName ?? '').toLowerCase().includes(q)),
    );
    return rows.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'updated') return b.updatedAt - a.updatedAt;
      return BANK_ORDER.indexOf(a.bank) - BANK_ORDER.indexOf(b.bank) || a.slot - b.slot;
    });
  }, [manager.metas, query, bankFilter, sortKey]);

  // View-level keyboard navigation; audition Enter/Esc are handled by App.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
      if (visible.length === 0) return;
      event.preventDefault();
      const index = visible.findIndex((meta) => meta.name === selected);
      const next =
        event.key === 'ArrowDown'
          ? Math.min(visible.length - 1, index + 1)
          : Math.max(0, index <= 0 ? 0 : index - 1);
      onSelect(visible[next].name);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, selected, onSelect]);

  const current = manager.metas.find((meta) => meta.name === selected);

  const handleImport = async () => {
    try {
      const path = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'NAMpli preset', extensions: ['json'] }],
      });
      if (!path || Array.isArray(path)) return;
      const meta = await importPresetFromPath(path);
      await manager.refresh();
      onSelect(meta.name);
      notifySuccess(`Imported ${meta.name}`);
    } catch (err) {
      notifyError(`Could not import preset: ${err}`);
    }
  };

  return (
    <section className="preset-library" role="region" aria-label="Preset library">
      <header className="preset-library-header">
        <button type="button" className="preset-library-back" onClick={onBack}>← Back to amp</button>
        <h2 id="preset-library-title">Preset Library</h2>
        <input
          ref={searchRef}
          className="preset-library-search"
          type="search"
          placeholder="Search presets…"
          aria-label="Search presets"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="preset-library-filters" aria-label="Filter by bank">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={bankFilter === filter ? 'active' : ''}
              aria-pressed={bankFilter === filter}
              onClick={() => setBankFilter(filter)}
            >
              {filter === 'all' ? 'All' : filter}
            </button>
          ))}
        </div>
        <button type="button" className="preset-library-import" onClick={() => void handleImport()}>
          Import…
        </button>
      </header>

      <div className="preset-library-body">
        <div className="preset-library-list">
          <div className="preset-library-list-head">
            <button type="button" onClick={() => setSortKey('slot')}>Slot</button>
            <button type="button" onClick={() => setSortKey('name')}>Name</button>
            <button type="button" onClick={() => setSortKey('updated')}>Updated</button>
          </div>
          {visible.length === 0 && <p className="preset-library-empty">No presets match this view.</p>}
          {visible.map((meta) => {
            const isLoaded = manager.activeName === meta.name;
            const isPreviewing = !!manager.preview && manager.preview.activeName === meta.name;
            return (
              <button
                type="button"
                key={meta.name}
                className={`preset-library-row ${selected === meta.name ? 'selected' : ''} ${isLoaded ? 'loaded' : ''} ${isPreviewing ? 'previewing' : ''}`}
                onClick={() => onSelect(meta.name)}
                onDoubleClick={() => void manager.recallAt(meta.bank, meta.slot)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void manager.recallAt(meta.bank, meta.slot);
                  }
                }}
              >
                <span className="preset-library-slot">{slotLabel(meta.bank, meta.slot)}</span>
                <span className="preset-library-name">
                  <span className="preset-library-name-text">{meta.name}</span>
                  {isPreviewing && <span className="preset-library-badge preview">PREVIEW</span>}
                  {isLoaded && !isPreviewing && <span className="preset-library-badge loaded">LOADED</span>}
                </span>
                <span className="preset-library-model">{meta.modelName ?? 'bypass'}</span>
                <span className="preset-library-ir">{meta.irName ?? 'no IR'}</span>
                <span className="preset-library-updated">{new Date(meta.updatedAt).toLocaleDateString()}</span>
              </button>
            );
          })}
        </div>
        <PresetInspector key={current?.name ?? 'none'} manager={manager} meta={current} onSelect={onSelect} />
      </div>

      <footer className="preset-library-footer">
        <span>{visible.length} of {manager.metas.length} presets · Loaded: {manager.activeName ?? 'working state'}</span>
        <span>↑↓ navigate · Enter audition · Esc back/revert · Ctrl+F search</span>
      </footer>
    </section>
  );
}
