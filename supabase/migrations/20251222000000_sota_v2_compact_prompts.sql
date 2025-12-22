-- =====================================================
-- SOTA v2: Compact Prompts for Vehicle DNA Extraction
-- =====================================================
--
-- This migration updates sport_categories prompts to use
-- compact format (short keys) for token efficiency while
-- extracting additional Vehicle DNA fields.
--
-- Token savings: ~15-20% per request
-- New fields: livery, make, model, category, plate, context
--
-- Backward compatible: response-parser auto-detects format
-- =====================================================

-- 1. Update MOTORSPORT prompt (most common category)
UPDATE sport_categories
SET
  ai_prompt = 'Race vehicles. For each subject:

[{
  n: string|null,
  d: string[],
  t: string|null,
  s: string[],
  c: 0.0-1.0,
  b: [y1,x1,y2,x2],
  lv: {p:string,s:string[]}|null,
  mk: string|null,
  md: string|null,
  cat: string|null,
  plt: string|null,
  ctx: string|null
}]

n=number, d=drivers, t=team, s=sponsors(max5), c=confidence, b=bbox(0-1000), lv=livery(p=primary,s=secondary), mk=make, md=model, cat=category, plt=plate, ctx=context(race/pit/podium/portrait).

Visible data only. Never invent.',
  updated_at = NOW()
WHERE code = 'motorsport';


-- 2. Update RUNNING prompt
UPDATE sport_categories
SET
  ai_prompt = 'Athletes/runners. For each subject:

[{
  n: string|null,
  d: string[],
  t: string|null,
  s: string[],
  c: 0.0-1.0,
  b: [y1,x1,y2,x2],
  cat: string|null,
  ctx: string|null
}]

n=bib number, d=athlete names, t=team/club, s=sponsors(max5), c=confidence, b=bbox(0-1000), cat=category(marathon/trail/10k), ctx=context(race/finish/podium).

Visible data only. Never invent.',
  updated_at = NOW()
WHERE code = 'running';


-- 3. Update CYCLING prompt
UPDATE sport_categories
SET
  ai_prompt = 'Cyclists. For each subject:

[{
  n: string|null,
  d: string[],
  t: string|null,
  s: string[],
  c: 0.0-1.0,
  b: [y1,x1,y2,x2],
  lv: {p:string,s:string[]}|null,
  mk: string|null,
  cat: string|null,
  ctx: string|null
}]

n=rider number, d=names, t=team, s=sponsors(max5), c=confidence, b=bbox(0-1000), lv=jersey colors, mk=bike brand, cat=category, ctx=context(race/sprint/climb).

Visible data only. Never invent.',
  updated_at = NOW()
WHERE code = 'cycling';


-- 4. Update ENDURANCE-WEC prompt (if exists)
UPDATE sport_categories
SET
  ai_prompt = 'Endurance race vehicles (GT3/Hypercar/LMP2). For each subject:

[{
  n: string|null,
  d: string[],
  t: string|null,
  s: string[],
  c: 0.0-1.0,
  b: [y1,x1,y2,x2],
  lv: {p:string,s:string[]}|null,
  mk: string|null,
  md: string|null,
  cat: string|null,
  ctx: string|null
}]

n=number(1-3 digits), d=all visible drivers, t=team, s=sponsors(max5), c=confidence, b=bbox(0-1000), lv=livery colors, mk=make, md=model, cat=class(Hypercar/LMP2/GT3), ctx=context(race/pit/podium).

Visible data only. Foreground priority. Never invent.',
  updated_at = NOW()
WHERE code = 'endurance-wec';


-- 5. Update ALTRO (generic) prompt
UPDATE sport_categories
SET
  ai_prompt = 'Competitors/participants. For each subject:

[{
  n: string|null,
  d: string[],
  t: string|null,
  s: string[],
  c: 0.0-1.0,
  b: [y1,x1,y2,x2],
  cat: string|null,
  ctx: string|null
}]

n=competitor number, d=names, t=team/club, s=sponsors(max5), c=confidence, b=bbox(0-1000), cat=sport/category, ctx=context.

Visible data only. Never invent.',
  updated_at = NOW()
WHERE code = 'altro';


-- 6. Add comment for documentation
COMMENT ON TABLE sport_categories IS
'Sport categories with AI prompts.
SOTA v2 (Dec 2025): Updated to compact format with Vehicle DNA fields.
Compact keys: n=number, d=drivers, t=team, s=sponsors, c=confidence, b=bbox, lv=livery, mk=make, md=model, cat=category, plt=plate, ctx=context.
Auto-detected by response-parser for backward compatibility.';


-- 7. Log migration
DO $$
BEGIN
  RAISE NOTICE 'SOTA v2 compact prompts migration completed';
  RAISE NOTICE 'Updated categories: motorsport, running, cycling, endurance-wec, altro';
  RAISE NOTICE 'New DNA fields: livery, make, model, category, plate, context';
END $$;
