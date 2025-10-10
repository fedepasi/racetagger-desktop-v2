// Edge Function: export-training-labels
// Exports training labels from JSONL analysis logs in various formats
// Supports: COCO JSON, YOLO TXT, CSV
// With includeImages=true, creates ZIP with images + labels for training

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @deno-types="npm:@types/jszip@^3.4.1"
import JSZip from 'npm:jszip@^3.10.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface VehicleAnalysisData {
  vehicleIndex: number;
  raceNumber?: string;
  drivers?: string[];
  team?: string;
  sponsors?: string[];
  confidence: number;
  boundingBox?: {
    x: number;      // Percentage 0-100
    y: number;      // Percentage 0-100
    width: number;  // Percentage 0-100
    height: number; // Percentage 0-100
  };
  corrections: any[];
  participantMatch?: any;
  finalResult: {
    raceNumber?: string;
    team?: string;
    drivers?: string[];
    matchedBy: string;
  };
}

interface ImageAnalysisEvent {
  type: 'IMAGE_ANALYSIS';
  timestamp: string;
  executionId: string;
  imageId: string;
  fileName: string;
  originalFileName?: string;
  originalPath?: string;
  aiResponse: {
    rawText: string;
    totalVehicles: number;
    vehicles: VehicleAnalysisData[];
  };
  temporalContext?: any;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get authenticated user
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'User not authenticated' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401
        }
      )
    }

    // Parse request
    const body = await req.json()
    const { executionId, format = 'coco', minConfidence = 0.0, includeImages = false } = body

    if (!executionId) {
      return new Response(
        JSON.stringify({ success: false, error: 'executionId is required' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      )
    }

    if (!['coco', 'yolo', 'csv'].includes(format)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid format. Supported: coco, yolo, csv' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      )
    }

    console.log(`[export-training-labels] Exporting labels for execution ${executionId} in ${format} format`)

    // Get metadata to find storage path
    const { data: metadata, error: metadataError } = await supabaseClient
      .from('analysis_log_metadata')
      .select('*')
      .eq('execution_id', executionId)
      .eq('user_id', user.id)
      .single()

    if (metadataError || !metadata) {
      return new Response(
        JSON.stringify({ success: false, error: 'Execution log not found' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404
        }
      )
    }

    // Download JSONL file from storage
    const { data: fileData, error: downloadError } = await supabaseClient.storage
      .from('analysis-logs')
      .download(metadata.storage_path)

    if (downloadError || !fileData) {
      console.error('[export-training-labels] Download error:', downloadError)
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to download log file' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500
        }
      )
    }

    // Parse JSONL
    const text = await fileData.text()
    const lines = text.trim().split('\n').filter(line => line.trim())

    const imageAnalysisEvents: ImageAnalysisEvent[] = []
    for (const line of lines) {
      try {
        const event = JSON.parse(line)
        if (event.type === 'IMAGE_ANALYSIS') {
          imageAnalysisEvents.push(event)
        }
      } catch (err) {
        console.warn('[export-training-labels] Failed to parse line:', err)
      }
    }

    console.log(`[export-training-labels] Found ${imageAnalysisEvents.length} image analysis events`)

    // Extract annotations with bounding boxes
    const annotations: any[] = []
    let imageIdCounter = 1
    const imageMap = new Map<string, number>()

    for (const event of imageAnalysisEvents) {
      const fileName = event.fileName || event.originalFileName || 'unknown'

      if (!imageMap.has(fileName)) {
        imageMap.set(fileName, imageIdCounter++)
      }
      const imageId = imageMap.get(fileName)!

      if (event.aiResponse?.vehicles) {
        for (const vehicle of event.aiResponse.vehicles) {
          // Filter by confidence
          if (vehicle.confidence < minConfidence) {
            continue
          }

          // Skip vehicles without bounding boxes
          if (!vehicle.boundingBox) {
            continue
          }

          annotations.push({
            imageId,
            fileName,
            vehicle,
            timestamp: event.timestamp
          })
        }
      }
    }

    console.log(`[export-training-labels] Extracted ${annotations.length} annotations with bounding boxes (minConfidence: ${minConfidence})`)

    if (annotations.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No annotations with bounding boxes found in this execution',
          hint: 'Make sure you enabled Advanced Annotations (V3) in settings'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404
        }
      )
    }

    // Generate export based on format
    let exportData: any
    let contentType: string
    let fileName: string

    if (format === 'coco') {
      // COCO JSON format
      const images = Array.from(imageMap.entries()).map(([name, id]) => ({
        id,
        file_name: name,
        width: 1920, // Default, adjust if you have actual dimensions
        height: 1080
      }))

      const cocoAnnotations = annotations.map((ann, idx) => {
        const bbox = ann.vehicle.boundingBox
        // Convert from percentage to pixels (assuming 1920x1080)
        const x = (bbox.x / 100) * 1920
        const y = (bbox.y / 100) * 1080
        const width = (bbox.width / 100) * 1920
        const height = (bbox.height / 100) * 1080

        return {
          id: idx + 1,
          image_id: ann.imageId,
          category_id: 1, // Single category: "vehicle"
          bbox: [x, y, width, height],
          area: width * height,
          iscrowd: 0,
          attributes: {
            race_number: ann.vehicle.raceNumber,
            team: ann.vehicle.team,
            drivers: ann.vehicle.drivers,
            confidence: ann.vehicle.confidence
          }
        }
      })

      exportData = {
        info: {
          description: `RaceTagger V3 Training Data - Execution ${executionId}`,
          version: '1.0',
          year: new Date().getFullYear(),
          contributor: 'RaceTagger',
          date_created: new Date().toISOString()
        },
        licenses: [],
        images,
        annotations: cocoAnnotations,
        categories: [
          { id: 1, name: 'vehicle', supercategory: 'object' }
        ]
      }

      contentType = 'application/json'
      fileName = `training_labels_${executionId}_coco.json`

    } else if (format === 'yolo') {
      // YOLO TXT format (one file per image)
      // Return as JSON with file contents
      const yoloFiles: Record<string, string> = {}

      for (const [imageName, imageId] of imageMap.entries()) {
        const imageAnnotations = annotations.filter(ann => ann.imageId === imageId)

        const lines = imageAnnotations.map(ann => {
          const bbox = ann.vehicle.boundingBox
          // YOLO format: <class> <x_center> <y_center> <width> <height> (all normalized 0-1)
          const x_center = (bbox.x + bbox.width / 2) / 100
          const y_center = (bbox.y + bbox.height / 2) / 100
          const w = bbox.width / 100
          const h = bbox.height / 100

          return `0 ${x_center.toFixed(6)} ${y_center.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`
        })

        // Use image name without extension for txt file
        const txtFileName = imageName.replace(/\.[^/.]+$/, '') + '.txt'
        yoloFiles[txtFileName] = lines.join('\n')
      }

      // Also include classes.txt
      yoloFiles['classes.txt'] = 'vehicle'

      exportData = {
        format: 'yolo',
        files: yoloFiles,
        info: `YOLO format labels for execution ${executionId}. Contains ${Object.keys(yoloFiles).length - 1} label files.`
      }

      contentType = 'application/json'
      fileName = `training_labels_${executionId}_yolo.json`

    } else if (format === 'csv') {
      // CSV format
      const csvRows = [
        ['image_file', 'vehicle_index', 'race_number', 'team', 'drivers', 'bbox_x_pct', 'bbox_y_pct', 'bbox_width_pct', 'bbox_height_pct', 'confidence', 'timestamp']
      ]

      for (const ann of annotations) {
        const bbox = ann.vehicle.boundingBox
        csvRows.push([
          ann.fileName,
          ann.vehicle.vehicleIndex.toString(),
          ann.vehicle.raceNumber || '',
          ann.vehicle.team || '',
          (ann.vehicle.drivers || []).join('; '),
          bbox.x.toFixed(2),
          bbox.y.toFixed(2),
          bbox.width.toFixed(2),
          bbox.height.toFixed(2),
          ann.vehicle.confidence.toFixed(3),
          ann.timestamp
        ])
      }

      const csvContent = csvRows.map(row =>
        row.map(cell => {
          // Escape quotes and wrap in quotes if contains comma
          const escaped = cell.replace(/"/g, '""')
          return escaped.includes(',') || escaped.includes('\n') ? `"${escaped}"` : escaped
        }).join(',')
      ).join('\n')

      exportData = csvContent
      contentType = 'text/csv'
      fileName = `training_labels_${executionId}.csv`
    }

    console.log(`[export-training-labels] Generated ${format} export with ${annotations.length} annotations`)

    // If includeImages=true, create ZIP with images + labels
    if (includeImages) {
      console.log(`[export-training-labels] Creating ZIP with images...`)

      const zip = new JSZip()

      // Helper function to find original image in storage
      async function findOriginalImage(fileName: string): Promise<Blob | null> {
        const possiblePaths = [
          `${user.id}/${executionId}/images/original/${fileName}`,
          `${user.id}/${executionId}/images/compressed/${fileName}`,
          `${user.id}/${fileName}`, // Legacy flat structure
        ]

        for (const path of possiblePaths) {
          try {
            const { data, error } = await supabaseClient.storage
              .from('images')
              .download(path)

            if (!error && data) {
              console.log(`[export-training-labels] Found image at: ${path}`)
              return data
            }
          } catch (err) {
            // Continue to next path
          }
        }

        console.warn(`[export-training-labels] Image not found: ${fileName}`)
        return null
      }

      // Create images folder and add all images
      const imagesFolder = zip.folder('images')
      const labelsFolder = zip.folder('labels')

      let successCount = 0
      let failCount = 0

      for (const [imageName] of imageMap.entries()) {
        const imageBlob = await findOriginalImage(imageName)
        if (imageBlob) {
          const arrayBuffer = await imageBlob.arrayBuffer()
          imagesFolder!.file(imageName, arrayBuffer)
          successCount++
        } else {
          failCount++
        }
      }

      console.log(`[export-training-labels] Added ${successCount} images, ${failCount} not found`)

      // Add label files
      if (format === 'yolo') {
        // Add YOLO txt files
        const yoloFiles = (exportData as any).files
        for (const [txtFileName, content] of Object.entries(yoloFiles)) {
          labelsFolder!.file(txtFileName, content as string)
        }

        // Add dataset.yaml
        const yamlContent = `
# RaceTagger V3 Training Dataset
# Execution: ${executionId}
# Generated: ${new Date().toISOString()}

path: .  # dataset root dir
train: images  # train images (relative to 'path')
val: images    # val images (relative to 'path')

# Classes
names:
  0: vehicle
`.trim()
        zip.file('dataset.yaml', yamlContent)

      } else if (format === 'coco') {
        // Add COCO JSON annotations
        labelsFolder!.file('annotations.json', JSON.stringify(exportData, null, 2))
      }

      // Add README
      const readmeContent = `
# RaceTagger V3 Training Dataset

**Execution ID:** ${executionId}
**Format:** ${format.toUpperCase()}
**Generated:** ${new Date().toISOString()}
**Total Images:** ${successCount} / ${imageMap.size}
**Total Annotations:** ${annotations.length}

## Structure

- \`images/\` - Original training images
- \`labels/\` - Annotation files (${format.toUpperCase()} format)
${format === 'yolo' ? '- `dataset.yaml` - YOLO dataset configuration' : ''}
${format === 'coco' ? '- `labels/annotations.json` - COCO format annotations' : ''}

## Usage

${format === 'yolo' ? `
### YOLO Training

\`\`\`bash
# Using YOLOv8
yolo train data=dataset.yaml model=yolov8n.pt epochs=100
\`\`\`
` : ''}

${format === 'coco' ? `
### COCO Format

Compatible with Detectron2, MMDetection, and other COCO-based frameworks.
` : ''}

---
Generated with RaceTagger V3
`.trim()
      zip.file('README.md', readmeContent)

      // Generate ZIP
      const zipBlob = await zip.generateAsync({ type: 'uint8array' })

      return new Response(zipBlob, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="training_dataset_${executionId}_${format}.zip"`
        },
        status: 200
      })
    }

    // Return labels only (original behavior)
    return new Response(
      typeof exportData === 'string' ? exportData : JSON.stringify(exportData, null, 2),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${fileName}"`
        },
        status: 200
      }
    )

  } catch (error) {
    console.error('[export-training-labels] Unexpected error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
