import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';

const FIXTURES_DIR = path.join(__dirname, '../fixtures/images');

interface FixtureSpec {
  filename: string;
  width: number;
  height: number;
  background: { r: number; g: number; b: number };
  overlays?: Array<{
    left: number;
    top: number;
    width: number;
    height: number;
    color: { r: number; g: number; b: number };
  }>;
  quality: number;
  description: string;
}

const FIXTURES: FixtureSpec[] = [
  {
    filename: 'sample.jpg',
    width: 2000,
    height: 1500,
    background: { r: 80, g: 120, b: 80 },
    overlays: [
      // Simulate subjects in scene
      { left: 400, top: 300, width: 200, height: 400, color: { r: 200, g: 50, b: 50 } },
      { left: 800, top: 350, width: 180, height: 380, color: { r: 50, g: 50, b: 200 } },
      { left: 1300, top: 280, width: 220, height: 420, color: { r: 200, g: 200, b: 50 } },
    ],
    quality: 85,
    description: 'Primary test fixture (2000x1500), used by 8+ test files',
  },
  {
    filename: 'motorsport-track.jpg',
    width: 800,
    height: 600,
    background: { r: 100, g: 100, b: 100 },
    overlays: [
      // Track surface
      { left: 0, top: 300, width: 800, height: 300, color: { r: 60, g: 60, b: 60 } },
      // Vehicle-like shape
      { left: 300, top: 250, width: 200, height: 100, color: { r: 220, g: 30, b: 30 } },
    ],
    quality: 80,
    description: 'Scene classifier test - track/circuit scene',
  },
  {
    filename: 'paddock.jpg',
    width: 800,
    height: 600,
    background: { r: 140, g: 160, b: 140 },
    overlays: [
      // Garage-like structures
      { left: 50, top: 100, width: 300, height: 350, color: { r: 180, g: 180, b: 180 } },
      { left: 450, top: 100, width: 300, height: 350, color: { r: 170, g: 170, b: 170 } },
    ],
    quality: 80,
    description: 'Scene classifier test - paddock/pit area',
  },
  {
    filename: 'podium.jpg',
    width: 800,
    height: 600,
    background: { r: 40, g: 60, b: 120 },
    overlays: [
      // Podium steps
      { left: 250, top: 350, width: 300, height: 250, color: { r: 200, g: 180, b: 50 } },
      // Figures on podium
      { left: 300, top: 150, width: 60, height: 200, color: { r: 220, g: 220, b: 220 } },
      { left: 370, top: 180, width: 60, height: 170, color: { r: 200, g: 200, b: 200 } },
      { left: 440, top: 200, width: 60, height: 150, color: { r: 180, g: 180, b: 180 } },
    ],
    quality: 80,
    description: 'Scene classifier test - podium/ceremony',
  },
  {
    filename: 'portrait.jpg',
    width: 600,
    height: 800,
    background: { r: 60, g: 100, b: 60 },
    overlays: [
      // Head
      { left: 225, top: 100, width: 150, height: 180, color: { r: 200, g: 170, b: 140 } },
      // Body
      { left: 175, top: 280, width: 250, height: 400, color: { r: 180, g: 40, b: 40 } },
    ],
    quality: 80,
    description: 'Portrait orientation test (600x800)',
  },
  {
    filename: 'race-numbers.jpg',
    width: 800,
    height: 600,
    background: { r: 70, g: 110, b: 70 },
    overlays: [
      // Vehicle with number plate area
      { left: 200, top: 200, width: 400, height: 200, color: { r: 180, g: 30, b: 30 } },
      // Number plate
      { left: 320, top: 250, width: 160, height: 80, color: { r: 240, g: 240, b: 240 } },
    ],
    quality: 80,
    description: 'Object detection test - visible race numbers',
  },
  {
    filename: 'multi-subjects.jpg',
    width: 800,
    height: 600,
    background: { r: 90, g: 130, b: 90 },
    overlays: [
      // Multiple subjects spread across image
      { left: 50, top: 150, width: 120, height: 300, color: { r: 200, g: 50, b: 50 } },
      { left: 230, top: 170, width: 110, height: 280, color: { r: 50, g: 50, b: 200 } },
      { left: 400, top: 140, width: 130, height: 310, color: { r: 200, g: 200, b: 50 } },
      { left: 590, top: 160, width: 115, height: 290, color: { r: 50, g: 200, b: 200 } },
    ],
    quality: 80,
    description: 'Segmentation test - multiple subjects',
  },
];

async function generateFixture(spec: FixtureSpec): Promise<void> {
  const outputPath = path.join(FIXTURES_DIR, spec.filename);

  // Start with background
  let image = sharp({
    create: {
      width: spec.width,
      height: spec.height,
      channels: 3,
      background: spec.background,
    },
  });

  // Add overlays as composite operations
  if (spec.overlays && spec.overlays.length > 0) {
    const composites = await Promise.all(
      spec.overlays.map(async (overlay) => {
        const buf = await sharp({
          create: {
            width: overlay.width,
            height: overlay.height,
            channels: 3,
            background: overlay.color,
          },
        })
          .png()
          .toBuffer();

        return {
          input: buf,
          left: overlay.left,
          top: overlay.top,
        };
      })
    );

    image = sharp(await image.png().toBuffer()).composite(composites);
  }

  // Add basic EXIF-like metadata via JPEG output
  await image
    .jpeg({ quality: spec.quality })
    .toFile(outputPath);

  const stats = fs.statSync(outputPath);
  const sizeKB = (stats.size / 1024).toFixed(1);
  console.log(`  ${spec.filename} (${spec.width}x${spec.height}, ${sizeKB}KB) - ${spec.description}`);
}

async function main() {
  console.log('Generating test fixture images...\n');

  // Ensure output directory exists
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  let generated = 0;
  let skipped = 0;

  for (const spec of FIXTURES) {
    const outputPath = path.join(FIXTURES_DIR, spec.filename);

    // Skip if already exists
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      const sizeKB = (stats.size / 1024).toFixed(1);
      console.log(`  ${spec.filename} already exists (${sizeKB}KB) - skipping`);
      skipped++;
      continue;
    }

    await generateFixture(spec);
    generated++;
  }

  console.log(`\nDone! Generated: ${generated}, Skipped: ${skipped}, Total: ${FIXTURES.length}`);
  console.log(`Fixture directory: ${FIXTURES_DIR}`);
}

main().catch((err) => {
  console.error('Failed to generate fixtures:', err);
  process.exit(1);
});
