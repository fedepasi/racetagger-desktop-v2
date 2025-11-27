# Racetagger: Bounding Box Detection & Recognition Systems

## Overview
Racetagger supporta **bounding box detection** e multiple sistemi di riconoscimento per l'analisi delle immagini sportive.

**Versioni Edge Function disponibili:**
- **V2**: Riconoscimento base (senza bounding box)
- **V3**: Riconoscimento con bounding box auto-generati (Gemini)
- **V4**: Dual recognition con RF-DETR + Gemini fallback
- **V5**: Versione più recente con ottimizzazioni

**Routing automatico**: Il sistema sceglie automaticamente la versione in base a:
- `sport_categories.recognition_method` (gemini o rf-detr)
- `sport_categories.edge_function_version` (2, 3, 4, 5)

---

## V4: RF-DETR Recognition (Produzione)

### Cos'è RF-DETR
RF-DETR (Roboflow Detection Transformer) è un sistema di object detection specializzato che usa modelli custom trainati per riconoscere numeri di gara specifici.

### Come Funziona

1. **Routing basato su categoria**: Se `sport_categories.recognition_method = 'rf-detr'`:
   - Usa il workflow Roboflow configurato in `rf_detr_workflow_url`
   - Parsing labels format: `"MODEL_NUMBER"` (es. `"SF-25_16"` → numero 16)

2. **Fallback automatico**: Se RF-DETR fallisce:
   - Sistema passa automaticamente a Gemini V3
   - Log errore per debugging

3. **Cost tracking separato**:
   - RF-DETR: ~$0.0045/image
   - Tracciato in `execution_settings.rf_detr_detections_count` e `rf_detr_total_cost`

### Configurazione RF-DETR

```sql
-- Configura categoria per usare RF-DETR
UPDATE sport_categories
SET
  recognition_method = 'rf-detr',
  rf_detr_workflow_url = 'https://detect.roboflow.com/...',
  edge_function_version = 4
WHERE category = 'f1';
```

### Label Format Requirements
I modelli RF-DETR devono restituire labels nel formato:
```
"MODEL_NUMBER" o "TEAM_NUMBER"

Esempi validi:
- "SF-25_16" → Race number: 16
- "MCL39_4"  → Race number: 4
- "Ducati_93" → Race number: 93
```

---

## V3: Bounding Box con Gemini (Legacy)

## How It Works

### Automatic Prompt Enhancement
The V3 function includes a `enhancePromptWithBoundingBox()` function that:
1. Checks if the prompt already includes `boundingBox` field
2. If not present, automatically adds the requirement before the "Respond ONLY with" section
3. Updates example objects to include bbox format
4. Logs the enhancement for debugging

```typescript
// Example: Original database prompt
"Analyze image for race vehicles. Extract: raceNumber, drivers, teamName..."

// Automatically becomes:
"Analyze image for race vehicles. Extract: raceNumber, drivers, teamName, boundingBox..."
```

### What Changed in V3
The V3 Edge Function (`analyzeImageDesktopV3`) now requests Gemini to return bounding boxes for each detected participant/vehicle:

```json
{
  "raceNumber": "51",
  "drivers": ["A. Pier Guidi"],
  "category": "Hypercar",
  "teamName": "Ferrari AF Corse",
  "otherText": ["Shell"],
  "confidence": 0.95,
  "boundingBox": {
    "x": 25.5,
    "y": 30.0,
    "width": 45.0,
    "height": 60.0
  }
}
```

**Bounding Box Format:**
- `x`: Distance from left edge (percentage 0-100)
- `y`: Distance from top edge (percentage 0-100)
- `width`: Box width (percentage 0-100)
- `height`: Box height (percentage 0-100)

## Backward Compatibility

### V2 vs V3
- **V2 Edge Function** (`analyzeImageDesktopV2`): No bbox, works as before
- **V3 Edge Function** (`analyzeImageDesktopV3`): Always includes bbox

### Database Prompts
- Existing prompts in `sport_categories` continue to work without changes
- V3 automatically enhances them with bbox requirement at runtime
- If you manually add `boundingBox` to a database prompt, V3 will detect it and skip auto-enhancement

## Implementation Details

### Code Location
File: `/supabase/functions/analyzeImageDesktopV3/index.ts`

**Key Functions:**
1. **Lines 310-347**: `enhancePromptWithBoundingBox()` - Auto-adds bbox requirement
2. **Line 358**: Applies enhancement to all prompts before sending to Gemini
3. **Lines 142-202**: Hardcoded fallback prompts already include bbox

### Enhancement Logic
```typescript
function enhancePromptWithBoundingBox(basePrompt: string): string {
  // Skip if already has boundingBox
  if (basePrompt.includes('boundingBox')) {
    return basePrompt;
  }

  // Insert bbox requirement before "Respond ONLY with" section
  const respondIndex = basePrompt.indexOf('Respond ONLY with');
  if (respondIndex > -1) {
    return basePrompt.substring(0, respondIndex) +
      `- boundingBox: A tight bounding box around the subject...\n\n` +
      basePrompt.substring(respondIndex);
  }

  // Or append to end if no "Respond ONLY" section found
  return basePrompt + `\n\n- boundingBox: ...`;
}
```

## Testing V3

### 1. Deploy V3 Function
```bash
cd /path/to/racetagger-clean
supabase functions deploy analyzeImageDesktopV3
```

### 2. Test with Sample Image
```bash
curl -X POST https://your-project.supabase.co/functions/v1/analyzeImageDesktopV3 \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "imagePath": "user123/test-car.jpg",
    "originalFilename": "test-car.jpg",
    "mimeType": "image/jpeg",
    "sizeBytes": 500000,
    "userEmail": "test@example.com",
    "category": "motorsport",
    "modelName": "gemini-2.5-flash"
  }'
```

### 3. Verify Response
Expected response should include `boundingBox` for each detection:
```json
{
  "success": true,
  "detections": [
    {
      "raceNumber": "51",
      "boundingBox": {
        "x": 25.5,
        "y": 30.0,
        "width": 45.0,
        "height": 60.0
      },
      ...
    }
  ]
}
```

### 4. Check Logs
In Supabase Edge Function logs, look for:
```
[V3] Auto-enhancing prompt with boundingBox requirement
```
or
```
[V3] Prompt already includes boundingBox field, skipping auto-enhancement
```

## Next Steps

### Phase 2: Database Schema
Create `image_annotations` table to store detection results:
```sql
CREATE TABLE image_annotations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  image_path TEXT NOT NULL,
  annotations JSONB NOT NULL, -- Array of detections with bbox
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Phase 3: Desktop App Integration
Update `unified-image-processor.ts` to:
1. Add settings toggle: "Enable bounding box detection"
2. Call V3 instead of V2 when enabled
3. Save bbox data to local + cloud database

### Phase 4: Web Annotation Interface
Build React app to:
1. Display images with bbox overlays
2. Allow editing/correcting bboxes
3. Export to COCO JSON / YOLO TXT formats

## FAQ

**Q: Do I need to update existing database prompts?**
A: No! V3 automatically adds bbox requirement to all prompts.

**Q: What if I manually add boundingBox to a database prompt?**
A: V3 will detect it and skip auto-enhancement. Either approach works.

**Q: Can I use V2 and V3 simultaneously?**
A: Yes! V2 continues to work for non-bbox workflows. Choose per-request.

**Q: What happens if Gemini doesn't return bbox?**
A: The detection will still be saved, just without bbox field. V3 validates and handles missing data gracefully.

**Q: How accurate are the bounding boxes?**
A: Gemini 2.5 Flash provides good bbox accuracy. Results improve with:
- High resolution images
- Clear, unobstructed subjects
- Good lighting and focus

## Support
For issues or questions:
- Check Edge Function logs in Supabase Dashboard
- Review source code: `/supabase/functions/analyzeImageDesktopV*/index.ts`
- Test with sample images first

---

## Routing Logic nel Desktop App

Il file `src/unified-image-processor.ts` gestisce il routing:

```typescript
// Lines ~1720-1740
if (recognitionMethod === 'rf-detr') {
  functionName = 'analyzeImageDesktopV4';
} else if (edgeFunctionVersion === 3) {
  functionName = 'analyzeImageDesktopV3';
} else if (edgeFunctionVersion === 2) {
  functionName = 'analyzeImageDesktopV2';
} else {
  // Default based on category settings
  functionName = hasBboxSupport
    ? 'analyzeImageDesktopV3'
    : 'analyzeImageDesktopV2';
}
```

---

*Ultimo aggiornamento: v1.0.11 - Novembre 2025*
