# Telemetry Implementation Guide - Tier 1 Complete

## 🎯 Implementation Status

### ✅ COMPLETED (Steps 1-5):

1. **✅ hardware-detector.ts** - Created
2. **✅ network-monitor.ts** - Created
3. **✅ performance-timer.ts** - Created
4. **✅ error-tracker.ts** - Created
5. **✅ analysis-logger.ts** - Updated with optional telemetry fields

### 🔄 REMAINING (Steps 6-8):

6. **🔄 unified-image-processor.ts** - Integration needed
7. **⏳ database-service.ts** - Interface update needed
8. **⏳ Database Migration** - SQL update needed

---

## 📝 Step 6: Unified Image Processor Integration

### Location: `src/unified-image-processor.ts`

#### A. Add Imports (Top of file, around line 15)

```typescript
// Add these imports after existing imports
import { HardwareDetector } from './utils/hardware-detector';
import { NetworkMonitor } from './utils/network-monitor';
import { PerformanceTimer } from './utils/performance-timer';
import { ErrorTracker } from './utils/error-tracker';
```

#### B. Initialize Trackers in UnifiedProcessor class

Add to class properties (around line 2545):

```typescript
// Optional telemetry trackers (will be initialized only if execution_id exists)
private hardwareDetector?: HardwareDetector;
private networkMonitor?: NetworkMonitor;
private performanceTimer?: PerformanceTimer;
private errorTracker?: ErrorTracker;
```

#### C. Modify Execution Start (around line 2717)

**REPLACE THIS CODE:**

```typescript
// Log execution start
this.analysisLogger.logExecutionStart(
  imageFiles.length,
  undefined // participantPresetId not needed anymore with direct data passing
);
```

**WITH THIS CODE:**

```typescript
// TIER 1 TELEMETRY: Collect enhanced system environment (optional, safe)
let systemEnvironment: any = undefined;

try {
  // Initialize telemetry trackers (optional)
  this.hardwareDetector = new HardwareDetector();
  this.networkMonitor = new NetworkMonitor();
  this.performanceTimer = new PerformanceTimer();
  this.errorTracker = new ErrorTracker();

  // Collect hardware info (with 5s timeout)
  const hardwareInfo = await Promise.race([
    this.hardwareDetector.getHardwareInfo(),
    new Promise((resolve) => setTimeout(() => resolve(undefined), 5000))
  ]);

  // Collect network metrics (with 5s timeout)
  const networkMetrics = await Promise.race([
    this.networkMonitor.measureInitialMetrics(5000),
    new Promise((resolve) => setTimeout(() => resolve({}), 5000))
  ]);

  // Collect environment info
  const sharp = getSharp();
  systemEnvironment = {
    hardware: hardwareInfo,
    network: networkMetrics,
    environment: {
      node_version: process.version,
      electron_version: process.versions.electron || 'N/A',
      dcraw_version: undefined, // TODO: Add dcraw version detection
      sharp_version: sharp?.versions?.sharp || 'N/A',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: require('electron').app.getLocale()
    }
  };

  console.log('[UnifiedProcessor] ✅ Enhanced telemetry collected');
} catch (telemetryError) {
  console.warn('[UnifiedProcessor] ⚠️ Failed to collect telemetry (non-critical):', telemetryError);
  // Continue processing even if telemetry fails
}

// Log execution start with optional telemetry
this.analysisLogger.logExecutionStart(
  imageFiles.length,
  undefined, // participantPresetId not needed anymore with direct data passing
  systemEnvironment // Optional enhanced telemetry
);
```

#### D. Update Execution Database Record (around line 2736-2754)

**ADD `system_environment` field to executionData:**

```typescript
const executionData = {
  id: this.config.executionId,
  user_id: currentUserId,
  project_id: 'default',
  category: this.config.category || 'motorsport',
  total_images: imageFiles.length,
  processed_images: 0,
  status: 'processing',
  execution_settings: {
    maxDimension: this.config.maxDimension,
    jpegQuality: this.config.jpegQuality,
    maxImageSizeKB: this.config.maxImageSizeKB,
    category: this.config.category,
    hasParticipantPreset: !!(this.config.participantPresetData && this.config.participantPresetData.length > 0),
    participantCount: this.config.participantPresetData?.length || 0,
    folderOrganizationEnabled: !!this.config.folderOrganization?.enabled,
    enableAdvancedAnnotations: this.config.enableAdvancedAnnotations
  },
  // NEW: Add system environment telemetry
  system_environment: systemEnvironment
};
```

#### E. Add Execution Complete Telemetry (find around line 3010)

**FIND THIS CODE (around line 3010):**

```typescript
if (currentUserId && this.config.executionId) {
  const executionUpdate = {
    processed_images: successful,
    status: successful === results.length ? 'completed' : 'completed_with_errors',
    updated_at: new Date().toISOString()
  };
```

**REPLACE WITH:**

```typescript
if (currentUserId && this.config.executionId) {
  // Collect final telemetry stats (optional)
  let performanceBreakdown: any = undefined;
  let memoryStats: any = undefined;
  let networkStats: any = undefined;
  let errorSummary: any = undefined;

  try {
    if (this.performanceTimer) {
      performanceBreakdown = this.performanceTimer.getTimings();
    }

    if (this.networkMonitor) {
      networkStats = this.networkMonitor.getMetrics();
    }

    if (this.errorTracker) {
      errorSummary = this.errorTracker.getErrorSummary();
    }

    // Memory stats
    const currentMemoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
    memoryStats = {
      peak_mb: currentMemoryMB, // TODO: Track actual peak during execution
      average_mb: currentMemoryMB,
      baseline_mb: currentMemoryMB
    };

    console.log('[UnifiedProcessor] ✅ Final telemetry collected');
  } catch (telemetryError) {
    console.warn('[UnifiedProcessor] ⚠️ Failed to collect final telemetry:', telemetryError);
  }

  const executionUpdate = {
    processed_images: successful,
    status: successful === results.length ? 'completed' : 'completed_with_errors',
    updated_at: new Date().toISOString(),
    // NEW: Add telemetry fields
    performance_breakdown: performanceBreakdown,
    error_summary: errorSummary
  };
```

#### F. Update Analysis Logger Complete Event

**FIND (around line 3030):**

```typescript
} else {
  console.log(`[UnifiedProcessor] ✅ Execution record updated: ${successful}/${results.length} successful`);
}
```

**ADD AFTER:**

```typescript
// Update analysis logger with complete telemetry
if (this.analysisLogger) {
  try {
    this.analysisLogger.logExecutionComplete(
      results.length,
      successful,
      {
        performanceBreakdown,
        memoryStats,
        networkStats,
        errorSummary
      }
    );
  } catch (logError) {
    console.warn('[UnifiedProcessor] ⚠️ Failed to log complete telemetry:', logError);
  }
}
```

---

## 📝 Step 7: Database Service Interface Update

### Location: `src/database-service.ts`

Already completed in previous step! ✅

The `Execution` interface was updated with optional telemetry fields:
- `system_environment?`
- `performance_breakdown?`
- `error_summary?`

---

## 📝 Step 8: Database Migration Update

### Location: `supabase/migrations/20251015000000_add_execution_tracking_fields.sql`

**ADD to the existing migration file:**

```sql
-- Add system_environment JSONB column for hardware/network/environment telemetry
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS system_environment JSONB DEFAULT '{}'::jsonb;

-- Add performance_breakdown JSONB column for detailed phase timings
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS performance_breakdown JSONB DEFAULT '{}'::jsonb;

-- Add error_summary JSONB column for error tracking statistics
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS error_summary JSONB DEFAULT '{}'::jsonb;

-- Add helpful comments
COMMENT ON COLUMN executions.system_environment IS 'System hardware, network, and environment information collected at execution start (JSONB)';
COMMENT ON COLUMN executions.performance_breakdown IS 'Detailed timing breakdown by processing phase: RAW conversion, resize, AI analysis, upload, etc. (JSONB)';
COMMENT ON COLUMN executions.error_summary IS 'Summary of errors encountered during execution by category and severity (JSONB)';
```

---

## 🧪 Testing Checklist

### Manual Testing:

1. **✅ Old app versions compatibility**
   - Start app WITHOUT telemetry changes
   - Process images normally
   - Verify no errors

2. **✅ New telemetry collection**
   - Start app WITH telemetry changes
   - Process images
   - Check console for telemetry logs
   - Verify no errors if telemetry fails

3. **✅ Database compatibility**
   - Apply migration
   - Create new execution
   - Verify telemetry fields are saved
   - Verify old executions still work

4. **✅ JSONL compatibility**
   - Process images
   - Check JSONL file in `.analysis-logs/`
   - Verify new fields are present (optional)
   - Verify old format still readable

### Automated Testing:

Create test file: `tests/telemetry/test-telemetry-integration.ts`

```typescript
import { HardwareDetector } from '../../src/utils/hardware-detector';
import { NetworkMonitor } from '../../src/utils/network-monitor';
import { PerformanceTimer } from '../../src/utils/performance-timer';
import { ErrorTracker } from '../../src/utils/error-tracker';

describe('Telemetry System Integration', () => {
  test('Hardware detector should not throw', async () => {
    const detector = new HardwareDetector();
    const info = await detector.getHardwareInfo();
    expect(info).toBeDefined();
    expect(info.cpu_model).toBeDefined();
  });

  test('Network monitor should handle failures gracefully', async () => {
    const monitor = new NetworkMonitor();
    const metrics = await monitor.measureInitialMetrics(1000); // Short timeout
    expect(metrics).toBeDefined();
  });

  test('Performance timer should track phases', () => {
    const timer = new PerformanceTimer();
    timer.startPhase('ai_analysis');
    // Simulate work
    timer.endPhase('ai_analysis');
    const timings = timer.getTimings();
    expect(timings.ai_analysis_count).toBe(1);
  });

  test('Error tracker should categorize errors', () => {
    const tracker = new ErrorTracker();
    tracker.trackError(new Error('ENOENT: file not found'), 'recoverable');
    const summary = tracker.getErrorSummary();
    expect(summary.by_category.filesystem).toBe(1);
  });
});
```

---

## 🎯 Success Criteria

✅ All 4 new utility modules created
✅ Analysis logger updated with optional fields
✅ Backward compatibility maintained (all telemetry is optional)
✅ No breaking changes to existing code
✅ Database migration with optional JSONB fields
✅ Graceful degradation if telemetry fails

---

## ⚠️ Safety Notes

1. **All telemetry collection has try/catch** - Never breaks processing
2. **All new fields are optional (`?`)** - Old code still works
3. **Timeouts on slow operations** - Max 5s for hardware/network detection
4. **Graceful fallbacks** - If collection fails, continue with empty/default values
5. **No user-identifiable data** - Machine ID is hashed, no IP/email/name

---

## 📊 Expected Benefits

### Debug & Support:
- Identify Mac M1/M2/M3 specific issues
- Diagnose slow uploads (network vs file size)
- Find performance bottlenecks (RAW vs AI vs Upload)
- Track error patterns by hardware/network

### Analytics:
- Understand typical user hardware
- Optimize for common configurations
- Measure impact of optimizations

### Business:
- Correlate hardware → performance → satisfaction
- Identify users needing hardware upgrades
- Data-driven feature prioritization

---

## 🚀 Deployment Steps

1. **Apply database migration** via Supabase SQL Editor
2. **Compile TypeScript**: `npm run compile`
3. **Test locally** with sample images
4. **Monitor logs** for telemetry collection success
5. **Verify database** - check new JSONB fields populated
6. **Check JSONL files** - verify enhanced events logged
7. **Release** to internal beta first

---

**Last Updated:** 2025-10-15
**Status:** Step 6 IN PROGRESS - Unified Processor Integration
**Next:** Complete Steps 6, 7, 8
