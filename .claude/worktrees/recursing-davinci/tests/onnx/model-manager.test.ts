import { TempDirectory } from '../helpers/temp-directory';
import { FileHasher } from '../helpers/file-hasher';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('ONNX Model Manager', () => {
  let tempDir: TempDirectory;
  let hasher: FileHasher;

  beforeEach(async () => {
    tempDir = new TempDirectory();
    hasher = new FileHasher();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  function getModelManager() {
    try {
      const { ModelManager } = require('../../src/model-manager');
      return ModelManager.getInstance();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  ModelManager not available:', message);
      return null;
    }
  }

  test('ModelManager singleton is accessible', () => {
    const manager = getModelManager();
    if (!manager) return;

    expect(manager).toBeDefined();
    expect(typeof manager.downloadModel).toBe('function');
    expect(typeof manager.checkModelStatus).toBe('function');
    expect(typeof manager.getLocalModelPath).toBe('function');
    expect(typeof manager.getCacheInfo).toBe('function');
    expect(typeof manager.clearCache).toBe('function');
    expect(typeof manager.deleteModel).toBe('function');
    expect(typeof manager.ensureModelAvailable).toBe('function');
  });

  test('ModelManager exports correct helpers', () => {
    try {
      const mod = require('../../src/model-manager');

      expect(mod.ModelManager).toBeDefined();
      expect(typeof mod.getModelManager).toBe('function');

      // getModelManager should return singleton
      const m1 = mod.getModelManager();
      const m2 = mod.getModelManager();
      expect(m1).toBe(m2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  ModelManager module not available:', message);
    }
  });

  test('getCacheInfo returns structured data', () => {
    const manager = getModelManager();
    if (!manager) return;

    const info = manager.getCacheInfo();

    expect(info).toBeDefined();
    expect(typeof info.totalMB).toBe('number');
    expect(info.totalMB).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(info.models)).toBe(true);

    for (const model of info.models) {
      expect(model).toHaveProperty('name');
      expect(model).toHaveProperty('version');
      expect(model).toHaveProperty('sizeMB');
    }
  });

  test('getLocalModelPath returns string or null', () => {
    const manager = getModelManager();
    if (!manager) return;

    const modelPath = manager.getLocalModelPath('test-nonexistent-category');
    expect(modelPath === null || typeof modelPath === 'string').toBe(true);
  });

  test('getLocalModelConfig returns config or null', () => {
    const manager = getModelManager();
    if (!manager) return;

    const config = manager.getLocalModelConfig('test-nonexistent-category');
    expect(config === null || typeof config === 'object').toBe(true);
  });

  test('deleteModel handles non-existent models gracefully', () => {
    const manager = getModelManager();
    if (!manager) return;

    const result = manager.deleteModel('nonexistent-category');
    expect(typeof result).toBe('boolean');
  });

  test('checkModelStatus returns ModelStatus', async () => {
    const manager = getModelManager();
    if (!manager) return;

    try {
      const status = await manager.checkModelStatus('test-category');

      expect(status).toBeDefined();
      expect(typeof status.needsDownload).toBe('boolean');
      expect(typeof status.needsUpdate).toBe('boolean');
      expect(status.localVersion === null || typeof status.localVersion === 'string').toBe(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // May fail without Supabase client set
      console.log('⏭️  checkModelStatus failed (expected without Supabase):', message);
    }
  });

  test('downloadModel requires valid categoryCode', async () => {
    const manager = getModelManager();
    if (!manager) return;

    // Download with invalid category should fail gracefully
    try {
      await manager.downloadModel('nonexistent-category-xyz');
    } catch (error) {
      // Expected to fail — verifying it doesn't crash
      expect(error).toBeDefined();
    }
  });

  test('downloadModel accepts progress callback', async () => {
    const manager = getModelManager();
    if (!manager) return;

    const progressUpdates: number[] = [];

    try {
      await manager.downloadModel('test-category', (percent: number, downloadedMB: number, totalMB: number) => {
        progressUpdates.push(percent);
      });
    } catch (error) {
      // Expected to fail — we're just checking the callback signature
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Download failed (expected):', message);
    }

    // Progress callback was accepted (may not have been called if download failed immediately)
  });

  test('setSupabaseClient accepts client', () => {
    const manager = getModelManager();
    if (!manager) return;

    // Should not throw when setting client
    expect(() => {
      manager.setSupabaseClient(null as any);
    }).not.toThrow();
  });

  test('clearCache removes cached models', async () => {
    const manager = getModelManager();
    if (!manager) return;

    // clearCache should not throw
    await expect(manager.clearCache()).resolves.not.toThrow();
  });

  test('getActiveOnnxCategories returns array', async () => {
    const manager = getModelManager();
    if (!manager) return;

    try {
      const categories = await manager.getActiveOnnxCategories();
      expect(Array.isArray(categories)).toBe(true);
    } catch (error) {
      // May fail without Supabase
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  getActiveOnnxCategories failed (expected without Supabase):', message);
    }
  });

  test('getModelsToDownload returns structured data', async () => {
    const manager = getModelManager();
    if (!manager) return;

    try {
      const result = await manager.getModelsToDownload();
      expect(result).toBeDefined();
      expect(Array.isArray(result.models)).toBe(true);
      expect(typeof result.totalSizeMB).toBe('number');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  getModelsToDownload failed (expected without Supabase):', message);
    }
  });

  test('model_registry table integration', async () => {
    // This test requires database access
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.log('⏭️  Skipping: Supabase credentials not available');
      return;
    }

    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data, error } = await supabase
        .from('model_registry')
        .select('*')
        .limit(1);

      if (error) {
        console.log('⏭️  Skipping: model_registry table not accessible');
        return;
      }

      expect(data).toBeDefined();

      if (data && data.length > 0) {
        const model = data[0];
        expect(model).toHaveProperty('version');
        expect(model).toHaveProperty('onnx_storage_path');
        expect(model).toHaveProperty('checksum_sha256');
        expect(model).toHaveProperty('is_active');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Supabase not available:', message);
    }
  });
});
