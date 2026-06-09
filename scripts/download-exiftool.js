const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { exec } = require('child_process');

const execPromise = promisify(exec);
const mkdirPromise = promisify(fs.mkdir);
const writeFilePromise = promisify(fs.writeFile);
const unlinkPromise = promisify(fs.unlink);
const chmodPromise = promisify(fs.chmod);

// exiftool.org serves ONLY the latest release at its versioned URLs, so any
// hardcoded version 404s once it is superseded (e.g. 13.38 was gone by 2026).
// We resolve the current version from ver.txt at runtime and fall back to a
// known-good pin if the network/parse fails. URLs are built per-platform from
// the resolved version inside the setup functions below.
const EXIFTOOL_FALLBACK_VERSION = "13.59";

async function resolveExiftoolVersion() {
    try {
        const { default: fetch } = await import('node-fetch');
        const res = await fetch('https://exiftool.org/ver.txt');
        if (res.ok) {
            const v = (await res.text()).trim();
            if (/^\d+\.\d+$/.test(v)) return v;
        }
        console.warn(`ver.txt returned an unexpected value; using ${EXIFTOOL_FALLBACK_VERSION}`);
    } catch (error) {
        console.warn(`Could not resolve latest ExifTool version (${error.message}); using ${EXIFTOOL_FALLBACK_VERSION}`);
    }
    return EXIFTOOL_FALLBACK_VERSION;
}

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
    // node-fetch v3 removed response.buffer() — use the WHATWG arrayBuffer().
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFilePromise(outputPath, buffer);
    console.log(`Downloaded ${outputPath}`);
}

async function setupWindows(version) {
    const AdmZip = require('adm-zip');
    const EXIFTOOL_WIN_URL = `https://exiftool.org/exiftool-${version}_64.zip`; // 64-bit Windows package
    console.log("Setting up ExifTool for Windows...");
    const exiftoolWinZip = path.join(TEMP_DIR, 'exiftool-win.zip');
    await downloadFile(EXIFTOOL_WIN_URL, exiftoolWinZip);

    const zip = new AdmZip(exiftoolWinZip);

    // Extract entire zip to temp directory
    const extractPath = path.join(TEMP_DIR, 'exiftool-win-extract');
    await mkdirPromise(extractPath, { recursive: true });
    zip.extractAllTo(extractPath, true);

    // The 64-bit version has structure: exiftool-<version>_64/exiftool_files/
    const exiftoolFilesDir = path.join(extractPath, `exiftool-${version}_64`, 'exiftool_files');

    if (!fs.existsSync(exiftoolFilesDir)) {
        throw new Error(`Could not find exiftool_files directory at: ${exiftoolFilesDir}`);
    }

    await mkdirPromise(WIN32_DIR, { recursive: true });

    // LAUNCHER-ONLY install. The ExifTool code (exiftool.pl + lib/) and the
    // support DLLs are COMMITTED to vendor/win32 at a DELIBERATELY PINNED
    // version (chosen for compatibility), so this must NOT overwrite them —
    // doing so would silently bump ExifTool every time it runs (e.g. the build
    // guardrail's auto-download). The only git-ignored piece is the launcher:
    // the Strawberry Perl interpreter (perl.exe), which is version-independent
    // of the ExifTool script. We copy ONLY perl.exe (as perl.exe + exiftool.exe)
    // and its perlNNN.dll runtime, and only when absent so we never clobber a
    // committed, identical DLL. At runtime native-tool-manager invokes
    // `exiftool.exe exiftool.pl <args>`, so the committed .pl is what executes.
    const perlExeSrc = path.join(exiftoolFilesDir, 'perl.exe');
    if (!fs.existsSync(perlExeSrc)) {
        throw new Error(`perl.exe (the launcher) not found in the downloaded package at: ${perlExeSrc}`);
    }
    fs.copyFileSync(perlExeSrc, path.join(WIN32_DIR, 'perl.exe'));
    fs.copyFileSync(perlExeSrc, path.join(WIN32_DIR, 'exiftool.exe'));

    let copiedDlls = 0;
    for (const f of fs.readdirSync(exiftoolFilesDir)) {
        if (/^perl\d+\.dll$/i.test(f)) {
            const dest = path.join(WIN32_DIR, f);
            if (!fs.existsSync(dest)) {
                fs.copyFileSync(path.join(exiftoolFilesDir, f), dest);
                copiedDlls++;
            }
        }
    }

    console.log(`ExifTool launcher installed at: ${path.join(WIN32_DIR, 'exiftool.exe')}`);
    console.log(`(committed exiftool.pl/lib left untouched to preserve the pinned version; ${copiedDlls} runtime DLL(s) added)`);
}

async function setupLinuxOrDarwinPerl(version) {
    const targetDir = process.platform === 'darwin' ? DARWIN_DIR : LINUX_DIR;
    const targetExiftool = path.join(targetDir, 'exiftool');
    // The macOS/Linux ExifTool is a single COMMITTED Perl script pinned to a
    // deliberate version. Skip if it already exists so a re-run never silently
    // bumps it (pass --force, or delete the file, to intentionally re-provision).
    if (fs.existsSync(targetExiftool) && !process.argv.includes('--force')) {
        console.log(`ExifTool already present at ${targetExiftool} — skipping to preserve the pinned version (use --force to re-provision).`);
        return;
    }
    const EXIFTOOL_LINUX_URL = `https://exiftool.org/Image-ExifTool-${version}.tar.gz`;
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

    await mkdirPromise(targetDir, { recursive: true });

    fs.copyFileSync(exiftoolScriptPath, path.join(targetDir, 'exiftool'));
    await chmodPromise(path.join(targetDir, 'exiftool'), 0o755); // Make executable
    console.log(`ExifTool for ${process.platform} installed at: ${path.join(targetDir, 'exiftool')}`);
}

async function main() {
    const version = await resolveExiftoolVersion();
    console.log(`Setting up ExifTool version ${version}...`);
    await mkdirPromise(TEMP_DIR, { recursive: true });

    try {
        if (process.platform === 'win32') {
            await setupWindows(version);
        } else if (process.platform === 'darwin' || process.platform === 'linux') {
            await setupLinuxOrDarwinPerl(version);
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