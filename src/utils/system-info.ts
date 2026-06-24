import * as os from 'os';
import * as crypto from 'crypto';
import { app } from 'electron';

export interface SystemInfo {
  client_version: string;
  client_build_number: string;
  operating_system: string;
  os_version: string;
  system_arch: string;
  client_session_id: string;
  client_machine_id: string;
}

let cachedSystemInfo: SystemInfo | null = null;
let sessionId: string | null = null;

/**
 * Generates a unique session ID for the current app session
 */
function generateSessionId(): string {
  if (!sessionId) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    sessionId = `session_${timestamp}_${random}`;
  }
  return sessionId;
}

/**
 * Generates an anonymized machine ID based on hardware characteristics
 * Uses SHA-256 hash of hostname + CPU model for privacy
 */
function generateMachineId(): string {
  try {
    const hostname = os.hostname();
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
    const platform = os.platform();
    const arch = os.arch();
    
    // Create a unique but anonymized identifier
    const machineString = `${hostname}-${cpuModel}-${platform}-${arch}`;
    const hash = crypto.createHash('sha256');
    hash.update(machineString);
    
    return hash.digest('hex').substring(0, 16); // First 16 chars of hash
  } catch (error) {
    console.warn('[SystemInfo] Failed to generate machine ID:', error);
    return `machine_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }
}

/**
 * Canonical machine ID for device→account abuse correlation (Phase 3 device cap).
 *
 * MUST match the "Scheme A" id that app_launches.machine_id and
 * executions.system_environment.device.machineId are built from (main.ts
 * trackAppLaunch + unified-image-processor.ts), because device_accounts — the
 * table the cap counts — is keyed on it. It is DELIBERATELY different from
 * getMachineId() (Scheme B: dash-joined, no totalmem) which feeds
 * pre_authorize_tokens; that sacred path is left untouched. The fields, order,
 * separator and totalmem here are load-bearing — keep them in sync with main.ts.
 * Returns '' on failure so the caller can fail-open (skip the cap check).
 */
export function getCanonicalMachineId(): string {
  try {
    const cpus = os.cpus();
    const source = [
      os.hostname(),
      os.platform(),
      os.arch(),
      cpus.length > 0 ? cpus[0].model : '',
      os.totalmem().toString()
    ].join('|');
    return crypto.createHash('sha256').update(source).digest('hex').substring(0, 16);
  } catch (error) {
    console.warn('[SystemInfo] Failed to generate canonical machine ID:', error);
    return '';
  }
}

/**
 * Gets detailed operating system information
 */
function getOperatingSystemInfo(): { name: string; version: string } {
  const platform = os.platform();
  const release = os.release();
  const type = os.type();
  
  let osName: string;
  let osVersion: string;

  switch (platform) {
    case 'darwin':
      osName = 'macOS';
      // Convert macOS kernel version to user-friendly version
      osVersion = `${type} ${release}`;
      break;
    case 'win32':
      osName = 'Windows';
      osVersion = `${type} ${release}`;
      break;
    case 'linux':
      osName = 'Linux';
      osVersion = `${type} ${release}`;
      break;
    default:
      osName = platform;
      osVersion = `${type} ${release}`;
  }

  return { name: osName, version: osVersion };
}

/**
 * Gets the build number from environment variables or generates one
 */
function getBuildNumber(): string {
  // Check for CI/CD build number environment variables
  const buildNumber = 
    process.env.BUILD_NUMBER ||
    process.env.GITHUB_RUN_NUMBER ||
    process.env.CI_BUILD_ID ||
    process.env.BUILD_ID;

  if (buildNumber) {
    return `build-${buildNumber}`;
  }

  // Fallback: generate from version and timestamp
  try {
    const version = app.getVersion();
    const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp
    return `v${version}-${timestamp}`;
  } catch (error) {
    return `build-${Date.now()}`;
  }
}

/**
 * Collects comprehensive system information for analytics
 */
export function getSystemInfo(): SystemInfo {
  // Return cached info if available (system info doesn't change during session)
  if (cachedSystemInfo) {
    return cachedSystemInfo;
  }

  try {
    const osInfo = getOperatingSystemInfo();
    
    cachedSystemInfo = {
      client_version: app.getVersion(),
      client_build_number: getBuildNumber(),
      operating_system: osInfo.name,
      os_version: osInfo.version,
      system_arch: os.arch(), // 'x64', 'arm64', etc.
      client_session_id: generateSessionId(),
      client_machine_id: generateMachineId()
    };

    console.log('[SystemInfo] Collected system information:', {
      ...cachedSystemInfo,
      client_machine_id: cachedSystemInfo.client_machine_id.substring(0, 8) + '...' // Log partial ID for privacy
    });

    return cachedSystemInfo;
  } catch (error) {
    console.error('[SystemInfo] Failed to collect system information:', error);
    
    // Return minimal fallback info
    return {
      client_version: '0.0.0',
      client_build_number: 'unknown',
      operating_system: 'Unknown',
      os_version: 'Unknown',
      system_arch: 'unknown',
      client_session_id: generateSessionId(),
      client_machine_id: generateMachineId()
    };
  }
}

/**
 * Resets cached system info (useful for testing)
 */
export function resetSystemInfo(): void {
  cachedSystemInfo = null;
  sessionId = null;
}

/**
 * Gets just the session ID without full system info
 */
export function getSessionId(): string {
  return generateSessionId();
}

/**
 * Gets a privacy-safe machine identifier
 */
export function getMachineId(): string {
  if (cachedSystemInfo) {
    return cachedSystemInfo.client_machine_id;
  }
  return generateMachineId();
}