/**
 * Earn Free Credits — Rewards Hub (sidebar page) + sidebar next-milestone badge.
 *
 * Fetches referral data from the satisfaction-survey Edge Function (action=referral)
 * via the referral:get IPC handler and renders the gamified hub: milestone track,
 * next-goal hero, invite link, per-friend reward tower, and the friends-joined table.
 * Also keeps the compact "next milestone" badge in the sidebar in sync.
 *
 * No token logic — the reward is the existing signup-time referral pipeline; this only
 * displays it. Milestone math mirrors process_referral_signup_enhanced (the truth):
 *   per-friend: 1–5 = 100, 6–15 = 150, 16+ = 200
 *   one-time milestone bonus on reaching: 5 → +500, 10 → +1,000, 25 → +2,500
 */
(function () {
  'use strict';

  var REFERRAL_BASE = 'https://racetagger.cloud';
  var MILESTONES = [5, 10, 25];
  var BONUS = { 5: 500, 10: 1000, 25: 2500 };
  // Fixed track x-positions for the milestone nodes (0 → 5 → 10 → 25).
  var NODE_X = { 0: 0, 5: 40, 10: 70, 25: 100 };

  function fmt(n) { return (Number(n) || 0).toLocaleString('en-US'); }

  function ratePerFriend(n) { return n < 5 ? 100 : n < 15 ? 150 : 200; }

  function milestoneState(n) {
    n = Math.max(0, Number(n) || 0);
    var next = null;
    for (var i = 0; i < MILESTONES.length; i++) { if (MILESTONES[i] > n) { next = MILESTONES[i]; break; } }
    var rate = ratePerFriend(n);
    var remaining = next ? next - n : 0;
    return {
      n: n,
      next: next,
      bonus: next ? BONUS[next] : 0,
      remaining: remaining,
      rate: rate,
      referralsToNext: next ? remaining * rate : 0,
      inReach: next ? remaining * rate + BONUS[next] : 0,
    };
  }

  // Linear position (%) of the YOU marker along the fixed-node track.
  function positionOf(n) {
    if (n <= 0) return 0;
    if (n < 5) return (n / 5) * 40;
    if (n < 10) return 40 + ((n - 5) / 5) * 30;
    if (n < 25) return 70 + ((n - 10) / 15) * 30;
    return 100;
  }

  function nodeState(m, n, next) { return n >= m ? 'done' : (next === m ? 'next' : 'locked'); }

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
    try {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    } catch (e) {}
  }

  // ---- Renderers -------------------------------------------------------------

  function renderTrack(n) {
    var st = milestoneState(n);
    var fill = positionOf(n);
    var html = '<div class="rl-track-wrap">'
      + '<div class="rl-track-head"><span class="rl-track-title">Track to the finish</span>'
      + '<span class="rl-track-count"><b>' + fmt(n) + '</b> / 25 friends</span></div>'
      + '<div class="rl-track">'
      + '<div class="rl-rail"></div>'
      + '<div class="rl-fill" style="width:' + fill.toFixed(2) + '%;"></div>';

    // start node (0)
    html += '<div class="rl-node rl-node--done" style="left:0;">'
      + '<div class="rl-node-dot"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></div>'
      + '<div class="rl-node-num">0</div><div class="rl-node-cap">start</div></div>';

    // YOU marker (skip when exactly on a milestone or at 0 to avoid overlap)
    if (n > 0 && MILESTONES.indexOf(n) === -1) {
      html += '<div class="rl-node rl-node--you" style="left:' + fill.toFixed(2) + '%;">'
        + '<div class="rl-node-dot"></div>'
        + '<div class="rl-node-num">' + fmt(n) + '</div><div class="rl-node-cap">you</div></div>';
    }

    // milestone nodes 5 / 10 / 25
    MILESTONES.forEach(function (m) {
      var state = nodeState(m, n, st.next);
      var x = NODE_X[m];
      var inner;
      if (state === 'done') {
        inner = '<div class="rl-node-dot"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></div>';
      } else {
        inner = '<div class="rl-node-dot"><span class="rl-node-mn">' + m + '</span></div>';
      }
      var label;
      if (state === 'next') {
        label = '<div class="rl-next-tab">NEXT · +' + fmt(BONUS[m]) + '</div>';
      } else if (m === 25) {
        label = '<div class="rl-checker"></div><div class="rl-node-bonus">+' + fmt(BONUS[m]) + '</div>';
      } else {
        label = '<div class="rl-node-bonus">+' + fmt(BONUS[m]) + '</div>';
      }
      html += '<div class="rl-node rl-node--' + state + '" style="left:' + x + '%;">' + inner + label + '</div>';
    });

    html += '</div></div>';
    return html;
  }

  function renderHero(n) {
    var st = milestoneState(n);
    if (!st.next) {
      return '<div class="rl-hero is-done">'
        + '<svg viewBox="0 0 24 24"><path d="M4 22V2l16 6-16 6"/></svg>'
        + '<div><div class="rl-hero-title">You’ve hit every milestone.</div>'
        + '<div class="rl-hero-sub">From here you earn <span class="rl-mono rl-c-green">200</span> credits for every friend who signs up.</div></div></div>';
    }
    if (n === 0) {
      return '<div class="rl-hero">'
        + '<svg viewBox="0 0 24 24"><path d="M4 22V2l16 6-16 6"/></svg>'
        + '<div><div class="rl-hero-title"><span class="rl-mono rl-c-amber">5</span> friends to your first <span class="rl-mono rl-c-amber">+500</span> bonus.</div>'
        + '<div class="rl-hero-sub">Share your link to start — you earn <span class="rl-mono rl-c-blue">100</span> credits per friend, plus the bonus at 5.</div></div></div>';
    }
    return '<div class="rl-hero">'
      + '<svg viewBox="0 0 24 24"><path d="M4 22V2l16 6-16 6"/></svg>'
      + '<div><div class="rl-hero-title"><span class="rl-mono rl-c-amber">' + fmt(st.remaining) + '</span> more friend'
      + (st.remaining === 1 ? '' : 's') + ' to a <span class="rl-mono rl-c-amber">+' + fmt(st.bonus) + '</span> milestone bonus.</div>'
      + '<div class="rl-hero-sub">You’re at <span class="rl-mono rl-c-white">' + fmt(n) + ' of ' + st.next + '</span> — closer than you think. That’s '
      + '<span class="rl-mono rl-c-blue">' + fmt(st.referralsToNext) + '</span> credits from referrals plus the '
      + '<span class="rl-mono rl-c-green">' + fmt(st.bonus) + '</span> bonus — <span class="rl-mono rl-c-white" style="font-weight:700;">'
      + fmt(st.inReach) + ' credits</span> in reach.</div></div></div>';
  }

  function renderTower(n) {
    var bands = [
      { band: 'NOW · 1–5', lo: 0, hi: 5, val: 100 },
      { band: '6–15', lo: 5, hi: 15, val: 150 },
      { band: '16+', lo: 15, hi: Infinity, val: 200 },
    ];
    var rate = ratePerFriend(n);
    var cols = bands.map(function (b) {
      var isNow = b.val === rate;
      var bandLabel = isNow && b.band.indexOf('NOW') === -1 ? 'NOW · ' + b.band : b.band;
      return '<div class="rl-tower-col' + (isNow ? ' is-now' : '') + '">'
        + '<div class="rl-tower-band">' + bandLabel + '</div>'
        + '<div class="rl-tower-val">' + b.val + '<span> ea</span></div></div>';
    }).join('');
    return '<div class="rl-tower"><div class="rl-tower-head"><span class="t">Per-friend reward</span>'
      + '<span class="s">scales as you bring more</span></div><div class="rl-tower-cols">' + cols + '</div></div>';
  }

  function renderFriends(friends) {
    var list = Array.isArray(friends) ? friends : [];
    var countEl = document.getElementById('referral-friends-count');
    if (countEl) countEl.textContent = fmt(list.length);
    var body = document.getElementById('referral-friends-body');
    if (!body) return;
    if (list.length === 0) {
      body.innerHTML = '<div class="rl-empty">No friends yet. Share your link above to start earning.</div>';
      return;
    }
    var rows = list.map(function (f) {
      var who = f.name ? esc(f.name) : esc(f.email_masked || '—');
      var when = (f.joined_at || '').slice(0, 10);
      var credited = Number(f.credited) || 0;
      var pill = credited > 0
        ? '<span class="rl-pill-credited"><span class="dot"></span>+' + fmt(credited) + '</span>'
        : '<span class="rl-pill-credited"><span class="dot"></span>Joined</span>';
      return '<tr><td>' + who + '</td><td class="date">' + esc(when) + '</td><td class="r">' + pill + '</td></tr>';
    }).join('');
    body.innerHTML = '<table class="rl-friends-table"><thead><tr>'
      + '<th>Photographer</th><th>Joined</th><th class="r">Status</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderSidebarBadge(n) {
    var el = document.getElementById('referral-nav-badge');
    if (!el) return;
    var st = milestoneState(n);
    if (!st.next) { el.style.display = 'none'; return; } // all milestones done → no "next"
    var pct = st.next > 0 ? Math.min(100, Math.round((n / st.next) * 100)) : 0;
    el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 22V2l16 6-16 6"/></svg>'
      + '<div class="rl-badge-body"><div class="rl-badge-label">Next milestone</div>'
      + '<div class="rl-badge-nums"><span class="rl-badge-prog">' + fmt(n) + '/' + st.next + '</span>'
      + '<span class="rl-badge-arrow">→</span><span class="rl-badge-bonus">+' + fmt(st.bonus) + '</span></div>'
      + '<div class="rl-badge-bar"><i style="width:' + pct + '%;"></i></div></div>';
    el.style.display = 'flex';
    if (!el.dataset.bound) {
      el.dataset.bound = '1';
      el.addEventListener('click', function () {
        var a = document.querySelector('.nav-item[data-section="referral"]');
        if (a) a.click();
      });
    }
  }

  // ---- Data ------------------------------------------------------------------

  function applyData(data) {
    var n = Number(data.total_referrals) || 0;

    var creditsEl = document.getElementById('referral-credits-count');
    if (creditsEl) creditsEl.textContent = fmt(data.bonus_tokens);

    var trackWrap = document.getElementById('referral-track-wrap');
    if (trackWrap) trackWrap.innerHTML = renderTrack(n);

    var heroEl = document.getElementById('referral-hero');
    if (heroEl) heroEl.innerHTML = renderHero(n);

    var towerEl = document.getElementById('referral-tower');
    if (towerEl) towerEl.innerHTML = renderTower(n);

    var linkEl = document.getElementById('referral-invite-link');
    if (linkEl) linkEl.textContent = inviteUrl(data);

    renderFriends(data.friends);
    renderSidebarBadge(n);
    bindCopy();
  }

  function bindCopy() {
    var copyBtn = document.getElementById('referral-copy-btn');
    var linkEl = document.getElementById('referral-invite-link');
    if (!copyBtn || !linkEl || copyBtn.dataset.bound) return;
    copyBtn.dataset.bound = '1';
    var labelEl = copyBtn.querySelector('.rl-copy-label') || copyBtn;
    copyBtn.addEventListener('click', function () {
      copyText(linkEl.textContent || '');
      var original = labelEl.textContent;
      labelEl.textContent = 'Copied';
      copyBtn.classList.add('copied');
      setTimeout(function () { labelEl.textContent = original; copyBtn.classList.remove('copied'); }, 1600);
    });
  }

  async function fetchData() {
    try {
      var res = await window.api.invoke('referral:get');
      if (res && res.success && res.data) return res.data;
    } catch (e) { console.error('[Referral] fetch failed:', e); }
    return null;
  }

  // Full page render (on visiting the page).
  async function initialize() {
    if (!document.getElementById('referral-track-wrap')) return;
    var data = await fetchData();
    if (!data) {
      var linkEl = document.getElementById('referral-invite-link');
      if (linkEl) linkEl.textContent = 'Could not load your invite link. Check your connection.';
      return;
    }
    applyData(data);
  }

  // Keep the sidebar badge fresh even when the user never opens the page.
  // Retries a few times after load until auth is ready (referral:get needs a session).
  var sidebarTries = 0;
  async function bootstrapSidebar() {
    if (!document.getElementById('referral-nav-badge')) return;
    var data = await fetchData();
    if (data) { renderSidebarBadge(Number(data.total_referrals) || 0); return; }
    if (sidebarTries++ < 5) setTimeout(bootstrapSidebar, 4000);
  }

  window.ReferralPage = { initialize: initialize, refreshSidebarBadge: bootstrapSidebar };

  window.addEventListener('page-loaded', function (e) {
    if (e && e.detail && e.detail.page === 'referral') initialize();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(bootstrapSidebar, 1500); });
  } else {
    setTimeout(bootstrapSidebar, 1500);
  }
})();
