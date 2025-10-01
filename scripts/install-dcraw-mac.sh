#!/bin/bash

# RaceTagger - dcraw Installation Script for macOS
# This script installs dcraw for RAW image processing support

set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           RaceTagger - dcraw Installation Script             ║"
echo "║                    for macOS (M1/Intel)                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Function to check if running on Apple Silicon
is_apple_silicon() {
    [[ $(uname -m) == "arm64" ]]
}

# Function to check if dcraw is already installed
check_dcraw_installed() {
    if command -v dcraw &> /dev/null; then
        echo "✅ dcraw is already installed at: $(which dcraw)"
        echo "   Version: $(dcraw -v 2>&1 | head -n 1)"
        return 0
    fi
    
    # Check common locations
    local paths=("/opt/homebrew/bin/dcraw" "/usr/local/bin/dcraw" "/usr/bin/dcraw")
    for path in "${paths[@]}"; do
        if [[ -x "$path" ]]; then
            echo "✅ dcraw found at: $path"
            echo "   Version: $($path -v 2>&1 | head -n 1)"
            return 0
        fi
    done
    
    return 1
}

# Check if dcraw is already installed
if check_dcraw_installed; then
    echo ""
    echo "dcraw is already installed and ready for RaceTagger!"
    echo "If you're still having issues, please restart RaceTagger."
    exit 0
fi

echo "dcraw is not installed. Starting installation..."
echo ""

# Method 1: Try installing via Homebrew (preferred)
echo "Method 1: Checking for Homebrew..."
if command -v brew &> /dev/null; then
    echo "✅ Homebrew found. Installing dcraw..."
    
    if brew install dcraw; then
        echo "✅ Successfully installed dcraw via Homebrew!"
        check_dcraw_installed
        echo ""
        echo "Installation complete! Please restart RaceTagger."
        exit 0
    else
        echo "⚠️ Homebrew installation failed. Trying alternative method..."
    fi
else
    echo "❌ Homebrew not found."
    echo ""
    echo "Would you like to install Homebrew first? (recommended)"
    echo "Press Y to install Homebrew, or N to skip:"
    read -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        
        # Add Homebrew to PATH for Apple Silicon
        if is_apple_silicon; then
            echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
        
        echo "✅ Homebrew installed. Now installing dcraw..."
        if brew install dcraw; then
            echo "✅ Successfully installed dcraw via Homebrew!"
            check_dcraw_installed
            echo ""
            echo "Installation complete! Please restart RaceTagger."
            exit 0
        fi
    fi
fi

# Method 2: Download precompiled binary
echo ""
echo "Method 2: Downloading precompiled dcraw binary..."

# Create directory if it doesn't exist
sudo mkdir -p /usr/local/bin

# Determine architecture
if is_apple_silicon; then
    echo "Detected Apple Silicon (M1/M2/M3) Mac"
    DCRAW_URL="https://www.dechifro.org/dcraw/binaries/dcraw-arm64-macos"
    
    # If ARM64 binary doesn't exist, we'll compile from source
    if ! curl -f -L -o /tmp/dcraw "$DCRAW_URL" 2>/dev/null; then
        echo "ARM64 binary not available. Will compile from source..."
        
        # Method 3: Compile from source
        echo ""
        echo "Method 3: Compiling dcraw from source..."
        
        # Check for Xcode Command Line Tools
        if ! xcode-select -p &> /dev/null; then
            echo "Installing Xcode Command Line Tools (required for compilation)..."
            xcode-select --install
            echo "Please complete the Xcode Command Line Tools installation and run this script again."
            exit 1
        fi
        
        # Download source code
        echo "Downloading dcraw source code..."
        curl -L -o /tmp/dcraw.c https://www.dechifro.org/dcraw/dcraw.c
        
        # Compile dcraw
        echo "Compiling dcraw for Apple Silicon..."
        cc -o /tmp/dcraw -O4 /tmp/dcraw.c -lm -DNO_JPEG -DNO_LCMS -DNO_JASPER
        
        if [[ -f /tmp/dcraw ]]; then
            echo "✅ Successfully compiled dcraw!"
        else
            echo "❌ Compilation failed. Please check error messages above."
            exit 1
        fi
    fi
else
    echo "Detected Intel Mac"
    DCRAW_URL="https://www.dechifro.org/dcraw/binaries/dcraw-x86_64-macos"
    
    if ! curl -f -L -o /tmp/dcraw "$DCRAW_URL"; then
        echo "❌ Failed to download dcraw binary."
        echo "Please visit https://www.dechifro.org/dcraw/ to download manually."
        exit 1
    fi
fi

# Install the binary
echo "Installing dcraw to /usr/local/bin/..."
sudo mv /tmp/dcraw /usr/local/bin/dcraw
sudo chmod +x /usr/local/bin/dcraw

# Verify installation
if check_dcraw_installed; then
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║               ✅ Installation Successful!                    ║"
    echo "║                                                               ║"
    echo "║            Please restart RaceTagger now.                    ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
else
    echo ""
    echo "⚠️ Installation may have completed but dcraw is not in PATH."
    echo "You may need to add /usr/local/bin to your PATH."
    echo "Add this line to your ~/.zshrc or ~/.bash_profile:"
    echo "  export PATH=\"/usr/local/bin:\$PATH\""
fi

# Clean up
rm -f /tmp/dcraw.c 2>/dev/null || true

echo ""
echo "Script completed. Thank you for using RaceTagger!"