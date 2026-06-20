/**
 * Crash Recovery
 *
 * Bridges *hard* crashes (the ones JS handlers never see) into the existing
 * error-telemetry pipeline. On the next launch after a crash we surface it as
 * an automatic error report → GitHub issue, exactly like a caught error.
 *
 * Two independent signals, checked once at startup:
 *
 *  1. Native crash minidump (Crashpad) — written by crashReporter.start() in
 *     main.ts even when the process dies from a segfault / native module crash /
 *     GPU crash. Strongest signal. Reported as `native_crash` (fatal).
 *
 *  2. Abnormal exit — the previous session's diagnostic log has a [SESSION START]
 *     but no matching [SESSION END] (the marker is only written on a clean
 *     shutdown). Catches OOM kills, force-quits and power loss that leave no
 *     minidump. Reported as `abnormal_exit` (warning — can be benign).
 *
 * Design: 100% non-blocking, never throws, dedupes already-reported minidumps
 * via a small state file so the same crash isn't re-reported on every launch.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { diagnosticLogger } from './diagnostic-logger';
import { errorTelemetryService } from './error-telemetry-service';

interface CrashRecoveryState {
  reportedDumps: string[]; // basenames of minidumps already reported
}

interface MinidumpInfo {
  name: string;
  sizeKb: number;
  mtime: number;
}

// Cap how many minidumps we report in one launch (avoid a flood after a crash
// loop). The rest are still marked as seen so they never re-report.
const MAX_DUMPS_PER_LAUNCH = 3;
// Keep the seen-list bounded.
const MAX_TRACKED_DUMPS = 200;

class CrashRecovery {
  private statePath = '';

  /**
   * Detect a crash from the previous session and report it. Call ONCE at
   * startup, after diagnosticLogger.initialize() (so the current [SESSION START]
   * is already written) and after errorTelemetryService.initialize().
   */
  detectAndReportPriorCrash(): void {
    try {
      this.statePath = path.join(app.getPath('userData'), 'crash-recovery-state.json');
      const state = this.loadState();

      // Diagnose the previous session from the diagnostic log (abnormal exit +
      // a capped tail of its log + a best-effort "last phase" hint).
      const prior = diagnosticLogger.getPreviousSessionDiagnosis();

      // 1) Native crash minidumps (strongest signal)
      const newDumps = this.findNewMinidumps(state);

      if (newDumps.length > 0) {
        const cap = Math.min(newDumps.length, MAX_DUMPS_PER_LAUNCH);
        for (let i = 0; i < cap; i++) {
          const dump = newDumps[i];
          errorTelemetryService.reportCriticalError({
            errorType: 'native_crash',
            severity: 'fatal',
            error: new Error(
              `Native crash detected on previous launch (Crashpad minidump ${dump.name}, ${dump.sizeKb} KB)`
            ),
            batchPhase: prior?.lastPhase ? `native_${prior.lastPhase}` : 'native_crash',
            logSnapshotOverride: prior?.log,
          });
        }
        // Mark ALL found dumps as reported (even beyond the per-launch cap) so a
        // crash loop doesn't keep re-reporting the same files forever.
        const merged = new Set([...state.reportedDumps, ...newDumps.map((d) => d.name)]);
        state.reportedDumps = Array.from(merged).slice(-MAX_TRACKED_DUMPS);
        console.log(`[CrashRecovery] Reported ${cap} native crash(es) from previous launch`);
      } else if (prior?.abnormalExit) {
        // No minidump, but the previous session never wrote [SESSION END]:
        // OOM kill / force-quit / power loss. Lower severity (can be benign).
        errorTelemetryService.reportCriticalError({
          errorType: 'abnormal_exit',
          severity: 'warning',
          error: new Error(
            `App exited abnormally on the previous launch (no clean shutdown)${
              prior.lastPhase ? ` — last activity: ${prior.lastPhase}` : ''
            }`
          ),
          batchPhase: prior.lastPhase ? `exit_${prior.lastPhase}` : 'abnormal_exit',
          logSnapshotOverride: prior.log,
        });
        console.log('[CrashRecovery] Reported abnormal exit from previous launch');
      }

      this.saveState(state);
    } catch (err) {
      // Crash recovery must never break startup.
      console.warn('[CrashRecovery] Scan failed (non-critical):', err);
    }
  }

  /**
   * Scan the Crashpad database for *.dmp files we haven't reported yet.
   * The on-disk layout differs per OS, so we probe the common subdirs.
   */
  private findNewMinidumps(state: CrashRecoveryState): MinidumpInfo[] {
    const results: MinidumpInfo[] = [];
    try {
      const base = app.getPath('crashDumps');
      // Windows: <crashDumps>/reports/*.dmp · macOS/Linux: completed|pending
      const dirs = [
        base,
        path.join(base, 'reports'),
        path.join(base, 'completed'),
        path.join(base, 'pending'),
      ];
      const seen = new Set(state.reportedDumps);

      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        let entries: string[] = [];
        try {
          entries = fs.readdirSync(dir);
        } catch {
          continue;
        }
        for (const f of entries) {
          if (!f.toLowerCase().endsWith('.dmp')) continue;
          if (seen.has(f)) continue;
          try {
            const st = fs.statSync(path.join(dir, f));
            if (!st.isFile() || st.size === 0) continue;
            results.push({
              name: f,
              sizeKb: Math.round(st.size / 1024),
              mtime: st.mtimeMs,
            });
          } catch {
            // skip unreadable entry
          }
        }
      }
      // Newest first
      results.sort((a, b) => b.mtime - a.mtime);
    } catch {
      // ignore — return whatever we have
    }
    return results;
  }

  private loadState(): CrashRecoveryState {
    try {
      if (fs.existsSync(this.statePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
        if (parsed && Array.isArray(parsed.reportedDumps)) {
          return { reportedDumps: parsed.reportedDumps };
        }
      }
    } catch {
      // corrupt/missing → fresh state
    }
    return { reportedDumps: [] };
  }

  private saveState(state: CrashRecoveryState): void {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(state));
    } catch {
      // never throw
    }
  }
}

export const crashRecovery = new CrashRecovery();
