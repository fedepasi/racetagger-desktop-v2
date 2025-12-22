import * as path from 'path';
import * as fs from 'fs';
import { execFile, spawn } from 'child_process';
import { app } from 'electron';

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
 * CRITICAL FIX: Caches tool paths to avoid repeated fs.existsSync() calls
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
      return path.join(__dirname, '../../vendor');
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

    const toolExecutables = {
      exiftool: process.platform === 'win32' ? 'exiftool.exe' : 'exiftool',
      dcraw: process.platform === 'win32' ? 'dcraw.exe' : 'dcraw',
      imagemagick: this.getImageMagickExecutable()
    };

    const executable = toolExecutables[toolName as keyof typeof toolExecutables];
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

    // Special handling for ImageMagick
    if (executable === 'magick.exe') {
      return this.getImageMagickWindowsPath(arch);
    }

    // Try architecture-specific path first
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

  private getImageMagickWindowsPath(arch: string): ToolInfo {
    // Try bundled ImageMagick first
    const imageMagickPath = path.join(this.basePath, 'win32', arch, 'imagemagick', 'magick.exe');
    if (fs.existsSync(imageMagickPath)) {
      return { path: imageMagickPath, native: true };
    }

    // Fall back to x64 under emulation for ARM64
    if (this.systemInfo.isARM64) {
      const x64ImageMagickPath = path.join(this.basePath, 'win32', 'x64', 'imagemagick', 'magick.exe');
      if (fs.existsSync(x64ImageMagickPath)) {
        return { path: x64ImageMagickPath, native: false, emulated: true };
      }
    }

    // Fallback to system ImageMagick
    return { path: 'magick', native: false };
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

  private getImageMagickExecutable(): string {
    switch (process.platform) {
      case 'win32':
        return 'magick.exe';
      case 'darwin':
        return 'convert';
      case 'linux':
        return 'convert';
      default:
        return 'convert';
    }
  }

  /**
   * Execute a native tool with proper error handling and logging
   */
  async executeTool(toolName: string, args: string[], options: any = {}): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const toolInfo = this.getToolPath(toolName);
      const toolPath = toolInfo.path;

      const child = execFile(toolPath, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env, ...this.getToolEnvironment() },
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
   * Get environment variables optimized for tool execution
   */
  private getToolEnvironment(): Record<string, string> {
    const env: Record<string, string> = {};

    if (process.platform === 'win32') {
      // ImageMagick specific environment
      const arch = this.systemInfo.processArch;
      let imageMagickPath = path.join(this.basePath, 'win32', arch, 'imagemagick');

      // Fallback to x64 for ARM64 if native version doesn't exist
      if (!fs.existsSync(imageMagickPath) && this.systemInfo.isARM64) {
        imageMagickPath = path.join(this.basePath, 'win32', 'x64', 'imagemagick');
      }

      if (fs.existsSync(imageMagickPath)) {
        env.MAGICK_HOME = imageMagickPath;
        env.MAGICK_CONFIGURE_PATH = path.join(imageMagickPath, 'config');
        env.MAGICK_CODER_MODULE_PATH = path.join(imageMagickPath, 'modules-Q8', 'coders');
        env.MAGICK_FILTER_MODULE_PATH = path.join(imageMagickPath, 'modules-Q8', 'filters');

        // Prevent ImageMagick from using system config that might conflict
        env.MAGICK_DEBUG = '';
        env.MAGICK_TEMPORARY_PATH = path.join(require('os').tmpdir(), 'racetagger-imagemagick');

        // Ensure proper DLL loading for Windows
        const oldPath = env.PATH || process.env.PATH || '';
        env.PATH = `${imageMagickPath};${oldPath}`;
      }

      // Node-gyp for rebuilds
      env.npm_config_arch = this.systemInfo.processArch;
      env.npm_config_target_arch = this.systemInfo.processArch;
      env.npm_config_disturl = 'https://electronjs.org/headers';
      env.npm_config_runtime = 'electron';
      env.npm_config_build_from_source = 'true';
    }

    return env;
  }

  /**
   * Verify that a tool is accessible and working
   */
  async verifyTool(toolName: string): Promise<boolean> {
    try {
      const versionArgs = {
        exiftool: ['-ver'],
        dcraw: ['-v'],
        imagemagick: ['-version']
      };

      const args = versionArgs[toolName as keyof typeof versionArgs];
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
      environment: this.getToolEnvironment()
    };

    const tools = ['exiftool', 'dcraw', 'imagemagick'];

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
