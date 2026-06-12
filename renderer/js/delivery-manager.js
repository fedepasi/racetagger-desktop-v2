/**
 * Delivery Manager - Client-side logic for the Delivery page
 * Handles projects, galleries, and delivery rules.
 */
(function() {
  'use strict';

  let planLimits = null;
  let galleries = [];
  let projects = [];
  let selectedProjectId = null;

  // ── Inline SVG icons (Tabler/Feather-style, MIT). The desktop renderer has no
  //    icon font, so the brand-aligned UI uses these instead of emoji. ──────────
  var DL_ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9z"/>',
    lock: '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3"/><path d="M16 7l3 3"/><path d="M14 9l2 2"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    arrowUp: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M3 12h18"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="8" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 4.13a4 4 0 0 1 0 7.75"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/>',
    cloudUp: '<path d="M20 17.5a4.5 4.5 0 0 0-2-8.5h-1.3A7 7 0 1 0 5 16"/><path d="M12 12v9"/><path d="M8 16l4-4 4 4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    eyeOff: '<path d="M17 17A10 10 0 0 1 12 19c-7 0-11-7-11-7a18 18 0 0 1 5-5"/><path d="M9.9 4.2A10 10 0 0 1 12 4c7 0 11 7 11 7a18 18 0 0 1-2.3 3.3"/><path d="M1 1l22 22"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 5L2 7"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    play: '<path d="M6 4l14 8-14 8z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  };

  function dlIcon(name, size) {
    var inner = DL_ICONS[name] || '';
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  // Rotating livery-stripe colours (the "each gallery has its own livery" motif)
  var DL_STRIPES = ['blue', 'amber', 'green', 'purple'];
  var DL_AVATAR = [
    { bg: 'rgba(26,158,224,0.16)', fg: '#1a9ee0' },
    { bg: 'rgba(167,139,250,0.16)', fg: '#a78bfa' },
    { bg: 'rgba(16,185,129,0.16)', fg: '#10b981' },
    { bg: 'rgba(245,158,11,0.16)', fg: '#f59e0b' },
  ];

  function dlInitials(name) {
    var parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // Toast helper — uses the canonical global toast (toast.js), falls back to alert().
  function dlNotify(message, type) {
    if (typeof window.showToast === 'function') window.showToast(message, type);
    else alert(message);
  }

  // Init on page load
  window.addEventListener('page-loaded', async (e) => {
    if (e.detail && e.detail.page === 'delivery') {
      await init();
    }
  });

  // Show/hide nav on any page load
  document.addEventListener('page-loaded', async () => {
    await checkNavVisibility();
  });

  // Check on app start too
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkNavVisibility, 1500);
  });

  async function checkNavVisibility() {
    try {
      if (!window.api || !window.api.invoke) return;
      // Always show the Delivery nav — if not enabled, it shows the interest survey
      var nav = document.getElementById('nav-delivery');
      if (nav) nav.style.display = '';
    } catch (e) {
      console.error('[Delivery] Nav check failed:', e);
    }
  }

  async function init() {
    console.log('[Delivery] Initializing delivery page...');

    try {
      var result = await window.api.invoke('delivery-get-plan-limits');
      if (result && result.success) {
        planLimits = result.data;
        console.log('[Delivery] Plan limits:', planLimits);
      }
    } catch (e) {
      console.error('[Delivery] Failed to load plan limits:', e);
    }

    var galleriesSection = document.getElementById('delivery-galleries-section');
    var projectsSection = document.getElementById('delivery-projects-section');
    var surveySection = document.getElementById('delivery-interest-survey');

    if (!planLimits || !planLimits.gallery_enabled) {
      // Feature not enabled — show interest survey instead
      if (surveySection) {
        surveySection.style.display = 'block';
        initSurvey();
      }
      return;
    }

    if (galleriesSection) galleriesSection.style.display = 'block';
    if (projectsSection && planLimits.projects_enabled) projectsSection.style.display = 'block';

    // Show HD uploads section if R2 is enabled
    if (planLimits.r2_storage_enabled) {
      var uploadsSection = document.getElementById('delivery-uploads-section');
      if (uploadsSection) uploadsSection.style.display = 'block';
      loadR2ExecutionStatus();
    }

    await loadGalleries();
    if (planLimits.projects_enabled) await loadProjects();
    bindEvents();

    // Bind R2 refresh button
    var btnRefresh = document.getElementById('btn-refresh-r2-status');
    if (btnRefresh) btnRefresh.addEventListener('click', loadR2ExecutionStatus);
  }

  async function loadGalleries() {
    try {
      const result = await window.api.invoke('delivery-get-galleries');
      if (result && result.success) galleries = result.data || [];
      renderGalleries();
    } catch (e) {
      console.error('[Delivery] Failed to load galleries:', e);
    }
  }

  async function loadProjects() {
    try {
      const result = await window.api.invoke('delivery-get-projects');
      if (result && result.success) projects = result.data || [];
      renderProjects();
    } catch (e) {
      console.error('[Delivery] Failed to load projects:', e);
    }
  }

  function renderGalleries() {
    const grid = document.getElementById('galleries-grid');
    const empty = document.getElementById('galleries-empty');
    const countEl = document.getElementById('galleries-count');
    const head = document.getElementById('delivery-galleries-head');
    if (!grid) return;

    if (countEl) countEl.textContent = galleries.length;

    if (galleries.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.style.display = 'block';
      if (head) head.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (head) head.style.display = 'flex';

    grid.innerHTML = galleries.map(function(g, i) {
      var isLive = g.status === 'published';
      var stripe = DL_STRIPES[i % DL_STRIPES.length];
      var photoCount = g.image_count != null ? g.image_count
        : (g.gallery_image_count != null ? g.gallery_image_count
        : (g.photo_count != null ? g.photo_count : null));

      // Honest chips: only render what the gallery object actually carries.
      var chips = '';
      chips += g.access_type === 'unrestricted'
        ? '<span class="dl-chip dl-chip--neutral">' + dlIcon('globe', 13) + 'Public</span>'
        : '<span class="dl-chip dl-chip--neutral">' + dlIcon('lock', 13) + 'Code</span>';
      // HD status — render only when the gallery object exposes it (data wiring is Phase C).
      if (g.original_upload_status === 'completed' || g.hd_status === 'completed') {
        chips += '<span class="dl-chip dl-chip--green">' + dlIcon('check', 13) + 'HD ready</span>';
      } else if (g.hd_pending != null && g.hd_total != null) {
        chips += '<span class="dl-chip dl-chip--amber">' + dlIcon('arrowUp', 13) + 'HD <b class="dl-num" style="font-weight:700">' + g.hd_pending + '/' + g.hd_total + '</b></span>';
      }
      var clientName = g.client_name || g.project_name;
      if (clientName) {
        chips += '<span class="dl-chip dl-chip--neutral">' + dlIcon('briefcase', 13) + escapeHtml(clientName) + '</span>';
      }

      var statsHtml = '';
      if (photoCount != null) {
        statsHtml += '<span><b>' + photoCount + '</b> photos</span>';
      }
      statsHtml += '<span>' + dlIcon('eye', 13) + ' <b>' + (g.total_views || 0) + '</b></span>';
      statsHtml += '<span>' + dlIcon('download', 13) + ' <b>' + (g.total_downloads || 0) + '</b></span>';

      return '<div class="dl-card" data-id="' + g.id + '">' +
        '<div class="dl-card__stripe dl-card__stripe--' + stripe + '"></div>' +
        '<div class="dl-card__body">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;">' +
            '<h4 class="dl-card__title">' + escapeHtml(g.title) + '</h4>' +
            '<span class="dl-pill ' + (isLive ? 'dl-pill--live' : 'dl-pill--draft') + '"><span class="dl-pill__dot"></span>' + (isLive ? 'Live' : 'Draft') + '</span>' +
          '</div>' +
          '<div class="dl-card__stats dl-num" style="margin-bottom:10px;">' + statsHtml + '</div>' +
          (g.slug ? '<div class="dl-card__url dl-num" style="margin-bottom:11px;">photos.racetagger.cloud/' + escapeHtml(g.slug) + '</div>' : '') +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + chips + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    grid.querySelectorAll('.dl-card').forEach(function(card) {
      card.addEventListener('click', function() { openGalleryDetail(this.dataset.id); });
    });
  }

  function renderProjects() {
    var grid = document.getElementById('projects-grid');
    var countEl = document.getElementById('projects-count');
    if (!grid) return;

    if (countEl) countEl.textContent = projects.length;

    if (projects.length === 0) {
      grid.innerHTML = '<div style="color: var(--text-muted); font-size: 12px;">No clients yet — add one to group galleries by team or sponsor.</div>';
      return;
    }

    grid.innerHTML = projects.map(function(p, i) {
      var galCount = p.galleries ? p.galleries.length : 0;
      var av = DL_AVATAR[i % DL_AVATAR.length];
      return '<span class="dl-client-chip" data-id="' + p.id + '">' +
        '<span class="dl-client-chip__avatar" style="background:' + av.bg + ';color:' + av.fg + ';">' + escapeHtml(dlInitials(p.name)) + '</span>' +
        '<span style="font-size:12px;color:var(--text-primary);">' + escapeHtml(p.name) + '</span>' +
        '<span class="dl-num" style="font-size:11px;color:var(--text-muted);">' + galCount + '</span>' +
      '</span>';
    }).join('');

    grid.querySelectorAll('.dl-client-chip').forEach(function(card) {
      card.addEventListener('click', function() { openProjectDetail(this.dataset.id); });
    });
  }

  async function openProjectDetail(projectId) {
    selectedProjectId = projectId;
    document.getElementById('delivery-galleries-section').style.display = 'none';
    document.getElementById('delivery-projects-section').style.display = 'none';
    var pageHeader = document.getElementById('delivery-page-header');
    if (pageHeader) pageHeader.style.display = 'none';
    var uploadsSection = document.getElementById('delivery-uploads-section');
    if (uploadsSection) {
      uploadsSection.dataset.wasVisible = uploadsSection.style.display !== 'none' ? '1' : '0';
      uploadsSection.style.display = 'none';
    }
    document.getElementById('delivery-project-detail').style.display = 'block';

    try {
      var result = await window.api.invoke('delivery-get-project', projectId);
      if (!result || !result.success) return;
      var project = result.data;

      var clientTypeIcons = { team: '🏎️', sponsor: '💰', organizer: '🏟️', media: '📷', other: '📋' };
      var typeIcon = clientTypeIcons[project.client_type] || '📋';
      var metaLine = [];
      if (project.client_type) metaLine.push('<span style="text-transform: capitalize;">' + escapeHtml(project.client_type) + '</span>');
      if (project.client_contact_email) metaLine.push('<span>✉ ' + escapeHtml(project.client_contact_email) + '</span>');

      document.getElementById('project-detail-header').innerHTML =
        '<h2 style="color: var(--text-primary); font-size: 20px; font-weight: 700; margin: 0 0 6px;">' + typeIcon + ' ' + escapeHtml(project.name) + '</h2>' +
        (metaLine.length > 0 ? '<div style="display: flex; align-items: center; gap: 10px; color: var(--text-muted); font-size: 12px; flex-wrap: wrap;">' + metaLine.join('') + '</div>' : '');

      // Render client galleries
      var pgGrid = document.getElementById('project-galleries-grid');
      var projectGalleries = project.galleries || [];
      pgGrid.innerHTML = projectGalleries.length === 0
        ? '<div style="color: var(--text-muted); font-size: 13px;">No galleries for this client yet.</div>'
        : projectGalleries.map(function(g) {
            var dateStr = g.event_date ? g.event_date : '';
            var seasonBadge = g.season ? '<span style="font-size: 10px; padding: 2px 8px; border-radius: 12px; background: rgba(99,102,241,0.15); color: #818cf8; font-weight: 600;">' + escapeHtml(g.season) + '</span>' : '';
            var slugLine = g.slug ? '<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px; font-family: Monaco, monospace; opacity: 0.7;">photos.racetagger.cloud/' + escapeHtml(g.slug) + '</div>' : '';
            return '<div style="background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px;">' +
              '<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">' +
                '<h5 style="color: var(--text-primary); font-size: 13px; margin: 0;">' + escapeHtml(g.title) + '</h5>' +
                seasonBadge +
              '</div>' +
              '<div style="color: var(--text-muted); font-size: 11px;">' +
                (dateStr ? '📅 ' + dateStr + ' • ' : '') +
                '👁 ' + (g.total_views || 0) + ' • ⬇ ' + (g.total_downloads || 0) +
              '</div>' +
              slugLine +
            '</div>';
          }).join('');

      // Shareable links — auto-generate slug if missing
      if (!project.client_slug) {
        try {
          var slugResult = await window.api.invoke('delivery-set-client-slug', {
            projectId: projectId,
            clientName: project.client_name || project.name || 'client'
          });
          if (slugResult && slugResult.success) {
            project.client_slug = slugResult.data;
          }
        } catch (e) { console.warn('[Delivery] Auto-slug generation failed:', e); }
      }
      renderShareableLinks(project);

      // Client users (access credentials)
      loadClientUsers(projectId);

      // Delivery rules — hidden from client detail since rules are auto-generated from presets.
      // The section remains in the DOM for potential future "advanced" toggle.
      document.getElementById('delivery-rules-section').style.display = 'none';
    } catch (e) {
      console.error('[Delivery] Failed to load project:', e);
    }
  }

  function closeProjectDetail() {
    selectedProjectId = null;
    document.getElementById('delivery-project-detail').style.display = 'none';
    var pageHeader = document.getElementById('delivery-page-header');
    if (pageHeader) pageHeader.style.display = '';
    document.getElementById('delivery-galleries-section').style.display = 'block';
    if (planLimits && planLimits.projects_enabled) {
      document.getElementById('delivery-projects-section').style.display = 'block';
    }
    // Restore uploads section (was hidden when entering client detail)
    var uploadsSection = document.getElementById('delivery-uploads-section');
    if (uploadsSection && uploadsSection.dataset.wasVisible === '1') {
      uploadsSection.style.display = 'block';
    }
  }

  function showModal(id) {
    var m = document.getElementById(id);
    if (m) m.style.display = 'flex';
  }

  function hideModal(id) {
    var m = document.getElementById(id);
    if (m) m.style.display = 'none';
  }

  function bindEvents() {
    // Gallery modal
    var btnCreateGallery = document.getElementById('btn-create-gallery');
    if (btnCreateGallery) btnCreateGallery.addEventListener('click', function() { showModal('modal-create-gallery'); });

    var btnCancelGallery = document.getElementById('btn-cancel-gallery');
    if (btnCancelGallery) btnCancelGallery.addEventListener('click', function() { hideModal('modal-create-gallery'); });

    var btnSaveGallery = document.getElementById('btn-save-gallery');
    if (btnSaveGallery) btnSaveGallery.addEventListener('click', async function() {
      var title = document.getElementById('input-gallery-title').value.trim();
      var access = document.getElementById('input-gallery-access').value || 'unrestricted';
      var gallerySeason = document.getElementById('input-gallery-season').value.trim();
      var galleryEventDate = document.getElementById('input-gallery-event-date').value || null;
      if (!title) return;
      try {
        var galleryData = {
          title: title,
          access_type: access,
          gallery_type: access === 'unrestricted' ? 'open' : 'private',
          season: gallerySeason || null,
          event_date: galleryEventDate
        };
        // If we're inside a project, associate the gallery
        if (selectedProjectId) {
          galleryData.project_id = selectedProjectId;
        }
        var result = await window.api.invoke('delivery-create-gallery', galleryData);
        if (result && result.success) {
          hideModal('modal-create-gallery');
          document.getElementById('input-gallery-title').value = '';
          var seasonInput = document.getElementById('input-gallery-season');
          if (seasonInput) seasonInput.value = '';
          var dateInput = document.getElementById('input-gallery-event-date');
          if (dateInput) dateInput.value = '';
          await loadGalleries();
          // Refresh project detail if we were inside one
          if (selectedProjectId) {
            await openProjectDetail(selectedProjectId);
          }
          dlNotify('Gallery "' + title + '" created.', 'success');
        } else {
          dlNotify('Couldn\'t create the gallery: ' + (result ? result.error : 'unknown error'), 'error');
        }
      } catch (e) {
        dlNotify('Couldn\'t create the gallery.', 'error');
      }
    });

    // Project modal
    var btnCreateProject = document.getElementById('btn-create-project');
    if (btnCreateProject) btnCreateProject.addEventListener('click', function() { showModal('modal-create-project'); });

    var btnCancelProject = document.getElementById('btn-cancel-project');
    if (btnCancelProject) btnCancelProject.addEventListener('click', function() { hideModal('modal-create-project'); });

    var btnSaveProject = document.getElementById('btn-save-project');
    if (btnSaveProject) btnSaveProject.addEventListener('click', async function() {
      var name = document.getElementById('input-project-name').value.trim();
      var clientType = document.getElementById('input-project-client-type').value || 'team';
      var contactEmail = document.getElementById('input-project-email').value.trim();
      if (!name) return;
      try {
        var result = await window.api.invoke('delivery-create-project', {
          name: name,
          client_name: name,
          client_type: clientType,
          client_contact_email: contactEmail || null
        });
        if (result && result.success) {
          hideModal('modal-create-project');
          ['input-project-name', 'input-project-email'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
          });
          var selectEl = document.getElementById('input-project-client-type');
          if (selectEl) selectEl.value = 'team';
          await loadProjects();
          dlNotify('Client "' + name + '" added.', 'success');
        } else {
          dlNotify('Couldn\'t add the client: ' + (result ? result.error : 'unknown error'), 'error');
        }
      } catch (e) {
        dlNotify('Couldn\'t add the client.', 'error');
      }
    });

    // Back button
    var btnBack = document.getElementById('btn-back-to-projects');
    if (btnBack) btnBack.addEventListener('click', closeProjectDetail);

    // Add gallery to project button (reuses the gallery modal but associates with project)
    var btnAddGalleryToProject = document.getElementById('btn-add-gallery-to-project');
    if (btnAddGalleryToProject) btnAddGalleryToProject.addEventListener('click', function() { showModal('modal-create-gallery'); });

    // Link existing gallery to project
    var btnLinkGallery = document.getElementById('btn-link-gallery-to-project');
    if (btnLinkGallery) btnLinkGallery.addEventListener('click', openLinkGalleryModal);
    var btnCancelLinkGallery = document.getElementById('btn-cancel-link-gallery');
    if (btnCancelLinkGallery) btnCancelLinkGallery.addEventListener('click', function() { hideModal('modal-link-gallery'); });
    var btnConfirmLinkGallery = document.getElementById('btn-confirm-link-gallery');
    if (btnConfirmLinkGallery) btnConfirmLinkGallery.addEventListener('click', confirmLinkGallery);

    // Add delivery rule button
    var btnAddRule = document.getElementById('btn-add-rule');
    if (btnAddRule) btnAddRule.addEventListener('click', function() {
      resetRuleModal();
      populateRuleGalleryDropdown();
      showModal('modal-create-rule');
    });

    // Shareable links
    var btnCopyLink = document.getElementById('btn-copy-client-link');
    if (btnCopyLink) btnCopyLink.addEventListener('click', copyClientLink);
    var btnEditSlug = document.getElementById('btn-edit-client-slug');
    if (btnEditSlug) btnEditSlug.addEventListener('click', enterSlugEditMode);
    var btnSaveSlug = document.getElementById('btn-save-client-slug');
    if (btnSaveSlug) btnSaveSlug.addEventListener('click', saveCustomSlug);
    var btnCancelSlug = document.getElementById('btn-cancel-edit-slug');
    if (btnCancelSlug) btnCancelSlug.addEventListener('click', exitSlugEditMode);

    // Client user modal
    var btnAddClientUser = document.getElementById('btn-add-client-user');
    if (btnAddClientUser) btnAddClientUser.addEventListener('click', function() { showModal('modal-create-client-user'); });

    var btnCancelClientUser = document.getElementById('btn-cancel-client-user');
    if (btnCancelClientUser) btnCancelClientUser.addEventListener('click', function() { hideModal('modal-create-client-user'); });

    var btnSaveClientUser = document.getElementById('btn-save-client-user');
    if (btnSaveClientUser) btnSaveClientUser.addEventListener('click', saveClientUser);

    // (Password generation removed — invite flow handles credentials)

    // Close modals on backdrop click
    ['modal-create-gallery', 'modal-create-project', 'modal-create-rule', 'modal-gallery-detail', 'modal-create-client-user'].forEach(function(id) {
      var modal = document.getElementById(id);
      if (modal) {
        modal.addEventListener('click', function(e) {
          if (e.target === modal) hideModal(id);
        });
      }
    });

    // Bind delivery rule events
    bindDeliveryRuleEvents();
  }

  function populateRuleGalleryDropdown() {
    var select = document.getElementById('input-rule-gallery');
    if (!select) return;
    select.innerHTML = '<option value="">-- Select a gallery --</option>';
    galleries.forEach(function(g) {
      var option = document.createElement('option');
      option.value = g.id;
      option.textContent = g.title;
      select.appendChild(option);
    });
  }

  function saveDeliveryRule() {
    var name = document.getElementById('input-rule-name').value.trim();
    var galleryId = document.getElementById('input-rule-gallery').value;
    var teams = document.getElementById('input-rule-teams').value.trim();
    var numbers = document.getElementById('input-rule-numbers').value.trim();
    var participants = document.getElementById('input-rule-participants').value.trim();
    var priority = parseInt(document.getElementById('input-rule-priority').value) || 1;
    var isActive = document.getElementById('input-rule-active').checked;

    if (!name || !galleryId) {
      dlNotify('Rule name and target gallery are required', 'warning');
      return;
    }

    var matchCriteria = {
      teams: teams ? teams.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; }) : [],
      numbers: numbers ? numbers.split(',').map(function(n) { return n.trim(); }).filter(function(n) { return n; }) : [],
      participants: participants ? participants.split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p; }) : []
    };

    // Check if we're editing an existing rule
    var btnSave = document.getElementById('btn-save-rule');
    var editRuleId = btnSave ? btnSave.dataset.editRuleId : null;

    var promise;
    if (editRuleId) {
      // Update existing rule
      promise = window.api.invoke('delivery-update-rule', {
        id: editRuleId,
        data: {
          rule_name: name,
          gallery_id: galleryId,
          match_criteria: matchCriteria,
          priority: priority,
          is_active: isActive
        }
      });
    } else {
      // Create new rule
      promise = window.api.invoke('delivery-create-rule', {
        project_id: selectedProjectId,
        rule_name: name,
        gallery_id: galleryId,
        match_criteria: matchCriteria,
        priority: priority,
        is_active: isActive
      });
    }

    promise.then(function(result) {
      if (result && result.success) {
        hideModal('modal-create-rule');
        resetRuleModal();
        if (selectedProjectId) {
          openProjectDetail(selectedProjectId);
        }
      } else {
        dlNotify('Error: ' + (result ? result.error : 'Unknown'), 'error');
      }
    }).catch(function(e) {
      dlNotify('Error saving rule', 'error');
      console.error('[Delivery] Rule save error:', e);
    });
  }

  function resetRuleModal() {
    document.getElementById('input-rule-name').value = '';
    document.getElementById('input-rule-teams').value = '';
    document.getElementById('input-rule-numbers').value = '';
    document.getElementById('input-rule-participants').value = '';
    document.getElementById('input-rule-priority').value = '1';
    document.getElementById('input-rule-active').checked = true;
    // Reset modal to "create" mode
    var modalTitle = document.querySelector('#modal-create-rule h3');
    if (modalTitle) modalTitle.textContent = 'Create delivery rule';
    var btnSave = document.getElementById('btn-save-rule');
    if (btnSave) {
      btnSave.textContent = 'Create rule';
      delete btnSave.dataset.editRuleId;
    }
  }

  function openGalleryDetail(galleryId) {
    var gallery = galleries.find(function(g) { return g.id === galleryId; });
    if (!gallery) return;

    var modal = document.getElementById('modal-gallery-detail');
    if (!modal) return;

    document.getElementById('gallery-detail-name').textContent = gallery.title;
    var fullLink = gallery.slug ? 'photos.racetagger.cloud/' + gallery.slug : '(no slug)';
    document.getElementById('gallery-detail-slug').textContent = fullLink;
    document.getElementById('gallery-detail-status').textContent = gallery.status;
    document.getElementById('gallery-detail-views').textContent = gallery.total_views || 0;
    document.getElementById('gallery-detail-downloads').textContent = gallery.total_downloads || 0;
    document.getElementById('gallery-detail-title').textContent = gallery.title;

    // Set access type dropdown
    var accessSelect = document.getElementById('gallery-detail-access-type');
    if (accessSelect) {
      accessSelect.value = gallery.access_type || 'unrestricted';
    }

    // Update status badge color
    var statusEl = document.getElementById('gallery-detail-status');
    if (statusEl) {
      var isPub = gallery.status === 'published';
      statusEl.style.background = isPub ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)';
      statusEl.style.color = isPub ? '#10b981' : '#f59e0b';
    }

    // Update status-dependent buttons
    var btnToggle = document.getElementById('btn-toggle-gallery-status');
    if (btnToggle) btnToggle.textContent = gallery.status === 'published' ? 'Unpublish' : 'Publish';

    // Store gallery ID in modal for later use
    modal.dataset.galleryId = galleryId;

    // Reset add-execution picker visibility
    var picker = document.getElementById('gallery-add-execution-picker');
    if (picker) picker.style.display = 'none';
    var btnShowAdd = document.getElementById('btn-show-add-execution');
    if (btnShowAdd) btnShowAdd.style.display = '';

    // Load linked executions for this gallery
    loadGalleryLinkedExecutions(galleryId);

    showModal('modal-gallery-detail');
  }

  function loadGalleryLinkedExecutions(galleryId) {
    var container = document.getElementById('gallery-linked-executions');
    var emptyMsg = document.getElementById('gallery-linked-empty');
    if (!container) return;

    // Show loading state
    if (emptyMsg) emptyMsg.textContent = 'Loading...';

    window.api.invoke('delivery-get-gallery-executions', galleryId).then(function(result) {
      if (!result || !result.success || !result.data || result.data.length === 0) {
        container.innerHTML = '';
        if (emptyMsg) {
          emptyMsg.textContent = 'No executions added yet.';
          container.appendChild(emptyMsg);
        }
        loadAddExecutionDropdown(galleryId, []);
        return;
      }

      var linkedExecs = result.data;
      var linkedIds = linkedExecs.map(function(e) { return e.id; });

      var html = linkedExecs.map(function(exec) {
        var date = exec.execution_at ? exec.execution_at.split('T')[0] : '';
        return '<div style="background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: 8px; padding: 8px 12px;">' +
          '<div style="display: flex; align-items: center; justify-content: space-between;">' +
            '<div>' +
              '<div style="color: var(--text-primary); font-size: 12px; font-weight: 600;">' + escapeHtml(exec.name || 'Execution') + '</div>' +
              '<div style="color: var(--text-muted); font-size: 10px;">' + date + ' • ' + (exec.gallery_image_count || 0) + ' photos in gallery</div>' +
            '</div>' +
            '<span style="color: #10b981; font-size: 10px; font-weight: 600;">Added</span>' +
          '</div>' +
          '<div style="margin-top: 6px; display: flex; gap: 6px;">' +
            '<button onclick="retryHDUpload(\'' + exec.id + '\')" style="flex: 1; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-secondary); padding: 4px 8px; border-radius: 6px; font-size: 10px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.borderColor=\'#1a9ee0\';this.style.color=\'#1a9ee0\'" onmouseout="this.style.borderColor=\'var(--border-color)\';this.style.color=\'var(--text-secondary)\'">' +
              'Retry HD upload' +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('');

      container.innerHTML = html;
      loadAddExecutionDropdown(galleryId, linkedIds);
    }).catch(function(e) {
      console.error('[Delivery] Failed to load gallery executions:', e);
      if (emptyMsg) {
        emptyMsg.textContent = 'Failed to load.';
        container.innerHTML = '';
        container.appendChild(emptyMsg);
      }
    });
  }

  function loadAddExecutionDropdown(galleryId, excludeIds) {
    var execSelect = document.getElementById('gallery-detail-execution-select');
    if (!execSelect) return;

    execSelect.innerHTML = '<option value="">-- Select an execution --</option>';
    window.api.invoke('delivery-get-recent-executions').then(function(result) {
      if (result && result.success && result.data) {
        var available = result.data.filter(function(exec) {
          return excludeIds.indexOf(exec.id) === -1;
        });
        available.forEach(function(exec) {
          var option = document.createElement('option');
          option.value = exec.id;
          option.textContent = (exec.name || 'Execution') + ' (' + (exec.processed_images || 0) + ' photos, ' + (exec.execution_at ? exec.execution_at.split('T')[0] : '') + ')';
          execSelect.appendChild(option);
        });
      }
    }).catch(function() {});
  }

  async function toggleGalleryStatus(galleryId) {
    var gallery = galleries.find(function(g) { return g.id === galleryId; });
    var newStatus = gallery && gallery.status === 'published' ? 'draft' : 'published';
    console.log('[Delivery] toggleGalleryStatus:', galleryId, 'found:', !!gallery, 'currentStatus:', gallery ? gallery.status : 'N/A', 'newStatus:', newStatus);
    try {
      var result = await window.api.invoke('delivery-update-gallery', { id: galleryId, data: { status: newStatus } });
      console.log('[Delivery] Update result:', JSON.stringify(result));
      if (result && result.success) {
        await loadGalleries();
        var modal = document.getElementById('modal-gallery-detail');
        if (modal && modal.dataset.galleryId === galleryId) {
          openGalleryDetail(galleryId);
        }
      } else {
        dlNotify('Error updating gallery: ' + (result ? result.error : 'Unknown'), 'error');
      }
    } catch (e) {
      dlNotify('Error updating gallery: ' + (e.message || e), 'error');
      console.error('[Delivery] Update error:', e);
    }
  }

  function deleteGallery(galleryId) {
    if (!confirm('Are you sure you want to delete this gallery? This action cannot be undone.')) {
      return;
    }
    try {
      window.api.invoke('delivery-delete-gallery', galleryId).then(function(result) {
        if (result && result.success) {
          hideModal('modal-gallery-detail');
          loadGalleries();
        } else {
          dlNotify('Error: ' + (result ? result.error : 'Unknown'), 'error');
        }
      }).catch(function(e) {
        dlNotify('Error deleting gallery', 'error');
        console.error('[Delivery] Delete error:', e);
      });
    } catch (e) {
      dlNotify('Error deleting gallery', 'error');
      console.error('[Delivery] Delete error:', e);
    }
  }

  function sendExecutionToGallery(galleryId, executionId) {
    if (!executionId) {
      dlNotify('Please select an execution', 'warning');
      return;
    }

    var btnAdd = document.getElementById('btn-send-execution-to-gallery');
    if (btnAdd) { btnAdd.disabled = true; btnAdd.textContent = 'Adding...'; }

    try {
      window.api.invoke('delivery-send-execution-to-gallery', { galleryId: galleryId, executionId: executionId }).then(function(result) {
        if (result && result.success) {
          var added = result.data ? result.data.added : 0;
          // Show toast-style feedback
          var execSelect = document.getElementById('gallery-detail-execution-select');
          if (execSelect) execSelect.value = '';

          // Hide picker, show button again
          var picker = document.getElementById('gallery-add-execution-picker');
          if (picker) picker.style.display = 'none';
          var btnShow = document.getElementById('btn-show-add-execution');
          if (btnShow) btnShow.style.display = '';

          // Refresh the linked executions list
          loadGalleryLinkedExecutions(galleryId);
        } else {
          dlNotify('Error: ' + (result ? result.error : 'Unknown'), 'error');
        }
      }).catch(function(e) {
        dlNotify('Error sending images', 'error');
        console.error('[Delivery] Send error:', e);
      }).finally(function() {
        if (btnAdd) { btnAdd.disabled = false; btnAdd.textContent = 'Add'; }
      });
    } catch (e) {
      dlNotify('Error sending images', 'error');
      console.error('[Delivery] Send error:', e);
      if (btnAdd) { btnAdd.disabled = false; btnAdd.textContent = 'Add'; }
    }
  }

  function renderDeliveryRules(rules) {
    var rulesList = document.getElementById('delivery-rules-list');
    var rulesEmpty = document.getElementById('delivery-rules-empty');
    if (!rulesList) return;

    if (rules.length === 0) {
      rulesList.innerHTML = '';
      if (rulesEmpty) rulesEmpty.style.display = 'block';
      return;
    }
    if (rulesEmpty) rulesEmpty.style.display = 'none';

    rulesList.innerHTML = rules.map(function(r) {
      var mc = r.match_criteria || {};
      var activeColor = r.is_active ? '#10b981' : '#94a3b8';
      var activeBg = r.is_active ? 'rgba(16,185,129,0.2)' : 'rgba(148,163,184,0.2)';
      var galleryName = r.galleries ? r.galleries.title : 'Unknown gallery';
      var isAuto = r.source_type === 'preset_auto';

      // Build criteria tags
      var criteriaTags = '';
      if (mc.teams && mc.teams.length) {
        criteriaTags += mc.teams.map(function(t) {
          return '<span style="display: inline-block; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(99,102,241,0.15); color: #818cf8; margin-right: 4px;">🏢 ' + escapeHtml(t) + '</span>';
        }).join('');
      }
      if (mc.numbers && mc.numbers.length) {
        criteriaTags += mc.numbers.map(function(n) {
          return '<span style="display: inline-block; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(26,158,224,0.15); color: #1a9ee0; margin-right: 4px;"># ' + escapeHtml(n) + '</span>';
        }).join('');
      }
      if (mc.participants && mc.participants.length) {
        criteriaTags += mc.participants.map(function(p) {
          return '<span style="display: inline-block; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(16,185,129,0.15); color: #34d399; margin-right: 4px;">👤 ' + escapeHtml(p) + '</span>';
        }).join('');
      }
      if (!criteriaTags) {
        criteriaTags = '<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">No criteria set</span>';
      }

      // Source badge for auto-generated rules
      var sourceBadge = isAuto
        ? '<span style="font-size: 9px; padding: 2px 6px; border-radius: 99px; background: rgba(26,158,224,0.15); color: #1a9ee0; font-weight: 600; margin-left: 4px;">FROM PRESET</span>'
        : '';

      // Action buttons: auto-generated rules only get toggle, manual rules get all actions
      var actionButtons = '';
      if (isAuto) {
        // Read-only: only toggle on/off allowed
        actionButtons =
          '<button class="rule-toggle-btn" data-rule-id="' + r.id + '" data-active="' + (r.is_active ? '1' : '0') + '" title="' + (r.is_active ? 'Disable rule' : 'Enable rule') + '" style="background: none; border: 1px solid var(--border-color); border-radius: 6px; padding: 4px 8px; cursor: pointer; color: var(--text-muted); font-size: 12px; transition: color 0.2s, border-color 0.2s;">' + (r.is_active ? dlIcon('pause', 13) : dlIcon('play', 13)) + '</button>';
      } else {
        actionButtons =
          '<button class="rule-toggle-btn" data-rule-id="' + r.id + '" data-active="' + (r.is_active ? '1' : '0') + '" title="' + (r.is_active ? 'Disable rule' : 'Enable rule') + '" style="background: none; border: 1px solid var(--border-color); border-radius: 6px; padding: 4px 8px; cursor: pointer; color: var(--text-muted); font-size: 12px; transition: color 0.2s, border-color 0.2s;">' + (r.is_active ? dlIcon('pause', 13) : dlIcon('play', 13)) + '</button>' +
          '<button class="rule-edit-btn" data-rule-id="' + r.id + '" title="Edit rule" style="background: none; border: 1px solid var(--border-color); border-radius: 6px; padding: 4px 8px; cursor: pointer; color: var(--text-muted); font-size: 12px; transition: color 0.2s, border-color 0.2s;">' + dlIcon('edit', 13) + '</button>' +
          '<button class="rule-delete-btn" data-rule-id="' + r.id + '" title="Delete rule" style="background: none; border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; padding: 4px 8px; cursor: pointer; color: #f87171; font-size: 12px; transition: opacity 0.2s;">' + dlIcon('trash', 13) + '</button>';
      }

      var cardBorder = isAuto ? 'border-left: 3px solid rgba(26,158,224,0.5);' : '';

      return '<div class="delivery-rule-card" data-rule-id="' + r.id + '" style="background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; transition: border-color 0.2s; ' + cardBorder + '">' +
        '<div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px;">' +
          '<div style="flex: 1; min-width: 0;">' +
            '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">' +
              '<span style="color: var(--text-primary); font-size: 13px; font-weight: 600;">' + escapeHtml(r.rule_name) + '</span>' +
              '<span style="font-size: 10px; padding: 2px 8px; border-radius: 99px; background: ' + activeBg + '; color: ' + activeColor + '; font-weight: 600;">' + (r.is_active ? 'Active' : 'Disabled') + '</span>' +
              sourceBadge +
            '</div>' +
            '<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">→ ' + escapeHtml(galleryName) + '</div>' +
            '<div style="display: flex; flex-wrap: wrap; gap: 3px;">' + criteriaTags + '</div>' +
          '</div>' +
          '<div style="display: flex; gap: 4px; flex-shrink: 0; margin-left: 12px;">' +
            actionButtons +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Bind action buttons
    rulesList.querySelectorAll('.rule-toggle-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var ruleId = this.dataset.ruleId;
        var isActive = this.dataset.active === '1';
        toggleDeliveryRule(ruleId, !isActive);
      });
    });

    rulesList.querySelectorAll('.rule-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        openEditRuleModal(this.dataset.ruleId);
      });
    });

    rulesList.querySelectorAll('.rule-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        deleteDeliveryRule(this.dataset.ruleId);
      });
    });

    // Hover effects on cards
    rulesList.querySelectorAll('.delivery-rule-card').forEach(function(card) {
      card.addEventListener('mouseenter', function() { this.style.borderColor = 'var(--accent-primary)'; });
      card.addEventListener('mouseleave', function() { this.style.borderColor = 'var(--border-color)'; });
    });
  }

  async function toggleDeliveryRule(ruleId, newActive) {
    try {
      var result = await window.api.invoke('delivery-update-rule', { id: ruleId, data: { is_active: newActive } });
      if (result && result.success) {
        if (selectedProjectId) openProjectDetail(selectedProjectId);
      } else {
        dlNotify('Error: ' + (result ? result.error : 'Unknown'), 'error');
      }
    } catch (e) {
      console.error('[Delivery] Toggle rule error:', e);
      dlNotify('Error toggling rule', 'error');
    }
  }

  function openEditRuleModal(ruleId) {
    // Find the rule from the current project data by fetching rules
    window.api.invoke('delivery-get-rules', selectedProjectId).then(function(result) {
      if (!result || !result.success) return;
      var rule = (result.data || []).find(function(r) { return r.id === ruleId; });
      if (!rule) return;

      // Populate the modal with existing data
      document.getElementById('input-rule-name').value = rule.rule_name || '';
      var mc = rule.match_criteria || {};
      document.getElementById('input-rule-teams').value = (mc.teams || []).join(', ');
      document.getElementById('input-rule-numbers').value = (mc.numbers || []).join(', ');
      document.getElementById('input-rule-participants').value = (mc.participants || []).join(', ');
      document.getElementById('input-rule-priority').value = rule.priority || 1;
      document.getElementById('input-rule-active').checked = rule.is_active !== false;

      // Populate gallery dropdown and select the current gallery
      populateRuleGalleryDropdown();
      setTimeout(function() {
        document.getElementById('input-rule-gallery').value = rule.gallery_id || '';
      }, 100);

      // Change modal title and save button to "edit" mode
      var modalTitle = document.querySelector('#modal-create-rule h3');
      if (modalTitle) modalTitle.textContent = 'Edit delivery rule';
      var btnSave = document.getElementById('btn-save-rule');
      if (btnSave) {
        btnSave.textContent = 'Save changes';
        btnSave.dataset.editRuleId = ruleId;
      }

      showModal('modal-create-rule');
    });
  }

  async function deleteDeliveryRule(ruleId) {
    if (!confirm('Delete this delivery rule? Photos already routed will remain in their galleries.')) return;
    try {
      var result = await window.api.invoke('delivery-delete-rule', ruleId);
      if (result && result.success) {
        if (selectedProjectId) openProjectDetail(selectedProjectId);
      } else {
        dlNotify('Error: ' + (result ? result.error : 'Unknown'), 'error');
      }
    } catch (e) {
      console.error('[Delivery] Delete rule error:', e);
      dlNotify('Error deleting rule', 'error');
    }
  }

  function showRoutingBanner(results) {
    var banner = document.getElementById('delivery-routing-banner');
    var message = document.getElementById('delivery-routing-message');
    if (!banner || !message) return;

    var routed = results.routed_count || 0;
    var galleriesCount = results.galleries_count || 0;
    var unmatched = results.unmatched_count || 0;

    var text = '';
    if (routed > 0) {
      text = routed + ' photo' + (routed !== 1 ? 's' : '') + ' routed to ' + galleriesCount + ' galler' + (galleriesCount !== 1 ? 'ies' : 'y');
      if (unmatched > 0) {
        text += '. ' + unmatched + ' photo' + (unmatched !== 1 ? 's' : '') + ' did not match any rule.';
      } else {
        text += '.';
      }
    } else {
      text = 'No photos matched any delivery rule. ' + unmatched + ' photo' + (unmatched !== 1 ? 's' : '') + ' unmatched.';
    }
    message.textContent = text;
    banner.style.display = 'block';

    // Bind the "View" button to navigate to delivery page
    var btnView = document.getElementById('btn-routing-banner-view');
    if (btnView) {
      btnView.onclick = function() {
        banner.style.display = 'none';
        if (window.router && window.router.navigate) {
          window.router.navigate('/delivery');
        }
      };
    }

    // Auto-hide after 12 seconds
    setTimeout(function() {
      if (banner.style.display === 'block') {
        banner.style.display = 'none';
      }
    }, 12000);
  }

  function bindDeliveryRuleEvents() {
    var btnCancelRule = document.getElementById('btn-cancel-rule');
    if (btnCancelRule) {
      btnCancelRule.addEventListener('click', function() { hideModal('modal-create-rule'); resetRuleModal(); });
    }

    var btnSaveRule = document.getElementById('btn-save-rule');
    if (btnSaveRule) {
      btnSaveRule.addEventListener('click', saveDeliveryRule);
    }

    var btnCloseGalleryDetail = document.getElementById('btn-close-gallery-detail');
    if (btnCloseGalleryDetail) {
      btnCloseGalleryDetail.addEventListener('click', function() { hideModal('modal-gallery-detail'); });
    }

    var btnToggleGalleryStatus = document.getElementById('btn-toggle-gallery-status');
    if (btnToggleGalleryStatus) {
      btnToggleGalleryStatus.addEventListener('click', function() {
        var modal = document.getElementById('modal-gallery-detail');
        if (modal && modal.dataset.galleryId) {
          toggleGalleryStatus(modal.dataset.galleryId);
        }
      });
    }

    // Access type change → save immediately
    var accessSelect = document.getElementById('gallery-detail-access-type');
    if (accessSelect) {
      accessSelect.addEventListener('change', async function() {
        var modal = document.getElementById('modal-gallery-detail');
        if (!modal || !modal.dataset.galleryId) return;
        var galleryId = modal.dataset.galleryId;
        var newAccess = this.value;
        try {
          var result = await window.api.invoke('delivery-update-gallery', { id: galleryId, data: { access_type: newAccess } });
          if (result && result.success) {
            // Update local cache
            var g = galleries.find(function(x) { return x.id === galleryId; });
            if (g) g.access_type = newAccess;
          } else {
            dlNotify('Error updating access: ' + (result ? result.error : 'Unknown'), 'error');
          }
        } catch (e) {
          dlNotify('Error updating access type', 'error');
          console.error('[Delivery] Access type update error:', e);
        }
      });
    }

    var btnDeleteGallery = document.getElementById('btn-delete-gallery');
    if (btnDeleteGallery) {
      btnDeleteGallery.addEventListener('click', function() {
        var modal = document.getElementById('modal-gallery-detail');
        if (modal && modal.dataset.galleryId) {
          deleteGallery(modal.dataset.galleryId);
        }
      });
    }

    // "Add Execution" toggle button — shows the picker
    var btnShowAddExecution = document.getElementById('btn-show-add-execution');
    if (btnShowAddExecution) {
      btnShowAddExecution.addEventListener('click', function() {
        var picker = document.getElementById('gallery-add-execution-picker');
        if (picker) picker.style.display = 'block';
        this.style.display = 'none';
      });
    }

    var btnSendExecution = document.getElementById('btn-send-execution-to-gallery');
    if (btnSendExecution) {
      btnSendExecution.addEventListener('click', function() {
        var modal = document.getElementById('modal-gallery-detail');
        var execSelect = document.getElementById('gallery-detail-execution-select');
        if (modal && modal.dataset.galleryId && execSelect) {
          sendExecutionToGallery(modal.dataset.galleryId, execSelect.value);
        }
      });
    }

    // Listen for post-execution routing complete event (via IPC, not DOM events)
    if (window.api && window.api.receive) {
      window.api.receive('delivery-routing-complete', function(data) {
        if (data) {
          showRoutingBanner({ routed_count: data.routed, galleries_count: data.galleriesCount || 0, unmatched_count: data.unmatched });
          // Refresh the delivery page if we're on it
          if (selectedProjectId) openProjectDetail(selectedProjectId);
        }
      });
      window.api.receive('r2-upload-progress', function(data) {
        console.log('[Delivery] R2 upload progress:', data.progress.percentage + '%');
      });
      window.api.receive('r2-upload-complete', function(data) {
        console.log('[Delivery] R2 upload complete:', data.completed + '/' + data.total);
      });
    }
  }

  // ==================== INTEREST SURVEY ====================

  async function initSurvey() {
    // Check if already submitted
    try {
      var result = await window.api.invoke('delivery-check-survey');
      if (result && result.success && result.data && result.data.submitted) {
        document.getElementById('survey-form').style.display = 'none';
        document.getElementById('survey-submitted').style.display = 'block';
        return;
      }
    } catch (e) {
      // Ignore — just show the form
    }

    var btnSubmit = document.getElementById('btn-submit-interest');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', submitSurvey);
    }
  }

  async function submitSurvey() {
    var interests = {
      single_gallery: document.getElementById('interest-single-gallery').checked,
      multi_client: document.getElementById('interest-multi-client').checked,
      hd_download: document.getElementById('interest-hd-download').checked,
      watermark: document.getElementById('interest-watermark').checked,
      payment: document.getElementById('interest-payment').checked,
    };

    var workflow = document.getElementById('interest-current-workflow').value || null;
    var comment = document.getElementById('interest-comment').value.trim() || null;

    // Check at least one interest is selected
    var hasAny = Object.values(interests).some(function(v) { return v; });
    if (!hasAny && !workflow && !comment) {
      dlNotify('Please select at least one option or leave a comment.', 'warning');
      return;
    }

    var btnSubmit = document.getElementById('btn-submit-interest');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Submitting...';
    }

    try {
      var result = await window.api.invoke('delivery-submit-survey', {
        responses: {
          interests: interests,
          current_workflow: workflow,
        },
        comment: comment,
      });

      if (result && result.success) {
        document.getElementById('survey-form').style.display = 'none';
        document.getElementById('survey-submitted').style.display = 'block';
      } else {
        dlNotify('Error submitting. Please try again.', 'error');
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.textContent = 'Submit feedback';
        }
      }
    } catch (e) {
      dlNotify('Error submitting. Please try again.', 'error');
      console.error('[Delivery] Survey submission error:', e);
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Submit feedback';
      }
    }
  }

  // ==================== LINK EXISTING GALLERY ====================

  async function openLinkGalleryModal() {
    var select = document.getElementById('select-link-gallery');
    var emptyMsg = document.getElementById('link-gallery-empty');
    var confirmBtn = document.getElementById('btn-confirm-link-gallery');
    if (!select) return;

    select.innerHTML = '<option value="">Loading...</option>';
    if (emptyMsg) emptyMsg.style.display = 'none';
    if (confirmBtn) confirmBtn.style.display = '';
    showModal('modal-link-gallery');

    try {
      var result = await window.api.invoke('delivery-get-unlinked-galleries');
      if (!result || !result.success) {
        select.innerHTML = '<option value="">Error loading galleries</option>';
        return;
      }
      var galleries = result.data || [];
      if (galleries.length === 0) {
        select.innerHTML = '';
        select.style.display = 'none';
        if (emptyMsg) emptyMsg.style.display = 'block';
        if (confirmBtn) confirmBtn.style.display = 'none';
        return;
      }
      select.style.display = '';
      select.innerHTML = '<option value="">— Select a gallery —</option>';
      galleries.forEach(function(g) {
        var option = document.createElement('option');
        option.value = g.id;
        option.textContent = g.title || g.slug || 'Untitled';
        select.appendChild(option);
      });
    } catch (e) {
      console.error('[Delivery] Error loading unlinked galleries:', e);
      select.innerHTML = '<option value="">Error loading galleries</option>';
    }
  }

  async function confirmLinkGallery() {
    var select = document.getElementById('select-link-gallery');
    if (!select || !select.value || !selectedProjectId) return;

    try {
      var result = await window.api.invoke('delivery-link-gallery', { galleryId: select.value, projectId: selectedProjectId });
      if (result && result.success) {
        hideModal('modal-link-gallery');
        await openProjectDetail(selectedProjectId);
      } else {
        dlNotify('Error linking gallery: ' + (result ? result.error : 'Unknown'), 'error');
      }
    } catch (e) {
      console.error('[Delivery] Link gallery error:', e);
      dlNotify('Error linking gallery', 'error');
    }
  }

  // ==================== SHAREABLE LINKS ====================

  var currentClientSlug = '';

  function renderShareableLinks(project) {
    var readMode = document.getElementById('slug-read-mode');
    var editMode = document.getElementById('slug-edit-mode');
    var linkDisplay = document.getElementById('slug-link-display');
    var slugInput = document.getElementById('input-client-slug');

    currentClientSlug = project.client_slug || '';

    // Always start in read mode
    if (readMode) readMode.style.display = 'flex';
    if (editMode) editMode.style.display = 'none';

    // Update the displayed link
    if (linkDisplay) {
      if (currentClientSlug) {
        linkDisplay.textContent = 'photos.racetagger.cloud/c/' + currentClientSlug;
        linkDisplay.style.color = 'var(--accent-primary)';
      } else {
        linkDisplay.textContent = 'No link generated yet';
        linkDisplay.style.color = 'var(--text-muted)';
        linkDisplay.style.fontStyle = 'italic';
      }
    }

    // Pre-fill the edit input
    if (slugInput) slugInput.value = currentClientSlug;
  }

  function enterSlugEditMode() {
    var readMode = document.getElementById('slug-read-mode');
    var editMode = document.getElementById('slug-edit-mode');
    var slugInput = document.getElementById('input-client-slug');
    if (readMode) readMode.style.display = 'none';
    if (editMode) editMode.style.display = 'block';
    if (slugInput) { slugInput.value = currentClientSlug; slugInput.focus(); slugInput.select(); }
  }

  function exitSlugEditMode() {
    var readMode = document.getElementById('slug-read-mode');
    var editMode = document.getElementById('slug-edit-mode');
    if (readMode) readMode.style.display = 'flex';
    if (editMode) editMode.style.display = 'none';
  }

  async function saveCustomSlug() {
    if (!selectedProjectId) return;
    var slugInput = document.getElementById('input-client-slug');
    if (!slugInput) return;

    var newSlug = slugInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!newSlug) {
      dlNotify('Please enter a valid slug', 'warning');
      return;
    }

    try {
      var result = await window.api.invoke('delivery-update-project', { id: selectedProjectId, data: { client_slug: newSlug } });
      if (result && result.success) {
        currentClientSlug = newSlug;
        // Update display and switch back to read mode
        var linkDisplay = document.getElementById('slug-link-display');
        if (linkDisplay) {
          linkDisplay.textContent = 'photos.racetagger.cloud/c/' + newSlug;
          linkDisplay.style.color = 'var(--accent-primary)';
          linkDisplay.style.fontStyle = '';
        }
        exitSlugEditMode();
      } else {
        dlNotify('Error saving slug: ' + (result ? result.error : 'Unknown'), 'error');
      }
    } catch (e) {
      console.error('[Delivery] Slug save error:', e);
      dlNotify('Error saving shareable link', 'error');
    }
  }

  function copyClientLink() {
    if (!currentClientSlug) return;
    var fullUrl = 'https://photos.racetagger.cloud/c/' + currentClientSlug;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(fullUrl).then(function() {
        var btn = document.getElementById('btn-copy-client-link');
        if (btn) { btn.innerHTML = dlIcon('check', 13); setTimeout(function() { btn.innerHTML = dlIcon('copy', 13); }, 1500); }
      });
    }
  }

  // ==================== CLIENT USERS (INVITE FLOW) ====================

  async function loadClientUsers(projectId) {
    var list = document.getElementById('client-users-list');
    var empty = document.getElementById('client-users-empty');
    if (!list) return;

    try {
      var result = await window.api.invoke('delivery-get-client-users', projectId);
      if (!result || !result.success) return;
      var users = result.data || [];

      if (users.length === 0) {
        list.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
      }
      if (empty) empty.style.display = 'none';

      list.innerHTML = users.map(function(u) {
        var status = u.status || (u.is_active ? 'active' : 'disabled');
        var lastLogin = u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : null;

        // Status badge styling
        var statusColor, statusBg, statusLabel;
        if (status === 'invited') {
          statusColor = '#f59e0b'; statusBg = 'rgba(245,158,11,0.2)'; statusLabel = 'Invited';
        } else if (status === 'active') {
          statusColor = '#10b981'; statusBg = 'rgba(16,185,129,0.2)'; statusLabel = 'Active';
        } else {
          statusColor = '#94a3b8'; statusBg = 'rgba(148,163,184,0.2)'; statusLabel = 'Disabled';
        }

        var displayName = u.display_name || u.username || 'Unnamed';
        var emailLine = u.email ? escapeHtml(u.email) : '';
        var detailParts = [];
        if (emailLine) detailParts.push(emailLine);
        if (lastLogin) detailParts.push('Last login: ' + lastLogin);
        else if (status === 'invited') detailParts.push('Invitation pending');

        return '<div style="background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px; display: flex; align-items: center; justify-content: space-between;">' +
          '<div style="flex: 1; min-width: 0;">' +
            '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">' +
              '<span style="color: var(--text-primary); font-size: 13px; font-weight: 600;">' + escapeHtml(displayName) + '</span>' +
              '<span style="font-size: 10px; padding: 2px 8px; border-radius: 99px; background: ' + statusBg + '; color: ' + statusColor + '; font-weight: 600;">' + statusLabel + '</span>' +
            '</div>' +
            '<div style="font-size: 11px; color: var(--text-muted);">' + detailParts.join(' &bull; ') + '</div>' +
          '</div>' +
          '<div style="display: flex; gap: 4px; flex-shrink: 0; margin-left: 12px;">' +
            (status === 'invited' ? '<button class="client-user-resend-btn" data-user-id="' + u.id + '" title="Resend invitation" style="background: none; border: 1px solid var(--border-color); border-radius: 6px; padding: 4px 8px; cursor: pointer; color: var(--text-muted); font-size: 12px;">' + dlIcon('mail', 13) + '</button>' : '') +
            (status !== 'invited' ? '<button class="client-user-toggle-btn" data-user-id="' + u.id + '" data-status="' + status + '" title="' + (status === 'active' ? 'Disable' : 'Enable') + '" style="background: none; border: 1px solid var(--border-color); border-radius: 6px; padding: 4px 8px; cursor: pointer; color: var(--text-muted); font-size: 12px;">' + (status === 'active' ? dlIcon('pause', 13) : dlIcon('play', 13)) + '</button>' : '') +
            '<button class="client-user-delete-btn" data-user-id="' + u.id + '" data-name="' + escapeHtml(displayName) + '" title="Remove user" style="background: none; border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; padding: 4px 8px; cursor: pointer; color: #f87171; font-size: 12px;">' + dlIcon('trash', 13) + '</button>' +
          '</div>' +
        '</div>';
      }).join('');

      // Bind toggle buttons
      list.querySelectorAll('.client-user-toggle-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var userId = this.dataset.userId;
          var currentStatus = this.dataset.status;
          var newStatus = currentStatus === 'active' ? 'disabled' : 'active';
          try {
            await window.api.invoke('delivery-update-client-user', { id: userId, data: { status: newStatus, is_active: newStatus === 'active' } });
            loadClientUsers(projectId);
          } catch (e) { console.error('[Delivery] Toggle client user error:', e); }
        });
      });

      // Bind resend invite buttons
      list.querySelectorAll('.client-user-resend-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var userId = this.dataset.userId;
          try {
            var result = await window.api.invoke('delivery-resend-client-invite', userId);
            if (result && result.success) {
              this.innerHTML = dlIcon('check', 13);
              var self = this;
              setTimeout(function() { self.innerHTML = dlIcon('mail', 13); }, 2000);
            } else {
              dlNotify('Error resending invite: ' + (result ? result.error : 'Unknown'), 'error');
            }
          } catch (e) { console.error('[Delivery] Resend invite error:', e); }
        });
      });

      // Bind delete buttons
      list.querySelectorAll('.client-user-delete-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var userId = this.dataset.userId;
          var name = this.dataset.name;
          if (!confirm('Remove "' + name + '"? This action cannot be undone.')) return;
          try {
            await window.api.invoke('delivery-delete-client-user', userId);
            loadClientUsers(projectId);
          } catch (e) { console.error('[Delivery] Delete client user error:', e); }
        });
      });
    } catch (e) {
      console.error('[Delivery] Failed to load client users:', e);
    }
  }

  /**
   * Generate a random invite token (32 chars hex)
   */
  function generateInviteToken() {
    var array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    return Array.from(array).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  async function saveClientUser() {
    var displayName = document.getElementById('input-client-display-name').value.trim();
    var email = document.getElementById('input-client-email').value.trim();

    if (!displayName || !email) {
      dlNotify('Name and email are required.', 'warning');
      return;
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      dlNotify('Please enter a valid email address.', 'warning');
      return;
    }

    try {
      var inviteToken = generateInviteToken();
      var expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

      var data = {
        project_id: selectedProjectId,
        display_name: displayName,
        email: email,
        status: 'invited',
        invite_token: inviteToken,
        invite_token_expires_at: expiresAt,
        is_active: false
      };

      var result = await window.api.invoke('delivery-create-client-user', data);
      if (result && result.success) {
        hideModal('modal-create-client-user');
        // Clear form
        document.getElementById('input-client-display-name').value = '';
        document.getElementById('input-client-email').value = '';
        loadClientUsers(selectedProjectId);

        // Send invite email via IPC (fire-and-forget)
        window.api.invoke('delivery-send-client-invite', {
          clientUserId: result.data.id,
          email: email,
          displayName: displayName,
          inviteToken: inviteToken,
          projectId: selectedProjectId
        }).catch(function(e) { console.error('[Delivery] Send invite email error:', e); });

      } else {
        var errorMsg = result ? result.error : 'Unknown error';
        if (errorMsg.includes('duplicate') || errorMsg.includes('unique')) {
          dlNotify('This email has already been invited for this client.', 'warning');
        } else {
          dlNotify('Error: ' + errorMsg, 'error');
        }
      }
    } catch (e) {
      console.error('[Delivery] Invite client user error:', e);
      dlNotify('Error sending invitation', 'error');
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ==================== GLOBAL: COPY GALLERY LINK ====================

  window.copyGalleryLink = function() {
    var slugEl = document.getElementById('gallery-detail-slug');
    if (!slugEl) return;
    var text = slugEl.textContent || '';
    if (!text || text === '(no slug)') return;
    var fullUrl = 'https://' + text;
    navigator.clipboard.writeText(fullUrl).then(function() {
      var icon = document.getElementById('gallery-slug-copy-icon');
      if (icon) {
        icon.innerHTML = dlIcon('check', 13);
        setTimeout(function() { icon.innerHTML = dlIcon('copy', 13); }, 1500);
      }
    }).catch(function() {
      // Fallback
      var ta = document.createElement('textarea');
      ta.value = fullUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      var icon = document.getElementById('gallery-slug-copy-icon');
      if (icon) {
        icon.innerHTML = dlIcon('check', 13);
        setTimeout(function() { icon.innerHTML = dlIcon('copy', 13); }, 1500);
      }
    });
  };

  // ==================== GLOBAL: RETRY HD UPLOAD ====================

  window.retryHDUpload = async function(executionId) {
    if (!executionId) return;

    // Find the button that was clicked and update its state
    var buttons = document.querySelectorAll('button[onclick*="retryHDUpload"]');
    var btn = null;
    buttons.forEach(function(b) {
      if (b.getAttribute('onclick').indexOf(executionId) !== -1) btn = b;
    });

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Starting upload…';
      btn.style.color = '#f59e0b';
      btn.style.borderColor = '#f59e0b';
    }

    try {
      var result = await window.api.invoke('delivery-r2-upload-start', executionId);
      if (result && result.success) {
        var queued = result.data ? result.data.queued : 0;
        var error = result.data ? result.data.error : null;
        if (queued > 0) {
          if (btn) {
            btn.textContent = queued + ' files uploading…';
            btn.style.color = '#10b981';
            btn.style.borderColor = '#10b981';
          }
          // Trigger upload monitor to pick up the new upload
          if (window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('page-loaded', { detail: { page: 'delivery' } }));
          }
        } else if (error) {
          dlNotify(error, 'error');
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Retry HD upload';
            btn.style.color = 'var(--text-secondary)';
            btn.style.borderColor = 'var(--border-color)';
          }
        } else {
          if (btn) {
            btn.textContent = 'Already uploaded';
            btn.style.color = '#10b981';
            btn.style.borderColor = '#10b981';
          }
        }
      } else {
        dlNotify('Upload failed: ' + (result ? result.error : 'Unknown error'), 'error');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Retry HD upload';
          btn.style.color = 'var(--text-secondary)';
          btn.style.borderColor = 'var(--border-color)';
        }
      }
    } catch (e) {
      console.error('[Delivery] retryHDUpload error:', e);
      dlNotify('HD Upload error: ' + (e.message || e), 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Retry HD upload';
        btn.style.color = 'var(--text-secondary)';
        btn.style.borderColor = 'var(--border-color)';
      }
    }
  };

  // ==================== R2 EXECUTION STATUS PANEL ====================

  async function loadR2ExecutionStatus() {
    var listEl = document.getElementById('r2-execution-list');
    var emptyEl = document.getElementById('r2-execution-empty');
    if (!listEl) return;

    try {
      // Get recent executions first
      var execResult = await window.api.invoke('delivery-get-recent-executions');
      if (!execResult || !execResult.success || !execResult.data || execResult.data.length === 0) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        return;
      }

      var executions = execResult.data;
      var html = '';

      // Load R2 status for each execution (limit to 10 most recent)
      var recentExecs = executions.slice(0, 10);
      for (var exec of recentExecs) {
        try {
          var statusResult = await window.api.invoke('delivery-r2-upload-status', exec.id);
          if (!statusResult || !statusResult.success) continue;
          var st = statusResult.data;
          if (st.total === 0) continue;

          // Skip executions for which the user has never actually triggered
          // an upload. `getR2UploadStatus` reports every image in the
          // execution and labels images with NULL `original_upload_status`
          // as 'pending' — without this guard, the panel listed every
          // recent execution with a "○ Pending" badge even when the user
          // never clicked Deliver. Only show executions that have at least
          // one image touched by an actual upload action.
          if (!st.completed && !st.failed && !st.queued) continue;

          var pct = st.total > 0 ? Math.round((st.completed / st.total) * 100) : 0;
          var hasIssues = st.failed > 0 || st.queued > 0;
          var allDone = st.completed === st.total;
          var borderColor = allDone ? 'rgba(16, 185, 129, 0.3)' : hasIssues ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.06)';
          var statusBadge = allDone
            ? '<span style="font-size:10px;padding:3px 8px;border-radius:10px;background:rgba(16,185,129,0.15);color:#10b981;font-weight:600;">Complete</span>'
            : st.failed > 0
            ? '<span style="font-size:10px;padding:3px 8px;border-radius:10px;background:rgba(239,68,68,0.15);color:#ef4444;font-weight:600;">' + st.failed + ' failed</span>'
            : st.queued > 0
            ? '<span style="font-size:10px;padding:3px 8px;border-radius:10px;background:rgba(245,158,11,0.15);color:#f59e0b;font-weight:600;">' + st.queued + ' queued</span>'
            : '<span style="font-size:10px;padding:3px 8px;border-radius:10px;background:rgba(148,163,184,0.15);color:#94a3b8;font-weight:600;">Pending</span>';

          var execDate = exec.execution_at ? new Date(exec.execution_at).toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' }) : '';
          var execName = exec.name || 'Execution';
          var sourceFolder = exec.source_folder || null;

          html += '<div style="background:var(--bg-card,#1e293b);border:1px solid ' + borderColor + ';border-radius:10px;padding:14px;transition:border-color 0.3s;">';
          html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
          html += '<div><span style="font-size:13px;font-weight:600;color:var(--text-primary);">' + execName + '</span>';
          html += '<span style="font-size:11px;color:var(--text-muted);margin-left:8px;">' + execDate + '</span></div>';
          html += statusBadge;
          html += '</div>';

          // Source folder path + update button (only if not all completed)
          if (!allDone) {
            html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid rgba(255,255,255,0.04);">';
            html += '<span style="font-size:10px;color:var(--text-muted);white-space:nowrap;">' + dlIcon('folder', 11) + '</span>';
            html += '<span id="r2-folder-' + exec.id + '" style="font-size:10px;color:' + (sourceFolder ? 'var(--text-muted)' : '#f87171') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" title="' + escapeHtml(sourceFolder || 'No folder set') + '">';
            html += sourceFolder ? escapeHtml(sourceFolder) : '<em>No source folder set</em>';
            html += '</span>';
            html += '<button onclick="window.__r2UpdateFolder(\'' + exec.id + '\')" style="background:none;border:1px solid rgba(148,163,184,0.2);color:#94a3b8;padding:2px 8px;border-radius:5px;font-size:9px;cursor:pointer;white-space:nowrap;flex-shrink:0;" title="Browse for new folder location">Update</button>';
            html += '</div>';
          }

          // Progress bar
          html += '<div style="background:rgba(255,255,255,0.06);border-radius:4px;height:4px;overflow:hidden;margin-bottom:8px;">';
          var barColor = allDone ? '#10b981' : hasIssues ? '#f59e0b' : '#1a9ee0';
          html += '<div style="height:100%;border-radius:4px;background:' + barColor + ';width:' + pct + '%;transition:width 0.4s ease;"></div>';
          html += '</div>';

          // Stats row
          html += '<div style="display:flex;gap:12px;font-size:11px;color:var(--text-muted);align-items:center;flex-wrap:wrap;">';
          html += '<span>' + st.total + ' images</span>';
          html += '<span style="color:#10b981;">' + st.completed + '</span>';
          if (st.failed > 0) html += '<span style="color:#ef4444;">' + st.failed + '</span>';
          if (st.queued > 0) html += '<span style="color:#f59e0b;">' + st.queued + '</span>';
          if (st.pending > 0) html += '<span>' + st.pending + ' pending</span>';

          // Action buttons
          if (st.failed > 0 || st.queued > 0) {
            html += '<div style="margin-left:auto;display:flex;gap:6px;">';
            html += '<button onclick="window.__r2RetryExecution(\'' + exec.id + '\')" style="background:none;border:1px solid rgba(26,158,224,0.3);color:#1a9ee0;padding:3px 10px;border-radius:6px;font-size:10px;cursor:pointer;font-weight:600;">Retry</button>';
            html += '<button onclick="window.__r2ResetExecution(\'' + exec.id + '\')" style="background:none;border:1px solid rgba(239,68,68,0.2);color:#f87171;padding:3px 10px;border-radius:6px;font-size:10px;cursor:pointer;">Reset</button>';
            html += '</div>';
          }
          html += '</div>';
          html += '</div>';
        } catch (e) {
          console.warn('[R2 Status] Error loading status for execution', exec.id, e);
        }
      }

      listEl.innerHTML = html;
      if (emptyEl) emptyEl.style.display = html ? 'none' : 'block';
    } catch (e) {
      console.error('[R2 Status] Error:', e);
      listEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:16px;">Error loading R2 status</div>';
    }
  }

  // Global handlers for retry/reset buttons (called from onclick in generated HTML)
  window.__r2RetryExecution = async function(executionId) {
    try {
      // First reset failed/queued back to pending
      await window.api.invoke('delivery-r2-reset-status', { executionId, statuses: ['failed', 'queued'] });
      // Then start the upload
      var result = await window.api.invoke('delivery-r2-upload-start', executionId);
      if (result && result.success && result.data) {
        if (result.data.error) {
          dlNotify('R2 Upload: ' + result.data.error, 'error');
        } else {
          console.log('[R2] Retry queued: ' + (result.data.queued || 0) + ' images');
        }
      }
      // Refresh the status display after a short delay
      setTimeout(loadR2ExecutionStatus, 1500);
    } catch (e) {
      dlNotify('Retry failed: ' + (e.message || e), 'error');
    }
  };

  window.__r2ResetExecution = async function(executionId) {
    if (!confirm('Reset all failed/queued uploads for this execution back to pending?')) return;
    try {
      var result = await window.api.invoke('delivery-r2-reset-status', { executionId, statuses: ['failed', 'queued'] });
      if (result && result.success) {
        console.log('[R2] Reset ' + (result.data?.reset || 0) + ' images');
        await loadR2ExecutionStatus();
      }
    } catch (e) {
      dlNotify('Reset failed: ' + (e.message || e), 'error');
    }
  };

  window.__r2UpdateFolder = async function(executionId) {
    try {
      var result = await window.api.invoke('delivery-browse-source-folder', executionId);
      if (!result || !result.success) return;
      var data = result.data;
      if (data.cancelled) return;

      // Update the displayed path immediately
      var folderEl = document.getElementById('r2-folder-' + executionId);
      if (folderEl) {
        folderEl.textContent = data.sourceFolder;
        folderEl.title = data.sourceFolder;
        folderEl.style.color = 'var(--text-muted)';
      }

      console.log('[R2] Source folder updated to: ' + data.sourceFolder);
    } catch (e) {
      dlNotify('Failed to update folder: ' + (e.message || e), 'error');
    }
  };

})();
