#!/usr/bin/env node

/**
 * Performance Test Script for Log Visualizer
 * Generates a large mock execution log to test virtual scrolling and performance
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configuration
const TEST_EXECUTION_ID = 'perf-test-' + Date.now();
const NUM_IMAGES = 1500; // Large dataset for performance testing
const OUTPUT_DIR = path.join(require('os').homedir(), 'Library/Application Support/racetagger-desktop/.analysis-logs');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `exec_${TEST_EXECUTION_ID}.jsonl`);

// Sample participant data
const PARTICIPANTS = [
  { numero: '1', nome: 'PINZANO CORRADO, TURATI MAURO', squadra: 'NEW DRIVER\'S TEAM', categoria: 'R5' },
  { numero: '2', nome: 'TESTA GIUSEPPE, BIZZOCCHI MASSIMO', squadra: 'MRC SPORT', categoria: 'R5' },
  { numero: '3', nome: 'CRUGNOLA ANDREA, SASSI ANDREA', squadra: 'F.P.F. SPORT', categoria: 'R5' },
  { numero: '7', nome: 'MABELLINI ANDREA, LENZI VIRGINIA', squadra: 'MIRABELLA MILLE MIGLIA', categoria: 'R5' },
  { numero: '9', nome: 'LIBURDI STEFANO, VALERIO SILVAGGI', squadra: 'MOTOR VALLEY RACING', categoria: 'R5' },
  { numero: '12', nome: 'MAURI MAURIZIO, MAURI FEDERICA', squadra: 'BS SPORT', categoria: 'R4' },
  { numero: '15', nome: 'DALL\'ERA ALBERTO, BELTRAME LUCA', squadra: 'PARACING', categoria: 'R4' },
  { numero: '21', nome: 'LOCATELLI MASSIMILIANO, TIRABOSCHI STEFANO', squadra: 'MRC SPORT', categoria: 'R3' },
  { numero: '25', nome: 'COLPANI MATTIA, PASINI WALTER', squadra: 'MEDIAPROM RACING', categoria: 'R3' },
  { numero: '33', nome: 'FIORIO MARIA PAOLA, BICO GIULIA', squadra: 'HAWK RACING CLUB', categoria: 'R2' },
  { numero: '42', nome: 'ROSSI MARIO, BIANCHI LUIGI', squadra: 'SPEED RACING', categoria: 'R2' },
  { numero: '55', nome: 'FERRARI PAOLO, LAMBORGHINI ANNA', squadra: 'FAST TEAM', categoria: 'R1' },
  { numero: '77', nome: 'VERDI GIUSEPPE, AZZURRI MARCO', squadra: 'BLUE RACING', categoria: 'R1' },
  { numero: '88', nome: 'NERO CARLO, BIANCO SOFIA', squadra: 'CONTRAST MOTORS', categoria: 'R2' },
  { numero: '99', nome: 'VIOLA TERESA, GIALLO FRANCESCO', squadra: 'COLOR TEAM', categoria: 'R3' }
];

// Sample file extensions for realistic image names
const EXTENSIONS = ['.jpg', '.jpeg', '.JPG', '.JPEG', '.NEF', '.ARW', '.CR2', '.CR3'];

function getRandomParticipant() {
  return PARTICIPANTS[Math.floor(Math.random() * PARTICIPANTS.length)];
}

function getRandomFileName(index) {
  const ext = EXTENSIONS[Math.floor(Math.random() * EXTENSIONS.length)];
  const patterns = [
    `IMG_${String(index + 1000).padStart(4, '0')}${ext}`,
    `DSC_${String(index + 2000).padStart(4, '0')}${ext}`,
    `_MG_${String(index + 3000).padStart(4, '0')}${ext}`,
    `RALLY_${String(index + 100).padStart(3, '0')}${ext}`,
    `PIC${String(index + 1).padStart(5, '0')}${ext}`
  ];
  return patterns[Math.floor(Math.random() * patterns.length)];
}

function generateMockAnalysis(fileName, index) {
  const participant = getRandomParticipant();
  const hasSecondVehicle = Math.random() < 0.3; // 30% chance of second vehicle
  const hasCorrection = Math.random() < 0.15; // 15% chance of correction

  // Base AI response
  const vehicles = [{
    race_number: participant.numero,
    confidence: Math.floor(Math.random() * 20) + 80, // 80-99%
    detection_type: 'number_recognition'
  }];

  if (hasSecondVehicle) {
    const secondParticipant = getRandomParticipant();
    vehicles.push({
      race_number: secondParticipant.numero,
      confidence: Math.floor(Math.random() * 30) + 60, // 60-89%
      detection_type: 'number_recognition'
    });
  }

  const aiResponse = {
    vehicles,
    analysis_summary: `Detected ${vehicles.length} vehicle(s) in racing scene`,
    context: 'race_action',
    timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString() // Random time in last 24h
  };

  // Apply corrections if needed
  const finalResponse = JSON.parse(JSON.stringify(aiResponse));
  const corrections = [];

  if (hasCorrection && vehicles.length > 0) {
    const originalNumber = vehicles[0].race_number;
    const newParticipant = getRandomParticipant();
    finalResponse.vehicles[0].race_number = newParticipant.numero;

    corrections.push({
      type: 'number_correction',
      original_value: originalNumber,
      corrected_value: newParticipant.numero,
      explanation: `Temporal correction: found ${newParticipant.numero} in nearby images`,
      applied_by: 'temporal_clustering'
    });
  }

  // Participant matching
  const participantMatches = finalResponse.vehicles.map(vehicle => {
    const matchedParticipant = PARTICIPANTS.find(p => p.numero === vehicle.race_number) || getRandomParticipant();
    return {
      race_number: vehicle.race_number,
      nome: matchedParticipant.nome,
      squadra: matchedParticipant.squadra,
      categoria: matchedParticipant.categoria,
      match_type: 'exact',
      confidence: 100
    };
  });

  return {
    aiResponse,
    finalResponse,
    corrections,
    participantMatches,
    timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString()
  };
}

function generateLogFile() {
  console.log(`Generating performance test log with ${NUM_IMAGES} images...`);
  console.log(`Output: ${OUTPUT_FILE}`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const logLines = [];

  // Execution start
  logLines.push(JSON.stringify({
    event_type: 'EXECUTION_START',
    execution_id: TEST_EXECUTION_ID,
    timestamp: new Date().toISOString(),
    total_images: NUM_IMAGES,
    category: 'Rally',
    participant_preset: 'Rally 1000 Miglia 2025 (Performance Test)',
    settings: {
      resize_preset: 'BILANCIATO',
      optimization_level: 'BALANCED',
      metadata_options: {
        write_to_file: true,
        create_sidecar: false,
        overwrite_existing: true
      }
    }
  }));

  // Generate image analysis events
  console.log('Generating image analysis events...');
  const startTime = Date.now();

  for (let i = 0; i < NUM_IMAGES; i++) {
    if (i % 100 === 0) {
      console.log(`Progress: ${i}/${NUM_IMAGES} (${Math.round(i/NUM_IMAGES*100)}%)`);
    }

    const fileName = getRandomFileName(i);
    const analysis = generateMockAnalysis(fileName, i);

    // Image analysis event
    const imageEvent = {
      event_type: 'IMAGE_ANALYSIS',
      execution_id: TEST_EXECUTION_ID,
      timestamp: analysis.timestamp,
      file_name: fileName,
      ai_response: analysis.aiResponse,
      final_response: analysis.finalResponse,
      corrections: analysis.corrections,
      participant_matches: analysis.participantMatches,
      processing_time_ms: Math.floor(Math.random() * 2000) + 500, // 500-2500ms
      analysis_tokens: Math.floor(Math.random() * 100) + 50 // 50-150 tokens
    };

    logLines.push(JSON.stringify(imageEvent));

    // Add correction events if any
    if (analysis.corrections.length > 0) {
      analysis.corrections.forEach(correction => {
        logLines.push(JSON.stringify({
          event_type: 'CORRECTION',
          execution_id: TEST_EXECUTION_ID,
          timestamp: new Date(Date.parse(analysis.timestamp) + 100).toISOString(),
          file_name: fileName,
          correction_type: correction.type,
          original_value: correction.original_value,
          corrected_value: correction.corrected_value,
          explanation: correction.explanation,
          applied_by: correction.applied_by
        }));
      });
    }
  }

  // Execution complete
  const endTimestamp = new Date().toISOString();
  const totalTokens = NUM_IMAGES * 75; // Average tokens per image
  const totalTime = Date.now() - startTime;

  logLines.push(JSON.stringify({
    event_type: 'EXECUTION_COMPLETE',
    execution_id: TEST_EXECUTION_ID,
    timestamp: endTimestamp,
    statistics: {
      total_images: NUM_IMAGES,
      successfully_processed: NUM_IMAGES - Math.floor(Math.random() * 5), // Some may fail
      with_detections: Math.floor(NUM_IMAGES * 0.85), // 85% detection rate
      with_participant_matches: Math.floor(NUM_IMAGES * 0.78), // 78% match rate
      total_corrections_applied: Math.floor(NUM_IMAGES * 0.15), // 15% correction rate
      total_tokens_used: totalTokens,
      processing_time_seconds: Math.floor(totalTime / 1000)
    }
  }));

  // Write to file
  console.log('Writing log file...');
  fs.writeFileSync(OUTPUT_FILE, logLines.join('\n'));

  console.log(`✅ Performance test log generated successfully!`);
  console.log(`📊 Statistics:`);
  console.log(`   - Images: ${NUM_IMAGES}`);
  console.log(`   - Log entries: ${logLines.length}`);
  console.log(`   - File size: ${Math.round(fs.statSync(OUTPUT_FILE).size / 1024)}KB`);
  console.log(`   - Execution ID: ${TEST_EXECUTION_ID}`);
  console.log(`\n🧪 To test the log visualizer:`);
  console.log(`   1. Run "npm run dev" if not already running`);
  console.log(`   2. In the app console, run:`);
  console.log(`      window.logVisualizer.init('${TEST_EXECUTION_ID}', [])`);
  console.log(`      window.logVisualizer.render('#final-stats-container')`);

  return TEST_EXECUTION_ID;
}

// Generate UUID package if missing
try {
  require('uuid');
} catch (e) {
  console.error('Error: uuid package not found. Please install it first:');
  console.error('npm install uuid');
  process.exit(1);
}

// Run the generator
if (require.main === module) {
  generateLogFile();
}

module.exports = { generateLogFile, TEST_EXECUTION_ID };