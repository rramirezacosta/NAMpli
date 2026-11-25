import { useEffect, useMemo, useRef, useState } from 'react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import type { AssetKind, AssetMeta, AssetRef } from '../types/preset';
import { notifyError } from '../notifications';
import { fileNameFromPath } from '../utils/platform';
import './AssetLibrary.css';

type KindFilter = 'all' | AssetKind;
type SortKey = 'name' | 'kind' | 'size' | 'modified' | 'used';

const FILTERS: KindFilter[] = ['all', 'nam', 'ir'];
const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'kind', label: 'Kind' },
  { key: 'size', label: 'Size' },
  { key: 'modified', label: 'Added' },
  { key: 'used', label: 'Used by' },
];
const SORT_DIRECTION: Record<SortKey, 'ascending' | 'descending'> = {
  name: 'ascending',
  kind: 'ascending',
  size: 'descending',
  modified: 'descending',
  used: 'descending',
};

interface AssetLibraryProps {
  assets: AssetMeta[];
  model: AssetRef | null;
  ir: AssetRef | null;
  previewId: string | null;
  busy: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onBack: () => void;
  onPreview: (asset: AssetMeta) => void;
  onLoad: (asset: AssetMeta) => void;
  onStore: (kind: AssetKind, filename: string, path?: string, data?: string) => void;
  onExport: (asset: AssetMeta, path: string) => void;
  onDelete: (asset: AssetMeta, force: boolean) => void;
  onRename: (asset: AssetMeta, newName: string) => Promise<AssetRef | null>;
  onCleanup: () => void;
}

interface InspectorProps {
  asset: AssetMeta | undefined;
  model: AssetRef | null;
  ir: AssetRef | null;
  previewId: string | null;
  busy: boolean;
  onSelect: (id: string | null) => void;
  onLoad: (asset: AssetMeta) => void;
  onPreview: (asset: AssetMeta) => void;
  onExport: (asset: AssetMeta, path: string) => void;
  onDelete: (asset: AssetMeta, force: boolean) => void;
  onRename: (asset: AssetMeta, newName: string) => Promise<AssetRef | null>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileInspector({
  asset, model, ir, previewId, busy, onSelect, onLoad, onPreview, onExport, onDelete, onRename,
}: InspectorProps) {
  const [renameValue, setRenameValue] = useState(asset?.name ?? '');

  if (!asset) {
    return <aside className="asset-library-side"><p className="asset-library-empty">Select a file to manage it.</p></aside>;
  }

  const handleRename = async () => {
    const clean = renameValue.trim();
    if (!clean || clean === asset.name) return;
    const renamed = await onRename(asset, clean);
    if (renamed) onSelect(renamed.id);
  };

  const loaded = model?.id === asset.id || ir?.id === asset.id;
  const previewing = previewId === asset.id;
  const hash = asset.id.split('/')[1] ?? '—';

  const handleExport = async () => {
    const extension = asset.kind === 'nam' ? 'nam' : 'wav';
    const path = await saveDialog({
      defaultPath: asset.name,
      filters: [{ name: asset.kind === 'nam' ? 'NAM model' : 'Cabinet IR', extensions: [extension] }],
    });
    if (path) await onExport(asset, path);
  };

  const handleDelete = () => {
    const used = asset.usedBy;
    const message = used.length > 0
      ? `${asset.name} is used by: ${used.join(', ')}.\nDeleting will remove those references from the presets. Continue?`
      : `Delete ${asset.name} from the library?`;
    if (window.confirm(message)) onDelete(asset, used.length > 0);
  };

  return (
    <aside className="asset-library-side">
      <div className="asset-library-info">
        <p className="asset-library-info-name" title={asset.name}>{asset.name}</p>
        <dl>
          <div><dt>Kind</dt><dd>{asset.kind === 'nam' ? 'NAM model' : 'Cabinet IR'}</dd></div>
          <div><dt>Size</dt><dd>{formatSize(asset.size)}</dd></div>
          <div><dt>Hash</dt><dd>{hash}</dd></div>
          <div><dt>Added</dt><dd>{new Date(asset.modified).toLocaleString()}</dd></div>
        </dl>
        <p className="asset-library-used">
          {asset.usedBy.length > 0 ? `Used by: ${asset.usedBy.join(', ')}` : 'Not used by any preset'}
        </p>
        {loaded && <span className="asset-library-status">Currently loaded</span>}
        {previewing && <span className="asset-library-status preview">Auditioning — not kept yet</span>}
      </div>
      <div className="asset-library-rename">
        <input
          aria-label="New file name"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleRename();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void handleRename()}
          disabled={busy || !renameValue.trim() || renameValue.trim() === asset.name}
        >
          Apply rename
        </button>
      </div>
      <button type="button" onClick={() => onLoad(asset)} disabled={busy}>
        {asset.kind === 'nam' ? 'Load as model' : 'Load as IR'}
      </button>
      <button type="button" onClick={() => onPreview(asset)} disabled={busy}>Preview</button>
      <button type="button" onClick={() => void handleExport()} disabled={busy}>Export…</button>
      <button type="button" className="danger" onClick={handleDelete} disabled={busy}>Delete</button>
    </aside>
  );
}

/** Full-window browser for the stored NAM models and cabinet IRs. */
export default function AssetLibrary({
  assets, model, ir, previewId, busy, selected, onSelect, onBack,
  onPreview, onLoad, onStore, onExport, onDelete, onRename, onCleanup,
}: AssetLibraryProps) {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = assets.filter((asset) =>
      (kindFilter === 'all' || asset.kind === kindFilter)
      && (!needle || asset.name.toLowerCase().includes(needle) || asset.usedBy.some((n) => n.toLowerCase().includes(needle))),
    );
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'kind': return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
        case 'size': return b.size - a.size;
        case 'modified': return b.modified - a.modified;
        case 'used': return b.usedBy.length - a.usedBy.length || a.name.localeCompare(b.name);
        default: return a.name.localeCompare(b.name);
      }
    });
    return rows;
  }, [assets, kindFilter, query, sortKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if (visible.length === 0) return;
      event.preventDefault();
      const current = visible.findIndex((asset) => asset.id === selected);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = Math.max(0, Math.min(visible.length - 1, current + step));
      onSelect(visible[next].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selected, onSelect]);

  const handleImport = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: 'NAM model or cabinet IR', extensions: ['nam', 'wav'] }],
    });
    if (!path || typeof path !== 'string') return;
    const filename = fileNameFromPath(path);
    const extension = filename.split('.').pop()?.toLowerCase();
    if (extension !== 'nam' && extension !== 'wav') {
      notifyError('Choose a .nam model or a .wav cabinet IR.');
      return;
    }
    const kind: AssetKind = extension === 'nam' ? 'nam' : 'ir';
    await onStore(kind, filename, path);
    onSelect(null);
  };

  return (
    <section className="asset-library view-shell" role="region" aria-labelledby="asset-library-title">
      <header className="asset-library-header">
        <button type="button" className="asset-library-back back-btn" onClick={onBack}>← Back to amp</button>
        <h2 id="asset-library-title">Model &amp; IR Library</h2>
        <input
          ref={searchRef}
          className="asset-library-search"
          type="search"
          placeholder="Search files or presets…"
          aria-label="Search models and IRs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="asset-library-filters" role="group" aria-label="Filter by file type">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={kindFilter === filter ? 'active' : ''}
              aria-pressed={kindFilter === filter}
              onClick={() => setKindFilter(filter)}
            >
              {filter === 'all' ? 'All' : filter === 'nam' ? 'Models' : 'IRs'}
            </button>
          ))}
        </div>
        <button type="button" className="asset-library-cleanup" onClick={onCleanup} disabled={busy}>
          Clean up…
        </button>
        <button type="button" className="asset-library-import" onClick={() => void handleImport()} disabled={busy}>
          Import…
        </button>
      </header>

      <div className="asset-library-body">
        <div className="asset-library-list">
          <div className="asset-library-list-head" role="row">
            {SORT_COLUMNS.map(({ key, label }) => (
              <span role="columnheader" aria-sort={sortKey === key ? SORT_DIRECTION[key] : 'none'} key={key}>
                <button type="button" aria-pressed={sortKey === key} onClick={() => setSortKey(key)}>
                  {label}
                </button>
              </span>
            ))}
          </div>
          {visible.length === 0 && <p className="asset-library-empty">No files match this view.</p>}
          {visible.map((asset) => {
            const isLoaded = model?.id === asset.id || ir?.id === asset.id;
            const isPreviewing = previewId === asset.id;
            return (
              <button
                type="button"
                key={asset.id}
                className={`asset-library-row ${selected === asset.id ? 'selected' : ''} ${isLoaded ? 'loaded' : ''} ${isPreviewing ? 'previewing' : ''}`}
                aria-pressed={selected === asset.id}
                aria-current={isLoaded || isPreviewing ? 'true' : undefined}
                onClick={() => onSelect(asset.id)}
                onDoubleClick={() => onPreview(asset)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onPreview(asset);
                  }
                }}
              >
                <span className="asset-library-name">
                  <span className="asset-library-name-text">{asset.name}</span>
                  {isPreviewing && <span className="asset-library-badge preview">PREVIEW</span>}
                  {isLoaded && !isPreviewing && <span className="asset-library-badge loaded">LOADED</span>}
                </span>
                <span className={`asset-library-kind ${asset.kind}`}>{asset.kind === 'nam' ? 'MODEL' : 'IR'}</span>
                <span className="asset-library-size">{formatSize(asset.size)}</span>
                <span className="asset-library-added">{new Date(asset.modified).toLocaleDateString()}</span>
                <span className="asset-library-used-count">{asset.usedBy.length || '—'}</span>
              </button>
            );
          })}
        </div>
        <FileInspector
          key={selected ?? 'none'}
          asset={assets.find((asset) => asset.id === selected)}
          model={model}
          ir={ir}
          previewId={previewId}
          busy={busy}
          onSelect={onSelect}
          onLoad={onLoad}
          onPreview={onPreview}
          onExport={onExport}
          onDelete={onDelete}
          onRename={onRename}
        />
      </div>
      <footer className="asset-library-footer">
        <span>{visible.length} of {assets.length} files · Model: {model?.name ?? 'none'} · IR: {ir?.name ?? 'none'}</span>
        <span>↑↓ navigate · Enter preview · Esc back/revert · Ctrl+F search</span>
      </footer>
    </section>
  );
}
