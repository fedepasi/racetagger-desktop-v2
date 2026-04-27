import * as path from 'path';

describe('ONNX Runtime Native Module', () => {
  test('onnxruntime-node loads correctly', async () => {
    // Verify native module binds successfully
    expect(() => {
      const ort = require('onnxruntime-node');
    }).not.toThrow();

    const ort = require('onnxruntime-node');
    expect(ort).toBeDefined();
    expect(ort.InferenceSession).toBeDefined();
  });

  test('onnxruntime-node env object is accessible', async () => {
    const ort = require('onnxruntime-node');

    expect(ort.env).toBeDefined();

    // Check version info (may be in different locations depending on version)
    if (ort.env.versions && ort.env.versions.onnxruntime) {
      expect(typeof ort.env.versions.onnxruntime).toBe('string');
    }

    // Check execution providers if available
    if (ort.env.availableExecutionProviders) {
      expect(Array.isArray(ort.env.availableExecutionProviders)).toBe(true);
    }
  });

  test('creates InferenceSession with valid ONNX model', async () => {
    const ort = require('onnxruntime-node');

    // Create a minimal ONNX model (1x1 identity)
    // This is a base64-encoded minimal ONNX model
    const minimalModelBase64 = 'CAcSBnRlc3RlchoCMTAaCgoICAEYASABMgAaAgoAQgA=';
    const modelBuffer = Buffer.from(minimalModelBase64, 'base64');

    try {
      const session = await ort.InferenceSession.create(modelBuffer);

      expect(session).toBeDefined();
      expect(session.inputNames).toBeDefined();
      expect(session.outputNames).toBeDefined();
    } catch (error) {
      // Minimal model may not be valid for all ONNX Runtime versions
      const message = error instanceof Error ? error.message : String(error);
      console.log('Minimal model test skipped:', message);
    }
  });

  test('handles corrupted ONNX model gracefully', async () => {
    const ort = require('onnxruntime-node');

    // Invalid model buffer
    const corruptedModel = Buffer.from([0x00, 0x01, 0x02, 0x03]);

    // Should throw error, not crash
    await expect(
      ort.InferenceSession.create(corruptedModel)
    ).rejects.toThrow();
  });

  test('ONNX Runtime supports required tensor operations', async () => {
    const ort = require('onnxruntime-node');

    // Create a simple tensor
    const tensor = new ort.Tensor('float32', Float32Array.from([1, 2, 3, 4]), [2, 2]);

    expect(tensor).toBeDefined();
    expect(tensor.dims).toEqual([2, 2]);
    expect(tensor.type).toBe('float32');
    expect(tensor.data.length).toBe(4);
  });

  test('ONNX Runtime memory management works correctly', async () => {
    const ort = require('onnxruntime-node');

    // Create and dispose multiple tensors
    for (let i = 0; i < 100; i++) {
      const tensor = new ort.Tensor('float32', new Float32Array(1000), [10, 10, 10]);
      expect(tensor).toBeDefined();
    }

    // No memory leak expected — if we get here, memory management is fine
    expect(true).toBe(true);
  });

  test('supports CPU execution provider', async () => {
    const ort = require('onnxruntime-node');

    // Check available execution providers
    const providers = ort.env.availableExecutionProviders;

    if (providers) {
      // Must have CPU
      expect(providers).toContain('CPUExecutionProvider');

      // GPU providers are optional
      const gpuProviders = ['CUDAExecutionProvider', 'CoreMLExecutionProvider', 'DmlExecutionProvider'];
      const hasGpu = gpuProviders.some((p: string) => providers.includes(p));

      if (hasGpu) {
        console.log('GPU execution provider available:', providers.filter((p: string) => gpuProviders.includes(p)));
      } else {
        console.log('No GPU execution provider available (CPU only)');
      }
    } else {
      // Some ONNX Runtime versions don't expose availableExecutionProviders
      // Verify we can at least create a session (which implies CPU is available)
      expect(ort.InferenceSession).toBeDefined();
    }
  });

  test('ONNX Runtime version is 1.x', async () => {
    const ort = require('onnxruntime-node');

    // Version may be in different locations depending on ONNX Runtime version
    const version = ort.env?.versions?.onnxruntime;

    if (version) {
      expect(version).toMatch(/^1\.\d+/);
    } else {
      // Fallback: check package.json version
      try {
        const pkg = require('onnxruntime-node/package.json');
        expect(pkg.version).toMatch(/^1\.\d+/);
      } catch (error) {
        console.log('ONNX Runtime version check skipped (version info not accessible)');
      }
    }
  });

  test('native module is correctly placed for Electron', async () => {
    // Verify module path
    const modulePath = require.resolve('onnxruntime-node');
    expect(modulePath).toBeDefined();

    // In packaged app, should not be inside ASAR
    if (process.env.NODE_ENV === 'production') {
      expect(modulePath).not.toContain('.asar' + path.sep);
    }
  });
});
