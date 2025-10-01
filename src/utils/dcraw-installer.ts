/**
 * DCraw Installer Module for RaceTagger
 * Handles automatic installation of dcraw for RAW image processing
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { app, dialog } from 'electron';

const execAsync = promisify(exec);
const fsPromises = fs.promises;

export class DcrawInstaller {
  /**
   * Check if dcraw is installed and working
   */
  async isDcrawInstalled(): Promise<boolean> {
    const isPackaged = app?.isPackaged || false;
    
    const possiblePaths = [];
    
    // Check bundled dcraw first
    if (process.platform === 'darwin') {
      const vendorPath = isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', 'darwin', 'dcraw')
        : path.join(process.cwd(), 'vendor', 'darwin', 'dcraw');
      possiblePaths.push(vendorPath);
      
      // Check system installations
      possiblePaths.push('/opt/homebrew/bin/dcraw');
      possiblePaths.push('/usr/local/bin/dcraw');
    }
    
    for (const dcrawPath of possiblePaths) {
      try {
        await fsPromises.access(dcrawPath, fs.constants.X_OK);
        const { stdout } = await execAsync(`"${dcrawPath}" -v 2>&1`);
        if (stdout.includes('Raw photo decoder')) {
          return true;
        }
      } catch {
        // Continue checking other paths
      }
    }
    
    return false;
  }

  /**
   * Install dcraw automatically on macOS
   */
  async installDcraw(): Promise<{ success: boolean; message: string }> {
    if (process.platform !== 'darwin') {
      return { 
        success: false, 
        message: 'Automatic installation is only supported on macOS' 
      };
    }

    try {
      // Check if dcraw is already working
      if (await this.isDcrawInstalled()) {
        return { 
          success: true, 
          message: 'dcraw is already installed and working' 
        };
      }

      console.log('Starting dcraw installation...');

      // Try Method 1: Homebrew
      try {
        const { stdout: brewCheck } = await execAsync('which brew');
        if (brewCheck) {
          console.log('Installing dcraw via Homebrew...');
          await execAsync('brew install dcraw');
          
          if (await this.isDcrawInstalled()) {
            return { 
              success: true, 
              message: 'Successfully installed dcraw via Homebrew' 
            };
          }
        }
      } catch {
        console.log('Homebrew not available, trying alternative method...');
      }

      // Method 2: Use bundled dcraw (already in vendor folder)
      const vendorDcrawPath = path.join(process.cwd(), 'vendor', 'darwin', 'dcraw');
      if (fs.existsSync(vendorDcrawPath)) {
        // Ensure it has executable permissions
        await fsPromises.chmod(vendorDcrawPath, '755');
        
        if (await this.isDcrawInstalled()) {
          return { 
            success: true, 
            message: 'Using bundled dcraw binary' 
          };
        }
      }

      return { 
        success: false, 
        message: 'Unable to install dcraw. Please install manually using: brew install dcraw' 
      };

    } catch (error: any) {
      console.error('dcraw installation failed:', error);
      return { 
        success: false, 
        message: `Installation failed: ${error.message}` 
      };
    }
  }

  /**
   * Show installation dialog and handle user interaction
   */
  async promptInstallation(): Promise<boolean> {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'dcraw Required for RAW Processing',
      message: 'dcraw is not installed or not accessible.',
      detail: 'dcraw is required to process RAW image files (NEF, ARW, CR2, etc.). Would you like to install it automatically?',
      buttons: ['Install Automatically', 'Install Manually', 'Cancel'],
      defaultId: 0,
      cancelId: 2
    });

    if (result.response === 0) {
      // Install automatically
      const installation = await this.installDcraw();
      
      if (installation.success) {
        dialog.showMessageBox({
          type: 'info',
          title: 'Installation Successful',
          message: 'dcraw has been installed successfully!',
          detail: 'You can now process RAW image files.'
        });
        return true;
      } else {
        dialog.showMessageBox({
          type: 'error',
          title: 'Installation Failed',
          message: 'Automatic installation failed',
          detail: installation.message
        });
        return false;
      }
    } else if (result.response === 1) {
      // Manual installation
      dialog.showMessageBox({
        type: 'info',
        title: 'Manual Installation Instructions',
        message: 'To install dcraw manually on macOS:',
        detail: `1. Open Terminal
2. Install Homebrew (if not installed):
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
3. Install dcraw:
   brew install dcraw
4. Restart RaceTagger after installation`
      });
      return false;
    }
    
    return false;
  }

  /**
   * Get installation script path
   */
  getInstallScriptPath(): string {
    const isPackaged = app?.isPackaged || false;
    return isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'install-dcraw-mac.sh')
      : path.join(process.cwd(), 'scripts', 'install-dcraw-mac.sh');
  }

  /**
   * Run installation script
   */
  async runInstallScript(): Promise<{ success: boolean; output: string }> {
    const scriptPath = this.getInstallScriptPath();
    
    if (!fs.existsSync(scriptPath)) {
      return { 
        success: false, 
        output: 'Installation script not found' 
      };
    }

    try {
      const { stdout, stderr } = await execAsync(`bash "${scriptPath}"`, {
        timeout: 60000 // 1 minute timeout
      });
      
      const success = await this.isDcrawInstalled();
      return { 
        success, 
        output: stdout + (stderr ? '\n' + stderr : '') 
      };
    } catch (error: any) {
      return { 
        success: false, 
        output: error.message 
      };
    }
  }
}