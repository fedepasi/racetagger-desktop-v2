# Racetagger Desktop

Desktop application for Racetagger, built with Electron, TypeScript, and Supabase. This application allows users to analyze racing images to detect race numbers and other relevant information.

## Default language
English

## Features

- **Single Image Analysis**: Upload and analyze individual racing images to detect race numbers, drivers, teams, and categories
- **Batch Processing**: Select an entire folder to process multiple images at once
- **CSV Integration**: Load starting lists from CSV files to match detected race numbers with participant data
- **EXIF Metadata**: Automatically tag images with metadata based on recognized race numbers or driver names
- **RAW to DNG Conversion**: Converts RAW files to DNG format using Adobe DNG Converter, embedding a full-size JPEG preview for fast loading and compatibility.
- **RAW Format Support**: Processes a wide range of RAW files (NEF, ARW, CR2, CR3, ORF, RAW, RW2, etc.) by converting them to DNG. The original RAW can optionally be embedded within the DNG.
- **Advanced Error Handling**: Intelligent retry mechanism for API calls with exponential backoff
- **Cross-platform**: Works on Windows, macOS, and Linux
- **Early Access System**: Exclusive access through invitation codes for early adopters
- **Token-based Usage**: Pay-as-you-go model with token consumption for each analysis

## Technical Information

- Built with Electron and TypeScript
- Uses Supabase for storage and serverless functions
- Image processing with Sharp.js and piexifjs for EXIF metadata
- RAW conversion handled by Adobe DNG Converter (if available)
- ExifTool for extracting embedded previews from DNG files and advanced metadata operations
- Integrates with Google Vision AI for image recognition.

## Development

### Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Create a `.env` file with the necessary Supabase credentials
4. Start the development server: `npm run dev`

### Building

To build the application for distribution:

```
npm run build
```

### CSV Format

The application supports CSV files with the following required columns:
- `numero`: Race number
- `metatag`: Text to be written to the EXIF metadata

Optional columns:
- `nome`: Driver name
- `categoria`: Category
- `squadra`: Team

Example:
```
numero,nome,categoria,squadra,metatag
123,Mario Rossi,Elite,Team Veloce,"Gara XYZ, 10/06/2025"
456,Luigi Verdi,Junior,Team Giovani,"Gara XYZ, 10/06/2025"
789,Anna Bianchi,Women,Team Rosa,"Gara XYZ, 10/06/2025"
```

## Batch Processing Workflow

1. Select a folder containing racing images
2. Optionally load a CSV file with starting list data
3. Start batch processing
4. The app will:
   - Analyze each image to detect race numbers and other information
   - Match detected race numbers or driver names with the CSV data (if provided)
   - Update EXIF metadata (Image.ImageDescription field) on matching images
   - Display a summary of results for all processed images

## Early Access System

The application uses an invitation-based early access system:

1. Users sign up on the web application to join the early access waiting list
2. The first 50 subscribers receive exclusive access codes via email
3. When launching the desktop app for the first time, users enter their access code
4. Valid codes unlock full access to the application
5. Users without a code can sign up for the waiting list directly from the app

## Token System

The application uses a token-based system for image analysis:

1. **Early Access Free Tokens**: Each user receives 500 free tokens per month during the early access period
2. **Token Requests**: Users can request additional tokens through a dedicated button in the application
3. **Progressive Pricing for Additional Tokens**:
   - First 5,000 tokens: $0.020 each
   - 5,001 to 20,000 tokens: $0.015 each
   - Over 20,000 tokens: $0.010 each
4. Each image analysis consumes 1 token
5. The token balance is displayed in the app interface
6. Demo mode allows for 3 free analyses without registration

## Dependencies

Major dependencies include:
- Electron: Framework for building cross-platform desktop apps
- TypeScript: Type-safe JavaScript
- Supabase: Backend-as-a-Service for storage and serverless functions
- Sharp.js: High-performance image processing
- piexifjs: EXIF metadata manipulation (fallback for Sharp)
