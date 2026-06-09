/**
 * Regression tests for issues #146 / #147:
 *
 * temporal-clustering.ts used to build the ExifTool command as a single shell
 * string via child_process.exec, interpolating an unquoted executable path.
 * When the app runs from a mount whose path contains a space — the DEFAULT
 * macOS DMG mount is `/Volumes/RaceTagger <version>-arm64/...` — the shell
 * split the path, ExifTool never ran, no EXIF timestamps were extracted, and
 * temporal clustering produced 0 recognized numbers for the whole batch.
 *
 * The fix switches to child_process.execFile (no shell) with an argv array, so
 * neither the executable path, the temp file path, nor the image path can be
 * broken by spaces. These tests assert that contract by capturing the argv
 * passed to execFile.
 */

// Mock child_process.execFile with a util.promisify.custom implementation so
// the module's `promisify(execFile)` yields a promise-returning fn we control.
// (Var must be `mock`-prefixed for jest's mock-factory hoisting.)
import { promisify } from 'util';

interface RecordedCall {
  file: string;
  args: string[];
}
const mockExecFileCalls: RecordedCall[] = [];
let mockExecFileStdout = '[]';

const mockExecFile: any = jest.fn();
mockExecFile[promisify.custom] = (file: string, args: string[]) => {
  mockExecFileCalls.push({ file, args });
  return Promise.resolve({ stdout: mockExecFileStdout, stderr: '' });
};

jest.mock('child_process', () => ({
  execFile: mockExecFile,
}));

import { TemporalClusterManager } from '../src/matching/temporal-clustering';

// A spaced executable path mirrors the real macOS DMG mount from issue #147:
// /Volumes/RaceTagger 1.1.9-arm64/RaceTagger.app/.../vendor/darwin/exiftool
const SPACED_EXIFTOOL =
  '/Volumes/RaceTagger 1.1.9-arm64/RaceTagger.app/Contents/Resources/app.asar.unpacked/vendor/darwin/exiftool';
const SPACED_IMAGE = '/Volumes/RaceTagger 1.1.9-arm64/photos/IMG with space_0001.jpg';

describe('temporal-clustering ExifTool exec safety (#146/#147)', () => {
  beforeEach(() => {
    mockExecFileCalls.length = 0;
    mockExecFileStdout = '[]';
  });

  it('single-file extract passes the spaced exiftool path as its own argv entry', async () => {
    mockExecFileStdout = JSON.stringify([{ DateTimeOriginal: '2025:09:21 08:42:57' }]);

    const manager = new TemporalClusterManager(SPACED_EXIFTOOL);
    const result = await manager.extractTimestamp(SPACED_IMAGE);

    // The spaced path must reach execFile whole (never split, never quoted).
    expect(mockExecFileCalls).toHaveLength(1);
    const { file, args } = mockExecFileCalls[0];
    expect(file).toBe(SPACED_EXIFTOOL);
    expect(file).toContain(' '); // sanity: the path really has a space

    // The image path is a discrete argv element, not concatenated into a string.
    expect(args).toContain(SPACED_IMAGE);
    expect(args).toContain('-json');

    // No argv element is a packed shell command (that would mean string-building).
    for (const a of [file, ...args]) {
      expect(a).not.toMatch(/exiftool.*-DateTimeOriginal/);
    }

    // The space-safe path actually yielded a parsed timestamp (end-to-end).
    expect(result.timestampSource).toBe('exif');
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it('batch extract passes the spaced exiftool path + a discrete -@ argfile entry', async () => {
    mockExecFileStdout = JSON.stringify([{ DateTimeOriginal: '2025:09:21 08:42:57' }]);

    const manager = new TemporalClusterManager(SPACED_EXIFTOOL);
    const results = await manager.extractTimestampsBatch([SPACED_IMAGE]);

    expect(mockExecFileCalls).toHaveLength(1);
    const { file, args } = mockExecFileCalls[0];
    expect(file).toBe(SPACED_EXIFTOOL);

    // ExifTool's argfile flag `-@` must be immediately followed by the temp
    // file path as a separate argv element (which itself may live under a
    // spaced tmp dir on some machines).
    const atIdx = args.indexOf('-@');
    expect(atIdx).toBeGreaterThanOrEqual(0);
    expect(typeof args[atIdx + 1]).toBe('string');
    expect(args[atIdx + 1].length).toBeGreaterThan(0);
    expect(args).toContain('-json');

    expect(results).toHaveLength(1);
    expect(results[0].timestampSource).toBe('exif');
    expect(results[0].timestamp).toBeInstanceOf(Date);
  });

  it('Windows perl-wrapper path prepends exiftool.pl as a discrete argv entry', () => {
    // Sanity-check the resolver shape on Windows without spawning anything:
    // perl.exe is the executable, exiftool.pl is prefixArgs[0]. We exercise the
    // private resolver via a fresh instance and reflect its stored invocation.
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const manager: any = new TemporalClusterManager();
      expect(manager.exiftool.cmd).toMatch(/perl\.exe$/);
      expect(manager.exiftool.prefixArgs).toHaveLength(1);
      expect(manager.exiftool.prefixArgs[0]).toMatch(/exiftool\.pl$/);
    } finally {
      if (original) Object.defineProperty(process, 'platform', original);
    }
  });
});
