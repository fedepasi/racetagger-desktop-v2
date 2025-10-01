document.addEventListener('DOMContentLoaded', () => {
  const accessCodeContainer = document.getElementById('access-code-container');
  const mainAppContainer = document.getElementById('main-app-container');
  const getEarlyAccessLink = document.getElementById('get-early-access-link');
  
  // Nascondi il container del codice di accesso
  accessCodeContainer.classList.add('hidden');
  
  // Verifica se l'utente è già autenticato
  window.api.send('check-auth-status');
  
  // Gestione click sul link per ottenere l'accesso anticipato
  if (getEarlyAccessLink) {
    getEarlyAccessLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.api.send('open-early-access');
    });
  }
});
