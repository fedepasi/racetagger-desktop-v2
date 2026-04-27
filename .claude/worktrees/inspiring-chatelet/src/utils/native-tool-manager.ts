import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

export interface ToolInfo {
  path: string;
  native: boolean;
  emulated?: boolean;
}

export interface SystemInfo {
  processArch: string;
  platform: string;
  isARM64: boolean;
  isX64: boolean;
  isEmulated: boolean;
}

/**
 * Architecture detector for Windows systems
 * CRITICAL FIX: Caches results to avoid expensive execSync calls on every request
 */
export class ArchitectureDetector {
  private static cachedSystemInfo: SystemInfo | null = null;
  private static emulationDetected: boolean | null = null;

  static getSystemInfo(): SystemInfo {
    // CRITICAL FIX: Return cached result instantly
    if (this.cachedSystemInfo) {
      return this.cachedSystemInfo;
    }

    // Calculate only once
    this.cachedSystemInfo = {
      processArch: process.arch,
      platform: process.platform,
      isARM64: process.arch === 'arm64',
      isX64: process.arch === 'x64',
      isEmulated: this.detectEmulation()
    };

    return this.cachedSystemInfo;
  }

  static detectEmulation(): boolean {
    // CRITICAL FIX: Return cached result if available
    if (this.emulationDetected !== null) {
      return this.emulationDetected;
    }

    // On Windows ARM64, check if running under emulation
    if (process.platform === 'win32' && process.arch === 'x64') {
      try {
        const { execSync } = require('child_process');
        const result = execSync('wmic cpu get Architecture', { encoding: 'utf8', timeout: 5000 });
        // Architecture 12 = ARM64
        this.emulationDetected = result.includes('12');
      } catch {
        this.emulationDetected = false;
      }
    } else {
      this.emulationDetected = false;
    }

    // At this point emulationDetected is guaranteed to be boolean, not null
    return this.emulationDetected as boolean;
  }
}

/**
 * Centralized native tool manager for Windows, macOS, and Linux
 * Handles architecture detection, fallback mechanisms, and path resolution
 *
 * NOTE: dcraw and ImageMagick support removed in v1.2.0.
 * Only ExifTool is managed by this module now.
 */
export class NativeToolManager {
  private basePath: string;
  private systemInfo: SystemInfo;
  private toolPathCache: Map<string, ToolInfo> = new Map();

  constructor() {
    this.systemInfo = ArchitectureDetector.getSystemInfo();
    this.basePath = this.getBasePath();
  }

  private getBasePath(): string {
    // Safely determine if we're in development mode without electron-is-dev
    let isDev = true;
    try {
      const { app } = require('electron');
      isDev = !app || !app.isPackaged;
    } catch {
      // If electron is not available, assume development
      isDev = true;
    }

    if (isDev) {
      // In dev mode, __dirname is dist/src/utils/, so we need ../../../vendor to reach project root
      return path.join(__dirname, '../../../vendor');
    }

    // In production, vendor files are unpacked from asar
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor');
  }

  /**
   * Get the optimal tool path with architecture-specific fallback
   * CRITICAL FIX: Returns cached path instantly to avoid repeated fs.existsSync() calls
   */
  getToolPath(toolName: string): ToolInfo {
    // CRITICAL FIX: Check cache first
    const cached = this.toolPathCache.get(toolName);
    if (cached) {
      return cached;
    }

    const toolExecutables: Record<string, string> = {
      exiftool: process.platform === 'win32' ? 'exiftool.exe' : 'exiftool',
    };

    const executable = toolExecutables[toolName];
    if (!executable) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    // Platform-specific path resolution
    let toolInfo: ToolInfo;
    switch (process.platform) {
      case 'win32':
        toolInfo = this.getWindowsToolPath(executable);
        break;
      case 'darwin':
        toolInfo = this.getMacOSToolPath(executable);
        break;
      case 'linux':
        toolInfo = this.getLinuxToolPath(executable);
        break;
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }

    // CRITICAL FIX: Cache the result before returning
    this.toolPathCache.set(toolName, toolInfo);
    return toolInfo;
  }

  private getWindowsToolPath(executable: string): ToolInfo {
    const arch = this.systemInfo.processArch;

    // Try non-architecture-specific path first (vendor/win32/exiftool.exe)
    const flatPath = path.join(this.basePath, 'win32', executable);
    if (fs.existsSync(flatPath)) {
      return { path: flatPath, native: true };
    }

    // Try architecture-specific path (vendor/win32/x64/exiftool.exe)
    const archPath = path.join(this.basePath, 'win32', arch, executable);
    if (fs.existsSync(archPath)) {
      return { path: archPath, native: true };
    }

    // Fall back to x64 under emulation for ARM64
    if (this.systemInfo.isARM64) {
      const x64Path = path.join(this.basePath, 'win32', 'x64', executable);
      if (fs.existsSync(x64Path)) {
        return { path: x64Path, native: false, emulated: true };
      }
    }

    // Fallback to system-installed tool
    return { path: executable, native: false };
  }

  private getMacOSToolPath(executable: string): ToolInfo {
    const vendorPath = path.join(this.basePath, 'darwin', executable);
    if (fs.existsSync(vendorPath)) {
      return { path: vendorPath, native: true };
    }

    // Fallback to system paths
    const systemPaths = [
      `/opt/homebrew/bin/${executable}`,
      `/usr/local/bin/${executable}`,
      `/usr/bin/${executable}`
    ];

    for (const systemPath of systemPaths) {
      if (fs.existsSync(systemPath)) {
        return { path: systemPath, native: false };
      }
    }

    throw new Error(`Tool ${executable} not found on macOS`);
  }

  private getLinuxToolPath(executable: string): ToolInfo {
    const vendorPath = path.join(this.basePath, 'linux', executable);
    if (fs.existsSync(vendorPath)) {
      return { path: vendorPath, native: true };
    }

    // Fallback to system installation
    return { path: `/usr/bin/${executable}`, native: false };
  }

  /**
   * Execute a native tool with proper error handling and logging
   */
  async executeTool(toolName: string, args: string[], options: any = {}): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const toolInfo = this.getToolPath(toolName);
      let toolPath = toolInfo.path;
      let finalArgs = args;

      // Special handling for Windows ExifTool bundled as Perl + exiftool.pl
      // The vendor/win32/exiftool.exe is actually perl.exe, so we need to call:
      // exiftool.exe exiftool.pl [args]
      if (process.platform === 'win32' && toolName === 'exiftool') {
        const exiftoolDir = path.dirname(toolPath);
        const exiftoolPlPath = path.join(exiftoolDir, 'exiftool.pl');
        if (fs.existsSync(exiftoolPlPath)) {
          // exiftool.exe is actually Perl, prepend exiftool.pl to args
          finalArgs = [exiftoolPlPath, ...args];
        }
      }

      const child = execFile(toolPath, finalArgs, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        maxBuffer: options.maxBuffer || 100 * 1024 * 1024, // 100MB default
        encoding: options.encoding || 'utf8',
        timeout: options.timeout || 30000 // 30s default
      }, (error, stdout, stderr) => {
        if (error) {
          console.error(`[NativeToolManager] ${toolName} error:`, error);
          reject(new Error(`${toolName} execution failed: ${error.message}`));
        } else {
          // Ensure stdout and stderr are strings
          const stdoutStr = stdout?.toString() || '';
          const stderrStr = stderr?.toString() || '';
          resolve({ stdout: stdoutStr, stderr: stderrStr });
        }
      });

      child.on('error', (error) => {
        console.error(`[NativeToolManager] Process error for ${toolName}:`, error);
        reject(error);
      });
    });
  }

  /**
   * Verify that a tool is accessible and working
   */
  async verifyTool(toolName: string): Promise<boolean> {
    try {
      const versionArgs: Record<string, string[]> = {
        exiftool: ['-ver'],
      };

      const args = versionArgs[toolName];
      if (!args) {
        throw new Error(`No version check available for ${toolName}`);
      }

      await this.executeTool(toolName, args, { timeout: 10000 });
      return true;
    } catch (error) {
      console.error(`[NativeToolManager] Tool ${toolName} verification failed:`, error);
      return false;
    }
  }

  /**
   * Get comprehensive system and tool information for debugging
   */
  async getSystemDiagnostics(): Promise<any> {
    const diagnostics = {
      system: this.systemInfo,
      basePath: this.basePath,
      tools: {} as any,
    };

    const tools = ['exiftool'];

    for (const tool of tools) {
      try {
        const toolInfo = this.getToolPath(tool);
        const isWorking = await this.verifyTool(tool);

        diagnostics.tools[tool] = {
          ...toolInfo,
          exists: fs.existsSync(toolInfo.path),
          working: isWorking
        };
      } catch (error) {
        diagnostics.tools[tool] = {
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    return diagnostics;
  }
}

/**
 * Global instance of the native tool manager
 */
export const nativeToolManager = new NativeToolManager();
