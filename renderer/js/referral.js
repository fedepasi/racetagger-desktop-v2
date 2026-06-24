/**
 * Earn Free Credits — Rewards Hub (v2) + sidebar next-milestone badge.
 *
 * Full-width, two columns: grouped progress/scores on the left, the editable
 * referral CODE (purple) on the right. Friends-joined table shows email + per-friend
 * credits + milestone rows. The user can edit their referral code (referral:set-handle).
 *
 * No token logic — only displays the existing signup-time referral rewards. Milestone
 * math mirrors process_referral_signup_enhanced:
 *   per-friend: 1–5 = 100, 6–15 = 150, 16+ = 200
 *   one-time milestone bonus on reaching: 5 → +500, 10 → +1,000, 25 → +2,500
 */
(function () {
  'use strict';

  var REFERRAL_BASE = 'https://racetagger.cloud';
  var MILESTONES = [5, 10, 25];
  var BONUS = { 5: 500, 10: 1000, 25: 2500 };
  var NODE_X = { 0: 0, 5: 40, 10: 70, 25: 100 };
  var HANDLE_RE = /^[a-z0-9][a-z0-9-]{2,30}[a-z0-9]$/;

  var currentData = null;

  function fmt(n) { return (Number(n) || 0).toLocaleString('en-US'); }
  function ratePerFriend(n) { return n < 5 ? 100 : n < 15 ? 150 : 200; }

  function milestoneState(n) {
    n = Math.max(0, Number(n) || 0);
    var next = null;
    for (var i = 0; i < MILESTONES.length; i++) { if (MILESTONES[i] > n) { next = MILESTONES[i]; break; } }
    var rate = ratePerFriend(n);
    var remaining = next ? next - n : 0;
    return { n: n, next: next, bonus: next ? BONUS[next] : 0, remaining: remaining, rate: rate,
      referralsToNext: next ? remaining * rate : 0, inReach: next ? remaining * rate + BONUS[next] : 0 };
  }

  function positionOf(n) {
    if (n <= 0) return 0;
    if (n < 5) return (n / 5) * 40;
    if (n < 10) return 40 + ((n - 5) / 5) * 30;
    if (n < 25) return 70 + ((n - 10) / 15) * 30;
    return 100;
  }
  function nodeState(m, n, next) { return n >= m ? 'done' : (next === m ? 'next' : 'lock'); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function inviteUrl(data) {
    if (data && data.referral_slug) return REFERRAL_BASE + '/r/' + data.referral_slug;
    if (data && data.referral_code) return REFERRAL_BASE + '/?ref=' + encodeURIComponent(data.referral_code);
    return REFERRAL_BASE + '/';
  }

  function copyText(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); return; } } catch (e) {}
    try { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch (e) {}
  }

  // ---- Scores cluster (track + hero + tower) -------------------------------
  function scoreboxHtml(n) {
    var st = milestoneState(n);
    var fill = positionOf(n);

    var track = '<div class="rl-track-head"><span class="rl-track-title">Track to the finish</span>'
      + '<span class="rl-track-count"><b>' + fmt(n) + '</b> / 25 friends</span></div>'
      + '<div class="rl-track"><div class="rl-rail"></div><div class="rl-fill" style="width:' + fill.toFixed(2) + '%;"></div>';
    track += '<div class="rl-node" style="left:0;"><div class="rl-nd done"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></div><div class="rl-nnum">0</div><div class="rl-ncap">start</div></div>';
    if (n > 0 && MILESTONES.indexOf(n) === -1) {
      track += '<div class="rl-node" style="left:' + fill.toFixed(2) + '%;"><div class="rl-nd you"></div><div class="rl-nnum you">' + fmt(n) + '</div><div class="rl-ncap you">you</div></div>';
    }
    MILESTONES.forEach(function (m) {
      var s = nodeState(m, n, st.next);
      var inner = s === 'done' ? '<div class="rl-nd done"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></div>' : '<div class="rl-nd ' + s + '">' + m + '</div>';
      var label;
      if (s === 'next') label = '<div class="rl-ntab">NEXT · +' + fmt(BONUS[m]) + '</div>';
      else if (m === 25) label = '<div class="rl-checker"></div><div class="rl-nbonus">+' + fmt(BONUS[m]) + '</div>';
      else label = '<div class="rl-nbonus">+' + fmt(BONUS[m]) + '</div>';
      var doneMs = (m === 25 && n >= 25) ? ' done-ms' : '';
      track += '<div class="rl-node' + doneMs + '" style="left:' + NODE_X[m] + '%;">' + inner + label + '</div>';
    });
    track += '</div>';

    var hero;
    if (!st.next) {
      hero = '<div class="rl-hero is-done"><svg viewBox="0 0 24 24"><path d="M4 22V2l16 6-16 6"/></svg>'
        + '<div><div class="rl-hero-title">You’ve hit every milestone.</div>'
        + '<div class="rl-hero-sub">From here you earn <span class="rl-mono rl-cG">200</span> credits for every friend who signs up.</div></div></div>';
    } else if (n === 0) {
      hero = '<div class="rl-hero"><svg viewBox="0 0 24 24"><path d="M4 22V2l16 6-16 6"/></svg>'
        + '<div><div class="rl-hero-title"><span class="rl-mono rl-cA">5</span> friends to your first <span class="rl-mono rl-cA">+500</span> bonus.</div>'
        + '<div class="rl-hero-sub">Share your link to start — <span class="rl-mono rl-cB">100</span> credits per friend, plus the bonus at 5.</div></div></div>';
    } else {
      hero = '<div class="rl-hero"><svg viewBox="0 0 24 24"><path d="M4 22V2l16 6-16 6"/></svg>'
        + '<div><div class="rl-hero-title"><span class="rl-mono rl-cA">' + fmt(st.remaining) + '</span> more friend' + (st.remaining === 1 ? '' : 's') + ' to a <span class="rl-mono rl-cA">+' + fmt(st.bonus) + '</span> milestone bonus.</div>'
        + '<div class="rl-hero-sub">You’re at <span class="rl-mono rl-cW">' + fmt(n) + ' of ' + st.next + '</span> — that’s <span class="rl-mono rl-cB">' + fmt(st.referralsToNext) + '</span> from referrals plus the <span class="rl-mono rl-cG">' + fmt(st.bonus) + '</span> bonus, <span class="rl-mono rl-cW" style="font-weight:700;">' + fmt(st.inReach) + ' credits</span> in reach.</div></div></div>';
    }

    var rate = ratePerFriend(n);
    var bands = [{ b: '1–5', v: 100 }, { b: '6–15', v: 150 }, { b: '16+', v: 200 }];
    var cols = bands.map(function (x) {
      var now = x.v === rate;
      return '<div class="rl-tw' + (now ? ' is-now' : '') + '"><div class="rl-twb">' + (now ? 'NOW · ' : '') + x.b + '</div><div class="rl-twv">' + x.v + '<span> ea</span></div></div>';
    }).join('');
    var tower = '<div class="rl-tower"><div class="rl-twh"><span class="t">Per-friend reward</span><span class="s">scales as you bring more</span></div><div class="rl-twc">' + cols + '</div></div>';

    return '<div class="rl-scorebox">' + track + hero + tower + '</div>';
  }

  // ---- Friends table (with email + milestone rows) -------------------------
  function renderFriends(friends, n) {
    var list = Array.isArray(friends) ? friends : [];
    var countEl = document.getElementById('referral-friends-count');
    if (countEl) countEl.textContent = fmt(list.length);
    var metaEl = document.getElementById('referral-friends-meta');
    if (metaEl) {
      var earned = (currentData && Number(currentData.referral_credits_earned)) || list.reduce(function (s, f) { return s + (Number(f.credited) || 0); }, 0);
      metaEl.innerHTML = '<b>' + fmt(list.length) + '</b> joined · <b>+' + fmt(earned) + '</b> earned';
    }
    var body = document.getElementById('referral-friends-body');
    if (!body) return;
    if (list.length === 0) {
      body.innerHTML = '<div class="rl-empty">No friends yet. Share your link to start earning.</div>';
      return;
    }
    var rows = list.map(function (f) {
      var who = f.name ? esc(f.name) : esc(f.email_masked || '—');
      var mail = f.name ? esc(f.email_masked || '') : '';
      var when = (f.joined_at || '').slice(0, 10);
      var credited = Number(f.credited) || 0;
      return '<tr><td>' + who + '</td><td class="email">' + mail + '</td><td class="date">' + esc(when) + '</td>'
        + '<td class="r"><span class="rl-credp">+' + fmt(credited) + '</span></td></tr>';
    });
    // Milestone rows: reached ones (green) + the next one (amber). Skip far-future.
    var st = milestoneState(n);
    MILESTONES.forEach(function (m) {
      if (n >= m) {
        rows.push('<tr class="rl-msrow reached"><td>🏁 Milestone — ' + m + ' friends</td><td class="email">—</td><td class="date">reached</td><td class="r"><span class="rl-credp">+' + fmt(BONUS[m]) + '</span></td></tr>');
      } else if (m === st.next) {
        rows.push('<tr class="rl-msrow"><td>🏁 Milestone — ' + m + ' friends</td><td class="email">—</td><td class="date">upcoming</td><td class="r"><span class="rl-credp">+' + fmt(BONUS[m]) + '</span></td></tr>');
      }
    });
    body.innerHTML = '<table class="rl-friends-table"><thead><tr><th>Photographer</th><th>Email</th><th>Joined</th><th class="r">Earned</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }

  function renderSidebarBadge(n) {
    var el = document.getElementById('referral-nav-badge');
    if (!el) return;
    var st = milestoneState(n);
    if (!st.next) { el.style.display = 'none'; return; }
    var pct = st.next > 0 ? Math.min(100, Math.round((n / st.next) * 100)) : 0;
    el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 22V2l16 6-16 6"/></svg>'
      + '<div class="rl-badge-body"><div class="rl-badge-label">Next milestone</div>'
      + '<div class="rl-badge-nums"><span class="rl-badge-prog">' + fmt(n) + '/' + st.next + '</span>'
      + '<span class="rl-badge-arrow">→</span><span class="rl-badge-bonus">+' + fmt(st.bonus) + '</span></div>'
      + '<div class="rl-badge-bar"><i style="width:' + pct + '%;"></i></div></div>';
    el.style.display = 'flex';
    if (!el.dataset.bound) {
      el.dataset.bound = '1';
      el.addEventListener('click', function () { var a = document.querySelector('.nav-item[data-section="referral"]'); if (a) a.click(); });
    }
  }

  // ---- Apply + bind --------------------------------------------------------
  function applyData(data) {
    currentData = data;
    var n = Number(data.total_referrals) || 0;

    var creditsEl = document.getElementById('referral-credits-count');
    var earned = (data.referral_credits_earned != null) ? data.referral_credits_earned : data.bonus_tokens;
    if (creditsEl) creditsEl.textContent = fmt(earned);

    var box = document.getElementById('referral-scorebox');
    if (box) box.innerHTML = scoreboxHtml(n);

    var codeVal = document.getElementById('referral-code-value');
    if (codeVal) codeVal.textContent = data.referral_slug || data.referral_code || '—';

    var linkEl = document.getElementById('referral-invite-link');
    if (linkEl) linkEl.textContent = inviteUrl(data);

    renderFriends(data.friends, n);
    renderSidebarBadge(n);
    bindCopy();
    bindEdit();
  }

  function bindCopy() {
    var copyBtn = document.getElementById('referral-copy-btn');
    var linkEl = document.getElementById('referral-invite-link');
    if (!copyBtn || !linkEl || copyBtn.dataset.bound) return;
    copyBtn.dataset.bound = '1';
    var labelEl = copyBtn.querySelector('.rl-copy-label') || copyBtn;
    copyBtn.addEventListener('click', function () {
      copyText(linkEl.textContent || '');
      var o = labelEl.textContent; labelEl.textContent = 'Copied'; copyBtn.classList.add('copied');
      setTimeout(function () { labelEl.textContent = o; copyBtn.classList.remove('copied'); }, 1600);
    });
  }

  function bindEdit() {
    var editBtn = document.getElementById('referral-edit-btn');
    if (!editBtn || editBtn.dataset.bound) return;
    editBtn.dataset.bound = '1';

    var valEl = document.getElementById('referral-code-value');
    var input = document.getElementById('referral-code-input');
    var saveBtn = document.getElementById('referral-save-btn');
    var cancelBtn = document.getElementById('referral-cancel-btn');
    var msg = document.getElementById('referral-code-msg');

    function setMode(editing) {
      valEl.style.display = editing ? 'none' : '';
      input.style.display = editing ? '' : 'none';
      editBtn.style.display = editing ? 'none' : '';
      saveBtn.style.display = editing ? '' : 'none';
      cancelBtn.style.display = editing ? '' : 'none';
      if (!editing) { msg.textContent = ''; msg.className = 'rl-code-msg'; }
    }
    function validate() {
      var v = input.value.trim().toLowerCase();
      var ok = HANDLE_RE.test(v) && v !== (currentData && currentData.referral_slug);
      saveBtn.disabled = !ok;
      if (input.value && !HANDLE_RE.test(v)) { msg.textContent = '4–32 lowercase letters, numbers and hyphens.'; msg.className = 'rl-code-msg err'; }
      else { msg.textContent = ''; msg.className = 'rl-code-msg'; }
    }

    editBtn.addEventListener('click', function () {
      input.value = (currentData && currentData.referral_slug) || '';
      setMode(true); validate(); input.focus(); input.select();
    });
    cancelBtn.addEventListener('click', function () { setMode(false); });
    input.addEventListener('input', validate);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !saveBtn.disabled) saveBtn.click(); if (e.key === 'Escape') cancelBtn.click(); });

    saveBtn.addEventListener('click', async function () {
      var v = input.value.trim().toLowerCase();
      if (!HANDLE_RE.test(v)) return;
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        var res = await window.api.invoke('referral:set-handle', { handle: v });
        if (res && res.success && res.data && res.data.referral_slug) {
          currentData.referral_slug = res.data.referral_slug;
          valEl.textContent = res.data.referral_slug;
          var linkEl = document.getElementById('referral-invite-link');
          if (linkEl) linkEl.textContent = inviteUrl(currentData);
          setMode(false);
          msg.textContent = '✓ Saved — old links keep working.'; msg.className = 'rl-code-msg ok';
          setTimeout(function () { if (msg.className.indexOf('ok') !== -1) { msg.textContent = ''; msg.className = 'rl-code-msg'; } }, 3000);
        } else {
          msg.textContent = (res && res.error) ? res.error : 'Could not save. Try another code.';
          msg.className = 'rl-code-msg err';
        }
      } catch (e) {
        msg.textContent = 'Could not reach RaceTagger. Check your connection.'; msg.className = 'rl-code-msg err';
      } finally {
        saveBtn.textContent = 'Save'; validate();
      }
    });
  }

  async function fetchData() {
    try { var res = await window.api.invoke('referral:get'); if (res && res.success && res.data) return res.data; }
    catch (e) { console.error('[Referral] fetch failed:', e); }
    return null;
  }

  async function initialize() {
    if (!document.getElementById('referral-scorebox')) return;
    var data = await fetchData();
    if (!data) {
      var linkEl = document.getElementById('referral-invite-link');
      if (linkEl) linkEl.textContent = 'Could not load your invite link. Check your connection.';
      return;
    }
    applyData(data);
  }

  var sidebarTries = 0;
  async function bootstrapSidebar() {
    if (!document.getElementById('referral-nav-badge')) return;
    var data = await fetchData();
    if (data) { currentData = currentData || data; renderSidebarBadge(Number(data.total_referrals) || 0); return; }
    if (sidebarTries++ < 5) setTimeout(bootstrapSidebar, 4000);
  }

  window.ReferralPage = { initialize: initialize, refreshSidebarBadge: bootstrapSidebar };
  window.addEventListener('page-loaded', function (e) { if (e && e.detail && e.detail.page === 'referral') initialize(); });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(bootstrapSidebar, 1500); });
  } else { setTimeout(bootstrapSidebar, 1500); }
})();
