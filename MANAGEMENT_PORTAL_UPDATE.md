# Management Portal Update: Category & Plate Number Weights

## Obiettivo
Aggiungere i campi `category` e `plateNumber` weights al management portal per permettere la configurazione via UI.

## File da Modificare

### 1. Interface SportCategory (linee 46-61)

**File**: `racetagger-app/src/app/management-portal/sport-categories/page.tsx`

**Cambiamento**:
```typescript
// BEFORE
matching_config?: {
  weights: {
    raceNumber: number;
    driverName: number;
    sponsor: number;
    team: number;
  };
  // ...
} | null;

// AFTER
matching_config?: {
  weights: {
    raceNumber: number;
    driverName: number;
    sponsor: number;
    team: number;
    category: number;        // NUOVO
    plateNumber: number;     // NUOVO
  };
  // ...
} | null;
```

### 2. Interface FormData (linee 94-97)

**Aggiungere dopo `weight_team`**:
```typescript
weight_team: number;
weight_category: number;       // NUOVO
weight_plate_number: number;   // NUOVO
```

### 3. Funzione toFormData - Create Mode (linee ~363-366)

**Aggiungere dopo `weight_team`**:
```typescript
weight_team: category.matching_config?.weights?.team || 60,
weight_category: category.matching_config?.weights?.category || 0,        // NUOVO
weight_plate_number: category.matching_config?.weights?.plateNumber || 0,  // NUOVO
```

### 4. Funzione toFormData - Edit Mode (linee ~417-420)

**Aggiungere dopo `weight_team`**:
```typescript
weight_team: category.matching_config?.weights?.team || 60,
weight_category: category.matching_config?.weights?.category || 0,        // NUOVO
weight_plate_number: category.matching_config?.weights?.plateNumber || 0,  // NUOVO
```

### 5. Funzione handleSubmit - Matching Config Object (cercare dove si costruisce matching_config)

**Cambiamento**:
```typescript
// BEFORE
matching_config: {
  weights: {
    raceNumber: formData.weight_race_number,
    driverName: formData.weight_driver_name,
    sponsor: formData.weight_sponsor,
    team: formData.weight_team,
  },
  thresholds: { ... },
  multiEvidenceBonus: formData.multi_evidence_bonus,
}

// AFTER
matching_config: {
  weights: {
    raceNumber: formData.weight_race_number,
    driverName: formData.weight_driver_name,
    sponsor: formData.weight_sponsor,
    team: formData.weight_team,
    category: formData.weight_category,              // NUOVO
    plateNumber: formData.weight_plate_number,       // NUOVO
  },
  thresholds: { ... },
  multiEvidenceBonus: formData.multi_evidence_bonus,
}
```

### 6. UI Form Fields - Matching Weights Section

**Cercare la sezione "Matching Configuration - Weights" nel JSX e aggiungere**:

```tsx
{/* Existing fields: weight_race_number, weight_driver_name, weight_sponsor, weight_team */}

{/* NUOVO: Category Weight */}
<div>
  <label className="block text-sm font-medium text-gray-700 mb-2">
    Category Weight
    <Tooltip text="Weight for category matches (GT3, F1, MotoGP, etc.). Set to 0 to disable category matching. Recommended: 60-80 for motorsport, 30-40 for running/cycling, 0 if not applicable." />
  </label>
  <input
    type="number"
    name="weight_category"
    value={formData.weight_category}
    onChange={handleInputChange}
    min="0"
    max="200"
    step="5"
    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
    placeholder="0-200 (0 = disabled)"
  />
  <p className="mt-1 text-xs text-gray-500">
    Current: {formData.weight_category} points
    {formData.weight_category === 0 && ' (DISABLED)'}
    {formData.weight_category > 0 && formData.weight_category < 50 && ' (Low priority)'}
    {formData.weight_category >= 50 && formData.weight_category < 100 && ' (Medium priority)'}
    {formData.weight_category >= 100 && ' (High priority)'}
  </p>
</div>

{/* NUOVO: Plate Number Weight */}
<div>
  <label className="block text-sm font-medium text-gray-700 mb-2">
    Plate Number Weight
    <Tooltip text="Weight for license plate matches. VERY RELIABLE for motorsport with visible plates (rally, endurance). Set to 0 for sports without plates (running, cycling) or when plates are covered (F1, GT Sprint). Recommended: 130-150 for rally/endurance, 0 for track racing/running." />
  </label>
  <input
    type="number"
    name="weight_plate_number"
    value={formData.weight_plate_number}
    onChange={handleInputChange}
    min="0"
    max="200"
    step="10"
    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
    placeholder="0-200 (0 = disabled)"
  />
  <p className="mt-1 text-xs text-gray-500">
    Current: {formData.weight_plate_number} points
    {formData.weight_plate_number === 0 && ' (DISABLED)'}
    {formData.weight_plate_number > 0 && formData.weight_plate_number < 80 && ' (Low confidence)'}
    {formData.weight_plate_number >= 80 && formData.weight_plate_number < 120 && ' (Medium confidence)'}
    {formData.weight_plate_number >= 120 && ' (HIGH confidence - more reliable than race number!)'}
  </p>
  {formData.weight_plate_number > 0 && !formData.recognition_detect_plate_number && (
    <p className="mt-1 text-xs text-yellow-600 font-semibold">
      ⚠️ Warning: Plate weight is enabled but AI plate detection is OFF.
      Enable "Detect Plate Number" in Recognition Config to use this feature.
    </p>
  )}
  {formData.weight_plate_number === 0 && formData.recognition_detect_plate_number && (
    <p className="mt-1 text-xs text-blue-600">
      💡 Tip: AI is detecting plates but weight is 0. Increase weight to use plate matching.
    </p>
  )}
</div>
```

## Validation Logic (Opzionale ma Consigliata)

Aggiungere validazione per assicurare coerenza tra `recognition_config.detectPlateNumber` e `matching_config.weights.plateNumber`:

```typescript
const validatePlateConfig = (formData: FormData): string | null => {
  // If plate weight > 0 but AI detection is off, warn user
  if (formData.weight_plate_number > 0 && !formData.recognition_detect_plate_number) {
    return 'Plate number weight is enabled but AI plate detection is OFF. Enable plate detection in Recognition Config.';
  }

  // If AI detection is on but weight is 0, suggest enabling weight
  if (formData.recognition_detect_plate_number && formData.weight_plate_number === 0) {
    // This is OK - just a suggestion, not an error
    console.log('Suggestion: AI is detecting plates but matching weight is 0. Consider increasing weight to use this data.');
  }

  return null; // Valid
};

// In handleSubmit, before saving:
const plateWarning = validatePlateConfig(formData);
if (plateWarning) {
  // Show warning modal or inline message
  if (!confirm(plateWarning + '\n\nDo you want to continue anyway?')) {
    return; // Cancel save
  }
}
```

## Recommended Default Values per Sport

Per facilitare la configurazione, suggerisci questi valori di default quando si crea una nuova category:

```typescript
const defaultWeightsByType = {
  motorsport: {
    category: 60,
    plateNumber: 150  // High - plates visible in endurance/rally
  },
  trackRacing: {
    category: 70,
    plateNumber: 0  // Disabled - plates usually covered
  },
  rally: {
    category: 80,
    plateNumber: 130  // High - plates always visible
  },
  running: {
    category: 30,
    plateNumber: 0  // Disabled - not applicable
  },
  cycling: {
    category: 40,
    plateNumber: 0  // Disabled - not applicable
  },
  generic: {
    category: 0,  // Disabled by default
    plateNumber: 0  // Disabled by default
  }
};
```

## Summary

**Files da modificare**:
- `racetagger-app/src/app/management-portal/sport-categories/page.tsx`

**Sezioni da aggiornare**:
1. ✅ Interface `SportCategory`
2. ✅ Interface `FormData`
3. ✅ Funzione `toFormData()` (2 posti: create e edit mode)
4. ✅ Funzione `handleSubmit()` - matching_config object
5. ✅ UI Form - aggiungere 2 input fields
6. ✅ (Opzionale) Validation logic

**Testing**:
1. Creare nuova sport category → verifica defaults category=0, plateNumber=0
2. Modificare motorsport → imposta category=60, plateNumber=150 → salva
3. Modificare running → imposta category=30, plateNumber=0 → salva
4. Verifica warning quando plateWeight > 0 ma detectPlateNumber = false
5. Ricarica pagina → verifica che i valori siano persistiti
