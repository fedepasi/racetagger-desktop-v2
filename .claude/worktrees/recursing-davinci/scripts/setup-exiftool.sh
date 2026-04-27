#!/bin/bash
# Script to download and setup ExifTool for different platforms

# Define versions and URLs
EXIFTOOL_VERSION="13.34"
EXIFTOOL_WIN_URL="https://sourceforge.net/projects/exiftool/files/exiftool-${EXIFTOOL_VERSION}_64.zip/download"
EXIFTOOL_MACOS_URL="https://sourceforge.net/projects/exiftool/files/ExifTool-${EXIFTOOL_VERSION}.pkg/download"
EXIFTOOL_LINUX_URL="https://sourceforge.net/projects/exiftool/files/Image-ExifTool-${EXIFTOOL_VERSION}.tar.gz/download"

# Define directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
VENDOR_DIR="$ROOT_DIR/vendor"
WIN32_DIR="$VENDOR_DIR/win32"
DARWIN_DIR="$VENDOR_DIR/darwin"
LINUX_DIR="$VENDOR_DIR/linux"
TEMP_DIR="$ROOT_DIR/tmp"

# Create temporary directory
mkdir -p "$TEMP_DIR"

echo "Setting up ExifTool version $EXIFTOOL_VERSION..."
echo "Using temporary directory: $TEMP_DIR"

# Function to download file
download_file() {
  url="$1"
  output="$2"
  
  echo "Downloading $url to $output"
  
  if command -v curl >/dev/null 2>&1; then
    curl -L "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$output" "$url"
  else
    echo "Error: Neither curl nor wget is installed"
    exit 1
  fi
}

# Setup ExifTool for Windows
setup_windows() {
  echo "Setting up ExifTool for Windows..."
  
  EXIFTOOL_WIN_ZIP="$TEMP_DIR/exiftool-win.zip"
  download_file "$EXIFTOOL_WIN_URL" "$EXIFTOOL_WIN_ZIP"
  
  # Create extract directory
  WIN_EXTRACT_DIR="$TEMP_DIR/exiftool-win"
  mkdir -p "$WIN_EXTRACT_DIR"
  
  # Extract to temporary directory
  unzip -q "$EXIFTOOL_WIN_ZIP" -d "$WIN_EXTRACT_DIR"
  
  # Find the extracted .exe file (usually called exiftool(-k).exe)
  WIN_EXE=$(find "$WIN_EXTRACT_DIR" -name "exiftool*.exe" | head -1)
  
  if [ -z "$WIN_EXE" ]; then
    echo "Error: Could not find exiftool.exe in the extracted files"
    exit 1
  fi
  
  # Copy to vendor directory
  cp "$WIN_EXE" "$WIN32_DIR/exiftool.exe"
  
  echo "ExifTool for Windows installed at: $WIN32_DIR/exiftool.exe"
}

# Setup ExifTool for macOS (using tarball for complete installation)
setup_macos() {
  echo "Setting up ExifTool for macOS..."
  
  # Use the same tarball as Linux for macOS to get the complete library
  EXIFTOOL_MACOS_TAR="$TEMP_DIR/exiftool-macos.tar.gz"
  download_file "$EXIFTOOL_LINUX_URL" "$EXIFTOOL_MACOS_TAR"
  
  # Create extract directory
  MACOS_EXTRACT_DIR="$TEMP_DIR/exiftool-macos"
  mkdir -p "$MACOS_EXTRACT_DIR"
  
  # Extract
  tar -xzf "$EXIFTOOL_MACOS_TAR" -C "$MACOS_EXTRACT_DIR"
  
  # Find the extracted directory
  EXTRACTED_DIR=$(find "$MACOS_EXTRACT_DIR" -type d -name "Image-ExifTool-*" | head -1)
  
  if [ -n "$EXTRACTED_DIR" ]; then
    # Copy the perl script
    cp "$EXTRACTED_DIR/exiftool" "$DARWIN_DIR/exiftool"
    
    # Copy the lib directory with all Perl modules
    cp -r "$EXTRACTED_DIR/lib" "$DARWIN_DIR/"
    
    # Make it executable
    chmod +x "$DARWIN_DIR/exiftool"
    
    echo "ExifTool for macOS installed at: $DARWIN_DIR/exiftool with complete library"
  else
    echo "Error: Could not find extracted ExifTool directory"
    exit 1
  fi
}

# Setup ExifTool for Linux
setup_linux_perl_script() {
  echo "Setting up ExifTool (Perl script) for Linux..."
  
  EXIFTOOL_LINUX_TAR="$TEMP_DIR/exiftool-linux.tar.gz"
  download_file "$EXIFTOOL_LINUX_URL" "$EXIFTOOL_LINUX_TAR"
  
  # Create extract directory
  LINUX_EXTRACT_DIR="$TEMP_DIR/exiftool-linux"
  mkdir -p "$LINUX_EXTRACT_DIR"
  
  # Extract
  tar -xzf "$EXIFTOOL_LINUX_TAR" -C "$LINUX_EXTRACT_DIR"
  
  # Find the extracted directory
  EXTRACTED_DIR=$(find "$LINUX_EXTRACT_DIR" -type d -name "Image-ExifTool-*" | head -1)
  
  # Copy the perl script
  cp "$EXTRACTED_DIR/exiftool" "$LINUX_DIR/exiftool"
  
  # Make it executable
  chmod +x "$LINUX_DIR/exiftool"
  
  echo "ExifTool for Linux installed at: $LINUX_DIR/exiftool"
}

# Create directories if they don't exist
mkdir -p "$WIN32_DIR" "$DARWIN_DIR" "$LINUX_DIR"

# Run setup for each platform
setup_windows
setup_macos
setup_linux_perl_script

# Clean up
echo "Cleaning up temporary files..."
rm -rf "$TEMP_DIR"

echo "ExifTool setup complete!"