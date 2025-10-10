# Racetagger V3: Bounding Box Detection

## Overview
Racetagger V3 adds support for **bounding box detection** in addition to the existing text recognition features.

**Good news**: You **do NOT need to update** the AI prompts in the `sport_categories` database table. The V3 Edge Function automatically adds the bounding box requirement to ALL prompts at runtime.

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
- Review V3 source code: `/supabase/functions/analyzeImageDesktopV3/index.ts`
- Test with sample images first
