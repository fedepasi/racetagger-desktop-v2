// DOM Elements for Auth UI
let loginForm;
let registerForm;
let authContainer;
let mainAppContainer;
let accessCodeContainer;
let logoutButton;
let userInfoDisplay;
let loginTab;
let registerTab;
let loginPanel;
let registerPanel;
let tokenBalanceDisplay;
let subscriptionDisplay;
let continueDemo;
let backToLogin;

// Auth state
let authState = {
  isAuthenticated: false,
  session: null,
  user: null,
  userRole: null,
  tokens: {
    total: 0,
    used: 0,
    remaining: 0,
    pending: 0
  },
  subscription: {
    plan: null,
    isActive: false,
    expiresAt: null
  }
};

// Initialize auth UI
function initializeAuth() {
  console.log('Initializing auth UI components');
  
  // Setup refresh button event listener
  const refreshBtn = document.getElementById('refresh-tokens-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', handleTokenRefresh);
  }
  
  // Get DOM elements
  authContainer = document.getElementById('auth-container');
  mainAppContainer = document.getElementById('main-app-container');
  accessCodeContainer = document.getElementById('access-code-container');
  loginForm = document.getElementById('login-form');
  registerForm = document.getElementById('register-form');
  logoutButton = document.getElementById('logout-button');
  userInfoDisplay = document.getElementById('user-info');
  loginTab = document.getElementById('login-tab');
  registerTab = document.getElementById('register-tab');
  loginPanel = document.getElementById('login-panel');
  registerPanel = document.getElementById('register-panel');
  tokenBalanceDisplay = document.getElementById('token-balance');
  subscriptionDisplay = null; // Removed subscription info display
  // Il pulsante continueDemo è stato rimosso dall'HTML
  continueDemo = null;
  backToLogin = document.getElementById('back-to-login');
  
  // Set up event listeners
  if (loginForm) loginForm.addEventListener('submit', handleLogin);
  // Registrazione disabilitata temporaneamente
  // if (registerForm) registerForm.addEventListener('submit', handleRegister);
  if (logoutButton) logoutButton.addEventListener('click', handleLogout);
  if (loginTab) loginTab.addEventListener('click', () => switchAuthTab('login'));
  // Registrazione disabilitata temporaneamente
  // if (registerTab) registerTab.addEventListener('click', () => switchAuthTab('register'));
  if (continueDemo) continueDemo.addEventListener('click', handleContinueWithoutLogin);
  if (backToLogin) backToLogin.addEventListener('click', () => switchAuthTab('login'));
  
  // Listen for auth messages from main process
  if (window.api) {
    window.api.receive('auth-status', handleAuthStatus);
    window.api.receive('login-result', handleLoginResult);
    window.api.receive('register-result', handleRegisterResult);
    window.api.receive('logout-result', handleLogoutResult);
    window.api.receive('token-balance', updateTokenBalance);
    window.api.receive('pending-tokens', updatePendingTokens);
    window.api.receive('subscription-info', updateSubscriptionInfo);
    window.api.receive('auth-error', handleAuthError);
    window.api.receive('token-used', handleTokenUsed);
    window.api.receive('auth-refresh-completed', handleAuthRefreshCompleted);
  }
}

// Handle login form submission
function handleLogin(event) {
  event.preventDefault();
  
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  
  if (!email || !password) {
    showAuthError('login', 'Email e password sono obbligatorie');
    return;
  }
  
  // Clear error
  showAuthError('login', '');
  
  // Show loading indicator
  const submitBtn = loginForm.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Accesso in corso...';
  submitBtn.disabled = true;
  
  // Send login request to main process
  if (window.api) {
    window.api.send('login', { email, password });
  }
  
  // Reset form state after timeout (in case of no response)
  setTimeout(() => {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }, 10000);
}

// Handle register form submission
function handleRegister(event) {
  event.preventDefault();
  
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const name = document.getElementById('register-name').value;
  
  if (!email || !password) {
    showAuthError('register', 'Email e password sono obbligatorie');
    return;
  }
  
  if (password.length < 6) {
    showAuthError('register', 'La password deve essere di almeno 6 caratteri');
    return;
  }
  
  // Clear error
  showAuthError('register', '');
  
  // Show loading indicator
  const submitBtn = registerForm.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Registrazione in corso...';
  submitBtn.disabled = true;
  
  // Send register request to main process
  if (window.api) {
    window.api.send('register', { email, password, name });
  }
  
  // Reset form state after timeout (in case of no response)
  setTimeout(() => {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }, 10000);
}

// Handle logout button click
function handleLogout() {
  if (window.api) {
    window.api.send('logout');
  }
}

// Handle auth status response
function handleAuthStatus(status) {
  console.log('Received auth status:', status);
  console.log('Frontend - userRole received:', status.userRole);
  
  authState = {
    ...authState,
    isAuthenticated: status.isAuthenticated,
    user: status.user,
    session: status.session,
    userRole: status.userRole
  };
  
  updateUIForAuthState();
  
  // If authenticated, get complete token info and subscription info
  if (status.isAuthenticated) {
    if (window.api) {
      // Load complete token info (balance + pending)
      loadCompleteTokenInfo();
      window.api.send('get-subscription-info');
    }
  }
}

// Handle login result
function handleLoginResult(result) {
  const submitBtn = loginForm.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Accedi';
  submitBtn.disabled = false;

  if (result.success) {
    authState = {
      ...authState,
      isAuthenticated: true,
      user: result.user,
      session: result.session
    };

    updateUIForAuthState();

    // Reset form
    loginForm.reset();

    // Get complete token info and subscription info
    if (window.api) {
      // Load complete token info (balance + pending)
      loadCompleteTokenInfo();
      window.api.send('get-subscription-info');

      // IMPORTANT: Reload home page data to clear previous user's data
      if (typeof loadHomePageData === 'function') {
        loadHomePageData();
      }
    }
  } else {
    showAuthError('login', result.error || 'Error during login');
  }
}

// Handle register result
function handleRegisterResult(result) {
  const submitBtn = registerForm.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Registrati';
  submitBtn.disabled = false;
  
  if (result.success) {
    // Show success message
    showAuthMessage('register', 'Registrazione completata! Effettua il login.');
    
    // Reset form
    registerForm.reset();
    
    // Switch to login tab
    setTimeout(() => {
      switchAuthTab('login');
    }, 2000);
  } else {
    showAuthError('register', result.error || 'Error during registration');
  }
}

// Handle logout result
function handleLogoutResult(result) {
  if (result.success) {
    authState = {
      isAuthenticated: false,
      session: null,
      user: null,
      tokens: {
        total: 0,
        used: 0,
        remaining: 0
      },
      subscription: {
        plan: null,
        isActive: false,
        expiresAt: null
      }
    };

    // Clear home page data on logout
    homePageData = {
      monthlyPhotos: 0,
      completedEvents: 0,
      recentWork: [],
      userName: 'Photographer'
    };

    updateUIForAuthState();
  } else {
    console.error('Logout error:', result.error);
  }
}

// Update token balance display - now includes pending tokens if available
function updateTokenBalance(tokenInfo) {
  console.log('[Auth] Updating token balance display:', tokenInfo);
  
  // Update the token balance but preserve existing pending count
  const existingPending = authState.tokens.pending || 0;
  authState.tokens = { ...tokenInfo, pending: existingPending };
  
  // Use the new display function that includes pending tokens
  updateTokenDisplayWithPending();
  
  // If tokenBalanceDisplay is being used elsewhere, update it without overwriting
  if (tokenBalanceDisplay && !document.getElementById('token-balance')) {
    // Only use this fallback if the main widget doesn't exist
    tokenBalanceDisplay.innerHTML = `
      <div class="token-info">
        <span class="token-label">Images available:</span>
        <span class="token-value">${tokenInfo.remaining}</span>
      </div>
      <button id="refresh-tokens-btn" class="btn small" title="Refresh token balance" style="margin-left: 8px; font-size: 12px;">🔄</button>
    `;
    
    // Add event listener to refresh button
    const refreshBtn = tokenBalanceDisplay.querySelector('#refresh-tokens-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', handleTokenRefresh);
    }
  }
  
  // Reset refresh button state if it was in loading state
  const existingRefreshBtn = document.getElementById('refresh-tokens-btn');
  if (existingRefreshBtn && existingRefreshBtn.disabled) {
    console.log('[Auth] Resetting refresh button after successful token update');
    existingRefreshBtn.innerHTML = '🔄';
    existingRefreshBtn.disabled = false;
    existingRefreshBtn.classList.remove('spinning');
    
    // Show success feedback
    showNotification('Token Balance Updated', 'Your token balance has been refreshed successfully.');
    console.log('Token refresh completed, button restored');
  }
}

// Update subscription info display
function updateSubscriptionInfo(subscriptionInfo) {
  // Store subscription info in state but don't display it anymore
  authState.subscription = subscriptionInfo;
  
  // Subscription display has been removed from the UI for cleaner interface
  // The subscription info is still available in authState.subscription if needed
}

// Update pending tokens display
function updatePendingTokens(pendingTokensCount) {
  console.log('[Auth] Updating pending tokens display:', pendingTokensCount);
  authState.tokens.pending = pendingTokensCount || 0;
  
  // Update the display to show pending tokens if any exist
  updateTokenDisplayWithPending();
}

// Update token display including pending tokens
function updateTokenDisplayWithPending() {
  const tokenAmountElement = document.getElementById('token-balance');
  if (tokenAmountElement) {
    let displayText = authState.tokens.remaining.toString();
    let tooltip = `Images available: ${authState.tokens.remaining}`;

    // If there are pending tokens, show them with styling
    if (authState.tokens.pending > 0) {
      displayText += ` <span class="token-pending">(+${authState.tokens.pending} pending)</span>`;
      tooltip += `\nPending approval: ${authState.tokens.pending} images`;
      console.log('[Auth] Displaying tokens with pending:', displayText);
    }

    tokenAmountElement.innerHTML = displayText;
    tokenAmountElement.title = tooltip;
  }

  // Update any other token display elements
  const tokenValueElements = document.querySelectorAll('.token-value, .token-amount');
  tokenValueElements.forEach(element => {
    let displayText = authState.tokens.remaining.toString();
    let tooltip = `Images available: ${authState.tokens.remaining}`;

    if (authState.tokens.pending > 0) {
      displayText += ` <span class="token-pending">(+${authState.tokens.pending} pending)</span>`;
      tooltip += `\nPending approval: ${authState.tokens.pending} images`;
    }
    
    element.innerHTML = displayText;
    element.title = tooltip;
  });
}

// Handle token used event
function handleTokenUsed(tokenInfo) {
  console.log('[Auth] handleTokenUsed called with:', tokenInfo);
  
  // Update token balance
  updateTokenBalance(tokenInfo);
  
  // Show notification if token balance is low
  if (tokenInfo.remaining <= 5) {
    showNotification('Avviso', `Hai solo ${tokenInfo.remaining} token disponibili. Considera l'acquisto di token aggiuntivi.`);
  }
}

// Handle auth refresh completed event
function handleAuthRefreshCompleted() {
  console.log('[Auth] Auth refresh completed - reloading categories and analytics...');

  // Reload categories
  if (typeof loadDynamicCategories === 'function') {
    loadDynamicCategories(true); // Force refresh
  }

  // Reload home analytics data
  if (typeof refreshHomePageData === 'function') {
    refreshHomePageData();
  }

  // Notify main process to reload data as well
  if (window.api && window.api.send) {
    window.api.send('auth-refresh-completed-from-renderer');
  }
}

// Handle token refresh button click
function handleTokenRefresh() {
  console.log('[Auth] Token refresh requested by user');
  
  // Show loading state on button
  const refreshBtn = document.getElementById('refresh-tokens-btn');
  if (refreshBtn) {
    const originalText = refreshBtn.innerHTML;
    refreshBtn.innerHTML = '⏳';
    refreshBtn.disabled = true;
    refreshBtn.classList.add('spinning');
    
    // Reset button after 3 seconds if no response
    setTimeout(() => {
      if (refreshBtn.disabled) {
        refreshBtn.innerHTML = originalText;
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('spinning');
        console.log('[Auth] Token refresh button reset after timeout');
      }
    }, 3000);
  }
  
  // Request token refresh from main process
  if (window.api && authState.isAuthenticated) {
    console.log('[Auth] Sending force-token-refresh request');
    window.api.send('force-token-refresh');
  } else if (!authState.isAuthenticated) {
    console.log('[Auth] Cannot refresh tokens - user not authenticated');
    showNotification('Refresh Failed', 'Please login to refresh token balance.');
    // Reset button immediately if not authenticated
    if (refreshBtn) {
      refreshBtn.innerHTML = originalText;
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('spinning');
    }
  }
}

// Handle auth error
function handleAuthError(error) {
  console.error('Auth error:', error);
  showNotification('Authentication error', error.message || 'An authentication error occurred');
}

// Show auth error
function showAuthError(form, message) {
  const errorElement = document.getElementById(`${form}-error`);
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = message ? 'block' : 'none';
  }
}

// Show auth message
function showAuthMessage(form, message) {
  const errorElement = document.getElementById(`${form}-error`);
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = message ? 'block' : 'none';
    errorElement.className = 'success-message';
  }
}

// Show notification
function showNotification(title, message) {
  // Create notification element
  const notificationElement = document.createElement('div');
  notificationElement.className = 'notification';
  notificationElement.innerHTML = `
    <div class="notification-header">
      <h4>${title}</h4>
      <button class="close-btn">&times;</button>
    </div>
    <div class="notification-body">
      ${message}
    </div>
  `;
  
  // Add to document
  document.body.appendChild(notificationElement);
  
  // Add close button event listener
  const closeBtn = notificationElement.querySelector('.close-btn');
  closeBtn.addEventListener('click', () => {
    notificationElement.remove();
  });
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    if (notificationElement.parentNode) {
      notificationElement.remove();
    }
  }, 5000);
}

// Switch auth tab
function switchAuthTab(tab) {
  if (tab === 'login') {
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    loginPanel.style.display = 'block';
    registerPanel.style.display = 'none';
  } else {
    loginTab.classList.remove('active');
    registerTab.classList.add('active');
    loginPanel.style.display = 'none';
    registerPanel.style.display = 'block';
  }
}

// Handle continue without login
function handleContinueWithoutLogin() {
  if (window.api) {
    window.api.send('continue-demo');
  }
  
  // Close auth modal
  if (authModal) {
    authModal.style.display = 'none';
  }
}

// Handle upgrade click
function handleUpgradeClick() {
  if (window.api) {
    window.api.send('open-subscription-page');
  }
}

// Update UI based on auth state
function updateUIForAuthState() {
  const userBar = document.getElementById('user-bar');
  const sidebarUserName = document.getElementById('sidebar-user-name');
  const tokenDisplay = document.getElementById('token-display');
  
  if (authState.isAuthenticated) {
    // User is logged in
    if (authContainer) {
      authContainer.style.display = 'none';
    }
    
    if (userBar) {
      userBar.style.display = 'flex';
    }
    
    if (userInfoDisplay && authState.user) {
      userInfoDisplay.textContent = `${authState.user.email}`;
    }
    
    // Update sidebar user name
    if (sidebarUserName && authState.user) {
      sidebarUserName.textContent = authState.user.email.split('@')[0];
    }
    
    // Update token display in header
    if (tokenDisplay && authState.tokens) {
      const tokenValue = tokenDisplay.querySelector('.token-value');
      if (tokenValue) {
        tokenValue.textContent = authState.tokens.remaining;
      }
    }
    
    // Mostra l'app principale
    if (mainAppContainer) {
      mainAppContainer.classList.remove('hidden');
    }
    
    // Nascondi il container del codice di accesso
    if (accessCodeContainer) {
      accessCodeContainer.classList.add('hidden');
    }
    
    // Gestisci la visibilità delle sezioni sidebar in base al ruolo utente
    updateSidebarVisibility();
  } else {
    // User is not logged in
    if (authContainer) {
      authContainer.style.display = 'flex';
    }
    
    if (userBar) {
      userBar.style.display = 'none';
    }
    
    // Update sidebar user name for guest
    if (sidebarUserName) {
      sidebarUserName.textContent = 'Guest';
    }
    
    // Nascondi l'app principale
    if (mainAppContainer) {
      mainAppContainer.classList.add('hidden');
    }
    
    // Nascondi sempre il container del codice di accesso e mostra direttamente il login
    if (accessCodeContainer) {
      accessCodeContainer.classList.add('hidden');
    }
  }
}


// Update token balance from server (async version for manual calls)
async function updateTokenBalanceAsync() {
  if (!authState.isAuthenticated) {
    console.log('[Auth] Cannot update token balance - user not authenticated');
    return; // Demo mode, no need to update
  }
  
  try {
    console.log('[Auth] Fetching token balance from server...');
    const balance = await window.api.invoke('get-token-balance');
    
    // Update the display with the received balance
    if (typeof balance === 'object' && balance.remaining !== undefined) {
      updateTokenBalance(balance);
    } else {
      // Handle legacy number response
      updateTokenBalance({
        total: balance,
        used: 0,
        remaining: balance
      });
    }
    
    console.log(`[Auth] Token balance updated: ${balance}`);
  } catch (error) {
    console.error('[Auth] Error updating token balance:', error);
    throw error;
  }
}

// Check if token balance is sufficient
function checkTokenBalance(requiredTokens = 1, forceRefresh = false) {
  // If forceRefresh is requested, update balance from server first
  if (forceRefresh && authState.isAuthenticated) {
    updateTokenBalance();
    return true; // Return true for now, actual check will happen after refresh
  }
  
  if (!authState.isAuthenticated) {
    return true; // Demo mode, allow operation
  }
  
  if (authState.tokens.remaining < requiredTokens) {
    showNotification('Token insufficienti', `Hai bisogno di almeno ${requiredTokens} token per completare questa operazione. Il tuo saldo attuale è di ${authState.tokens.remaining} token.`);
    return false;
  }
  
  return true;
}

// Load initial pending tokens when authenticated
async function loadPendingTokens() {
  if (!authState.isAuthenticated || !window.api) {
    return;
  }
  
  try {
    console.log('[Auth] Loading initial pending tokens...');
    const pendingTokens = await window.api.invoke('get-pending-tokens');
    updatePendingTokens(pendingTokens);
  } catch (error) {
    console.error('[Auth] Error loading pending tokens:', error);
  }
}

// Load complete token info (balance + pending) when authenticated
async function loadCompleteTokenInfo() {
  if (!authState.isAuthenticated || !window.api) {
    return;
  }
  
  try {
    console.log('[Auth] Loading complete token info...');
    const tokenInfo = await window.api.invoke('get-token-info');
    updateTokenBalance(tokenInfo.balance);
    updatePendingTokens(tokenInfo.pending);
  } catch (error) {
    console.error('[Auth] Error loading complete token info:', error);
  }
}

// Aggiungi funzione per il feedback
function submitFeedback(imageId, rating, comment) {
  if (window.api) {
    window.api.send('submit-feedback', {
      imageId,
      rating,
      comment,
      userId: authState.isAuthenticated ? authState.user.id : null
    });
  }
}

// Aggiorna la visibilità delle sezioni sidebar in base al ruolo utente
function updateSidebarVisibility() {
  console.log('Updating sidebar visibility for user role:', authState.userRole);
  
  // Trova tutte le voci di navigazione
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  
  navItems.forEach(navItem => {
    const navIcon = navItem.querySelector('.nav-icon');
    const navText = navItem.querySelector('.nav-text');
    
    if (!navIcon || !navText) return;
    
    const iconText = navIcon.textContent.trim();
    const linkText = navText.textContent.trim();
    const href = navItem.getAttribute('href');
    
    // Identifica le sezioni da nascondere per utenti non admin
    const isAdminOnlySection =
      iconText === '📁' || // Progetti
      iconText === '🧪' || // Test & Valutazione
      href === 'test-dashboard.html'; // Test & Valutazione (alternativo)
    
    if (isAdminOnlySection) {
      // Mostra solo agli admin
      if (authState.userRole === 'admin') {
        navItem.style.display = 'block';
        console.log(`Showing admin section: ${linkText} (${iconText})`);
      } else {
        navItem.style.display = 'none';
        console.log(`Hiding admin section: ${linkText} (${iconText}) - user role: ${authState.userRole}`);
      }
    } else {
      // Analisi e Impostazioni sempre visibili
      navItem.style.display = 'block';
      console.log(`Showing regular section: ${linkText} (${iconText})`);
    }
  });
  
  // Se l'utente è autenticato, reindirizza alla sezione Analisi se è su una pagina admin-only
  if (authState.isAuthenticated && authState.userRole !== 'admin') {
    const currentActiveSection = document.querySelector('.content-section.active-section');
    if (currentActiveSection) {
      const sectionId = currentActiveSection.id;
      
      // Se è su Progetti o Test & Valutazione, reindirizza ad Analisi
      if (sectionId === 'section-progetti') {
        // Nascondi la sezione corrente e mostra Analisi
        currentActiveSection.classList.remove('active-section');
        
        const analysisSection = document.getElementById('section-analysis');
        if (analysisSection) {
          analysisSection.classList.add('active-section');
        }
        
        // Aggiorna anche la nav attiva
        const activeNavItem = document.querySelector('.sidebar-nav .nav-item.active');
        if (activeNavItem) {
          activeNavItem.classList.remove('active');
        }
        
        const analysisNavItem = document.querySelector('.sidebar-nav .nav-item .nav-icon');
        if (analysisNavItem && analysisNavItem.textContent.trim() === '🔍') {
          analysisNavItem.closest('.nav-item').classList.add('active');
        }
        
        console.log(`Redirected non-admin user from ${sectionId} to section-analysis`);
      }
    }
  }
}

// Export functions
window.authUtils = {
  initialize: initializeAuth,
  checkTokenBalance,
  updateTokenBalance,
  showNotification,
  submitFeedback,
  getCurrentUser: function() {
    return authState.user;
  }
};

// Funzione per ricontrollare l'auth status
function recheckAuthStatus() {
  console.log('Rechecking auth status...');
  if (window.api && window.api.send) {
    window.api.send('check-auth-status');
  }
}

// Esporta la funzione per l'uso globale
window.recheckAuthStatus = recheckAuthStatus;

// Inizializza quando il documento è pronto
document.addEventListener('DOMContentLoaded', () => {
  initializeAuth();
  
  // Ricontrolla auth status dopo 2 secondi per assicurarsi che il userRole sia determinato
  setTimeout(() => {
    console.log('Auto-rechecking auth status after 2 seconds...');
    recheckAuthStatus();
  }, 2000);
});
