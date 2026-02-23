-- =====================================================
-- FIX: Running & Cycling prompts - V3 compatibility
-- =====================================================
--
-- HOTFIX for migration 20260217000000_update_running_cycling_prompts.sql
-- which broke running detection (0/160 bib numbers read).
--
-- ROOT CAUSE:
-- The V6 pipeline (analyzeImageDesktopV6) appends JSON format via
-- prompt-builder.ts buildResponseFormat(), but running/cycling categories
-- do NOT use V6. They use the V3 pipeline (analyzeImageDesktopV3) via
-- the standard analyzeImage() path because:
--   1. crop_config is NULL → shouldUseCropContext() returns false
--   2. edge_function_version is NULL → defaults to V3
--
-- V3 uses ai_prompt DIRECTLY as the Gemini prompt. It sets
-- responseMimeType:"application/json" to force JSON output, but the
-- prompt MUST specify the exact JSON structure. The broken prompt said
-- "nel formato richiesto" without ever showing the format.
--
-- FIX: Include JSON format specification directly in ai_prompt,
-- compatible with BOTH V3 (flat array) and V6 (crops wrapper).
-- V3 expects: [{raceNumber, confidence, drivers, teamName, otherText, ...}]
-- V6's buildResponseFormat() will override with {"crops": [...]} format.
--
-- ALSO: The previous prompt used {"crops": []} which is V6-only format.
-- V3 expects a flat JSON array, not a wrapper object.
-- =====================================================

-- =====================================================
-- RUNNING CATEGORY - V3-compatible ai_prompt
-- =====================================================
UPDATE sport_categories
SET ai_prompt = 'Analyze this running/athletics race photo. Identify ALL visible runners/athletes.

BIB NUMBER RULES:
- Bib numbers range from 1 to 99999 (1-5 digits). Read EVERY digit carefully.
- Positions: chest, hip, back. May be folded, crumpled, or partially hidden by arms/other runners.
- If partially visible: extract readable digits, use lower confidence.
- Do NOT truncate, do NOT add digits, do NOT invent numbers.

VISUAL IDENTIFIERS (include in otherText):
- Jersey/shirt primary and secondary colors
- Shorts color
- Shoe brand and color (Nike, Adidas, ASICS, Hoka, New Balance, Saucony, Brooks, On)
- Cap/visor/headband if present
- Bib background color (white, yellow, blue, etc.)
- Event name printed on bib
- Visible sponsors on jersey

PRIORITY: 1) Bib number (digit by digit) 2) Jersey+shorts colors 3) Shoe brand/color 4) Team/club 5) Sponsors

For each athlete, respond with a JSON object containing:
- raceNumber: bib number as string (e.g. "1234", "56"), or null if unreadable
- confidence: identification confidence (number from 0.0 to 1.0)
- drivers: array with athlete name if visible, otherwise empty array []
- teamName: visible team/club name on jersey (string or null)
- otherText: array with relevant text (sponsors, colors, shoe brand, event name)

Respond ONLY with a valid JSON array. Example:
[{"raceNumber": "456", "confidence": 0.90, "drivers": [], "teamName": "ASD Runners", "otherText": ["red Nike shoes", "blue jersey", "yellow bib"]}, {"raceNumber": null, "confidence": 0.0, "drivers": [], "teamName": null, "otherText": ["red jersey", "white Hoka shoes"]}]

If no athletes found, respond with []. Do NOT invent data. Visible data only.',

fallback_prompt = 'Analyze this running race image. For each visible runner, extract:
- raceNumber: bib number (string or null). 1 to 5 digits.
- confidence: confidence score (0.0-1.0)
- drivers: names (array, empty if none)
- teamName: team/club (string or null)
- otherText: other visible text (array)

Respond with a valid JSON array. Example:
[{"raceNumber": "456", "confidence": 0.85, "drivers": [], "teamName": null, "otherText": ["Event Name"]}]'

WHERE code = 'running';


-- =====================================================
-- CYCLING CATEGORY - V3-compatible ai_prompt
-- =====================================================
UPDATE sport_categories
SET ai_prompt = 'Analyze this cycling race photo. Identify ALL visible cyclists.

RACE NUMBER RULES:
- Numbers range from 1 to 999. Locations: back number on jersey, hip, frame tube, helmet, seatpost.
- Same rider has the same number across all positions.
- If partially visible: extract readable digits, use lower confidence.
- Do NOT invent numbers or brands.

VISUAL IDENTIFIERS (include in otherText):
- Team kit: jersey colors (primary, secondary, tertiary) + pattern (solid, horizontal bands, vertical panels, gradient)
- Shorts/bib shorts color
- Bike brand (Pinarello, Trek, Specialized, Colnago, Bianchi, Cannondale, Cervelo, Giant, BMC, Canyon, Scott, Wilier, De Rosa, Factor)
- Bike model if identifiable (Dogma F, Madone, Tarmac SL8, etc.)
- Helmet brand (Kask, Giro, POC, Specialized, Lazer, Abus, MET, Rudy Project)
- Helmet color
- Sunglasses brand (Oakley, 100%, POC, Scicon, Rudy Project)
- Wheel type: standard, deep section, disc, tri-spoke
- National champion bands or rainbow world champion stripes

PRIORITY: 1) Race number (back number, frame, helmet) 2) Team name on jersey 3) Full kit colors 4) Bike brand 5) Sponsors and helmet

For each cyclist, respond with a JSON object containing:
- raceNumber: race number as string (e.g. "147", "1"), or null if unreadable
- confidence: identification confidence (number from 0.0 to 1.0)
- drivers: array with rider name if visible, otherwise empty array []
- teamName: visible team name on jersey (string or null)
- otherText: array with relevant text (sponsors, bike brand, kit colors, helmet brand)

Respond ONLY with a valid JSON array. Example:
[{"raceNumber": "88", "confidence": 0.92, "drivers": [], "teamName": "UAE Team Emirates", "otherText": ["Colnago Dogma F", "white Kask helmet", "white jersey black bands"]}, {"raceNumber": null, "confidence": 0.0, "drivers": [], "teamName": "Jumbo-Visma", "otherText": ["Cervelo", "yellow black jersey"]}]

If no cyclists found, respond with []. Do NOT invent data. Visible data only.',

fallback_prompt = 'Analyze this cycling race image. For each visible cyclist, extract:
- raceNumber: race number (string or null). Check back number, frame, helmet.
- confidence: confidence score (0.0-1.0)
- drivers: names (array, empty if none)
- teamName: team name (string or null)
- otherText: other visible text (array)

Respond with a valid JSON array. Example:
[{"raceNumber": "88", "confidence": 0.88, "drivers": [], "teamName": "UAE Team Emirates", "otherText": ["Colnago", "Champion System"]}]'

WHERE code = 'cycling';


-- Log migration
DO $$
BEGIN
  RAISE NOTICE 'HOTFIX: Running & Cycling prompts fixed for V3 compatibility';
  RAISE NOTICE 'Root cause: prompts lacked JSON format spec, V3 needs it in ai_prompt';
  RAISE NOTICE 'Fix: Added explicit JSON array format with example, prompts in English';
END $$;
