-- Create Endurance-WEC sport category optimized for Edge Function V3
-- WITHOUT plate number detection (detectPlateNumber: false)
--
-- This category is specifically optimized for:
-- - WEC (World Endurance Championship)
-- - Multi-class endurance racing (GT3, Hypercar, LMP2)
-- - Complex sponsor-based matching
-- - Lower win margin thresholds for close matches

INSERT INTO sport_categories (
  code,
  name,
  description,
  icon,
  is_active,
  display_order,
  edge_function_version,
  individual_competition,
  ai_prompt,
  fallback_prompt,
  expected_fields,
  temporal_config,
  matching_config,
  recognition_config,
  created_at,
  updated_at
) VALUES (
  'endurance-wec',
  'Endurance WEC',
  'World Endurance Championship - Multi-class endurance racing with optimized matching for GT3, Hypercar, and LMP2',
  '🏁',
  true,
  10,
  3,  -- Edge Function V3 for improved bounding boxes
  false,  -- Multi-class racing (not individual competition)

  -- AI Prompt optimized for WEC endurance racing
  'Analyze the provided image for all identifiable endurance racing vehicles (GT3, Hypercar, LMP2, etc.). For each vehicle detected, extract the following information if clearly visible:
- raceNumber: The primary race number (string, or null if not found/readable). WEC numbers are typically 1-3 digits.
- drivers: An array of driver names (strings, empty array if none found). Endurance races have multiple drivers - include all visible names.
- category: The race category if visible (string, or null). Common categories: "Hypercar", "LMP2", "LMGTE Pro", "LMGTE Am", "GT3".
- teamName: The team name if visible (string, or null). Examples: "IRON LYNX", "WRT", "PORSCHE PENSKE MOTORSPORT", "FERRARI AF CORSE".
- otherText: An array of other relevant short texts found on the vehicle (e.g., main sponsors, max 5 items). Common WEC sponsors: GOODYEAR, MOTUL, MICHELIN, TOTAL, MOBIL 1, SHELL, ROLEX.
- confidence: An estimated confidence score (number 0.00-1.00) for the identified raceNumber.
- box_2d: A tight bounding box around the vehicle in format [y1, x1, y2, x2] with coordinates normalized from 0 to 1000. Coordinates represent [top, left, bottom, right]. Provide tight boxes around visible parts only, excluding background.

Respond ONLY with a valid JSON array where each object represents one detected vehicle and contains the fields above. If no vehicles or data are found, return an empty array []. Do not include explanations or markdown formatting in the response. List vehicles generally from foreground to background or left to right if possible.

Example object: {"raceNumber": "92", "drivers": ["K. Estre", "M. Christensen"], "category": "LMGTE Pro", "teamName": "PORSCHE GT TEAM", "otherText": ["MOBIL 1", "MICHELIN", "TAG HEUER"], "confidence": 0.95, "box_2d": [250, 180, 720, 580]}',

  -- Fallback prompt (NULL = use same as primary)
  NULL,

  -- Expected fields for participant CSV
  '{"fields": ["numero", "nome", "categoria", "squadra", "sponsor"]}'::jsonb,

  -- Temporal config - optimized for endurance racing
  -- Longer cluster window due to slower lap times and pit stops
  -- Higher proximity bonus because same cars appear multiple times
  '{
    "clusterWindow": 5000,
    "burstThreshold": 150,
    "proximityBonus": 40
  }'::jsonb,

  -- Matching config - optimized for WEC multi-class racing
  -- Key differences from standard motorsport:
  -- - Higher sponsor weight (60 vs 40) - WEC liveries are very distinctive
  -- - Higher team weight (80 vs 60) - Teams are crucial in endurance
  -- - Lower clearWinner threshold (15 vs 30) - Accept closer matches
  -- - Higher lowOcrConfidence (0.7 vs 0.6) - More rigorous on OCR quality
  -- - Lower multiEvidenceBonus (0.15 vs 0.20) - Less generous with weak evidence
  '{
    "weights": {
      "raceNumber": 100,
      "driverName": 70,
      "sponsor": 60,
      "team": 80
    },
    "thresholds": {
      "minimumScore": 80,
      "clearWinner": 15,
      "nameSimilarity": 0.75,
      "lowOcrConfidence": 0.7,
      "strongNonNumberEvidence": 90
    },
    "multiEvidenceBonus": 0.15
  }'::jsonb,

  -- Recognition config - V3 features for improved accuracy
  -- detectPlateNumber: false - Not needed for endurance racing
  -- boundingBoxFormat: gemini_native - Use [y1,x1,y2,x2] 0-1000 format
  -- maxResults: 3 - Multi-class racing can have multiple cars per frame
  '{
    "maxResults": 3,
    "minConfidence": 0.7,
    "confidenceDecayFactor": 0.9,
    "relativeConfidenceGap": 0.3,
    "focusMode": "foreground",
    "ignoreBackground": true,
    "prioritizeForeground": true,
    "detectPlateNumber": false,
    "boundingBoxFormat": "gemini_native"
  }'::jsonb,

  NOW(),
  NOW()
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  edge_function_version = EXCLUDED.edge_function_version,
  individual_competition = EXCLUDED.individual_competition,
  ai_prompt = EXCLUDED.ai_prompt,
  temporal_config = EXCLUDED.temporal_config,
  matching_config = EXCLUDED.matching_config,
  recognition_config = EXCLUDED.recognition_config,
  updated_at = NOW();

-- Add helpful comment documenting the category
COMMENT ON TABLE sport_categories IS 'Sport categories configuration. Added endurance-wec category (V3) with optimized thresholds for multi-class WEC racing including lower clearWinner threshold (15) and increased sponsor/team weights.';
