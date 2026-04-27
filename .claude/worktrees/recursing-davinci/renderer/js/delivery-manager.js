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

    await loadGalleries();
    if (planLimits.projects_enabled) await loadProjects();
    bindEvents();
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
    if (!grid) return;

    if (galleries.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    grid.innerHTML = galleries.map(function(g) {
      var statusColor = g.status === 'published' ? '#10b981' : '#f59e0b';
      var statusBg = g.status === 'published' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)';
      return '<div class="delivery-card" data-id="' + g.id + '" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; transition: border-color 0.2s; cursor: pointer;">' +
        '<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">' +
          '<h4 style="color: var(--text-primary); font-size: 14px; font-weight: 600; margin: 0;">' + escapeHtml(g.title) + '</h4>' +
          '<span style="font-size: 10px; padding: 2px 8px; border-radius: 99px; background: ' + statusBg + '; color: ' + statusColor + ';">' + g.status + '</span>' +
        '</div>' +
        '<div style="display: flex; gap: 16px; color: var(--text-muted); font-size: 12px;">' +
          '<span>👁 ' + (g.total_views || 0) + ' views</span>' +
          '<span>⬇ ' + (g.total_downloads || 0) + ' downloads</span>' +
        '</div>' +
        '<div style="margin-top: 8px; color: var(--text-muted); font-size: 11px;">' +
          (g.access_type === 'unrestricted' ? '🌐 Public' : '🔒 Code required') +
        '</div>' +
      '</div>';
    }).join('');

    // Add hover effects and click handlers
    grid.querySelectorAll('.delivery-card').forEach(function(card) {
      card.addEventListener('mouseenter', function() { this.style.borderColor = 'var(--accent-primary)'; });
      card.addEventListener('mouseleave', function() { this.style.borderColor = 'var(--border-color)'; });
      card.addEventListener('click', function() { openGalleryDetail(this.dataset.id); });
    });
  }

  function renderProjects() {
    var grid = document.getElementById('projects-grid');
    if (!grid) return;

    if (projects.length === 0) {
      grid.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; padding: 20px; text-align: center;">No projects yet. Create one to organize multi-client delivery.</div>';
      return;
    }

    grid.innerHTML = projects.map(function(p) {
      return '<div class="project-card" data-id="' + p.id + '" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; cursor: pointer; transition: border-color 0.2s;">' +
        '<h4 style="color: var(--text-primary); font-size: 14px; font-weight: 600; margin: 0 0 4px;">' + escapeHtml(p.name) + '</h4>' +
        '<div style="color: var(--text-muted); font-size: 12px; margin-bottom: 8px;">' +
          (p.event_location ? escapeHtml(p.event_location) : '') +
          (p.event_date_start ? ' • ' + p.event_date_start : '') +
        '</div>' +
        '<div style="color: var(--text-muted); font-size: 11px;">' +
          '🖼 ' + (p.galleries ? p.galleries.length : 0) + ' galleries' +
        '</div>' +
      '</div>';
    }).join('');

    // Bind click + hover on project cards
    grid.querySelectorAll('.project-card').forEach(function(card) {
      card.addEventListener('click', function() { openProjectDetail(this.dataset.id); });
      card.addEventListener('mouseenter', function() { this.style.borderColor = 'var(--accent-primary)'; });
      card.addEventListener('mouseleave', function() { this.style.borderColor = 'var(--border-color)'; });
    });
  }

  async function openProjectDetail(projectId) {
    selectedProjectId = projectId;
    document.getElementById('delivery-galleries-section').style.display = 'none';
    document.getElementById('delivery-projects-section').style.display = 'none';
    document.getElementById('delivery-project-detail').style.display = 'block';

    try {
      var result = await window.api.invoke('delivery-get-project', projectId);
      if (!result || !result.success) return;
      var project = result.data;

      document.getElementById('project-detail-header').innerHTML =
        '<h2 style="color: var(--text-primary); font-size: 20px; font-weight: 700; margin: 0 0 4px;">' + escapeHtml(project.name) + '</h2>' +
        '<p style="color: var(--text-muted); font-size: 13px; margin: 0;">' +
          (project.event_location ? escapeHtml(project.event_location) : '') +
          (project.event_date_start ? ' • ' + project.event_date_start + (project.event_date_end ? ' → ' + project.event_date_end : '') : '') +
        '</p>';

      // Render project galleries
      var pgGrid = document.getElementById('project-galleries-grid');
      var projectGalleries = project.galleries || [];
      pgGrid.innerHTML = projectGalleries.length === 0
        ? '<div style="color: var(--text-muted); font-size: 13px;">No galleries in this project yet.</div>'
        : projectGalleries.map(function(g) {
            return '<div style="background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px;">' +
              '<h5 style="color: var(--text-primary); font-size: 13px; margin: 0 0 4px;">' + escapeHtml(g.title) + '</h5>' +
              '<div style="color: var(--text-muted); font-size: 11px;">👁 ' + (g.total_views || 0) + ' • ⬇ ' + (g.total_downloads || 0) + '</div>' +
            '</div>';
          }).join('');

      // Delivery rules
      if (planLimits && planLimits.delivery_enabled) {
        document.getElementById('delivery-rules-section').style.display = 'block';
        var rulesList = document.getElementById('delivery-rules-list');
        var rules = project.delivery_rules || [];
        rulesList.innerHTML = rules.length === 0
          ? '<div style="color: var(--text-muted); font-size: 13px;">No delivery rules defined yet.</div>'
          : rules.map(function(r) {
              var mc = r.match_criteria || {};
              var activeColor = r.is_active ? '#10b981' : '#94a3b8';
              var activeBg = r.is_active ? 'rgba(16,185,129,0.2)' : 'rgba(148,163,184,0.2)';
              return '<div style="background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; display: flex; align-items: center; justify-content: space-between;">' +
                '<div>' +
                  '<span style="color: var(--text-primary); font-size: 13px; font-weight: 600;">' + escapeHtml(r.rule_name) + '</span>' +
                  '<span style="color: var(--text-muted); font-size: 11px; margin-left: 8px;">' +
                    (mc.teams && mc.teams.length ? '| Teams: ' + mc.teams.join(', ') : '') +
                    (mc.numbers && mc.numbers.length ? '| #' + mc.numbers.join(', #') : '') +
                  '</span>' +
                '</div>' +
                '<span style="font-size: 10px; padding: 2px 8px; border-radius: 99px; background: ' + activeBg + '; color: ' + activeColor + ';">' + (r.is_active ? 'Active' : 'Disabled') + '</span>' +
              '</div>';
            }).join('');
      }
    } catch (e) {
      console.error('[Delivery] Failed to load project:', e);
    }
  }

  function closeProjectDetail() {
    selectedProjectId = null;
    document.getElementById('delivery-project-detail').style.display = 'none';
    document.getElementById('delivery-galleries-section').style.display = 'block';
    if (planLimits && planLimits.projects_enabled) {
      document.getElementById('delivery-projects-section').style.display = 'block';
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
      if (!title) return;
      try {
        var galleryData = {
          title: title,
          access_type: access,
          gallery_type: access === 'unrestricted' ? 'open' : 'private'
        };
        // If we're inside a project, associate the gallery
        if (selectedProjectId) {
          galleryData.project_id = selectedProjectId;
        }
        var result = await window.api.invoke('delivery-create-gallery', galleryData);
        if (result && result.success) {
          hideModal('modal-create-gallery');
          document.getElementById('input-gallery-title').value = '';
          await loadGalleries();
          // Refresh project detail if we were inside one
          if (selectedProjectId) {
            await openProjectDetail(selectedProjectId);
          }
        } else {
          alert('Error: ' + (result ? result.error : 'Unknown'));
        }
      } catch (e) {
        alert('Error creating gallery');
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
      var location = document.getElementById('input-project-location').value.trim();
      var start = document.getElementById('input-project-start').value;
      var end = document.getElementById('input-project-end').value;
      if (!name) return;
      try {
        var result = await window.api.invoke('delivery-create-project', {
          name: name,
          event_location: location || null,
          event_date_start: start || null,
          event_date_end: end || null
        });
        if (result && result.success) {
          hideModal('modal-create-project');
          ['input-project-name', 'input-project-location', 'input-project-start', 'input-project-end'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
          });
          await loadProjects();
        } else {
          alert('Error: ' + (result ? result.error : 'Unknown'));
        }
      } catch (e) {
        alert('Error creating project');
      }
    });

    // Back button
    var btnBack = document.getElementById('btn-back-to-projects');
    if (btnBack) btnBack.addEventListener('click', closeProjectDetail);

    // Add gallery to project button (reuses the gallery modal but associates with project)
    var btnAddGalleryToProject = document.getElementById('btn-add-gallery-to-project');
    if (btnAddGalleryToProject) btnAddGalleryToProject.addEventListener('click', function() { showModal('modal-create-gallery'); });

    // Add delivery rule button
    var btnAddRule = document.getElementById('btn-add-rule');
    if (btnAddRule) btnAddRule.addEventListener('click', function() {
      showModal('modal-create-rule');
      populateRuleGalleryDropdown();
    });

    // Close modals on backdrop click
    ['modal-create-gallery', 'modal-create-project', 'modal-create-rule', 'modal-gallery-detail'].forEach(function(id) {
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
      alert('Rule name and target gallery are required');
      return;
    }

    var matchCriteria = {
      teams: teams ? teams.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; }) : [],
      numbers: numbers ? numbers.split(',').map(function(n) { return n.trim(); }).filter(function(n) { return n; }) : [],
      participants: participants ? participants.split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p; }) : []
    };

    var ruleData = {
      project_id: selectedProjectId,
      rule_name: name,
      gallery_id: galleryId,
      match_criteria: matchCriteria,
      priority: priority,
      is_active: isActive
    };

    try {
      window.api.invoke('delivery-create-rule', ruleData).then(function(result) {
        if (result && result.success) {
          hideModal('modal-create-rule');
          document.getElementById('input-rule-name').value = '';
          document.getElementById('input-rule-teams').value = '';
          document.getElementById('input-rule-numbers').value = '';
          document.getElementById('input-rule-participants').value = '';
          document.getElementById('input-rule-priority').value = '1';
          document.getElementById('input-rule-active').checked = true;
          if (selectedProjectId) {
            openProjectDetail(selectedProjectId);
          }
        } else {
          alert('Error: ' + (result ? result.error : 'Unknown'));
        }
      }).catch(function(e) {
        alert('Error creating rule');
        console.error('[Delivery] Rule creation error:', e);
      });
    } catch (e) {
      alert('Error creating rule');
      console.error('[Delivery] Rule creation error:', e);
    }
  }

  function openGalleryDetail(galleryId) {
    var gallery = galleries.find(function(g) { return g.id === galleryId; });
    if (!gallery) return;

    var modal = document.getElementById('modal-gallery-detail');
    if (!modal) return;

    document.getElementById('gallery-detail-name').textContent = gallery.title;
    document.getElementById('gallery-detail-slug').textContent = gallery.slug || '(no slug)';
    document.getElementById('gallery-detail-status').textContent = gallery.status;
    document.getElementById('gallery-detail-views').textContent = gallery.total_views || 0;
    document.getElementById('gallery-detail-downloads').textContent = gallery.total_downloads || 0;
    document.getElementById('gallery-detail-title').textContent = gallery.title;

    // Update status-dependent buttons
    var btnToggle = document.getElementById('btn-toggle-gallery-status');
    if (btnToggle) btnToggle.textContent = gallery.status === 'published' ? 'Unpublish' : 'Publish';

    // Store gallery ID in modal for later use
    modal.dataset.galleryId = galleryId;

    // Load recent executions into the dropdown
    var execSelect = document.getElementById('gallery-detail-execution-select');
    if (execSelect) {
      execSelect.innerHTML = '<option value="">-- Select an execution --</option>';
      window.api.invoke('delivery-get-recent-executions').then(function(result) {
        if (result && result.success && result.data) {
          result.data.forEach(function(exec) {
            var option = document.createElement('option');
            option.value = exec.id;
            option.textContent = (exec.name || 'Execution') + ' (' + (exec.processed_images || 0) + ' photos, ' + (exec.execution_at ? exec.execution_at.split('T')[0] : '') + ')';
            execSelect.appendChild(option);
          });
        }
      }).catch(function() {});
    }

    showModal('modal-gallery-detail');
  }

  function toggleGalleryStatus(galleryId) {
    var gallery = galleries.find(function(g) { return g.id === galleryId; });
    var newStatus = gallery && gallery.status === 'published' ? 'draft' : 'published';
    try {
      window.api.invoke('delivery-update-gallery', { id: galleryId, data: { status: newStatus } }).then(function(result) {
        if (result && result.success) {
          loadGalleries();
          var modal = document.getElementById('modal-gallery-detail');
          if (modal && modal.dataset.galleryId === galleryId) {
            openGalleryDetail(galleryId);
          }
        } else {
          alert('Error: ' + (result ? result.error : 'Unknown'));
        }
      }).catch(function(e) {
        alert('Error updating gallery');
        console.error('[Delivery] Update error:', e);
      });
    } catch (e) {
      alert('Error updating gallery');
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
          alert('Error: ' + (result ? result.error : 'Unknown'));
        }
      }).catch(function(e) {
        alert('Error deleting gallery');
        console.error('[Delivery] Delete error:', e);
      });
    } catch (e) {
      alert('Error deleting gallery');
      console.error('[Delivery] Delete error:', e);
    }
  }

  function sendExecutionToGallery(galleryId, executionId) {
    if (!executionId) {
      alert('Please select an execution');
      return;
    }
    try {
      window.api.invoke('delivery-send-execution-to-gallery', { galleryId: galleryId, executionId: executionId }).then(function(result) {
        if (result && result.success) {
          alert('Images sent to gallery successfully');
          document.getElementById('gallery-detail-execution-select').value = '';
        } else {
          alert('Error: ' + (result ? result.error : 'Unknown'));
        }
      }).catch(function(e) {
        alert('Error sending images');
        console.error('[Delivery] Send error:', e);
      });
    } catch (e) {
      alert('Error sending images');
      console.error('[Delivery] Send error:', e);
    }
  }

  function showRoutingBanner(results) {
    var banner = document.getElementById('delivery-routing-banner');
    var message = document.getElementById('delivery-routing-message');
    if (!banner || !message) return;

    var routed = results.routed_count || 0;
    var galleries = results.galleries_count || 0;
    var unmatched = results.unmatched_count || 0;

    message.textContent = routed + ' photos routed to ' + galleries + ' galleries, ' + unmatched + ' unmatched';
    banner.style.display = 'block';

    setTimeout(function() {
      if (banner.style.display === 'block') {
        banner.style.display = 'none';
      }
    }, 8000);
  }

  function bindDeliveryRuleEvents() {
    var btnCancelRule = document.getElementById('btn-cancel-rule');
    if (btnCancelRule) {
      btnCancelRule.addEventListener('click', function() { hideModal('modal-create-rule'); });
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

    var btnDeleteGallery = document.getElementById('btn-delete-gallery');
    if (btnDeleteGallery) {
      btnDeleteGallery.addEventListener('click', function() {
        var modal = document.getElementById('modal-gallery-detail');
        if (modal && modal.dataset.galleryId) {
          deleteGallery(modal.dataset.galleryId);
        }
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
          showRoutingBanner({ routed_count: data.routed, galleries_count: 0, unmatched_count: data.unmatched });
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
      alert('Please select at least one option or leave a comment.');
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
        alert('Error submitting. Please try again.');
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.textContent = 'Submit Feedback';
        }
      }
    } catch (e) {
      alert('Error submitting. Please try again.');
      console.error('[Delivery] Survey submission error:', e);
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Submit Feedback';
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
