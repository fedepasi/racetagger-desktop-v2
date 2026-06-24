/**
 * Referral ("Invite friends") sidebar page.
 *
 * Fetches the user's referral code + stats from the satisfaction-survey Edge
 * Function (action=referral, service role) via the referral:get IPC handler and
 * renders the invite link, reward copy, and stats. No token logic — the reward
 * is the existing signup-time referral pipeline; this only shows it.
 */
(function () {
  'use strict';

  var REFERRAL_BASE = 'https://racetagger.cloud';

  function inviteUrl(data) {
    if (data && data.referral_slug) return REFERRAL_BASE + '/r/' + data.referral_slug;
    if (data && data.referral_code) return REFERRAL_BASE + '/?ref=' + encodeURIComponent(data.referral_code);
    return REFERRAL_BASE + '/';
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { /* ignore */ }
  }

  function fmt(n) {
    var v = Number(n) || 0;
    return v.toLocaleString('en-US');
  }

  async function initialize() {
    var linkInput = document.getElementById('referral-invite-link');
    var copyBtn = document.getElementById('referral-copy-btn');
    var rewardNote = document.getElementById('referral-reward-note');
    var friendsEl = document.getElementById('referral-friends-count');
    var creditsEl = document.getElementById('referral-credits-count');
    if (!linkInput || !copyBtn) return;

    try {
      var res = await window.api.invoke('referral:get');
      if (!res || !res.success || !res.data) {
        linkInput.value = 'Could not load your invite link. Check your connection.';
        copyBtn.disabled = true;
        return;
      }
      var data = res.data;
      var url = inviteUrl(data);
      linkInput.value = url;

      var reward = Number(data.reward_display) || 0;
      if (rewardNote) {
        rewardNote.textContent = reward > 0
          ? 'You earn ' + reward + ' credits for every friend who signs up.'
          : 'You earn credits for every friend who signs up.';
      }
      if (friendsEl) friendsEl.textContent = fmt(data.total_referrals);
      if (creditsEl) creditsEl.textContent = fmt(data.bonus_tokens);

      // Avoid double-binding if the page is re-initialized.
      if (!copyBtn.dataset.bound) {
        copyBtn.dataset.bound = '1';
        copyBtn.addEventListener('click', function () {
          copyText(linkInput.value);
          linkInput.focus();
          linkInput.select();
          var original = copyBtn.textContent;
          copyBtn.textContent = 'Copied';
          copyBtn.classList.add('copied');
          setTimeout(function () {
            copyBtn.textContent = original;
            copyBtn.classList.remove('copied');
          }, 1600);
        });
      }
    } catch (e) {
      console.error('[Referral] Failed to load referral data:', e);
      linkInput.value = 'Could not load your invite link.';
      copyBtn.disabled = true;
    }
  }

  window.ReferralPage = { initialize: initialize };

  // Also initialize on the router's page-loaded event as a safety net.
  window.addEventListener('page-loaded', function (e) {
    if (e && e.detail && e.detail.page === 'referral') {
      initialize();
    }
  });
})();
