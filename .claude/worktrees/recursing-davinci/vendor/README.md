# ExifTool Integration for Racetagger Desktop

This directory contains ExifTool binaries for different platforms that are automatically bundled with the application during the build process.

## Directory Structure

- `win32/`: Contains ExifTool for Windows (exiftool.exe)
- `darwin/`: Contains ExifTool for macOS (exiftool)
- `linux/`: Contains ExifTool for Linux (exiftool)

## Setup Process

The ExifTool binaries are automatically downloaded and set up during the `npm install` process through the `postinstall` script that runs `setup-exiftool.sh`.

If you need to manually update or reinstall ExifTool, run:

```bash
npm run setup-exiftool
```

## Integration with the Application

The application uses ExifTool for extracting metadata from images, specifically for:

1. Extracting embedded JPEG previews from DNG files
2. Reading and writing metadata like EXIF, IPTC, and XMP

The `RawConverter` class in `src/utils/raw-converter.ts` uses ExifTool to extract preview images from DNG files. It automatically detects and uses the bundled version of ExifTool before falling back to any system-installed version.

## Version Information

The current version of ExifTool used is determined by the `EXIFTOOL_VERSION` variable in `scripts/setup-exiftool.sh`.

## Troubleshooting

If you encounter issues with ExifTool:

1. Ensure the script `setup-exiftool.sh` has executed successfully
2. Check that the appropriate ExifTool binary exists in the platform-specific directory
3. Verify the binary has execute permissions (especially important on macOS and Linux)
4. Check the application logs for any ExifTool-related error messages

## License

ExifTool is distributed under the terms of the Perl Artistic License or the GNU General Public License as published by the Free Software Foundation.

For more information about ExifTool, visit: [https://exiftool.org/](https://exiftool.org/)
