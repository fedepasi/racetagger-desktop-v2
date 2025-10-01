const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { exec } = require('child_process');

const execPromise = promisify(exec);
const mkdirPromise = promisify(fs.mkdir);
const writeFilePromise = promisify(fs.writeFile);
const unlinkPromise = promisify(fs.unlink);
const chmodPromise = promisify(fs.chmod);

const EXIFTOOL_VERSION = "13.31"; // Updated to latest version
const EXIFTOOL_WIN_URL = `https://exiftool.org/exiftool-${EXIFTOOL_VERSION}.zip`;
const EXIFTOOL_LINUX_URL = `https://exiftool.org/Image-ExifTool-${EXIFTOOL_VERSION}.tar.gz`; // Corrected URL and extension

const ROOT_DIR = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(ROOT_DIR, 'vendor');
const WIN32_DIR = path.join(VENDOR_DIR, 'win32');
const DARWIN_DIR = path.join(VENDOR_DIR, 'darwin');
const LINUX_DIR = path.join(VENDOR_DIR, 'linux');
const TEMP_DIR = path.join(ROOT_DIR, 'tmp');

async function downloadFile(url, outputPath) {
    const { default: fetch } = await import('node-fetch');
    console.log(`Downloading ${url} to ${outputPath}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }
    const buffer = await response.buffer();
    await writeFilePromise(outputPath, buffer);
    console.log(`Downloaded ${outputPath}`);
}

async function setupWindows() {
    const AdmZip = require('adm-zip');
    console.log("Setting up ExifTool for Windows...");
    const exiftoolWinZip = path.join(TEMP_DIR, 'exiftool-win.zip');
    await downloadFile(EXIFTOOL_WIN_URL, exiftoolWinZip);

    const zip = new AdmZip(exiftoolWinZip);
    const zipEntries = zip.getEntries();
    let exiftoolExeEntry = null;

    for (const entry of zipEntries) {
        if (entry.entryName.match(/exiftool.*\.exe$/i)) {
            exiftoolExeEntry = entry;
            break;
        }
    }

    if (!exiftoolExeEntry) {
        throw new Error("Could not find exiftool.exe in the downloaded zip.");
    }

    const extractPath = path.join(TEMP_DIR, 'exiftool-win-extract');
    await mkdirPromise(extractPath, { recursive: true });
    zip.extractEntryTo(exiftoolExeEntry.entryName, extractPath, false, true);

    const extractedExePath = path.join(extractPath, exiftoolExeEntry.entryName);
    await mkdirPromise(WIN32_DIR, { recursive: true });
    fs.copyFileSync(extractedExePath, path.join(WIN32_DIR, 'exiftool.exe'));
    console.log(`ExifTool for Windows installed at: ${path.join(WIN32_DIR, 'exiftool.exe')}`);
}

async function setupLinuxOrDarwinPerl() {
    console.log("Setting up ExifTool (Perl script) for Linux/macOS...");
    const exiftoolTarGz = path.join(TEMP_DIR, 'exiftool-linux.tar.gz'); // Reverted to .tar.gz
    await downloadFile(EXIFTOOL_LINUX_URL, exiftoolTarGz);

    const extractPath = path.join(TEMP_DIR, 'exiftool-linux-extract');
    await mkdirPromise(extractPath, { recursive: true });

    // Use tar command for extraction
    await execPromise(`tar -xzf "${exiftoolTarGz}" -C "${extractPath}"`);

    const extractedDir = fs.readdirSync(extractPath).find(name => name.startsWith('Image-ExifTool-'));
    if (!extractedDir) {
        throw new Error("Could not find extracted ExifTool directory.");
    }

    const exiftoolScriptPath = path.join(extractPath, extractedDir, 'exiftool');
    
    // Determine target directory based on platform
    const targetDir = process.platform === 'darwin' ? DARWIN_DIR : LINUX_DIR;
    await mkdirPromise(targetDir, { recursive: true });

    fs.copyFileSync(exiftoolScriptPath, path.join(targetDir, 'exiftool'));
    await chmodPromise(path.join(targetDir, 'exiftool'), 0o755); // Make executable
    console.log(`ExifTool for ${process.platform} installed at: ${path.join(targetDir, 'exiftool')}`);
}

async function main() {
    console.log(`Setting up ExifTool version ${EXIFTOOL_VERSION}...`);
    await mkdirPromise(TEMP_DIR, { recursive: true });

    try {
        if (process.platform === 'win32') {
            await setupWindows();
        } else if (process.platform === 'darwin' || process.platform === 'linux') {
            await setupLinuxOrDarwinPerl();
        } else {
            console.warn(`Unsupported platform: ${process.platform}. ExifTool will not be installed.`);
        }
    } catch (error) {
        console.error("Error during ExifTool setup:", error);
        process.exit(1);
    } finally {
        console.log("Cleaning up temporary files...");
        if (fs.existsSync(TEMP_DIR)) {
            await fs.promises.rm(TEMP_DIR, { recursive: true, force: true });
        }
        console.log("ExifTool setup complete!");
    }
}

main();