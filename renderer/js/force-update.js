// Force Update Screen Logic
// Handles version checking, in-app download with progress, and installer launch.
let updateData = null;
let isDownloading = false;
let isChecking = false;
let downloadedFilePath = null;

// Initialize force update screen
document.addEventListener('DOMContentLoaded', async () => {
    // Load version check result
    await loadUpdateData();

    // Listen for download progress events from main process
    window.api.receive('update-download-progress', (progress) => {
        updateProgressBar(progress);
    });

    // Setup automatic check interval (every 30 seconds)
    setInterval(async () => {
        if (!isChecking && !isDownloading) {
            await checkVersionSilently();
        }
    }, 30000);
});

// Load update data from main process
async function loadUpdateData() {
    try {
        const result = await window.api.invoke('get-version-check-result');
        if (result) {
            updateData = result;
            updateUI();
        } else {
            // If no cached result, perform fresh check
            await checkAgain();
        }
    } catch (error) {
        showError('Errore nel caricamento dei dati di aggiornamento');
    }
}

// Update UI elements based on update data
function updateUI() {
    if (!updateData) return;

    // Update message and urgency
    const messageEl = document.getElementById('updateMessage');
    const modalEl = document.getElementById('updateModal');
    const iconEl = document.getElementById('updateIcon');
    const titleEl = document.getElementById('updateTitle');

    if (updateData.update_message) {
        messageEl.textContent = updateData.update_message;
    }

    // Apply urgency styling
    modalEl.className = 'update-modal';
    if (updateData.urgency) {
        modalEl.classList.add(`urgency-${updateData.urgency}`);
    }

    // Update icon and title based on urgency
    switch (updateData.urgency) {
        case 'critical':
            iconEl.textContent = '🚨';
            titleEl.textContent = 'Aggiornamento Critico Richiesto';
            titleEl.style.color = '#dc3545';
            break;
        case 'important':
            iconEl.textContent = '⚠️';
            titleEl.textContent = 'Aggiornamento Importante';
            titleEl.style.color = '#ffc107';
            break;
        default:
            iconEl.textContent = '🚀';
            titleEl.textContent = 'Aggiornamento Disponibile';
            titleEl.style.color = '#2c3e50';
    }

    // Update version info
    const currentVersionEl = document.getElementById('currentVersion');
    const requiredVersionEl = document.getElementById('requiredVersion');

    // Get current app version
    window.api.invoke('get-app-version').then(version => {
        currentVersionEl.textContent = version;
    }).catch(() => {
        currentVersionEl.textContent = 'Unknown';
    });

    if (updateData.minimum_version) {
        requiredVersionEl.textContent = updateData.minimum_version;
    }

    // Show/hide quit button based on force update status
    const quitBtn = document.getElementById('quitBtn');
    if (updateData.force_update_enabled && updateData.requires_update) {
        // Force update mode - show quit button after delay
        setTimeout(() => {
            quitBtn.classList.remove('hidden');
        }, 10000); // Show quit option after 10 seconds
    } else {
        quitBtn.classList.add('hidden');
    }

    // Update download button state
    const downloadBtn = document.getElementById('downloadBtn');
    if (!updateData.download_url) {
        downloadBtn.disabled = true;
        downloadBtn.querySelector('#downloadBtnText').textContent = '📥 Link Download Non Disponibile';
    }
}

// ==================== Download Update ====================

async function downloadUpdate() {
    if (isDownloading || !updateData?.download_url) return;

    isDownloading = true;
    downloadedFilePath = null;

    const downloadBtn = document.getElementById('downloadBtn');
    const downloadBtnText = document.getElementById('downloadBtnText');
    const downloadSpinner = document.getElementById('downloadSpinner');
    const progressContainer = document.getElementById('downloadProgressContainer');
    const installBtn = document.getElementById('installBtn');
    const checkAgainBtn = document.getElementById('checkAgainBtn');

    // Update UI for download state
    downloadBtn.disabled = true;
    downloadBtnText.textContent = 'Download in corso...';
    downloadSpinner.classList.remove('hidden');
    progressContainer.classList.remove('hidden');
    installBtn.classList.add('hidden');
    checkAgainBtn.disabled = true;

    // Reset progress bar
    updateProgressBar({ percent: 0, downloadedMB: 0, totalMB: 0, speedMBs: 0 });

    try {
        // Call main process to download the installer
        const result = await window.api.invoke('download-update', updateData.download_url);

        if (result.success) {
            downloadedFilePath = result.filePath;

            // Download complete - show install button
            downloadBtnText.textContent = '✅ Download Completato';
            downloadSpinner.classList.add('hidden');
            installBtn.classList.remove('hidden');

            // Update progress to 100%
            updateProgressBar({ percent: 100, downloadedMB: 0, totalMB: 0, speedMBs: 0 });

            showSuccess('Download completato! Clicca "Installa e Riavvia" per procedere.');
        } else {
            throw new Error(result.error || 'Download failed');
        }
    } catch (error) {
        downloadBtnText.textContent = '❌ Errore Download';
        downloadSpinner.classList.add('hidden');
        shakeElement(downloadBtn);
        showError('Errore durante il download. Riprova o contatta il supporto.');

        // Allow retry after delay
        setTimeout(() => {
            downloadBtnText.textContent = '📥 Riprova Download';
            downloadBtn.disabled = false;
            progressContainer.classList.add('hidden');
        }, 3000);
    } finally {
        isDownloading = false;
        checkAgainBtn.disabled = false;
    }
}

// ==================== Install Update ====================

async function installUpdate() {
    if (!downloadedFilePath) return;

    const installBtn = document.getElementById('installBtn');
    const installBtnText = document.getElementById('installBtnText');
    const installSpinner = document.getElementById('installSpinner');

    installBtn.disabled = true;
    installBtnText.textContent = 'Avvio installazione...';
    installSpinner.classList.remove('hidden');

    try {
        const result = await window.api.invoke('launch-installer', downloadedFilePath);

        if (result.success) {
            installBtnText.textContent = '✅ Installer avviato!';
            installSpinner.classList.add('hidden');
            showSuccess('Installer avviato! L\'app si chiuderà automaticamente...');
        } else {
            throw new Error(result.error || 'Failed to launch installer');
        }
    } catch (error) {
        installBtnText.textContent = '❌ Errore';
        installSpinner.classList.add('hidden');
        shakeElement(installBtn);
        showError('Errore nell\'avvio dell\'installer. Prova ad installare manualmente.');

        // Allow retry
        setTimeout(() => {
            installBtnText.textContent = '🚀 Riprova Installazione';
            installBtn.disabled = false;
        }, 3000);
    }
}

// ==================== Progress Bar ====================

function updateProgressBar(progress) {
    const fill = document.getElementById('progressBarFill');
    const percentEl = document.getElementById('progressPercent');
    const detailsEl = document.getElementById('progressDetails');
    const speedEl = document.getElementById('progressSpeed');

    if (fill) fill.style.width = `${progress.percent}%`;
    if (percentEl) percentEl.textContent = `${progress.percent}%`;
    if (detailsEl && progress.totalMB > 0) {
        detailsEl.textContent = `${progress.downloadedMB} MB / ${progress.totalMB} MB`;
    }
    if (speedEl && progress.speedMBs > 0) {
        speedEl.textContent = `${progress.speedMBs} MB/s`;
    }
}

// ==================== Version Check ====================

async function checkAgain() {
    if (isChecking) return;

    isChecking = true;
    const checkBtn = document.getElementById('checkAgainBtn');
    const checkBtnText = document.getElementById('checkAgainBtnText');
    const checkSpinner = document.getElementById('checkSpinner');

    // Update button state
    checkBtn.disabled = true;
    checkBtnText.textContent = 'Controllo...';
    checkSpinner.classList.remove('hidden');

    try {
        const result = await window.api.invoke('check-app-version');

        if (result) {
            updateData = result;

            // Check if update is still required
            if (!result.requires_update || !result.force_update_enabled) {
                // Update no longer required - could close force update screen
                showSuccess('Aggiornamento non più richiesto! Riavvio dell\'interfaccia...');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 2000);
                return;
            }

            updateUI();
            checkBtnText.textContent = '✅ Aggiornato';
        } else {
            throw new Error('No version check result received');
        }
    } catch (error) {
        checkBtnText.textContent = '❌ Errore';
        shakeElement(checkBtn);
        showError('Errore nel controllo della versione. Riprova tra qualche minuto.');
    } finally {
        checkSpinner.classList.add('hidden');
        setTimeout(() => {
            checkBtnText.textContent = '🔄 Controlla di Nuovo';
            checkBtn.disabled = false;
        }, 3000);
        isChecking = false;
    }
}

// Silent version check (without UI updates)
async function checkVersionSilently() {
    try {
        const result = await window.api.invoke('check-app-version');

        if (result && (!result.requires_update || !result.force_update_enabled)) {
            // Update no longer required
            window.location.href = 'index.html';
        }
    } catch (error) {
        // Silent check failed, continue
    }
}

// Quit application
async function quitApp() {
    const quitBtn = document.getElementById('quitBtn');
    quitBtn.disabled = true;
    quitBtn.textContent = '🔄 Chiusura...';

    try {
        await window.api.invoke('quit-app-for-update');
    } catch (error) {
        quitBtn.disabled = false;
        quitBtn.textContent = '❌ Esci dall\'App';
    }
}

// ==================== Utility Functions ====================

function showSuccess(message) {
    showNotification(message, 'success');
}

function showError(message) {
    showNotification(message, 'error');
}

function showNotification(message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#28a745' : '#dc3545'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 5px;
        z-index: 10001;
        max-width: 300px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        font-size: 0.9rem;
        line-height: 1.4;
        animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;

    // Add slide-in animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    // Auto remove after 5 seconds
    setTimeout(() => {
        notification.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

function shakeElement(element) {
    element.classList.add('shake');
    setTimeout(() => {
        element.classList.remove('shake');
    }, 500);
}

// Prevent context menu and dev tools in production
if (window.api?.isDev !== true) {
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I' || e.key === 'j' || e.key === 'J')) {
            e.preventDefault();
        }
        if (e.key === 'F12') {
            e.preventDefault();
        }
    });
}

// Handle window focus/blur for better UX
window.addEventListener('focus', () => {
    if (!isChecking && !isDownloading) {
        checkVersionSilently();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Escape key to quit (only if quit button is visible)
    if (e.key === 'Escape') {
        const quitBtn = document.getElementById('quitBtn');
        if (!quitBtn.classList.contains('hidden')) {
            quitApp();
        }
    }

    // Enter key to download or install
    if (e.key === 'Enter') {
        const installBtn = document.getElementById('installBtn');
        if (!installBtn.classList.contains('hidden') && !installBtn.disabled) {
            installUpdate();
            return;
        }
        const downloadBtn = document.getElementById('downloadBtn');
        if (!downloadBtn.disabled) {
            downloadUpdate();
        }
    }

    // F5 key to check again
    if (e.key === 'F5') {
        e.preventDefault();
        checkAgain();
    }
});
