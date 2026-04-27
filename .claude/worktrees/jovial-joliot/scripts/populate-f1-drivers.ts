/**
 * Populate F1 2025 Drivers Face Database
 *
 * This script populates the sport_category_faces table with F1 2025 drivers.
 * It downloads official photos, generates face descriptors, and stores them in Supabase.
 *
 * Usage: npx ts-node scripts/populate-f1-drivers.ts
 *
 * Prerequisites:
 * 1. Run the migration: 20251125000000_add_face_recognition_support.sql
 * 2. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables
 * 3. Create 'driver-photos' bucket in Supabase Storage
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { createClient } from '@supabase/supabase-js';

// =====================================================
// F1 2025 Driver Data
// =====================================================

interface F1Driver {
  name: string;
  team: string;
  number: string;
  nationality: string;
  // Wikipedia/FIA photo URL (these are placeholder URLs - replace with actual official photos)
  photoUrl: string;
}

// F1 2025 Grid (based on confirmed transfers)
const F1_DRIVERS_2025: F1Driver[] = [
  // Red Bull Racing
  {
    name: 'Max Verstappen',
    team: 'Red Bull Racing',
    number: '1',
    nationality: 'NL',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/verstappen'
  },
  {
    name: 'Liam Lawson',
    team: 'Red Bull Racing',
    number: '30',
    nationality: 'NZ',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/lawson'
  },
  // Ferrari
  {
    name: 'Charles Leclerc',
    team: 'Ferrari',
    number: '16',
    nationality: 'MC',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/leclerc'
  },
  {
    name: 'Lewis Hamilton',
    team: 'Ferrari',
    number: '44',
    nationality: 'GB',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/hamilton'
  },
  // Mercedes
  {
    name: 'George Russell',
    team: 'Mercedes',
    number: '63',
    nationality: 'GB',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/russell'
  },
  {
    name: 'Kimi Antonelli',
    team: 'Mercedes',
    number: '12',
    nationality: 'IT',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/antonelli'
  },
  // McLaren
  {
    name: 'Lando Norris',
    team: 'McLaren',
    number: '4',
    nationality: 'GB',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/norris'
  },
  {
    name: 'Oscar Piastri',
    team: 'McLaren',
    number: '81',
    nationality: 'AU',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/piastri'
  },
  // Aston Martin
  {
    name: 'Fernando Alonso',
    team: 'Aston Martin',
    number: '14',
    nationality: 'ES',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/alonso'
  },
  {
    name: 'Lance Stroll',
    team: 'Aston Martin',
    number: '18',
    nationality: 'CA',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/stroll'
  },
  // Alpine
  {
    name: 'Pierre Gasly',
    team: 'Alpine',
    number: '10',
    nationality: 'FR',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/gasly'
  },
  {
    name: 'Jack Doohan',
    team: 'Alpine',
    number: '7',
    nationality: 'AU',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/doohan'
  },
  // Williams
  {
    name: 'Alex Albon',
    team: 'Williams',
    number: '23',
    nationality: 'TH',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/albon'
  },
  {
    name: 'Carlos Sainz',
    team: 'Williams',
    number: '55',
    nationality: 'ES',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/sainz'
  },
  // RB (Visa Cash App RB)
  {
    name: 'Yuki Tsunoda',
    team: 'RB',
    number: '22',
    nationality: 'JP',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/tsunoda'
  },
  {
    name: 'Isack Hadjar',
    team: 'RB',
    number: '6',
    nationality: 'FR',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/hadjar'
  },
  // Kick Sauber
  {
    name: 'Nico Hulkenberg',
    team: 'Kick Sauber',
    number: '27',
    nationality: 'DE',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/hulkenberg'
  },
  {
    name: 'Gabriel Bortoleto',
    team: 'Kick Sauber',
    number: '5',
    nationality: 'BR',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/bortoleto'
  },
  // Haas
  {
    name: 'Esteban Ocon',
    team: 'Haas',
    number: '31',
    nationality: 'FR',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/ocon'
  },
  {
    name: 'Oliver Bearman',
    team: 'Haas',
    number: '87',
    nationality: 'GB',
    photoUrl: 'https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/drivers/2024/bearman'
  }
];

// =====================================================
// Supabase Configuration
// =====================================================

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  console.log('Usage: SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx npx ts-node scripts/populate-f1-drivers.ts');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// =====================================================
// Helper Functions
// =====================================================

/**
 * Download image from URL to local file
 */
async function downloadImage(url: string, destPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(destPath);

    https.get(url, (response) => {
      // Follow redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(destPath);
          downloadImage(redirectUrl, destPath).then(resolve);
          return;
        }
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        resolve(false);
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
    }).on('error', () => {
      file.close();
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      resolve(false);
    });
  });
}

/**
 * Generate face descriptor using face-api.js
 * Note: In production, this would use the FaceRecognitionProcessor
 * For this script, we use a simplified approach
 */
async function generateDescriptor(imagePath: string): Promise<number[] | null> {
  // Import face-api.js and canvas
  const faceapi = require('face-api.js');
  const canvas = require('canvas');
  const { Canvas, Image, ImageData, loadImage, createCanvas } = canvas;

  // Patch face-api.js
  faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

  // Load models
  const modelsPath = path.join(__dirname, '..', 'src', 'assets', 'models', 'face-api');

  if (!faceapi.nets.ssdMobilenetv1.isLoaded) {
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);
  }

  try {
    // Load image
    const img = await loadImage(imagePath);
    const canvasImg = createCanvas(img.width, img.height);
    const ctx = canvasImg.getContext('2d');
    ctx.drawImage(img, 0, 0);

    // Detect face
    const detection = await faceapi
      .detectSingleFace(canvasImg, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      return null;
    }

    return Array.from(detection.descriptor);
  } catch (error) {
    console.error('Error generating descriptor:', error);
    return null;
  }
}

// =====================================================
// Main Population Function
// =====================================================

async function populateF1Drivers() {
  console.log('='.repeat(60));
  console.log('F1 2025 Drivers Face Database Population Script');
  console.log('='.repeat(60));

  // 1. Get F1 category ID
  console.log('\n[1/5] Finding F1 category...');
  const { data: categories, error: catError } = await supabase
    .from('sport_categories')
    .select('id, name, code')
    .eq('code', 'f1')
    .single();

  if (catError || !categories) {
    console.error('ERROR: F1 category not found in database');
    console.error(catError);
    process.exit(1);
  }

  const f1CategoryId = categories.id;
  console.log(`   Found F1 category: ${categories.name} (${f1CategoryId})`);

  // 2. Check existing drivers
  console.log('\n[2/5] Checking existing drivers...');
  const { data: existingDrivers } = await supabase
    .from('sport_category_faces')
    .select('driver_name')
    .eq('sport_category_id', f1CategoryId)
    .eq('season', '2025');

  const existingNames = new Set(existingDrivers?.map(d => d.driver_name) || []);
  console.log(`   Found ${existingNames.size} existing drivers`);

  // 3. Create temp directory for photos
  const tempDir = path.join(__dirname, '..', 'temp', 'driver-photos');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // 4. Process each driver
  console.log('\n[3/5] Processing drivers...');
  const results: { success: string[]; failed: string[]; skipped: string[] } = {
    success: [],
    failed: [],
    skipped: []
  };

  for (const driver of F1_DRIVERS_2025) {
    // Skip if already exists
    if (existingNames.has(driver.name)) {
      console.log(`   [SKIP] ${driver.name} - already in database`);
      results.skipped.push(driver.name);
      continue;
    }

    console.log(`   Processing: ${driver.name} (#${driver.number}, ${driver.team})...`);

    // Download photo
    const photoPath = path.join(tempDir, `${driver.name.replace(/\s/g, '_')}.jpg`);
    const downloaded = await downloadImage(driver.photoUrl, photoPath);

    if (!downloaded) {
      console.log(`      [WARN] Could not download photo for ${driver.name}`);
      // Continue without photo - descriptor can be added later via Management Portal
    }

    // Generate descriptor (if photo was downloaded)
    let descriptor: number[] | null = null;
    if (downloaded && fs.existsSync(photoPath)) {
      descriptor = await generateDescriptor(photoPath);
      if (!descriptor) {
        console.log(`      [WARN] Could not detect face for ${driver.name}`);
      }
    }

    // Insert into database (even without descriptor - can be added later)
    const { error: insertError } = await supabase
      .from('sport_category_faces')
      .insert({
        sport_category_id: f1CategoryId,
        driver_name: driver.name,
        team: driver.team,
        car_number: driver.number,
        nationality: driver.nationality,
        face_descriptor: descriptor,
        reference_photo_url: downloaded ? driver.photoUrl : null,
        season: '2025',
        is_active: true
      });

    if (insertError) {
      console.log(`      [ERROR] Failed to insert ${driver.name}: ${insertError.message}`);
      results.failed.push(driver.name);
    } else {
      const status = descriptor ? 'with face descriptor' : 'without face descriptor';
      console.log(`      [OK] ${driver.name} inserted ${status}`);
      results.success.push(driver.name);
    }
  }

  // 5. Cleanup temp files
  console.log('\n[4/5] Cleaning up temp files...');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // 6. Summary
  console.log('\n[5/5] Summary');
  console.log('='.repeat(60));
  console.log(`   Total drivers: ${F1_DRIVERS_2025.length}`);
  console.log(`   Successfully added: ${results.success.length}`);
  console.log(`   Failed: ${results.failed.length}`);
  console.log(`   Skipped (existing): ${results.skipped.length}`);

  if (results.failed.length > 0) {
    console.log('\n   Failed drivers:');
    results.failed.forEach(name => console.log(`      - ${name}`));
  }

  console.log('\n   Note: Drivers without face descriptors can have photos');
  console.log('   uploaded via the Management Portal.');
  console.log('='.repeat(60));
}

// Run the script
populateF1Drivers()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nFatal error:', error);
    process.exit(1);
  });
