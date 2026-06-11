/**
 * Tests for the per-participant repeat block feature (`[[ ... ]]`) in IPTC
 * template fields, plus the multi-match-aware `{persons}` resolution.
 *
 * Two surfaces are tested:
 * 1. {@link expandPerParticipantBlocks} — the low-level expander, in isolation.
 * 2. {@link buildMetadataFromPresetIptc} — the public IPTC builder, end-to-end.
 *
 * Backward-compatibility tests are included throughout: any template that does
 * NOT contain `[[` must produce the same output as the legacy code path.
 */

import {
  expandPerParticipantBlocks,
  buildMetadataFromPresetIptc,
  TemplateParticipant,
} from '../src/utils/metadata-writer';
import { PresetIptcMetadata } from '../src/utils/iptc-types';

// ============================================================================
// Test fixtures
// ============================================================================

const FELLER: TemplateParticipant = {
  name: 'Ricardo Feller',
  number: '90',
  team: 'Manthey',
  car_model: 'Porsche 911 GT3 R',
  nationality: 'SUI',
};

const THIIM: TemplateParticipant = {
  name: 'Nicki Thiim',
  number: '7',
  team: 'Comtoyou Racing',
  car_model: 'Aston Martin Vantage AMR GT3 EVO',
  nationality: 'DEN',
};

const VERSTAPPEN: TemplateParticipant = {
  name: 'Max Verstappen',
  number: '1',
  team: 'Red Bull Racing',
  car_model: 'RB21',
  nationality: 'NED',
};

// ============================================================================
// expandPerParticipantBlocks — direct unit tests
// ============================================================================

describe('expandPerParticipantBlocks', () => {
  describe('backward compatibility', () => {
    it('returns the template unchanged when no [[ block is present', () => {
      const tpl = 'DTM 2026 #{number} - {name}';
      expect(expandPerParticipantBlocks(tpl, [FELLER])).toBe(tpl);
      expect(expandPerParticipantBlocks(tpl, [FELLER, THIIM])).toBe(tpl);
      expect(expandPerParticipantBlocks(tpl, [])).toBe(tpl);
    });

    it('handles empty/undefined templates safely', () => {
      expect(expandPerParticipantBlocks('', [FELLER])).toBe('');
    });

    it('handles a template containing only literal text', () => {
      const tpl = 'No placeholders here';
      expect(expandPerParticipantBlocks(tpl, [FELLER, THIIM])).toBe(tpl);
    });
  });

  describe('single block, varying participant counts', () => {
    const tpl = 'DTM 2026 [[#{number}; {team}: {name}]] - photo by GC';

    it('renders the block once for a single participant (no separator)', () => {
      expect(expandPerParticipantBlocks(tpl, [FELLER])).toBe(
        'DTM 2026 #90; Manthey: Ricardo Feller - photo by GC'
      );
    });

    it('renders once per participant joined by ", " by default', () => {
      expect(expandPerParticipantBlocks(tpl, [FELLER, THIIM])).toBe(
        'DTM 2026 #90; Manthey: Ricardo Feller, #7; Comtoyou Racing: Nicki Thiim - photo by GC'
      );
    });

    it('handles 3+ participants', () => {
      expect(expandPerParticipantBlocks(tpl, [FELLER, THIIM, VERSTAPPEN])).toBe(
        'DTM 2026 #90; Manthey: Ricardo Feller, ' +
        '#7; Comtoyou Racing: Nicki Thiim, ' +
        '#1; Red Bull Racing: Max Verstappen - photo by GC'
      );
    });

    it('replaces the block with empty string when participants is empty', () => {
      expect(expandPerParticipantBlocks(tpl, [])).toBe('DTM 2026  - photo by GC');
    });

    it('honors a custom separator', () => {
      expect(
        expandPerParticipantBlocks(tpl, [FELLER, THIIM], ' | ')
      ).toBe(
        'DTM 2026 #90; Manthey: Ricardo Feller | #7; Comtoyou Racing: Nicki Thiim - photo by GC'
      );
    });
  });

  describe('multiple blocks in the same template', () => {
    it('expands each block independently', () => {
      const tpl = 'Drivers: [[{name}]] | Numbers: [[#{number}]]';
      expect(expandPerParticipantBlocks(tpl, [FELLER, THIIM])).toBe(
        'Drivers: Ricardo Feller, Nicki Thiim | Numbers: #90, #7'
      );
    });
  });

  describe('participant variables inside vs outside blocks', () => {
    it('leaves variables OUTSIDE blocks untouched (caller substitutes them)', () => {
      const tpl = 'Multi-pilot: {team} | [[#{number} {name}]]';
      expect(expandPerParticipantBlocks(tpl, [FELLER, THIIM])).toBe(
        'Multi-pilot: {team} | #90 Ricardo Feller, #7 Nicki Thiim'
      );
    });

    it('does not touch unknown placeholders inside a block', () => {
      const tpl = '[[{name} ({unknown_var})]]';
      // {unknown_var} is left in place for the outer cleanup pass to scrub.
      expect(expandPerParticipantBlocks(tpl, [FELLER])).toBe(
        'Ricardo Feller ({unknown_var})'
      );
    });
  });

  describe('special-character handling in block content', () => {
    it('preserves punctuation, parentheses, and unicode inside blocks', () => {
      const tpl = '[[({number}) {name} 🏁 — {team}]]';
      expect(expandPerParticipantBlocks(tpl, [FELLER, THIIM])).toBe(
        '(90) Ricardo Feller 🏁 — Manthey, (7) Nicki Thiim 🏁 — Comtoyou Racing'
      );
    });

    it('handles empty participant fields gracefully (substitutes empty string)', () => {
      const partial: TemplateParticipant = { name: 'Solo Driver' };
      expect(
        expandPerParticipantBlocks('[[#{number} {name} ({team})]]', [partial])
      ).toBe('# Solo Driver ()');
    });
  });

  describe('{persons} placeholder inside a block', () => {
    it("uses each participant's individual extended name (NOT joined list)", () => {
      const tpl = '[[{persons}]]';
      const expanded = expandPerParticipantBlocks(tpl, [FELLER, THIIM]);
      // Each participant's full extended name renders independently per iteration.
      expect(expanded).toContain('(90) Ricardo Feller (SUI) - Manthey - Porsche 911 GT3 R');
      expect(expanded).toContain('(7) Nicki Thiim (DEN) - Comtoyou Racing - Aston Martin Vantage AMR GT3 EVO');
      expect(expanded).toContain(', '); // separator between iterations
    });
  });
});

// ============================================================================
// buildMetadataFromPresetIptc — end-to-end integration tests
// ============================================================================

describe('buildMetadataFromPresetIptc with [[ ]] blocks and multi-match {persons}', () => {
  // Lisa's real-world case from the customer report.
  describe("Gruppe C / Lisa's DTM caption template", () => {
    const profile: PresetIptcMetadata = {
      descriptionTemplate:
        'DTM, 3.+4. Rennen Zandvoort 2026 [[#{number}; {car_model}, {team}: {name}]] - picture by Gruppe C Photography',
      personShownFormat: 'simple',
    };

    it('produces the expected per-pilot caption for two cars in one frame', () => {
      const result = buildMetadataFromPresetIptc(
        profile,
        // Aggregated participant (legacy contract from iptc-finalizer)
        {
          name: 'Ricardo Feller and Nicki Thiim',
          number: '90, 7',
          team: 'Manthey, Comtoyou Racing',
          car_model: 'Porsche 911 GT3 R, Aston Martin Vantage AMR GT3 EVO',
        },
        undefined,
        'append',
        [FELLER, THIIM] // full list for [[ ]] expansion
      );

      expect(result.description).toBe(
        'DTM, 3.+4. Rennen Zandvoort 2026 ' +
        '#90; Porsche 911 GT3 R, Manthey: Ricardo Feller, ' +
        '#7; Aston Martin Vantage AMR GT3 EVO, Comtoyou Racing: Nicki Thiim ' +
        '- picture by Gruppe C Photography'
      );
    });

    it('still works for a single-pilot frame (block renders once)', () => {
      const result = buildMetadataFromPresetIptc(
        profile,
        FELLER,
        undefined,
        'append',
        [FELLER]
      );

      expect(result.description).toBe(
        'DTM, 3.+4. Rennen Zandvoort 2026 #90; Porsche 911 GT3 R, Manthey: Ricardo Feller - picture by Gruppe C Photography'
      );
    });
  });

  describe('backward compatibility — templates without [[ ]]', () => {
    it('produces identical output to the legacy single-match path', () => {
      const profile: PresetIptcMetadata = {
        descriptionTemplate: '{name} during the {team} session',
      };
      const result = buildMetadataFromPresetIptc(
        profile,
        VERSTAPPEN,
        undefined,
        'append',
        [VERSTAPPEN]
      );
      expect(result.description).toBe('Max Verstappen during the Red Bull Racing session');
    });

    it("preserves legacy multi-match behavior when the user hasn't adopted [[ ]] yet", () => {
      // Pre-feature, multi-match aggregated values into joined strings — that
      // legacy behavior must still apply OUTSIDE [[ ]] blocks.
      const profile: PresetIptcMetadata = {
        descriptionTemplate: 'Drivers: {name}, Numbers: {number}',
      };
      const result = buildMetadataFromPresetIptc(
        profile,
        // The aggregated participant the iptc-finalizer would have built.
        {
          name: 'Ricardo Feller and Nicki Thiim',
          number: '90, 7',
        },
        undefined,
        'append',
        [FELLER, THIIM]
      );
      expect(result.description).toBe(
        'Drivers: Ricardo Feller and Nicki Thiim, Numbers: 90, 7'
      );
    });

    it('omits allParticipants entirely (legacy 4-arg call) and works as before', () => {
      const profile: PresetIptcMetadata = {
        descriptionTemplate: '{name}',
      };
      const result = buildMetadataFromPresetIptc(profile, FELLER, undefined, 'append');
      expect(result.description).toBe('Ricardo Feller');
    });
  });

  describe('{persons} placeholder — multi-match fix', () => {
    it('joins individual extended names in multi-match (FIX: was broken before)', () => {
      const profile: PresetIptcMetadata = {
        descriptionTemplate: 'Featuring: {persons}',
      };
      const result = buildMetadataFromPresetIptc(
        profile,
        // Aggregated mess that previously made {persons} produce nonsense.
        {
          name: 'Ricardo Feller and Nicki Thiim',
          number: '90, 7',
          team: 'Manthey, Comtoyou Racing',
          car_model: 'Porsche 911 GT3 R, Aston Martin Vantage AMR GT3 EVO',
        },
        undefined,
        'append',
        [FELLER, THIIM]
      );
      expect(result.description).toBe(
        'Featuring: (90) Ricardo Feller (SUI) - Manthey - Porsche 911 GT3 R, (7) Nicki Thiim (DEN) - Comtoyou Racing - Aston Martin Vantage AMR GT3 EVO'
      );
    });

    it('preserves legacy single-match behavior for {persons}', () => {
      const profile: PresetIptcMetadata = {
        descriptionTemplate: '{persons}',
      };
      const result = buildMetadataFromPresetIptc(
        profile,
        FELLER,
        undefined,
        'append',
        [FELLER]
      );
      expect(result.description).toBe(
        '(90) Ricardo Feller (SUI) - Manthey - Porsche 911 GT3 R'
      );
    });
  });

  describe('blocks across all template fields', () => {
    it('works in headlineTemplate', () => {
      const profile: PresetIptcMetadata = {
        headlineTemplate: 'Race recap [[#{number} {name}]]',
      };
      const result = buildMetadataFromPresetIptc(
        profile,
        { name: 'a, b', number: '1, 2' },
        undefined,
        'append',
        [
          { name: 'Driver A', number: '1' },
          { name: 'Driver B', number: '2' },
        ]
      );
      expect(result.headline).toBe('Race recap #1 Driver A, #2 Driver B');
    });

    it('works in baseKeywords', () => {
      const profile: PresetIptcMetadata = {
        baseKeywords: ['DTM', '[[{name}]]', '[[#{number}]]'],
      };
      const result = buildMetadataFromPresetIptc(
        profile,
        { name: 'a, b' },
        undefined,
        'append',
        [
          { name: 'Driver A', number: '1' },
          { name: 'Driver B', number: '2' },
        ]
      );
      // Each keyword string is independently template-resolved. Block expansion
      // happens within each keyword.
      expect(result.keywords).toEqual(
        expect.arrayContaining([
          'DTM',
          'Driver A, Driver B',
          '#1, #2',
        ])
      );
    });
  });

  describe('zero participants edge case', () => {
    it('renders block as empty when no participants (template-only event-level vars survive)', () => {
      const profile: PresetIptcMetadata = {
        descriptionTemplate: 'Event recap [[#{number} {name}]] - GC',
      };
      const result = buildMetadataFromPresetIptc(
        profile,
        undefined,
        undefined,
        'append',
        []
      );
      // Block becomes empty; whitespace cleanup collapses spaces.
      expect(result.description).toBe('Event recap - GC');
    });
  });
});
