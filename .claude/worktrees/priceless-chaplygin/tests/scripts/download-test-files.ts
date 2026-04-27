import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { FileHasher } from '../helpers/file-hasher';

interface TestFile {
  url: string;
  path: string;
  sha256: string;
  description: string;
}

/**
 * Large test files that should be downloaded on-demand
 * These are NOT committed to git due to size
 */
const TEST_FILES: TestFile[] = [
  {
    url: 'https://raw.githubusercontent.com/ianare/exif-samples/master/jpg/Canon_40D.jpg',
    path: 'tests/fixtures/images/high-res-canon.jpg',
    sha256: '', // Will be computed on first download
    description: 'Canon 40D high-resolution JPEG with full EXIF'
  },
  {
    url: 'https://raw.githubusercontent.com/ianare/exif-samples/master/jpg/Nikon_D70.jpg',
    path: 'tests/fixtures/images/high-res-nikon.jpg',
    sha256: '',
    description: 'Nikon D70 JPEG with comprehensive metadata'
  }
  // RAW files from raw.pixls.us (CC0 license, small samples)
  {
    url: 'https://raw.pixls.us/getfile.php/225/nice/Nikon-D7000-Sampleimage.NEF',
    path: 'tests/fixtures/images/sample-small.nef',
    sha256: '',
    description: 'Nikon D7000 NEF RAW file (CC0)'
  },
  {
    url: 'https://raw.pixls.us/getfile.php/164/nice/Canon-EOS-40D-Sampleimage.CR2',
    path: 'tests/fixtures/images/sample.cr2',
    sha256: '',
    description: 'Canon EOS 40D CR2 RAW file (CC0)'
  }
];

/**
 * Download a file from URL to local path
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirects
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });

      file.on('error', (err) => {
        file.close();
        fs.unlinkSync(destPath);
        reject(err);
      });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

/**
 * Main download function
 */
async function downloadTestFiles() {
  console.log('📥 Downloading test files...\n');

  const hasher = new FileHasher();
  let downloadedCount = 0;
  let skippedCount = 0;

  for (const file of TEST_FILES) {
    const destDir = path.dirname(file.path);

    // Ensure directory exists
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Check if file already exists
    if (fs.existsSync(file.path)) {
      console.log(`✓ ${path.basename(file.path)} already exists`);
      skippedCount++;
      continue;
    }

    try {
      console.log(`⬇️  Downloading ${path.basename(file.path)}...`);
      console.log(`   Source: ${file.url}`);

      await downloadFile(file.url, file.path);

      // Compute hash for verification
      const hash = await hasher.computeSHA256(file.path);
      console.log(`   SHA256: ${hash}`);

      // Verify hash if provided
      if (file.sha256 && hash !== file.sha256) {
        throw new Error(`Checksum mismatch! Expected: ${file.sha256}, Got: ${hash}`);
      }

      console.log(`✓ ${path.basename(file.path)} downloaded successfully\n`);
      downloadedCount++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to download ${file.path}: ${message}\n`);
    }
  }

  console.log(`\n✅ Download complete!`);
  console.log(`   Downloaded: ${downloadedCount}`);
  console.log(`   Skipped (already exist): ${skippedCount}`);
  console.log(`   Failed: ${TEST_FILES.length - downloadedCount - skippedCount}`);
}

// Run if called directly
if (require.main === module) {
  downloadTestFiles().catch(console.error);
}

export { downloadTestFiles };
