import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetKind, AssetMeta, AssetRef, RigSnapshot } from '../types/preset';
import type { RigState } from './useRigState';
import {
  deleteAsset,
  exportAssetToPath,
  cleanLibrary,
  listAssets,
  loadAsset,
  loadRigAssets,
  renameAsset,
  storeAsset,
} from '../tauri';
import { notifyError, notifySuccess } from '../notifications';

/**
 * State and actions for the asset-library view. Loading an asset is auditioned
 * like a preset: the pre-audition rig is kept so Escape/Revert can restore both
 * the knobs and the NAM/IR in the engine.
 */
export function useAssetLibrary(rig: RigState) {
  const [assets, setAssets] = useState<AssetMeta[]>([]);
  const [preview, setPreview] = useState<RigSnapshot | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<RigSnapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAssets(await listAssets());
    } catch (err) {
      console.error('Failed to list assets:', err);
      notifyError(`Could not load the asset library: ${err}`);
    }
  }, []);

  useEffect(() => {
    // One initial load through the same path used by every later refresh.
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  const applyLoaded = useCallback(
    (asset: AssetMeta, snapshot: RigSnapshot) => {
      const next: RigSnapshot = asset.kind === 'nam'
        ? { ...snapshot, model: { id: asset.id, name: asset.name } }
        : { ...snapshot, ir: { id: asset.id, name: asset.name } };
      rig.applySnapshot(next);
      return next;
    },
    [rig],
  );

  /** Load an asset immediately (from the inspector's Load button). */
  const load = useCallback(
    async (asset: AssetMeta) => {
      setBusy(true);
      try {
        await loadAsset(asset.id);
        applyLoaded(asset, rig.snapshot);
        notifySuccess(`Loaded ${asset.name}`);
      } catch (err) {
        console.error('Failed to load asset:', err);
        notifyError(`Could not load ${asset.name}: ${err}`);
      } finally {
        setBusy(false);
      }
    },
    [applyLoaded, rig],
  );

  /** Audition an asset; the existing banner offers Keep / Revert. */
  const previewAsset = useCallback(
    async (asset: AssetMeta) => {
      if (!previewRef.current) {
        previewRef.current = rig.snapshot;
        setPreview(previewRef.current);
      }
      setPreviewId(asset.id);
      setPreviewName(asset.name);
      setBusy(true);
      try {
        await loadAsset(asset.id);
        applyLoaded(asset, rig.snapshot);
      } catch (err) {
        console.error('Failed to preview asset:', err);
        notifyError(`Could not load ${asset.name}: ${err}`);
      } finally {
        setBusy(false);
      }
    },
    [applyLoaded, rig],
  );

  const commitPreview = useCallback(() => {
    previewRef.current = null;
    setPreview(null);
    setPreviewId(null);
    setPreviewName(null);
    notifySuccess('Preview kept');
  }, []);

  const revertPreview = useCallback(async () => {
    const backup = previewRef.current;
    if (!backup) return;
    setBusy(true);
    try {
      await loadRigAssets(backup);
      rig.applySnapshot(backup);
      previewRef.current = null;
      setPreview(null);
      setPreviewId(null);
      setPreviewName(null);
      notifySuccess('Reverted to previous sound');
    } catch (err) {
      console.error('Failed to revert asset preview:', err);
      notifyError(`Could not revert: ${err}`);
    } finally {
      setBusy(false);
    }
  }, [rig]);

  const store = useCallback(
    async (kind: AssetKind, filename: string, path?: string, data?: string) => {
      setBusy(true);
      try {
        const asset = await storeAsset(kind, filename, path, data);
        await refresh();
        notifySuccess(`${kind === 'nam' ? 'Model' : 'IR'} added to library: ${asset.name}`);
      } catch (err) {
        console.error('Failed to store asset:', err);
        notifyError(`Could not import file: ${err}`);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const exportAsset = useCallback(async (asset: AssetMeta, path: string) => {
    try {
      await exportAssetToPath(asset.id, path);
      notifySuccess(`Exported ${asset.name}`);
    } catch (err) {
      console.error('Failed to export asset:', err);
      notifyError(`Could not export ${asset.name}: ${err}`);
    }
  }, []);

  const remove = useCallback(
    async (asset: AssetMeta, force = false) => {
      setBusy(true);
      try {
        const affected = await deleteAsset(asset.id, force);
        // A forced delete can remove the asset currently loaded in the rig.
        const snapshot = rig.snapshot;
        const model = snapshot.model?.id === asset.id ? null : snapshot.model;
        const ir = snapshot.ir?.id === asset.id ? null : snapshot.ir;
        if (model !== snapshot.model || ir !== snapshot.ir) {
          const next = { ...snapshot, model, ir };
          await loadRigAssets(next);
          rig.applySnapshot(next);
        }
        await refresh();
        notifySuccess(
          affected.length > 0
            ? `Deleted ${asset.name} (updated ${affected.length} preset${affected.length === 1 ? '' : 's'})`
            : `Deleted ${asset.name}`,
        );
      } catch (err) {
        console.error('Failed to delete asset:', err);
        notifyError(`Could not delete ${asset.name}: ${err}`);
      } finally {
        setBusy(false);
      }
    },
    [refresh, rig],
  );

  /** Rename a file, then reload the live rig if that file was loaded. */
  const rename = useCallback(
    async (asset: AssetMeta, newName: string): Promise<AssetRef | null> => {
      setBusy(true);
      try {
        const { asset: renamed, affected } = await renameAsset(asset.id, newName);
        const snapshot = rig.snapshot;
        const model = snapshot.model?.id === asset.id ? renamed : snapshot.model;
        const ir = snapshot.ir?.id === asset.id ? renamed : snapshot.ir;
        if (model !== snapshot.model || ir !== snapshot.ir) {
          const next = { ...snapshot, model, ir };
          await loadRigAssets(next);
          rig.applySnapshot(next);
        }
        await refresh();
        notifySuccess(
          affected.length > 0
            ? `Renamed ${renamed.name} (updated ${affected.length} preset${affected.length === 1 ? '' : 's'})`
            : `Renamed ${renamed.name}`,
        );
        return renamed;
      } catch (err) {
        console.error('Failed to rename asset:', err);
        notifyError(`Could not rename ${asset.name}: ${err}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [refresh, rig],
  );

  /** Remove library files that no preset uses (live-loaded files are kept). */
  const cleanup = useCallback(
    async (keep: string[]) => {
      setBusy(true);
      try {
        const removed = await cleanLibrary(keep);
        await refresh();
        // The caller short-circuits the zero-file case, so only report removals.
        if (removed.length > 0) {
          notifySuccess(`Removed ${removed.length} unused file${removed.length === 1 ? '' : 's'}`);
        }
      } catch (err) {
        console.error('Failed to clean library:', err);
        notifyError(`Could not clean up library: ${err}`);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return {
    assets,
    preview,
    previewId,
    previewName,
    busy,
    refresh,
    load,
    previewAsset,
    commitPreview,
    revertPreview,
    store,
    exportAsset,
    remove,
    rename,
    cleanup,
  };
}

export type AssetLibrary = ReturnType<typeof useAssetLibrary>;
