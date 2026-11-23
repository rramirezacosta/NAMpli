import { useEffect, useState } from 'react';
import type { Bank } from '../types/preset';
import { BANKS, SLOTS, slotLabel } from '../types/preset';
import type { PresetManager } from '../hooks/usePresetManager';
import './PresetBar.css';

type Dialog =
  | { mode: 'saveAs'; name: string; bank: Bank; slot: number }
  | { mode: 'rename'; source: string; name: string };

interface SlotMenu {
  bank: Bank;
  slot: number;
  x: number;
  y: number;
}

interface PresetBarProps {
  manager: PresetManager;
  onOpenLibrary: () => void;
}

export default function PresetBar({ manager, onOpenLibrary }: PresetBarProps) {
  const [menu, setMenu] = useState<SlotMenu | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  useEffect(() => {
    if (!menu && !dialog) return;
    const dismiss = () => {
      setMenu(null);
      setDialog(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('click', dismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, dialog]);

  const openMenuAt = (bank: Bank, slot: number, x: number, y: number) => {
    setDialog(null);
    setMenu({
      bank,
      slot,
      x: Math.min(x, window.innerWidth - 170),
      y: Math.min(y, window.innerHeight - 190),
    });
  };

  const openMenu = (event: React.MouseEvent, bank: Bank, slot: number) => {
    event.preventDefault();
    event.stopPropagation();
    openMenuAt(bank, slot, event.clientX, event.clientY);
  };

  const openMenuFromKeyboard = (event: React.KeyboardEvent, bank: Bank, slot: number) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openMenuAt(bank, slot, rect.left, rect.bottom);
  };

  const submitDialog = (event: React.FormEvent) => {
    event.preventDefault();
    if (!dialog) return;
    const name = dialog.name.trim();
    if (!name) return;
    if (dialog.mode === 'saveAs') {
      void manager.save(name, dialog.bank, dialog.slot);
    } else {
      void manager.rename(dialog.source, name);
    }
    setDialog(null);
  };

  const menuMeta = menu ? manager.metaAt(menu.bank, menu.slot) : undefined;

  return (
    <div className="preset-bar">
      <div className="preset-bank-toggle" aria-label="Preset bank">
        {BANKS.map((b) => (
          <button
            key={b}
            className={`preset-bank-btn ${manager.bank === b ? 'active' : ''}`}
            onClick={() => manager.setBank(b)}
            type="button"
          >
            {b}
          </button>
        ))}
      </div>

      <div className="preset-slots">
        {SLOTS.map((number) => {
          const meta = manager.metaAt(manager.bank, number);
          const active = !!meta && manager.activeName === meta.name;
          const selected = manager.slot === number;
          const showDirty = manager.dirty && (active || (!meta && selected));
          const menuOpen = menu?.bank === manager.bank && menu.slot === number;
          return (
            <div className="preset-slot-wrap" key={number}>
              <button
                type="button"
                className={`preset-slot ${selected ? 'selected' : ''} ${active ? 'active' : ''} ${meta ? '' : 'empty'}`}
                onClick={() => {
                  if (meta) void manager.recallAt(manager.bank, number);
                  else manager.selectAt(manager.bank, number);
                }}
                onContextMenu={(event) => openMenu(event, manager.bank, number)}
                onKeyDown={(event) => openMenuFromKeyboard(event, manager.bank, number)}
                title={meta ? `Recall ${meta.name}` : 'Empty slot — click to select, then press Save'}
                aria-pressed={selected}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={manager.busy}
              >
                <span className="preset-slot-number">{number}</span>
                <span className="preset-slot-name">{meta?.name ?? 'Empty'}</span>
                <span className="preset-slot-model">{meta?.modelName ?? 'no model'}</span>
                {showDirty && (
                  <span className="preset-dirty" title="Unsaved changes">•</span>
                )}
              </button>
              <button
                type="button"
                className="preset-slot-menu-trigger"
                onClick={(event) => openMenu(event, manager.bank, number)}
                onContextMenu={(event) => openMenu(event, manager.bank, number)}
                onKeyDown={(event) => openMenuFromKeyboard(event, manager.bank, number)}
                aria-label={`Actions for slot ${number}${meta ? ` (${meta.name})` : ''}`}
                title="Slot actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={manager.busy}
              >
                ⋯
              </button>
            </div>
          );
        })}
      </div>

      <div className="preset-actions">
        <button
          type="button"
          className="preset-action-btn"
          onClick={() => void manager.save()}
          disabled={manager.busy}
        >
          Save
        </button>
        <button
          type="button"
          className={`preset-action-btn ${manager.comparing ? 'active' : ''}`}
          onClick={() => void manager.compare()}
        >
          {manager.comparing ? 'Restore' : 'A/B'}
        </button>
        <button type="button" className="preset-action-btn" onClick={onOpenLibrary}>
          Library
        </button>
      </div>

      {menu && (
        <div
          className="preset-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="preset-menu-title">
            {slotLabel(menu.bank, menu.slot)} · {menuMeta?.name ?? 'Empty'}
          </div>
          <button type="button" role="menuitem" onClick={() => { void manager.save(undefined, menu.bank, menu.slot); setMenu(null); }}>
            Save here
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDialog({ mode: 'saveAs', name: menuMeta?.name ?? `Preset ${slotLabel(menu.bank, menu.slot)}`, bank: menu.bank, slot: menu.slot });
              setMenu(null);
            }}
          >
            Save As…
          </button>
          {menuMeta && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDialog({ mode: 'rename', source: menuMeta.name, name: menuMeta.name });
                  setMenu(null);
                }}
              >
                Rename…
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => { void manager.remove(menuMeta.name); setMenu(null); }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {dialog && (
        <div className="preset-dialog-overlay" onClick={() => setDialog(null)}>
          <form
            className="preset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preset-dialog-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitDialog}
          >
            <h3 id="preset-dialog-title">{dialog.mode === 'saveAs' ? 'Save preset' : 'Rename preset'}</h3>
            <label htmlFor="preset-name-input">Name</label>
            <input
              id="preset-name-input"
              autoFocus
              value={dialog.name}
              onChange={(event) => setDialog({ ...dialog, name: event.target.value })}
            />
            <div className="preset-dialog-buttons">
              <button type="button" onClick={() => setDialog(null)}>Cancel</button>
              <button type="submit">{dialog.mode === 'saveAs' ? 'Save' : 'Rename'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
