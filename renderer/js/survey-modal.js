/**
 * Satisfaction Survey + Referral Nudge Modal
 *
 * A dynamic modal (mirrors feedback-modal.js) shown server-authoritatively:
 *   - prompt='satisfaction' : rate RaceTagger →
 *        positive → referral card (advertise the existing referral reward)
 *        negative → a short "what went wrong" form routed into the SAME support
 *                   pipeline as the normal Support modal (submit-support-feedback
 *                   with source='satisfaction_survey' → submitFeedback → feedback).
 *   - prompt='referral_400' / 'referral_2000' : a light referral CTA (no rating).
 *
 * window.openSurveyModal(eligibility) returns a Promise that resolves when the
 * modal closes, so a caller (e.g. the results "Done" button) can `await` it
 * before navigating away.
 *
 * No token logic here — the referral reward is the existing signup-time pipeline;
 * this only shows the user their code/link and the configured reward number.
 */
(function () {
  'use strict';

  var REFERRAL_BASE = 'https://racetagger.cloud';

  // Categories for the negative "what went wrong" form. Maps to a support type.
  var PROBLEM_CATEGORIES = [
    { value: 'recognition', label: 'Number recognition accuracy', type: 'bug' },
    { value: 'matching', label: 'Participant matching', type: 'bug' },
    { value: 'speed', label: 'Speed / performance', type: 'bug' },
    { value: 'crash', label: 'Crashes / errors', type: 'bug' },
    { value: 'export', label: 'Export / metadata', type: 'bug' },
    { value: 'other', label: 'Something else', type: 'general' },
  ];

  var modal = null;
  var resolveFn = null;
  var eligibility = {};
  var rating = 0;
  var settled = false; // true once answered/submitted (suppresses dismiss-ack)

  // ==================== URL helpers ====================

  function inviteUrl() {
    if (eligibility.referral_slug) return REFERRAL_BASE + '/r/' + eligibility.referral_slug;
    if (eligibility.referral_code) return REFERRAL_BASE + '/?ref=' + encodeURIComponent(eligibility.referral_code);
    return REFERRAL_BASE + '/';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ==================== Shell ====================

  function createModal() {
    if (modal) return;
    var overlay = document.createElement('div');
    overlay.className = 'survey-modal-overlay';
    overlay.id = 'survey-modal-overlay';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    overlay.innerHTML =
      '<div class="survey-modal" role="dialog" aria-modal="true">' +
      '  <div class="survey-modal-header">' +
      '    <h2 id="survey-title">RaceTagger</h2>' +
      '    <button class="survey-modal-close" id="survey-close" aria-label="Close">&times;</button>' +
      '  </div>' +
      '  <div class="survey-modal-body" id="survey-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    modal = overlay;
    document.getElementById('survey-close').addEventListener('click', closeModal);
  }

  function setBody(title, html) {
    document.getElementById('survey-title').textContent = title;
    document.getElementById('survey-body').innerHTML = html;
  }

  // ==================== Step: rate (satisfaction) ====================

  function renderRateStep() {
    var max = Math.max(2, Math.min(10, Number(eligibility.scale_max) || 5));
    var dots = '';
    for (var i = 1; i <= max; i++) {
      dots += '<button type="button" class="survey-rate-dot" data-rate="' + i + '">' + i + '</button>';
    }
    setBody('How are we doing?',
      '<p class="survey-lead">How satisfied are you with RaceTagger so far?</p>' +
      '<div class="survey-rate" id="survey-rate">' + dots + '</div>' +
      '<div class="survey-rate-legend"><span>Not satisfied</span><span>Very satisfied</span></div>' +
      '<textarea id="survey-comment" class="survey-textarea" rows="3" placeholder="Anything you want to add? (optional)"></textarea>' +
      '<div class="survey-actions">' +
      '  <button class="survey-btn-ghost" id="survey-later">Maybe later</button>' +
      '  <button class="survey-btn-primary" id="survey-send" disabled>Send feedback</button>' +
      '</div>'
    );

    var dotEls = modal.querySelectorAll('.survey-rate-dot');
    dotEls.forEach(function (d) {
      d.addEventListener('click', function () {
        rating = parseInt(d.dataset.rate, 10);
        dotEls.forEach(function (x) {
          x.classList.toggle('selected', parseInt(x.dataset.rate, 10) <= rating);
        });
        document.getElementById('survey-send').disabled = false;
      });
    });
    document.getElementById('survey-later').addEventListener('click', closeModal);
    document.getElementById('survey-send').addEventListener('click', handleRateSubmit);
  }

  async function handleRateSubmit() {
    if (rating < 1) return;
    var sendBtn = document.getElementById('survey-send');
    var comment = (document.getElementById('survey-comment') || {}).value || '';
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="survey-spinner"></span>Sending…';
    settled = true;
    try {
      var res = await window.api.invoke('survey:submit', { rating: rating, comment: comment });
      if (!res || !res.success) {
        settled = false;
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send feedback';
        showInlineError(res ? res.error : 'Could not send. Please try again.');
        return;
      }
      var d = res.data || {};
      // Keep referral fields fresh from the submit response.
      if (d.referral_code) eligibility.referral_code = d.referral_code;
      if (d.referral_slug) eligibility.referral_slug = d.referral_slug;
      if (d.reward_display != null) eligibility.reward_display = d.reward_display;

      if (d.sentiment === 'positive') {
        renderReferralStep(true);
      } else {
        renderNegativeStep();
      }
    } catch (e) {
      settled = false;
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send feedback';
      showInlineError('Could not send. Please try again.');
    }
  }

  // ==================== Step: negative (route to support) ====================

  function renderNegativeStep() {
    var opts = PROBLEM_CATEGORIES.map(function (c) {
      return '<option value="' + c.value + '">' + esc(c.label) + '</option>';
    }).join('');
    setBody('Sorry to hear that',
      '<p class="survey-lead">Tell us what went wrong — it goes straight to the founder, same as a support ticket.</p>' +
      '<label class="survey-field-label">What area?</label>' +
      '<select id="survey-prob-cat" class="survey-select">' + opts + '</select>' +
      '<label class="survey-field-label">What happened?</label>' +
      '<textarea id="survey-prob-text" class="survey-textarea" rows="4" placeholder="A few details help us reproduce and fix it fast."></textarea>' +
      '<div class="survey-actions">' +
      '  <button class="survey-btn-ghost" id="survey-skip">Not now</button>' +
      '  <button class="survey-btn-primary" id="survey-report" disabled>Send report</button>' +
      '</div>'
    );
    var textEl = document.getElementById('survey-prob-text');
    var reportBtn = document.getElementById('survey-report');
    textEl.addEventListener('input', function () {
      reportBtn.disabled = textEl.value.trim().length === 0;
    });
    document.getElementById('survey-skip').addEventListener('click', closeModal);
    reportBtn.addEventListener('click', handleNegativeSubmit);
  }

  async function handleNegativeSubmit() {
    var catEl = document.getElementById('survey-prob-cat');
    var textEl = document.getElementById('survey-prob-text');
    var reportBtn = document.getElementById('survey-report');
    var cat = PROBLEM_CATEGORIES.filter(function (c) { return c.value === catEl.value; })[0] || PROBLEM_CATEGORIES[0];
    var description = textEl.value.trim();
    if (!description) return;

    reportBtn.disabled = true;
    reportBtn.innerHTML = '<span class="survey-spinner"></span>Sending…';
    try {
      // Same pipeline as the normal Support modal — tagged with source so the
      // report is visibly "from a dissatisfied survey respondent".
      var result = await window.api.invoke('submit-support-feedback', {
        type: cat.type,
        title: 'Dissatisfied survey: ' + cat.label,
        description: description,
        includeDiagnostics: true,
        source: 'satisfaction_survey',
      });
      if (result && result.success) {
        setBody('Thank you',
          '<div class="survey-done">' +
          '<p class="survey-lead">Got it — thank you. We read every report and we\'re on it.</p>' +
          '<div class="survey-actions"><button class="survey-btn-primary" id="survey-finish">Close</button></div>' +
          '</div>');
        document.getElementById('survey-finish').addEventListener('click', closeModal);
      } else {
        reportBtn.disabled = false;
        reportBtn.textContent = 'Send report';
        showInlineError(result ? result.error : 'Could not send. Please try again.');
      }
    } catch (e) {
      reportBtn.disabled = false;
      reportBtn.textContent = 'Send report';
      showInlineError('Could not send. Please try again.');
    }
  }

  // ==================== Step: referral (positive + milestone nudge) ====================

  function renderReferralStep(fromPositive) {
    var reward = Number(eligibility.reward_display) || 0;
    var url = inviteUrl();
    var photos = Number(eligibility.tokens_used) || 0;

    var lead = fromPositive
      ? 'Love it? Invite a friend. They get RaceTagger, and you earn <strong>' + reward + ' credits</strong> for every friend who signs up.'
      : 'You\'ve analyzed <strong>' + photos.toLocaleString('en-US') + ' photos</strong>. Invite a friend — you earn <strong>' + reward + ' credits</strong> for every friend who signs up.';

    setBody(fromPositive ? 'Thanks — that means a lot' : 'Invite a friend',
      '<p class="survey-lead">' + lead + '</p>' +
      '<label class="survey-field-label">Your invite link</label>' +
      '<div class="survey-link-row">' +
      '  <input id="survey-link" class="survey-link-input" type="text" readonly value="' + esc(url) + '">' +
      '  <button class="survey-btn-copy" id="survey-copy" title="Copy invite link">Copy</button>' +
      '</div>' +
      '<div class="survey-actions">' +
      '  <button class="survey-btn-ghost" id="survey-dismiss">Close</button>' +
      '  <button class="survey-btn-primary" id="survey-open-ref">Invite friends</button>' +
      '</div>'
    );

    document.getElementById('survey-copy').addEventListener('click', function () {
      var input = document.getElementById('survey-link');
      copyText(url);
      var btn = document.getElementById('survey-copy');
      btn.textContent = 'Copied';
      btn.classList.add('copied');
      if (input) { input.focus(); input.select(); }
      setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1600);
    });
    document.getElementById('survey-dismiss').addEventListener('click', closeModal);
    document.getElementById('survey-open-ref').addEventListener('click', function () {
      // Leave any standalone page (e.g. results.html) and land on the sidebar
      // referral page in the main shell.
      window.location.href = 'index.html#/referral';
    });
  }

  // ==================== Helpers ====================

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

  function showInlineError(msg) {
    var body = document.getElementById('survey-body');
    if (!body) return;
    var existing = document.getElementById('survey-error');
    if (existing) existing.remove();
    var div = document.createElement('div');
    div.id = 'survey-error';
    div.className = 'survey-error';
    div.textContent = msg || 'Something went wrong.';
    body.appendChild(div);
  }

  // ==================== Open / Close ====================

  function openSurveyModal(elig) {
    return new Promise(function (resolve) {
      eligibility = elig || {};
      rating = 0;
      settled = false;
      resolveFn = resolve;

      var prompt = eligibility.prompt;
      if (!prompt || prompt === 'none') {
        resolve();
        return;
      }

      createModal();
      modal.style.display = 'flex';
      document.body.classList.add('survey-modal-open');

      if (prompt === 'satisfaction') {
        renderRateStep();
      } else if (/^referral_\d+$/.test(prompt)) {
        settled = true; // a nudge is not a survey to dismiss
        renderReferralStep(false);
        // Mark the milestone nudge as shown so it never fires again.
        try { window.api.invoke('survey:ack-prompt', { prompt_key: prompt, outcome: 'acked' }); } catch (e) { /* ignore */ }
      } else {
        closeModal();
      }
    });
  }

  function closeModal() {
    if (!modal) {
      if (resolveFn) { var r0 = resolveFn; resolveFn = null; r0(); }
      return;
    }
    // If the satisfaction survey was shown but never answered, record a
    // dismissal so it re-asks only after the cooldown (not on the next Done).
    if (eligibility.prompt === 'satisfaction' && !settled) {
      try { window.api.invoke('survey:ack-prompt', { prompt_key: 'satisfaction', outcome: 'dismissed' }); } catch (e) { /* ignore */ }
    }
    modal.remove();
    modal = null;
    document.body.classList.remove('survey-modal-open');
    if (resolveFn) { var r = resolveFn; resolveFn = null; r(); }
  }

  // ==================== Global API ====================

  window.openSurveyModal = openSurveyModal;
})();
