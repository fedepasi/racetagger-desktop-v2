# Vendor Libraries

This directory contains third-party JavaScript libraries bundled with the application for offline support.

## sortable.min.js

**Version:** 2.0.0
**Source:** https://github.com/tofsjonas/sortable
**License:** MIT
**Size:** 942 bytes (minified)

**Purpose:**
Lightweight table sorting library with no dependencies. Enables interactive sorting on HTML tables by clicking column headers.

**Features:**
- Zero dependencies (vanilla JavaScript)
- Automatic type detection (numeric vs alphabetic sorting)
- Supports ascending/descending sort
- Minimal footprint (< 1KB gzipped)
- Accessibility support

**Usage in App:**
Used in the Participants Manager to enable sortable participant tables. Users can click any column header to sort participants by:
- Number (numeric sorting)
- Driver name (alphabetic)
- Category (alphabetic)
- Team (alphabetic)
- Plate number (alphanumeric)

**Update Instructions:**
To update to a newer version:
```bash
curl -o renderer/js/vendor/sortable.min.js https://cdn.jsdelivr.net/npm/sortable-tablesort@VERSION/sortable.min.js
```

**Documentation:** https://github.com/tofsjonas/sortable#readme
