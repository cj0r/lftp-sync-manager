// State variables
let ws = null;
let speedChart = null;
let currentConfig = null;
let tempMfaSecret = null;
let activeWorkflowTab = 'push'; // 'push' or 'pull'
const consoleOutput = document.getElementById('console-output');

// Multi-profile state
let profiles = [];
let activeProfileId = '';
let selectedProfileId = '';

// Global fetch interceptor to catch 401 Unauthorized errors
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  try {
    const response = await originalFetch(...args);
    if (response.status === 401) {
      window.location.href = '/login.html';
    }
    return response;
  } catch (err) {
    throw err;
  }
};

// Toast notifications (replaces native alert() so they don't block the UI)
let toastContainer = null;
function showToast(message, type = 'info') {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const icons = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle', info: 'info' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i data-lucide="${icons[type] || 'info'}"></i><span class="toast-message"></span><button type="button" class="toast-close" aria-label="Dismiss"><i data-lucide="x"></i></button>`;
  toast.querySelector('.toast-message').textContent = message;

  const dismiss = () => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 250);
  };
  toast.querySelector('.toast-close').addEventListener('click', dismiss);

  toastContainer.appendChild(toast);
  lucide.createIcons();
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(dismiss, type === 'error' ? 7000 : 4500);
}

// App-native replacements for confirm()/prompt(). Native dialogs block the
// entire page (and, notably, any automated browser control) until a human
// physically clicks them — these render as a normal in-app modal instead,
// resolving/rejecting a Promise so call sites can keep using async/await.
function showAppModal({ message, defaultValue = null, isPrompt = false, danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('app-confirm-overlay');
    const messageEl = document.getElementById('app-confirm-message');
    const inputWrapper = document.getElementById('app-confirm-input-wrapper');
    const input = document.getElementById('app-confirm-input');
    const btnOk = document.getElementById('app-confirm-ok');
    const btnCancel = document.getElementById('app-confirm-cancel');

    messageEl.textContent = message;
    inputWrapper.style.display = isPrompt ? 'block' : 'none';
    if (isPrompt) input.value = defaultValue || '';
    btnOk.classList.toggle('btn-danger', danger);
    btnOk.classList.toggle('btn-primary', !danger);

    overlay.style.display = 'flex';
    if (isPrompt) {
      input.focus();
      input.select();
    } else {
      btnOk.focus();
    }

    const cleanup = (result) => {
      overlay.style.display = 'none';
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      overlay.removeEventListener('keydown', onKeydown);
      resolve(result);
    };
    const onOk = () => cleanup(isPrompt ? input.value : true);
    const onCancel = () => cleanup(isPrompt ? null : false);
    const onKeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };

    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
    overlay.addEventListener('keydown', onKeydown);
  });
}

function showAppConfirm(message, { danger = false } = {}) {
  return showAppModal({ message, isPrompt: false, danger });
}

function showAppPrompt(message, defaultValue = '') {
  return showAppModal({ message, defaultValue, isPrompt: true });
}

// Escape a string for safe interpolation into innerHTML. Filenames (local
// filesystem or remote SFTP) can legally contain HTML-special characters like
// < > " ' & — without this, a crafted filename could inject markup into the
// File Explorer view.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Copy text to the clipboard. navigator.clipboard is only available in secure
// contexts (HTTPS or localhost) and can still reject even when present (focus,
// permissions, browser quirks) — always falls back to a hidden textarea +
// execCommand for plain-HTTP deployments (e.g. a self-hosted Docker instance
// on a LAN IP) or any other clipboard-API failure.
function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => copyTextToClipboardFallback(text));
  }
  return copyTextToClipboardFallback(text);
}

function copyTextToClipboardFallback(text) {
  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (success) {
        resolve();
      } else {
        reject(new Error('execCommand copy failed'));
      }
    } catch (err) {
      reject(err);
    }
  });
}

// WS Status UI
const wsStatusDot = document.querySelector('#ws-status .status-dot');
const wsStatusText = document.getElementById('ws-status-text');

// Settings Drawer/Modal UI
const btnSettingsToggle = document.getElementById('btn-settings-toggle');
const btnSettingsClose = document.getElementById('btn-settings-close');
const settingsDrawer = document.getElementById('settings-drawer');
const drawerBackdrop = document.getElementById('drawer-backdrop');

// Push Status Card UI
const pushSyncBadge = document.getElementById('push-sync-badge');
const pushStatusDetail = document.getElementById('push-status-detail');
const btnPushSync = document.getElementById('btn-push-sync');
const btnPushSyncText = document.getElementById('btn-push-sync-text');
const btnPushPause = document.getElementById('btn-push-pause');
const btnPushPauseText = document.getElementById('btn-push-pause-text');
const btnPushAbort = document.getElementById('btn-push-abort');
const pushLiveSpeedContainer = document.getElementById('push-live-speed-container');
const pushLiveSpeedValue = document.getElementById('push-live-speed-value');

// Pull Status Card UI
const pullSyncBadge = document.getElementById('pull-sync-badge');
const pullStatusDetail = document.getElementById('pull-status-detail');
const btnPullSync = document.getElementById('btn-pull-sync');
const btnPullSyncText = document.getElementById('btn-pull-sync-text');
const btnPullPause = document.getElementById('btn-pull-pause');
const btnPullPauseText = document.getElementById('btn-pull-pause-text');
const btnPullAbort = document.getElementById('btn-pull-abort');
const pullLiveSpeedContainer = document.getElementById('pull-live-speed-container');
const pullLiveSpeedValue = document.getElementById('pull-live-speed-value');

// Metrics UI
const statPushAvgSpeed = document.getElementById('stat-push-avg-speed');
const statPushAvgSpeedMbs = document.getElementById('stat-push-avg-speed-mbs');
const statPullAvgSpeed = document.getElementById('stat-pull-avg-speed');
const statPullAvgSpeedMbs = document.getElementById('stat-pull-avg-speed-mbs');
const statPushAvgLabel = document.getElementById('stat-push-avg-label');
const statPullAvgLabel = document.getElementById('stat-pull-avg-label');

// Settings Form UI
const settingsForm = document.getElementById('settings-form');
const pushEnabled = document.getElementById('pushEnabled');
const pullEnabled = document.getElementById('pullEnabled');
const pushCronEnabled = document.getElementById('pushCronEnabled');
const pushCronScheduleGroup = document.getElementById('push-cron-schedule-group');
const pushCronSchedule = document.getElementById('pushCronSchedule');
const pushWatchEnabled = document.getElementById('pushWatchEnabled');
const pullCronEnabled = document.getElementById('pullCronEnabled');
const pullCronScheduleGroup = document.getElementById('pull-cron-schedule-group');
const pullCronSchedule = document.getElementById('pullCronSchedule');
const pushSettingsFields = document.getElementById('push-settings-fields');
const pullSettingsFields = document.getElementById('pull-settings-fields');
const btnTestConnection = document.getElementById('btn-test-connection');
const throttleEnabled = document.getElementById('throttleEnabled');
const throttleSettingsFields = document.getElementById('throttle-settings-fields');
const throttleDownloadLimit = document.getElementById('throttleDownloadLimit');
const throttleUploadLimit = document.getElementById('throttleUploadLimit');
const throttleScheduleStart = document.getElementById('throttleScheduleStart');
const throttleScheduleEnd = document.getElementById('throttleScheduleEnd');
const excludePatterns = document.getElementById('excludePatterns');
const includePatterns = document.getElementById('includePatterns');
const syncDelete = document.getElementById('syncDelete');
const syncDryRun = document.getElementById('syncDryRun');
const syncIgnoreTime = document.getElementById('syncIgnoreTime');
const syncOnlyMissing = document.getElementById('syncOnlyMissing');
const throttleDayCheckboxes = document.querySelectorAll('.throttle-day-checkbox');


// Console Actions and Tabs
const btnClearConsole = document.getElementById('btn-clear-console');
const btnClearServerLogs = document.getElementById('btn-clear-server-logs');
const btnClearHistory = document.getElementById('clear-history-btn');
const btnLogsClose = document.getElementById('btn-logs-close');
const tabPushLogs = document.getElementById('tab-push-logs');
const tabPullLogs = document.getElementById('tab-pull-logs');
const btnDownloadLogs = document.getElementById('btn-download-logs');

// Connect to WebSocket Server
function connectWS() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    wsStatusDot.className = 'status-dot green';
    wsStatusText.textContent = 'Connected';
    consoleOutput.textContent = '[Websocket] Connected to server.\n';
  };
  
  ws.onclose = () => {
    wsStatusDot.className = 'status-dot red';
    wsStatusText.textContent = 'Disconnected';
    consoleOutput.textContent += '\n[Websocket] Disconnected. Reconnecting in 5 seconds...\n';
    setTimeout(connectWS, 5000);
  };
  
  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWSMessage(data);
    } catch (err) {
      appendConsole(event.data);
    }
  };
}

// Handle WebSocket Events
function handleWSMessage(data) {
  switch (data.type) {
    case 'init':
      updateWorkflowStatus('push', data.push.isSyncing, data.push.startTime, data.push.lastCompleted, data.push.status);
      updateWorkflowStatus('pull', data.pull.isSyncing, data.pull.startTime, data.pull.lastCompleted, data.pull.status);
      updateActiveTransfersUI('push', data.pushTransfers || []);
      updateActiveTransfersUI('pull', data.pullTransfers || []);
      updateMetrics(data.pushAverageSpeed30Days, data.pullAverageSpeed30Days);
      updateChart(data.history);
      if (data.profiles && data.activeProfileId) {
        profiles = data.profiles;
        activeProfileId = data.activeProfileId;
        if (!selectedProfileId || !profiles.some(p => p.id === selectedProfileId)) {
          selectedProfileId = activeProfileId;
        }
        renderProfileSelectors();
        loadProfileIntoForm(selectedProfileId);
      }
      break;
      
    case 'status':
      updateWorkflowStatus('push', data.push.isSyncing, data.push.startTime, data.push.lastCompleted, data.push.status);
      updateWorkflowStatus('pull', data.pull.isSyncing, data.pull.startTime, data.pull.lastCompleted, data.pull.status);
      break;
      
    case 'current_speed':
      if (data.workflow === 'push') {
        if (pushLiveSpeedContainer && pushLiveSpeedValue) {
          pushLiveSpeedContainer.style.display = 'flex';
          pushLiveSpeedValue.textContent = `${data.speedMbps.toFixed(2)} Mbps`;
        }
      } else {
        if (pullLiveSpeedContainer && pullLiveSpeedValue) {
          pullLiveSpeedContainer.style.display = 'flex';
          pullLiveSpeedValue.textContent = `${data.speedMbps.toFixed(2)} Mbps`;
        }
      }
      break;
      
    case 'active_transfers':
      updateActiveTransfersUI(data.workflow, data.transfers);
      break;

    case 'log':
      if (data.workflow === activeWorkflowTab) {
        appendConsole(data.text);
      }
      break;

    case 'clear_logs':
      if (data.workflow === activeWorkflowTab) {
        consoleOutput.textContent = '';
      }
      break;
      
    case 'history_update':
      updateChart(data.history);
      updateMetrics(data.pushAverageSpeed30Days, data.pullAverageSpeed30Days);
      break;
      
    case 'profile_switched':
      activeProfileId = data.activeProfileId;
      selectedProfileId = data.activeProfileId;
      fetchConfig();
      fetchLogs();
      break;

    default:
      console.log('Unknown WS message type:', data.type);
  }
}

function updateActiveTransfersUI(workflow, transfers) {
  const container = document.getElementById(`${workflow}-active-transfers-container`);
  const list = document.getElementById(`${workflow}-active-transfers`);
  if (!container || !list) return;

  if (!transfers || transfers.length === 0) {
    container.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  container.style.display = 'block';
  
  let html = '';
  transfers.forEach(t => {
    html += `
      <div class="active-transfer-item">
        <div class="active-transfer-meta">
          <span class="active-transfer-name" title="${t.filename}">${t.filename}</span>
          <span>${t.percent}%</span>
        </div>
        <div class="active-transfer-progress-bg">
          <div class="active-transfer-progress-bar" style="width: ${t.percent}%"></div>
        </div>
        <div class="active-transfer-stats">
          <span>${t.transferred} / ${t.total}</span>
          <span>&bull;</span>
          <span>${t.speed}</span>
          <span>&bull;</span>
          <span>ETA: ${t.eta}</span>
        </div>
      </div>
    `;
  });
  list.innerHTML = html;
}

// Logs Drawer UI Elements
const btnLogsToggle = document.getElementById('btn-logs-toggle');
const logsDrawer = document.getElementById('logs-drawer');

// Help Modal UI Elements
const helpModal = document.getElementById('help-modal');
const btnHelpToggle = document.getElementById('btn-help-toggle');
const btnHelpClose = document.getElementById('btn-help-close');
const btnHelpOk = document.getElementById('btn-help-ok');
const chkHelpSuppress = document.getElementById('chk-help-suppress');

// Toggle Drawer Panels
function updateBodyScrollLock() {
  const isAnyOpen = settingsDrawer.classList.contains('open') ||
                    logsDrawer.classList.contains('open') ||
                    (document.getElementById('explorer-drawer') && document.getElementById('explorer-drawer').classList.contains('open')) ||
                    helpModal.classList.contains('open');
  if (isAnyOpen) {
    document.body.classList.add('modal-open');
  } else {
    document.body.classList.remove('modal-open');
  }
}

function toggleDrawer(open) {
  if (open) {
    settingsDrawer.classList.add('open');
    drawerBackdrop.classList.add('open');
  } else {
    settingsDrawer.classList.remove('open');
    drawerBackdrop.classList.remove('open');
  }
  updateBodyScrollLock();
}

function toggleLogsDrawer(open) {
  if (open) {
    logsDrawer.classList.add('open');
    drawerBackdrop.classList.add('open');
    // Scroll logs to bottom on open
    setTimeout(() => {
      const wrapper = consoleOutput.parentElement;
      if (wrapper) {
        wrapper.scrollTop = wrapper.scrollHeight;
      }
    }, 100);
  } else {
    logsDrawer.classList.remove('open');
    drawerBackdrop.classList.remove('open');
  }
  updateBodyScrollLock();
}

function toggleHelpModal(open) {
  if (open) {
    helpModal.classList.add('open');
    drawerBackdrop.classList.add('open');
  } else {
    helpModal.classList.remove('open');
    drawerBackdrop.classList.remove('open');
    if (chkHelpSuppress.checked) {
      localStorage.setItem('lftp_help_shown', 'true');
    }
  }
  updateBodyScrollLock();
}

btnSettingsToggle.addEventListener('click', () => {
  toggleDrawer(true);
  fetchSSHStatus();
});
btnSettingsClose.addEventListener('click', () => toggleDrawer(false));
btnLogsToggle.addEventListener('click', () => toggleLogsDrawer(true));
btnLogsClose.addEventListener('click', () => toggleLogsDrawer(false));
btnHelpToggle.addEventListener('click', () => toggleHelpModal(true));
btnHelpClose.addEventListener('click', () => toggleHelpModal(false));
btnHelpOk.addEventListener('click', () => toggleHelpModal(false));


// Render selectors
function renderProfileSelectors() {
  const headerSelector = document.getElementById('header-profile-selector');
  const settingsSelector = document.getElementById('settings-profile-selector');
  const headerWrapper = document.getElementById('profile-select-wrapper');
  
  if (headerSelector) {
    headerSelector.innerHTML = '';
    profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === activeProfileId) opt.selected = true;
      headerSelector.appendChild(opt);
    });
    headerWrapper.style.display = 'flex';
  }

  if (settingsSelector) {
    settingsSelector.innerHTML = '';
    profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === selectedProfileId) opt.selected = true;
      settingsSelector.appendChild(opt);
    });
  }
}

// Load a specific profile into the settings form
function loadProfileIntoForm(profileId) {
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return;

  const fields = [
    'host', 'port', 'login', 'pass',
    'localPushDir', 'remotePullDir', 'remotePushDir', 'localPullDir',
    'nfile', 'nsegment', 'minchunk',
    'pushCronSchedule', 'pullCronSchedule',
    'throttleDownloadLimit', 'throttleUploadLimit',
    'throttleScheduleStart', 'throttleScheduleEnd',
    'excludePatterns', 'includePatterns'
  ];
  
  fields.forEach(field => {
    const element = document.getElementById(field);
    if (element) {
      element.value = profile[field] !== undefined ? profile[field] : '';
    }
  });

  pushEnabled.checked = !!profile.pushEnabled;
  pullEnabled.checked = !!profile.pullEnabled;
  pushCronEnabled.checked = !!profile.pushCronEnabled;
  pushWatchEnabled.checked = !!profile.pushWatchEnabled;
  pullCronEnabled.checked = !!profile.pullCronEnabled;
  throttleEnabled.checked = !!profile.throttleEnabled;
  syncDelete.checked = !!profile.syncDelete;
  syncDryRun.checked = !!profile.syncDryRun;
  syncIgnoreTime.checked = !!profile.syncIgnoreTime;
  syncOnlyMissing.checked = !!profile.syncOnlyMissing;

  // Clear day selection active classes
  throttleDayCheckboxes.forEach(cb => {
    cb.checked = false;
    const label = cb.closest('.day-checkbox-label');
    if (label) label.classList.remove('active');
  });

  // Check the day checkboxes
  const days = profile.throttleScheduleDays || [];
  days.forEach(day => {
    const cb = Array.from(throttleDayCheckboxes).find(c => c.value == day);
    if (cb) {
      cb.checked = true;
      const label = cb.closest('.day-checkbox-label');
      if (label) label.classList.add('active');
    }
  });

  toggleWorkflowFields();
  togglePushCronField();
  togglePullCronField();
  toggleThrottleFields();
}

// Write the inputs from the form into the client-side profiles array
function saveSelectedProfileFromForm() {
  if (!selectedProfileId) return;
  const profile = profiles.find(p => p.id === selectedProfileId);
  if (!profile) return;

  profile.host = document.getElementById('host').value.trim();
  profile.port = document.getElementById('port').value.trim();
  profile.login = document.getElementById('login').value.trim();
  profile.pass = document.getElementById('pass').value;

  profile.localPushDir = document.getElementById('localPushDir').value.trim();
  profile.remotePullDir = document.getElementById('remotePullDir').value.trim();
  profile.remotePushDir = document.getElementById('remotePushDir').value.trim();
  profile.localPullDir = document.getElementById('localPullDir').value.trim();

  profile.nfile = parseInt(document.getElementById('nfile').value, 10) || 2;
  profile.nsegment = parseInt(document.getElementById('nsegment').value, 10) || 16;
  profile.minchunk = parseInt(document.getElementById('minchunk').value, 10) || 1;

  profile.pushEnabled = pushEnabled.checked;
  profile.pushCronEnabled = pushCronEnabled.checked;
  profile.pushCronSchedule = pushCronSchedule.value.trim();
  profile.pushWatchEnabled = pushWatchEnabled.checked;

  profile.pullEnabled = pullEnabled.checked;
  profile.pullCronEnabled = pullCronEnabled.checked;
  profile.pullCronSchedule = pullCronSchedule.value.trim();

  profile.throttleEnabled = throttleEnabled.checked;
  profile.throttleDownloadLimit = throttleDownloadLimit.value ? parseInt(throttleDownloadLimit.value, 10) : 0;
  profile.throttleUploadLimit = throttleUploadLimit.value ? parseInt(throttleUploadLimit.value, 10) : 0;
  profile.throttleScheduleStart = throttleScheduleStart.value || '09:00';
  profile.throttleScheduleEnd = throttleScheduleEnd.value || '17:00';
  profile.throttleScheduleDays = Array.from(throttleDayCheckboxes).filter(cb => cb.checked).map(cb => parseInt(cb.value, 10));

  profile.excludePatterns = excludePatterns.value.trim();
  profile.includePatterns = includePatterns.value.trim();

  profile.syncDelete = syncDelete.checked;
  profile.syncDryRun = syncDryRun.checked;
  profile.syncIgnoreTime = syncIgnoreTime.checked;
  profile.syncOnlyMissing = syncOnlyMissing.checked;
}

// Load Initial Config via HTTP
async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const config = await res.json();
      currentConfig = config;
      
      profiles = config.profiles || [];
      activeProfileId = config.activeProfileId || '';
      
      if (!selectedProfileId || !profiles.some(p => p.id === selectedProfileId)) {
        selectedProfileId = activeProfileId;
      }
      
      renderProfileSelectors();
      loadProfileIntoForm(selectedProfileId);
      
      // Load global-only configurations
      const authEnabledInput = document.getElementById('authEnabled');
      const authCredentialsFields = document.getElementById('auth-credentials-fields');
      const btnLogout = document.getElementById('btn-logout');
      const mfaEnabledInput = document.getElementById('mfaEnabled');
      const mfaSetupPanel = document.getElementById('mfa-setup-panel');
      
      if (authEnabledInput) {
        authEnabledInput.checked = !!config.authEnabled;
        authCredentialsFields.style.display = config.authEnabled ? 'block' : 'none';
      }
      
      if (btnLogout) {
        btnLogout.style.display = config.authEnabled ? 'inline-flex' : 'none';
      }

      document.getElementById('authUser').value = config.authUser || '';
      document.getElementById('authPassword').value = '';
      
      if (mfaEnabledInput) {
        mfaEnabledInput.checked = !!config.mfaEnabled;
        mfaSetupPanel.style.display = 'none';
        tempMfaSecret = null;
      }
      
      const maxLogLinesInput = document.getElementById('maxLogLines');
      if (maxLogLinesInput) maxLogLinesInput.value = config.maxLogLines !== undefined ? config.maxLogLines : 5000;
      
      const logLevelInput = document.getElementById('logLevel');
      if (logLevelInput) logLevelInput.value = config.logLevel !== undefined ? config.logLevel : 2;
      
      const averageSpeedDaysInput = document.getElementById('averageSpeedDays');
      if (averageSpeedDaysInput) averageSpeedDaysInput.value = config.averageSpeedDays !== undefined ? config.averageSpeedDays : 7;
      
      // Update metric labels timeframe
      const avgDays = config.averageSpeedDays || 7;
      if (statPushAvgLabel) statPushAvgLabel.textContent = `Upload Avg Speed (${avgDays}d)`;
      if (statPullAvgLabel) statPullAvgLabel.textContent = `Download Avg Speed (${avgDays}d)`;
    }
  } catch (err) {
    console.error('Error fetching config:', err);
  }
}

// Toggle Workflow settings sections based on enabled states
function toggleWorkflowFields() {
  if (pushEnabled.checked) {
    pushSettingsFields.style.display = 'flex';
  } else {
    pushSettingsFields.style.display = 'none';
  }

  if (pullEnabled.checked) {
    pullSettingsFields.style.display = 'flex';
  } else {
    pullSettingsFields.style.display = 'none';
  }
}

function togglePushCronField() {
  if (pushCronEnabled.checked) {
    pushCronScheduleGroup.style.display = 'flex';
  } else {
    pushCronScheduleGroup.style.display = 'none';
  }
}

function togglePullCronField() {
  if (pullCronEnabled.checked) {
    pullCronScheduleGroup.style.display = 'flex';
  } else {
    pullCronScheduleGroup.style.display = 'none';
  }
}

function toggleThrottleFields() {
  if (throttleEnabled.checked) {
    throttleSettingsFields.style.display = 'flex';
  } else {
    throttleSettingsFields.style.display = 'none';
  }
}

pushEnabled.addEventListener('change', toggleWorkflowFields);
pullEnabled.addEventListener('change', toggleWorkflowFields);
pushCronEnabled.addEventListener('change', togglePushCronField);
pullEnabled.addEventListener('change', toggleWorkflowFields);
pullCronEnabled.addEventListener('change', togglePullCronField);
throttleEnabled.addEventListener('change', toggleThrottleFields);

// Handle checkbox day clicks styling transitions
throttleDayCheckboxes.forEach(cb => {
  cb.addEventListener('change', () => {
    const label = cb.closest('.day-checkbox-label');
    if (label) {
      if (cb.checked) {
        label.classList.add('active');
      } else {
        label.classList.remove('active');
      }
    }
  });
});


// Test connection handler
btnTestConnection.addEventListener('click', async () => {
  const host = document.getElementById('host').value;
  const port = document.getElementById('port').value;
  const login = document.getElementById('login').value;
  const pass = document.getElementById('pass').value;

  if (!host || !login) {
    showToast('Please enter Host IP/Domain and Username before testing connection.', 'warning');
    return;
  }

  // Update button UI state
  btnTestConnection.setAttribute('disabled', 'true');
  const origHTML = btnTestConnection.innerHTML;
  btnTestConnection.innerHTML = `<i data-lucide="loader-2" class="btn-icon spin"></i> Testing...`;
  lucide.createIcons();

  try {
    const res = await fetch('/api/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, login, pass })
    });
    
    const result = await res.json();
    if (res.ok && result.success) {
      showToast('SFTP Connection Successful!', 'success');
    } else {
      showToast(`SFTP Connection Failed:\n${result.error || 'Unknown Error'}`, 'error');
    }
  } catch (err) {
    showToast('SFTP Connection Failed: Network error trying to contact connection test API.', 'error');
  } finally {
    btnTestConnection.removeAttribute('disabled');
    btnTestConnection.innerHTML = origHTML;
    lucide.createIcons();
  }
});

// Save Config Form Submission
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // Save current form edits into the active profile array
  saveSelectedProfileFromForm();

  const payload = {
    profiles,
    // Preserve whichever profile is actually active for syncing — saving settings
    // for a *different* profile you happen to be editing must never silently
    // switch which one is live. Switching active profiles is only ever done
    // explicitly via the header dropdown (POST /api/profiles/active).
    activeProfileId,
    maxLogLines: parseInt(document.getElementById('maxLogLines').value, 10) || 5000,
    logLevel: isNaN(parseInt(document.getElementById('logLevel').value, 10)) ? 2 : parseInt(document.getElementById('logLevel').value, 10),
    averageSpeedDays: parseInt(document.getElementById('averageSpeedDays').value, 10) || 7,
    authEnabled: document.getElementById('authEnabled').checked,
    authUser: document.getElementById('authUser').value.trim(),
    mfaEnabled: document.getElementById('mfaEnabled').checked,
    mfaSecret: tempMfaSecret || (currentConfig ? currentConfig.mfaSecret : '')
  };

  const authPasswordVal = document.getElementById('authPassword').value;
  if (authPasswordVal) {
    payload.authPassword = authPasswordVal;
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      showToast('Configuration saved successfully.', 'success');
      toggleDrawer(false); // Close settings drawer on successful save
      fetchConfig();
    } else {
      const err = await res.json();
      showToast(`Error: ${err.error}`, 'error');
    }
  } catch (err) {
    showToast('Failed to save configuration', 'error');
  }
});

// Update Pulsing Status Badges by Workflow
function updateWorkflowStatus(workflow, isSyncing, startTime, lastCompleted, status) {
  const syncBadge = (workflow === 'push' ? pushSyncBadge : pullSyncBadge);
  const btnSync = (workflow === 'push' ? btnPushSync : btnPullSync);
  const btnSyncText = (workflow === 'push' ? btnPushSyncText : btnPullSyncText);
  const btnPause = (workflow === 'push' ? btnPushPause : btnPullPause);
  const btnPauseText = (workflow === 'push' ? btnPushPauseText : btnPullPauseText);
  const btnAbort = (workflow === 'push' ? btnPushAbort : btnPullAbort);
  const statusDetail = (workflow === 'push' ? pushStatusDetail : pullStatusDetail);
  const liveSpeedContainer = (workflow === 'push' ? pushLiveSpeedContainer : pullLiveSpeedContainer);
  const isPaused = status === 'paused';

  if (isSyncing) {
    if (syncBadge) {
      syncBadge.className = isPaused ? 'pulse-badge paused' : 'pulse-badge syncing';
      syncBadge.textContent = isPaused ? 'Paused' : 'Syncing';
    }
    if (btnSync) {
      btnSync.setAttribute('disabled', 'true');
      btnSyncText.textContent = 'Running...';
    }
    if (btnPause) {
      btnPause.removeAttribute('disabled');
      if (btnPauseText) {
        btnPauseText.textContent = isPaused ? 'Resume' : 'Pause';
      }
      const pauseIcon = btnPause.querySelector('[data-lucide]');
      if (pauseIcon) {
        pauseIcon.setAttribute('data-lucide', isPaused ? 'play' : 'pause');
      }
    }
    if (btnAbort) {
      btnAbort.removeAttribute('disabled');
    }

    lucide.createIcons();

    const startStr = startTime ? new Date(startTime).toLocaleTimeString() : new Date().toLocaleTimeString();
    if (statusDetail) {
      statusDetail.textContent = isPaused
        ? `${workflow === 'push' ? 'Upload' : 'Download'} sync paused. Resume to continue transferring.`
        : `${workflow === 'push' ? 'Upload' : 'Download'} sync started at ${startStr}. Checking files and transferring...`;
    }
  } else {
    if (syncBadge) {
      syncBadge.className = 'pulse-badge idle';
      syncBadge.textContent = 'Idle';
    }
    if (btnSync) {
      btnSync.removeAttribute('disabled');
      btnSyncText.textContent = workflow === 'push' ? 'Start Upload' : 'Start Download';
    }
    if (btnPause) {
      btnPause.setAttribute('disabled', 'true');
      if (btnPauseText) {
        btnPauseText.textContent = 'Pause';
      }
      const pauseIcon = btnPause.querySelector('[data-lucide]');
      if (pauseIcon) {
        pauseIcon.setAttribute('data-lucide', 'pause');
      }
      lucide.createIcons();
    }
    if (btnAbort) {
      btnAbort.setAttribute('disabled', 'true');
    }

    // Hide live speed indicator when idle
    if (liveSpeedContainer) {
      liveSpeedContainer.style.display = 'none';
    }

    if (statusDetail) {
      if (lastCompleted) {
        const endStr = new Date(lastCompleted.timestamp).toLocaleString();
        let statusText = lastCompleted.status || '';
        if (statusText.includes('(skipped - empty)')) {
          statusText = statusText.replace('(skipped - empty)', '<br><span style="opacity: 0.75; font-size: 0.9em; display: inline-block; margin-top: 0.15rem;">(skipped - empty)</span>');
          statusDetail.innerHTML = `Last sync completed at ${endStr} with status: ${statusText}`;
        } else {
          statusDetail.textContent = `Last sync completed at ${endStr} with status: ${statusText}`;
        }
      } else {
        statusDetail.textContent = `Ready to start ${workflow === 'push' ? 'Upload' : 'Download'} synchronization.`;
      }
    }
  }
}

// Update Average Speed Metrics UI
function updateMetrics(pushAverageSpeed30Days, pullAverageSpeed30Days) {
  if (pushAverageSpeed30Days) {
    const pushAvgMbps = pushAverageSpeed30Days.speedMbps || 0;
    const pushAvgMBs = pushAverageSpeed30Days.speedMBs || 0;
    if (statPushAvgSpeed) statPushAvgSpeed.textContent = `${pushAvgMbps.toFixed(2)} Mbps`;
    if (statPushAvgSpeedMbs) statPushAvgSpeedMbs.textContent = `${pushAvgMBs.toFixed(2)} MB/s`;
  } else {
    if (statPushAvgSpeed) statPushAvgSpeed.textContent = '0.00 Mbps';
    if (statPushAvgSpeedMbs) statPushAvgSpeedMbs.textContent = '0.00 MB/s';
  }
  
  if (pullAverageSpeed30Days) {
    const pullAvgMbps = pullAverageSpeed30Days.speedMbps || 0;
    const pullAvgMBs = pullAverageSpeed30Days.speedMBs || 0;
    if (statPullAvgSpeed) statPullAvgSpeed.textContent = `${pullAvgMbps.toFixed(2)} Mbps`;
    if (statPullAvgSpeedMbs) statPullAvgSpeedMbs.textContent = `${pullAvgMBs.toFixed(2)} MB/s`;
  } else {
    if (statPullAvgSpeed) statPullAvgSpeed.textContent = '0.00 Mbps';
    if (statPullAvgSpeedMbs) statPullAvgSpeedMbs.textContent = '0.00 MB/s';
  }
}

// Console Functions
function appendConsole(text) {
  consoleOutput.textContent += text;
  if (consoleOutput.textContent.length > 200000) {
    consoleOutput.textContent = consoleOutput.textContent.substring(consoleOutput.textContent.length - 100000);
  }
  consoleOutput.parentElement.scrollTop = consoleOutput.parentElement.scrollHeight;
}

// Console Tabs Events
if (tabPushLogs && tabPullLogs) {
  const switchLogTab = (workflow) => {
    activeWorkflowTab = workflow;
    
    // Toggle active classes
    tabPushLogs.classList.toggle('active', workflow === 'push');
    tabPullLogs.classList.toggle('active', workflow === 'pull');
    
    // Update download link
    if (btnDownloadLogs) {
      btnDownloadLogs.href = `/api/logs/${workflow}?lines=5000`;
    }
    
    // Fetch logs
    fetchLogs(workflow);
  };

  tabPushLogs.addEventListener('click', () => switchLogTab('push'));
  tabPullLogs.addEventListener('click', () => switchLogTab('pull'));
}

btnClearConsole.addEventListener('click', () => {
  consoleOutput.textContent = '';
});

if (btnClearServerLogs) {
  btnClearServerLogs.addEventListener('click', async () => {
    if (!await showAppConfirm(`Are you sure you want to permanently delete all server log history for ${activeWorkflowTab === 'push' ? 'Upload' : 'Download'}? This cannot be undone.`, { danger: true })) {
      return;
    }
    try {
      const res = await fetch(`/api/logs/${activeWorkflowTab}/clear`, { method: 'POST' });
      if (res.ok) {
        consoleOutput.textContent = `[System] Logs for ${activeWorkflowTab === 'push' ? 'Upload' : 'Download'} cleared on server.\n`;
      } else {
        const err = await res.json();
        showToast(`Error clearing server logs: ${err.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      console.error('Error clearing server logs:', err);
      showToast('Failed to contact server to clear logs.', 'error');
    }
  });
}

if (btnClearHistory) {
  btnClearHistory.addEventListener('click', async () => {
    if (!await showAppConfirm('Are you sure you want to permanently clear the speed history? This cannot be undone.', { danger: true })) {
      return;
    }
    try {
      const res = await fetch('/api/history/clear', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        showToast(`Error clearing speed history: ${err.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      console.error('Error clearing speed history:', err);
      showToast('Failed to contact server to clear speed history.', 'error');
    }
  });
}

// Trigger Manual Push (Upload) Sync
if (btnPushSync) {
  btnPushSync.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/sync/start/push', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        showToast(`Error starting Upload sync: ${err.error}`, 'error');
      }
    } catch (err) {
      console.error('Error starting Upload sync:', err);
    }
  });
}

// Trigger Manual Pull (Download) Sync
if (btnPullSync) {
  btnPullSync.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/sync/start/pull', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        showToast(`Error starting Download sync: ${err.error}`, 'error');
      }
    } catch (err) {
      console.error('Error starting Download sync:', err);
    }
  });
}

// Pause/Resume Active Push (Upload) Sync
if (btnPushPause) {
  btnPushPause.addEventListener('click', async () => {
    const action = btnPushPauseText && btnPushPauseText.textContent === 'Resume' ? 'resume' : 'pause';
    try {
      const res = await fetch(`/api/sync/${action}/push`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        showToast(`Error ${action === 'pause' ? 'pausing' : 'resuming'} Upload sync: ${err.error}`, 'error');
      }
    } catch (err) {
      console.error(`Error ${action === 'pause' ? 'pausing' : 'resuming'} Upload sync:`, err);
    }
  });
}

// Abort Active Push (Upload) Sync
if (btnPushAbort) {
  btnPushAbort.addEventListener('click', async () => {
    if (await showAppConfirm('Are you sure you want to abort the Upload sync process?', { danger: true })) {
      try {
        const res = await fetch('/api/sync/stop/push', { method: 'POST' });
        if (!res.ok) {
          const err = await res.json();
          showToast(`Error aborting Upload sync: ${err.error}`, 'error');
        }
      } catch (err) {
        console.error('Error aborting Upload sync:', err);
      }
    }
  });
}

// Pause/Resume Active Pull (Download) Sync
if (btnPullPause) {
  btnPullPause.addEventListener('click', async () => {
    const action = btnPullPauseText && btnPullPauseText.textContent === 'Resume' ? 'resume' : 'pause';
    try {
      const res = await fetch(`/api/sync/${action}/pull`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        showToast(`Error ${action === 'pause' ? 'pausing' : 'resuming'} Download sync: ${err.error}`, 'error');
      }
    } catch (err) {
      console.error(`Error ${action === 'pause' ? 'pausing' : 'resuming'} Download sync:`, err);
    }
  });
}

// Abort Active Pull (Download) Sync
if (btnPullAbort) {
  btnPullAbort.addEventListener('click', async () => {
    if (await showAppConfirm('Are you sure you want to abort the Download sync process?', { danger: true })) {
      try {
        const res = await fetch('/api/sync/stop/pull', { method: 'POST' });
        if (!res.ok) {
          const err = await res.json();
          showToast(`Error aborting Download sync: ${err.error}`, 'error');
        }
      } catch (err) {
        console.error('Error aborting Download sync:', err);
      }
    }
  });
}

// Load Initial Logs from Server
async function fetchLogs(workflow = activeWorkflowTab) {
  try {
    const res = await fetch(`/api/logs/${workflow}?lines=300`);
    if (res.ok) {
      const logs = await res.text();
      if (logs) {
        consoleOutput.textContent = logs;
      } else {
        consoleOutput.textContent = `No logs found for ${workflow === 'push' ? 'upload' : 'download'} sync.`;
      }
      consoleOutput.parentElement.scrollTop = consoleOutput.parentElement.scrollHeight;
    }
  } catch (err) {
    console.error('Error fetching logs:', err);
  }
}

// Initialize Chart.js Graph
function initChart() {
  const ctx = document.getElementById('speedChart').getContext('2d');
  
  const pushGradient = ctx.createLinearGradient(0, 0, 0, 200);
  pushGradient.addColorStop(0, 'rgba(129, 140, 248, 0.45)');
  pushGradient.addColorStop(1, 'rgba(129, 140, 248, 0.01)');

  const pullGradient = ctx.createLinearGradient(0, 0, 0, 200);
  pullGradient.addColorStop(0, 'rgba(16, 185, 129, 0.45)');
  pullGradient.addColorStop(1, 'rgba(16, 185, 129, 0.01)');

  speedChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Upload Speed (Mbps)',
          data: [],
          borderColor: '#818cf8',
          borderWidth: 3,
          backgroundColor: pushGradient,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#818cf8',
          pointBorderColor: '#fff',
          pointHoverRadius: 7,
          spanGaps: true
        },
        {
          label: 'Download Speed (Mbps)',
          data: [],
          borderColor: '#10b981',
          borderWidth: 3,
          backgroundColor: pullGradient,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#10b981',
          pointBorderColor: '#fff',
          pointHoverRadius: 7,
          spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(17, 25, 40, 0.9)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleFont: { family: 'Outfit', size: 13 },
          bodyFont: { family: 'Outfit', size: 12 },
          displayColors: true,
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} Mbps`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: '#6b7280',
            font: { family: 'Outfit', size: 11 }
          }
        },
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)'
          },
          ticks: {
            color: '#6b7280',
            font: { family: 'Outfit', size: 11 }
          },
          min: 0
        }
      }
    }
  });

  // Set up custom legend click handlers
  document.querySelectorAll('.chart-legend-custom .legend-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.getAttribute('data-dataset-index'), 10);
      const meta = speedChart.getDatasetMeta(index);
      meta.hidden = meta.hidden === null ? !speedChart.data.datasets[index].hidden : null;
      item.classList.toggle('disabled', meta.hidden);
      speedChart.update();
    });
  });
}

// Update Chart Data
function updateChart(history) {
  if (!speedChart || !history) return;
  
  const last20Runs = history.slice(0, 20).reverse();
  
  // Get all unique formatted timestamp strings
  const formattedTimes = last20Runs.map(run => {
    const d = new Date(run.timestamp);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  });
  
  // Keep unique labels in order
  const uniqueLabels = [...new Set(formattedTimes)];
  
  // Map speeds to the corresponding label index
  const pushData = new Array(uniqueLabels.length).fill(null);
  const pullData = new Array(uniqueLabels.length).fill(null);
  
  last20Runs.forEach(run => {
    const d = new Date(run.timestamp);
    const label = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const idx = uniqueLabels.indexOf(label);
    if (idx !== -1) {
      if (run.workflow === 'push' || run.direction === 'push') {
        pushData[idx] = run.speedMbps || 0;
      } else if (run.workflow === 'pull' || run.direction === 'pull') {
        pullData[idx] = run.speedMbps || 0;
      }
    }
  });

  speedChart.data.labels = uniqueLabels;
  speedChart.data.datasets[0].data = pushData;
  speedChart.data.datasets[1].data = pullData;
  speedChart.update();
}

// Mask SSH public key for display
function maskPublicKey(key) {
  if (!key) return '';
  const parts = key.trim().split(/\s+/);
  if (parts.length >= 2) {
    const keyType = parts[0];
    const keyData = parts[1];
    const comment = parts.slice(2).join(' ');
    if (keyData.length > 24) {
      const start = keyData.substring(0, 12);
      const end = keyData.substring(keyData.length - 12);
      const maskedData = `${start}...[masked]...${end}`;
      return comment ? `${keyType} ${maskedData} ${comment}` : `${keyType} ${maskedData}`;
    }
  }
  if (key.length > 30) {
    return `${key.substring(0, 15)}...[masked]...${key.substring(key.length - 15)}`;
  }
  return key;
}

// Fetch SSH Key Status and update UI
async function fetchSSHStatus() {
  const sshKeyStatus = document.getElementById('ssh-key-status');
  const btnSshAuthorize = document.getElementById('btn-ssh-authorize');
  const sshPubkeyWrapper = document.getElementById('ssh-pubkey-display-wrapper');
  const sshPublicKey = document.getElementById('ssh-public-key');

  if (!sshKeyStatus) return;

  try {
    const res = await fetch('/api/ssh/status');
    if (res.ok) {
      const data = await res.json();
      if (data.exists) {
        sshKeyStatus.textContent = 'Configured';
        sshKeyStatus.style.background = 'rgba(16, 185, 129, 0.1)';
        sshKeyStatus.style.color = '#10b981';
        btnSshAuthorize.removeAttribute('disabled');
        sshPubkeyWrapper.style.display = 'flex';
        sshPublicKey.value = maskPublicKey(data.publicKey);
        sshPublicKey.dataset.rawKey = data.publicKey;
      } else {
        sshKeyStatus.textContent = 'Not Configured';
        sshKeyStatus.style.background = 'rgba(239, 68, 68, 0.1)';
        sshKeyStatus.style.color = '#ef4444';
        btnSshAuthorize.setAttribute('disabled', 'true');
        sshPubkeyWrapper.style.display = 'none';
        sshPublicKey.value = '';
        delete sshPublicKey.dataset.rawKey;
      }
    }
  } catch (err) {
    console.error('Error fetching SSH key status:', err);
  }
}

// SSH Key Generation
const btnSshGenerate = document.getElementById('btn-ssh-generate');
if (btnSshGenerate) {
  btnSshGenerate.addEventListener('click', async () => {
    btnSshGenerate.setAttribute('disabled', 'true');
    const origHTML = btnSshGenerate.innerHTML;
    btnSshGenerate.innerHTML = `<i data-lucide="loader-2" class="btn-icon spin"></i> Generating...`;
    lucide.createIcons();

    try {
      const res = await fetch('/api/ssh/generate', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'SSH Key-Pair generated successfully.', 'success');
        await fetchSSHStatus();
      } else {
        showToast(`Error: ${data.error || 'Failed to generate SSH key-pair'}`, 'error');
      }
    } catch (e) {
      showToast('Failed to generate SSH key-pair.', 'error');
    } finally {
      btnSshGenerate.removeAttribute('disabled');
      btnSshGenerate.innerHTML = origHTML;
      lucide.createIcons();
    }
  });
}

// SSH Key Authorization
const btnSshAuthorize = document.getElementById('btn-ssh-authorize');
if (btnSshAuthorize) {
  btnSshAuthorize.addEventListener('click', async () => {
    const host = document.getElementById('host').value.trim();
    const port = document.getElementById('port').value.trim();
    const login = document.getElementById('login').value.trim();
    const pass = document.getElementById('pass').value;

    if (!host || !login || !pass) {
      showToast('Please fill out Host, Username, and Password to authorize the SSH key on the remote server.', 'warning');
      return;
    }

    btnSshAuthorize.setAttribute('disabled', 'true');
    const origHTML = btnSshAuthorize.innerHTML;
    btnSshAuthorize.innerHTML = `<i data-lucide="loader-2" class="btn-icon spin"></i> Authorizing...`;
    lucide.createIcons();

    try {
      const res = await fetch('/api/ssh/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, login, pass })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message || 'SSH Key authorized successfully! Connection password has been cleared.', 'success');
        document.getElementById('pass').value = '';
        await fetchSSHStatus();
        await fetchConfig();
      } else {
        showToast(`Error: ${data.error || 'Failed to authorize SSH key'}`, 'error');
      }
    } catch (e) {
      showToast('Failed to authorize SSH key.', 'error');
    } finally {
      btnSshAuthorize.removeAttribute('disabled');
      btnSshAuthorize.innerHTML = origHTML;
      lucide.createIcons();
    }
  });
}

// Copy SSH key button
const btnCopySshKey = document.getElementById('btn-copy-ssh-key');
const sshPublicKey = document.getElementById('ssh-public-key');

if (sshPublicKey) {
  sshPublicKey.addEventListener('click', function() {
    this.select();
  });
}

if (btnCopySshKey && sshPublicKey) {
  btnCopySshKey.addEventListener('click', () => {
    const rawKey = sshPublicKey.dataset.rawKey || sshPublicKey.value;
    if (rawKey) {
      copyTextToClipboard(rawKey)
        .then(() => showToast('Public key copied to clipboard!', 'success'))
        .catch(err => showToast('Failed to copy public key to clipboard', 'error'));
    }
  });
}

// Help Modal Tab Switcher
const modalTabBtns = document.querySelectorAll('.modal-tab-btn');
modalTabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    modalTabBtns.forEach(b => {
      b.classList.remove('active');
      b.style.borderBottom = '2px solid transparent';
      b.style.color = 'var(--text-muted)';
    });

    btn.classList.add('active');
    btn.style.borderBottom = '2px solid var(--primary)';
    btn.style.color = '#fff';

    const tabPanes = document.querySelectorAll('.help-tab-pane');
    tabPanes.forEach(pane => {
      pane.style.display = 'none';
      pane.classList.remove('active');
    });

    const targetTab = btn.getAttribute('data-tab');
    const targetPane = document.getElementById(targetTab);
    if (targetPane) {
      if (targetTab === 'help-tab-ssh') {
        targetPane.style.display = 'flex';
      } else {
        targetPane.style.display = 'block';
      }
      targetPane.classList.add('active');
    }
  });
});

// File Explorer State & Logic
let currentLocalPath = '/';
let currentLocalType = 'push'; // 'push' or 'pull'
let currentRemotePath = '/';
let currentRemoteType = 'pull'; // 'pull' or 'push'

// Last-fetched directory listing per pane, cached so sort/filter changes can
// re-render instantly without a network round-trip.
let lastLocalFiles = [];
let lastRemoteFiles = [];

// Multi-select state: keyed by full path (unique within a directory, unlike
// name alone once you factor in re-renders), value holds what batch actions
// need (isDirectory) without re-deriving it from the DOM. Cleared on every
// full reload (navigation, type switch, or after any action) since a stale
// selection referencing a since-deleted/renamed item would be worse than an
// empty one.
let selectedLocalPaths = new Map();
let selectedRemotePaths = new Map();

let localSortColumn = 'name'; // 'name' | 'size' | 'mtime'
let localSortDir = 'asc'; // 'asc' | 'desc'
let remoteSortColumn = 'name';
let remoteSortDir = 'asc';
let localFilterText = '';
let remoteFilterText = '';

// Directories always sort first regardless of column, matching the existing
// (pre-multi-select) name-sort behavior — this just extends it to size/date.
function sortFiles(files, column, dir) {
  const sorted = [...files].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    let cmp;
    if (column === 'size') {
      cmp = (a.size || 0) - (b.size || 0);
    } else if (column === 'mtime') {
      cmp = (a.mtimeEpoch != null ? a.mtimeEpoch : 0) - (b.mtimeEpoch != null ? b.mtimeEpoch : 0);
    } else {
      cmp = a.name.localeCompare(b.name);
    }
    return dir === 'desc' ? -cmp : cmp;
  });
  return sorted;
}

function filterFiles(files, filterText) {
  if (!filterText) return files;
  const lower = filterText.toLowerCase();
  return files.filter(f => f.name.toLowerCase().includes(lower));
}

// GET /api/config's top-level remotePushDir/remotePullDir are stale
// defaultConfig leftovers, not the active profile's real values - the
// multi-profile migration moved those fields into config.profiles[i] but
// never removed the top-level defaults, so `currentConfig.remotePushDir`
// silently returns "/remote-push" regardless of what's actually configured.
// Always look up the active profile's own fields instead.
function getActiveProfileData() {
  return profiles.find(p => p.id === activeProfileId) || null;
}

function toggleExplorerDrawer(open) {
  const explorerDrawer = document.getElementById('explorer-drawer');
  if (!explorerDrawer) return;
  if (open) {
    explorerDrawer.classList.add('open');
    drawerBackdrop.classList.add('open');

    currentLocalPath = '/';
    const activeProfile = getActiveProfileData();
    if (activeProfile) {
      currentRemotePath = currentRemoteType === 'pull' ? (activeProfile.remotePushDir || '/') : (activeProfile.remotePullDir || '/');
    } else {
      currentRemotePath = '/';
    }

    localSortColumn = 'name'; localSortDir = 'asc'; localFilterText = '';
    remoteSortColumn = 'name'; remoteSortDir = 'asc'; remoteFilterText = '';
    const localFilterInput = document.getElementById('local-filter-input');
    const remoteFilterInput = document.getElementById('remote-filter-input');
    if (localFilterInput) localFilterInput.value = '';
    if (remoteFilterInput) remoteFilterInput.value = '';

    loadLocalExplorer();
    loadRemoteExplorer();
  } else {
    explorerDrawer.classList.remove('open');
    drawerBackdrop.classList.remove('open');
  }
  updateBodyScrollLock();
}

// Bind Header & Close Buttons
const btnExplorerToggle = document.getElementById('btn-explorer-toggle');
const btnExplorerClose = document.getElementById('btn-explorer-close');
if (btnExplorerToggle) {
  btnExplorerToggle.addEventListener('click', () => toggleExplorerDrawer(true));
}
if (btnExplorerClose) {
  btnExplorerClose.addEventListener('click', () => toggleExplorerDrawer(false));
}

// Bind Dropdown Select Handlers
const explorerLocalTypeSel = document.getElementById('explorer-local-type');
const explorerRemoteTypeSel = document.getElementById('explorer-remote-type');

if (explorerLocalTypeSel) {
  explorerLocalTypeSel.addEventListener('change', (e) => {
    currentLocalType = e.target.value;
    currentLocalPath = '/';
    loadLocalExplorer();
  });
}
if (explorerRemoteTypeSel) {
  explorerRemoteTypeSel.addEventListener('change', (e) => {
    currentRemoteType = e.target.value;
    const activeProfile = getActiveProfileData();
    if (activeProfile) {
      currentRemotePath = currentRemoteType === 'pull' ? (activeProfile.remotePushDir || '/') : (activeProfile.remotePullDir || '/');
    } else {
      currentRemotePath = '/';
    }
    loadRemoteExplorer();
  });
}

// Sort headers, filter inputs, select-all checkboxes, and batch action bars
// are all static markup (never destroyed/rebuilt by a render call, unlike
// the <tbody> rows), so they're wired once here rather than re-bound on
// every render.
document.querySelectorAll('#local-explorer-pane th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.getAttribute('data-sort');
    if (localSortColumn === col) {
      localSortDir = localSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      localSortColumn = col;
      localSortDir = 'asc';
    }
    renderLocalFileList(lastLocalFiles);
  });
});

document.querySelectorAll('#remote-explorer-pane th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.getAttribute('data-sort');
    if (remoteSortColumn === col) {
      remoteSortDir = remoteSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      remoteSortColumn = col;
      remoteSortDir = 'asc';
    }
    renderRemoteFileList(lastRemoteFiles);
  });
});

const localFilterInputEl = document.getElementById('local-filter-input');
if (localFilterInputEl) {
  localFilterInputEl.addEventListener('input', (e) => {
    localFilterText = e.target.value;
    renderLocalFileList(lastLocalFiles);
  });
}

const remoteFilterInputEl = document.getElementById('remote-filter-input');
if (remoteFilterInputEl) {
  remoteFilterInputEl.addEventListener('input', (e) => {
    remoteFilterText = e.target.value;
    renderRemoteFileList(lastRemoteFiles);
  });
}

const localSelectAllEl = document.getElementById('local-select-all');
if (localSelectAllEl) {
  localSelectAllEl.addEventListener('change', (e) => {
    const visible = sortFiles(filterFiles(lastLocalFiles, localFilterText), localSortColumn, localSortDir);
    if (e.target.checked) {
      visible.forEach(f => {
        const p = currentLocalPath === '/' ? `/${f.name}` : `${currentLocalPath}/${f.name}`;
        selectedLocalPaths.set(p, { name: f.name, isDirectory: f.isDirectory });
      });
    } else {
      selectedLocalPaths.clear();
    }
    renderLocalFileList(lastLocalFiles);
  });
}

const remoteSelectAllEl = document.getElementById('remote-select-all');
if (remoteSelectAllEl) {
  remoteSelectAllEl.addEventListener('change', (e) => {
    const visible = sortFiles(filterFiles(lastRemoteFiles, remoteFilterText), remoteSortColumn, remoteSortDir);
    if (e.target.checked) {
      visible.forEach(f => {
        const p = currentRemotePath === '/' ? `/${f.name}` : `${currentRemotePath}/${f.name}`;
        selectedRemotePaths.set(p, { name: f.name, isDirectory: f.isDirectory });
      });
    } else {
      selectedRemotePaths.clear();
    }
    renderRemoteFileList(lastRemoteFiles);
  });
}

const btnBatchPushLocal = document.getElementById('btn-batch-push-local');
if (btnBatchPushLocal) {
  btnBatchPushLocal.addEventListener('click', async () => {
    const items = Array.from(selectedLocalPaths.keys());
    if (items.length === 0) return;
    if (!await showAppConfirm(`Push ${items.length} selected item(s) to the remote destination now? This transfers each item separately from a full Push Sync.`)) return;
    btnBatchPushLocal.disabled = true;
    let successCount = 0, failCount = 0;
    for (const filePath of items) {
      try {
        const res = await fetch('/api/explorer/local/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: currentLocalType, path: filePath })
        });
        if (res.ok) successCount++; else failCount++;
      } catch (e) {
        failCount++;
      }
    }
    btnBatchPushLocal.disabled = false;
    showToast(`Batch push complete: ${successCount} succeeded${failCount ? `, ${failCount} failed` : ''}.`, failCount ? 'error' : 'success');
    loadLocalExplorer();
  });
}

const btnBatchDeleteLocal = document.getElementById('btn-batch-delete-local');
if (btnBatchDeleteLocal) {
  btnBatchDeleteLocal.addEventListener('click', async () => {
    const items = Array.from(selectedLocalPaths.keys());
    if (items.length === 0) return;
    if (!await showAppConfirm(`Are you sure you want to permanently delete ${items.length} selected item(s)?`, { danger: true })) return;
    btnBatchDeleteLocal.disabled = true;
    let successCount = 0, failCount = 0;
    for (const filePath of items) {
      try {
        const res = await fetch('/api/explorer/local/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: currentLocalType, path: filePath })
        });
        if (res.ok) successCount++; else failCount++;
      } catch (e) {
        failCount++;
      }
    }
    btnBatchDeleteLocal.disabled = false;
    showToast(`Batch delete complete: ${successCount} succeeded${failCount ? `, ${failCount} failed` : ''}.`, failCount ? 'error' : 'success');
    loadLocalExplorer();
  });
}

const btnBatchClearLocal = document.getElementById('btn-batch-clear-local');
if (btnBatchClearLocal) {
  btnBatchClearLocal.addEventListener('click', () => {
    selectedLocalPaths.clear();
    renderLocalFileList(lastLocalFiles);
  });
}

const btnBatchPullRemote = document.getElementById('btn-batch-pull-remote');
if (btnBatchPullRemote) {
  btnBatchPullRemote.addEventListener('click', async () => {
    const items = Array.from(selectedRemotePaths.entries());
    if (items.length === 0) return;
    if (!await showAppConfirm(`Pull ${items.length} selected item(s) to the local destination now? This transfers each item separately from a full Pull Sync.`)) return;
    btnBatchPullRemote.disabled = true;
    let successCount = 0, failCount = 0;
    for (const [filePath, meta] of items) {
      try {
        const res = await fetch('/api/explorer/remote/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath, isDirectory: meta.isDirectory })
        });
        if (res.ok) successCount++; else failCount++;
      } catch (e) {
        failCount++;
      }
    }
    btnBatchPullRemote.disabled = false;
    showToast(`Batch pull complete: ${successCount} succeeded${failCount ? `, ${failCount} failed` : ''}.`, failCount ? 'error' : 'success');
    loadRemoteExplorer();
  });
}

const btnBatchDeleteRemote = document.getElementById('btn-batch-delete-remote');
if (btnBatchDeleteRemote) {
  btnBatchDeleteRemote.addEventListener('click', async () => {
    const items = Array.from(selectedRemotePaths.keys());
    if (items.length === 0) return;
    if (!await showAppConfirm(`Are you sure you want to permanently delete ${items.length} selected item(s)?`, { danger: true })) return;
    btnBatchDeleteRemote.disabled = true;
    let successCount = 0, failCount = 0;
    for (const filePath of items) {
      try {
        const res = await fetch('/api/explorer/remote/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath })
        });
        if (res.ok) successCount++; else failCount++;
      } catch (e) {
        failCount++;
      }
    }
    btnBatchDeleteRemote.disabled = false;
    showToast(`Batch delete complete: ${successCount} succeeded${failCount ? `, ${failCount} failed` : ''}.`, failCount ? 'error' : 'success');
    loadRemoteExplorer();
  });
}

const btnBatchClearRemote = document.getElementById('btn-batch-clear-remote');
if (btnBatchClearRemote) {
  btnBatchClearRemote.addEventListener('click', () => {
    selectedRemotePaths.clear();
    renderRemoteFileList(lastRemoteFiles);
  });
}

function formatSize(bytes) {
  if (bytes === 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function renderBreadcrumbs(containerId, currentPath, onClickCallback) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const parts = currentPath.split('/').filter(Boolean);
  let html = `<span class="breadcrumb-item" data-path="/">/</span>`;
  
  let accumulatedPath = '';
  parts.forEach((part) => {
    accumulatedPath += '/' + part;
    html += `<span class="breadcrumb-separator">/</span><span class="breadcrumb-item" data-path="${escapeHtml(accumulatedPath)}">${escapeHtml(part)}</span>`;
  });
  
  container.innerHTML = html;
  
  container.querySelectorAll('.breadcrumb-item').forEach(item => {
    item.addEventListener('click', () => {
      onClickCallback(item.getAttribute('data-path'));
    });
  });
}

function updateLocalBatchBar() {
  const bar = document.getElementById('local-batch-bar');
  const countEl = document.getElementById('local-batch-count');
  if (!bar || !countEl) return;
  const n = selectedLocalPaths.size;
  bar.style.display = n > 0 ? 'flex' : 'none';
  countEl.textContent = n > 0 ? `${n} selected` : '';
}

function updateLocalSortIndicators() {
  document.querySelectorAll('#local-explorer-pane th.sortable').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    if (!icon) return;
    if (th.getAttribute('data-sort') === localSortColumn) {
      icon.textContent = localSortDir === 'asc' ? '▲' : '▼';
    } else {
      icon.textContent = '';
    }
  });
}

async function loadLocalExplorer() {
  const fileList = document.getElementById('local-file-list');
  if (!fileList) return;

  selectedLocalPaths.clear();
  fileList.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;"><i data-lucide="loader-2" class="spin" style="width: 1.25rem; height: 1.25rem;"></i> Loading...</td></tr>';
  lucide.createIcons();

  try {
    const res = await fetch(`/api/explorer/local?type=${currentLocalType}&path=${encodeURIComponent(currentLocalPath)}`);
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const files = await res.json();
    lastLocalFiles = files;
    renderLocalFileList(files);
  } catch (err) {
    fileList.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 1.5rem;">Error: ${escapeHtml(err.message || err)}</td></tr>`;
  }
}

function renderLocalFileList(files) {
  const fileList = document.getElementById('local-file-list');
  renderBreadcrumbs('local-breadcrumbs', currentLocalPath, (targetPath) => {
    currentLocalPath = targetPath;
    loadLocalExplorer();
  });
  updateLocalSortIndicators();

  let html = '';
  if (currentLocalPath !== '/') {
    html += `
      <tr class="explorer-parent-row" style="cursor: pointer;">
        <td></td>
        <td>
          <span class="explorer-row-item directory parent-directory">
            <i data-lucide="corner-left-up"></i>
            <span>..</span>
          </span>
        </td>
        <td>--</td>
        <td>--</td>
        <td></td>
      </tr>
    `;
  }

  const visibleFiles = sortFiles(filterFiles(files || [], localFilterText), localSortColumn, localSortDir);

  if (!visibleFiles || visibleFiles.length === 0) {
    const emptyMsg = (files && files.length > 0) ? 'No items match your filter' : 'Folder is empty';
    if (currentLocalPath === '/') {
      fileList.innerHTML = `<tr><td colspan="5" class="empty-list">${emptyMsg}</td></tr>`;
    } else {
      fileList.innerHTML = html + `<tr><td colspan="5" class="empty-list">${emptyMsg}</td></tr>`;
      lucide.createIcons();
      const parentRow = fileList.querySelector('.explorer-parent-row');
      if (parentRow) {
        parentRow.addEventListener('click', () => {
          const parts = currentLocalPath.split('/').filter(Boolean);
          parts.pop();
          currentLocalPath = '/' + parts.join('/');
          loadLocalExplorer();
        });
      }
    }
    updateLocalBatchBar();
    return;
  }

  visibleFiles.forEach(f => {
    const icon = f.isDirectory ? 'folder' : 'file';
    const rowClass = f.isDirectory ? 'explorer-row-item directory' : 'explorer-row-item';
    const displaySize = f.isDirectory ? '--' : formatSize(f.size);
    const filePath = currentLocalPath === '/' ? `/${f.name}` : `${currentLocalPath}/${f.name}`;
    const isChecked = selectedLocalPaths.has(filePath);

    html += `
      <tr>
        <td class="explorer-checkbox-cell"><input type="checkbox" class="explorer-row-checkbox" data-name="${escapeHtml(f.name)}" data-isdir="${f.isDirectory}" ${isChecked ? 'checked' : ''}></td>
        <td>
          <span class="${rowClass}" data-name="${escapeHtml(f.name)}" data-isdir="${f.isDirectory}">
            <i data-lucide="${icon}"></i>
            <span>${escapeHtml(f.name)}</span>
          </span>
        </td>
        <td>${displaySize}</td>
        <td>${escapeHtml(f.mtime)}</td>
        <td class="explorer-row-actions">
          <button class="btn-explorer-action btn-push-local" data-name="${escapeHtml(f.name)}" title="Push to Remote">
            <i data-lucide="upload"></i>
          </button>
          <button class="btn-explorer-action btn-rename-local" data-name="${escapeHtml(f.name)}" title="Rename">
            <i data-lucide="pencil"></i>
          </button>
          <button class="btn-explorer-action btn-delete-local" data-name="${escapeHtml(f.name)}" title="Delete File/Folder">
            <i data-lucide="trash-2"></i>
          </button>
        </td>
      </tr>
    `;
  });
  fileList.innerHTML = html;
  lucide.createIcons();
  updateLocalBatchBar();

  const parentRow = fileList.querySelector('.explorer-parent-row');
  if (parentRow) {
    parentRow.addEventListener('click', () => {
      const parts = currentLocalPath.split('/').filter(Boolean);
      parts.pop();
      currentLocalPath = '/' + parts.join('/');
      loadLocalExplorer();
    });
  }

  fileList.querySelectorAll('.explorer-row-item:not(.parent-directory)').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.getAttribute('data-name');
      const isDir = item.getAttribute('data-isdir') === 'true';
      if (isDir) {
        currentLocalPath = currentLocalPath === '/' ? `/${name}` : `${currentLocalPath}/${name}`;
        loadLocalExplorer();
      }
    });
  });

  fileList.querySelectorAll('.explorer-row-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const name = cb.getAttribute('data-name');
      const isDir = cb.getAttribute('data-isdir') === 'true';
      const filePath = currentLocalPath === '/' ? `/${name}` : `${currentLocalPath}/${name}`;
      if (cb.checked) {
        selectedLocalPaths.set(filePath, { name, isDirectory: isDir });
      } else {
        selectedLocalPaths.delete(filePath);
      }
      updateLocalBatchBar();
    });
  });

  fileList.querySelectorAll('.btn-push-local').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.getAttribute('data-name');
      if (!await showAppConfirm(`Push "${name}" to the remote destination now? This transfers just this item, separate from a full Push Sync.`)) {
        return;
      }
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i>';
      lucide.createIcons();
      const filePath = currentLocalPath === '/' ? `/${name}` : `${currentLocalPath}/${name}`;
      try {
        const res = await fetch('/api/explorer/local/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: currentLocalType, path: filePath })
        });
        if (res.ok) {
          showToast(`Pushed "${name}" successfully.`, 'success');
        } else {
          const err = await res.json();
          showToast('Push failed: ' + err.error, 'error');
        }
      } catch (err) {
        showToast('Push failed: ' + err.message, 'error');
      } finally {
        loadLocalExplorer();
      }
    });
  });

  fileList.querySelectorAll('.btn-rename-local').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.getAttribute('data-name');
      const newName = await showAppPrompt(`Enter new name for "${name}":`, name);
      if (!newName || !newName.trim() || newName.trim() === name) return;
      if (newName.includes('/')) {
        showToast('Rename failed: name cannot contain "/"', 'error');
        return;
      }
      const filePath = currentLocalPath === '/' ? `/${name}` : `${currentLocalPath}/${name}`;
      try {
        const res = await fetch('/api/explorer/local/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: currentLocalType, path: filePath, newName: newName.trim() })
        });
        if (res.ok) {
          showToast(`Renamed "${name}" to "${newName.trim()}".`, 'success');
          loadLocalExplorer();
        } else {
          const err = await res.json();
          showToast('Rename failed: ' + err.error, 'error');
        }
      } catch (err) {
        showToast('Rename failed: ' + err.message, 'error');
      }
    });
  });

  fileList.querySelectorAll('.btn-delete-local').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.getAttribute('data-name');
      const filePath = currentLocalPath === '/' ? `/${name}` : `${currentLocalPath}/${name}`;
      if (await showAppConfirm(`Are you sure you want to permanently delete local file/folder: "${name}"?`, { danger: true })) {
        try {
          const res = await fetch('/api/explorer/local/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: currentLocalType, path: filePath })
          });
          if (res.ok) {
            loadLocalExplorer();
          } else {
            const err = await res.json();
            showToast('Delete failed: ' + err.error, 'error');
          }
        } catch (err) {
          showToast('Delete failed: ' + err.message, 'error');
        }
      }
    });
  });
}

function updateRemoteBatchBar() {
  const bar = document.getElementById('remote-batch-bar');
  const countEl = document.getElementById('remote-batch-count');
  if (!bar || !countEl) return;
  const n = selectedRemotePaths.size;
  bar.style.display = n > 0 ? 'flex' : 'none';
  countEl.textContent = n > 0 ? `${n} selected` : '';
}

function updateRemoteSortIndicators() {
  document.querySelectorAll('#remote-explorer-pane th.sortable').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    if (!icon) return;
    if (th.getAttribute('data-sort') === remoteSortColumn) {
      icon.textContent = remoteSortDir === 'asc' ? '▲' : '▼';
    } else {
      icon.textContent = '';
    }
  });
}

async function loadRemoteExplorer() {
  const fileList = document.getElementById('remote-file-list');
  if (!fileList) return;

  selectedRemotePaths.clear();
  fileList.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;"><i data-lucide="loader-2" class="spin" style="width: 1.25rem; height: 1.25rem;"></i> Loading...</td></tr>';
  lucide.createIcons();

  try {
    const res = await fetch(`/api/explorer/remote?path=${encodeURIComponent(currentRemotePath)}`);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Server error');
    }
    const files = await res.json();
    lastRemoteFiles = files;
    renderRemoteFileList(files);
  } catch (err) {
    const errorMsg = err.message || String(err);
    const isNoSuchFile = errorMsg.includes('No such file') || errorMsg.includes('does not exist') || errorMsg.includes('Access failed');
    if (isNoSuchFile) {
      fileList.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 2.5rem 1.5rem; color: var(--text-muted);">
            <div style="margin-bottom: 0.85rem; color: #f59e0b; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; gap: 0.35rem;">
              <i data-lucide="alert-triangle" style="width: 1.1rem; height: 1.1rem; color: #f59e0b;"></i>
              Directory does not exist on remote server: <code>${escapeHtml(currentRemotePath)}</code>
            </div>
            <button id="btn-create-remote-dir" class="btn btn-primary btn-small" style="font-size: 0.8rem; margin: 0 auto; display: inline-flex; align-items: center; gap: 0.25rem;">
              <i data-lucide="plus-circle" style="width: 0.95rem; height: 0.95rem;"></i>
              Create Remote Directory
            </button>
          </td>
        </tr>
      `;
      lucide.createIcons();

      const btnCreate = document.getElementById('btn-create-remote-dir');
      if (btnCreate) {
        btnCreate.addEventListener('click', async () => {
          btnCreate.setAttribute('disabled', 'true');
          btnCreate.innerHTML = `<i data-lucide="loader-2" class="spin" style="width: 0.95rem; height: 0.95rem;"></i> Creating...`;
          lucide.createIcons();

          try {
            const createRes = await fetch('/api/explorer/remote/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: currentRemotePath })
            });
            if (createRes.ok) {
              loadRemoteExplorer();
            } else {
              const errData = await createRes.json();
              showToast('Failed to create directory: ' + errData.error, 'error');
            }
          } catch (e) {
            showToast('Failed to create directory: ' + e.message, 'error');
          }
        });
      }
    } else {
      fileList.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 1.5rem;">Error: ${escapeHtml(errorMsg)}</td></tr>`;
    }
  }
}

function renderRemoteFileList(files) {
  const fileList = document.getElementById('remote-file-list');
  renderBreadcrumbs('remote-breadcrumbs', currentRemotePath, (targetPath) => {
    currentRemotePath = targetPath;
    loadRemoteExplorer();
  });
  updateRemoteSortIndicators();

  let html = '';
  if (currentRemotePath !== '/') {
    html += `
      <tr class="explorer-parent-row" style="cursor: pointer;">
        <td></td>
        <td>
          <span class="explorer-row-item directory parent-directory">
            <i data-lucide="corner-left-up"></i>
            <span>..</span>
          </span>
        </td>
        <td>--</td>
        <td>--</td>
        <td></td>
      </tr>
    `;
  }

  const visibleFiles = sortFiles(filterFiles(files || [], remoteFilterText), remoteSortColumn, remoteSortDir);

  if (!visibleFiles || visibleFiles.length === 0) {
    const emptyMsg = (files && files.length > 0) ? 'No items match your filter' : 'Folder is empty';
    if (currentRemotePath === '/') {
      fileList.innerHTML = `<tr><td colspan="5" class="empty-list">${emptyMsg}</td></tr>`;
    } else {
      fileList.innerHTML = html + `<tr><td colspan="5" class="empty-list">${emptyMsg}</td></tr>`;
      lucide.createIcons();
      const parentRow = fileList.querySelector('.explorer-parent-row');
      if (parentRow) {
        parentRow.addEventListener('click', () => {
          const parts = currentRemotePath.split('/').filter(Boolean);
          parts.pop();
          currentRemotePath = '/' + parts.join('/');
          loadRemoteExplorer();
        });
      }
    }
    updateRemoteBatchBar();
    return;
  }

  visibleFiles.forEach(f => {
    const icon = f.isDirectory ? 'folder' : 'file';
    const rowClass = f.isDirectory ? 'explorer-row-item directory' : 'explorer-row-item';
    const displaySize = f.isDirectory ? '--' : formatSize(f.size);
    const filePath = currentRemotePath === '/' ? `/${f.name}` : `${currentRemotePath}/${f.name}`;
    const isChecked = selectedRemotePaths.has(filePath);

    html += `
      <tr>
        <td class="explorer-checkbox-cell"><input type="checkbox" class="explorer-row-checkbox" data-name="${escapeHtml(f.name)}" data-isdir="${f.isDirectory}" ${isChecked ? 'checked' : ''}></td>
        <td>
          <span class="${rowClass}" data-name="${escapeHtml(f.name)}" data-isdir="${f.isDirectory}">
            <i data-lucide="${icon}"></i>
            <span>${escapeHtml(f.name)}</span>
          </span>
        </td>
        <td>${displaySize}</td>
        <td>${escapeHtml(f.mtime)}</td>
        <td class="explorer-row-actions">
          <button class="btn-explorer-action btn-pull-remote" data-name="${escapeHtml(f.name)}" data-isdir="${f.isDirectory}" title="Pull to Local">
            <i data-lucide="download"></i>
          </button>
          <button class="btn-explorer-action btn-rename-remote" data-name="${escapeHtml(f.name)}" title="Rename">
            <i data-lucide="pencil"></i>
          </button>
          <button class="btn-explorer-action btn-delete-remote" data-name="${escapeHtml(f.name)}" title="Delete File/Folder">
            <i data-lucide="trash-2"></i>
          </button>
        </td>
      </tr>
    `;
  });
  fileList.innerHTML = html;
  lucide.createIcons();
  updateRemoteBatchBar();

  const parentRow = fileList.querySelector('.explorer-parent-row');
  if (parentRow) {
    parentRow.addEventListener('click', () => {
      const parts = currentRemotePath.split('/').filter(Boolean);
      parts.pop();
      currentRemotePath = '/' + parts.join('/');
      loadRemoteExplorer();
    });
  }

  fileList.querySelectorAll('.explorer-row-item:not(.parent-directory)').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.getAttribute('data-name');
      const isDir = item.getAttribute('data-isdir') === 'true';
      if (isDir) {
        currentRemotePath = currentRemotePath === '/' ? `/${name}` : `${currentRemotePath}/${name}`;
        loadRemoteExplorer();
      }
    });
  });

  fileList.querySelectorAll('.explorer-row-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const name = cb.getAttribute('data-name');
      const isDir = cb.getAttribute('data-isdir') === 'true';
      const filePath = currentRemotePath === '/' ? `/${name}` : `${currentRemotePath}/${name}`;
      if (cb.checked) {
        selectedRemotePaths.set(filePath, { name, isDirectory: isDir });
      } else {
        selectedRemotePaths.delete(filePath);
      }
      updateRemoteBatchBar();
    });
  });

  fileList.querySelectorAll('.btn-pull-remote').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.getAttribute('data-name');
      const isDir = btn.getAttribute('data-isdir') === 'true';
      if (!await showAppConfirm(`Pull "${name}" to the local destination now? This transfers just this item, separate from a full Pull Sync.`)) {
        return;
      }
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i>';
      lucide.createIcons();
      const filePath = currentRemotePath === '/' ? `/${name}` : `${currentRemotePath}/${name}`;
      try {
        const res = await fetch('/api/explorer/remote/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath, isDirectory: isDir })
        });
        if (res.ok) {
          showToast(`Pulled "${name}" successfully.`, 'success');
        } else {
          const err = await res.json();
          showToast('Pull failed: ' + err.error, 'error');
        }
      } catch (err) {
        showToast('Pull failed: ' + err.message, 'error');
      } finally {
        loadRemoteExplorer();
      }
    });
  });

  fileList.querySelectorAll('.btn-rename-remote').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.getAttribute('data-name');
      const newName = await showAppPrompt(`Enter new name for "${name}":`, name);
      if (!newName || !newName.trim() || newName.trim() === name) return;
      if (newName.includes('/')) {
        showToast('Rename failed: name cannot contain "/"', 'error');
        return;
      }
      const filePath = currentRemotePath === '/' ? `/${name}` : `${currentRemotePath}/${name}`;
      try {
        const res = await fetch('/api/explorer/remote/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath, newName: newName.trim() })
        });
        if (res.ok) {
          showToast(`Renamed "${name}" to "${newName.trim()}".`, 'success');
          loadRemoteExplorer();
        } else {
          const err = await res.json();
          showToast('Rename failed: ' + err.error, 'error');
        }
      } catch (err) {
        showToast('Rename failed: ' + err.message, 'error');
      }
    });
  });

  fileList.querySelectorAll('.btn-delete-remote').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.getAttribute('data-name');
      const filePath = currentRemotePath === '/' ? `/${name}` : `${currentRemotePath}/${name}`;
      if (await showAppConfirm(`Are you sure you want to permanently delete remote file/folder: "${name}"?`, { danger: true })) {
        try {
          const res = await fetch('/api/explorer/remote/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath })
          });
          if (res.ok) {
            loadRemoteExplorer();
          } else {
            const err = await res.json();
            showToast('Delete failed: ' + err.error, 'error');
          }
        } catch (err) {
          showToast('Delete failed: ' + err.message, 'error');
        }
      }
    });
  });
}

// Initialize Web Authentication and MFA settings UI handlers
function initSecuritySettings() {
  const authEnabled = document.getElementById('authEnabled');
  const authCredentialsFields = document.getElementById('auth-credentials-fields');
  const mfaEnabled = document.getElementById('mfaEnabled');
  const mfaSetupPanel = document.getElementById('mfa-setup-panel');
  const mfaSecretDisplay = document.getElementById('mfa-secret-display');
  const mfaVerifyCode = document.getElementById('mfa-verify-code');
  const btnVerifyMfaCode = document.getElementById('btn-verify-mfa-code');
  const btnCopyMfaSecret = document.getElementById('btn-copy-mfa-secret');
  const mfaSetupStatus = document.getElementById('mfa-setup-status');
  const btnLogout = document.getElementById('btn-logout');

  // Toggle credentials fields view
  authEnabled.addEventListener('change', () => {
    authCredentialsFields.style.display = authEnabled.checked ? 'block' : 'none';
  });

  // Toggle MFA Setup View
  mfaEnabled.addEventListener('change', async () => {
    if (mfaEnabled.checked) {
      if (currentConfig && currentConfig.mfaEnabled && !tempMfaSecret) {
        // MFA is already enabled, show current status
        mfaSetupPanel.style.display = 'flex';
        document.getElementById('mfa-qrcode-container').innerHTML = '<div style="color: var(--success); text-align: center; font-size: 0.85rem; width: 100%;"><i data-lucide="check-circle" style="width: 2.5rem; height: 2.5rem; margin-bottom: 0.5rem; display: block; margin-left: auto; margin-right: auto;"></i>MFA Active</div>';
        lucide.createIcons();
        mfaSecretDisplay.value = '••••••••••••••••';
        mfaSetupStatus.textContent = '✓ Two-Factor Authentication is currently active.';
        mfaSetupStatus.style.color = 'var(--success)';
        
        // Add a button to reconfigure MFA
        const reconfigBtn = document.createElement('button');
        reconfigBtn.type = 'button';
        reconfigBtn.className = 'btn btn-secondary btn-xs';
        reconfigBtn.style.marginTop = '0.5rem';
        reconfigBtn.textContent = 'Reconfigure';
        reconfigBtn.onclick = () => generateMFASetup();
        document.getElementById('mfa-qrcode-container').appendChild(reconfigBtn);
      } else {
        await generateMFASetup();
      }
    } else {
      mfaSetupPanel.style.display = 'none';
      tempMfaSecret = '';
    }
  });

  async function generateMFASetup() {
    try {
      mfaSetupPanel.style.display = 'flex';
      mfaSetupStatus.textContent = 'Generating secret key...';
      mfaSetupStatus.style.color = 'var(--text-muted)';
      
      const res = await fetch('/api/auth/mfa-setup', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to generate setup details');
      const data = await res.json();
      
      tempMfaSecret = data.secret;
      mfaSecretDisplay.value = data.secret;
      
      // Render QR Code
      const qrContainer = document.getElementById('mfa-qrcode-container');
      qrContainer.innerHTML = '<canvas id="mfa-canvas"></canvas>';
      new QRious({
        element: document.getElementById('mfa-canvas'),
        value: data.qrUri,
        size: 140
      });
      mfaSetupStatus.textContent = 'Awaiting verification code...';
      btnVerifyMfaCode.disabled = false;
    } catch (err) {
      console.error(err);
      mfaSetupStatus.textContent = 'Error: ' + err.message;
      mfaSetupStatus.style.color = 'var(--danger)';
    }
  }

  // Copy MFA key to clipboard
  btnCopyMfaSecret.addEventListener('click', () => {
    if (mfaSecretDisplay.value && mfaSecretDisplay.value !== '••••••••••••••••') {
      const originalText = btnCopyMfaSecret.textContent;
      copyTextToClipboard(mfaSecretDisplay.value)
        .then(() => {
          btnCopyMfaSecret.textContent = 'Copied!';
          setTimeout(() => btnCopyMfaSecret.textContent = originalText, 2000);
        })
        .catch(() => {
          showToast('Failed to copy — please select and copy the code manually.', 'error');
        });
    }
  });

  // Verify code to link MFA
  btnVerifyMfaCode.addEventListener('click', async () => {
    const code = mfaVerifyCode.value.trim();
    if (!code || !tempMfaSecret) {
      showToast('Verification code or secret is missing.', 'warning');
      return;
    }
    
    try {
      mfaSetupStatus.textContent = 'Verifying...';
      mfaSetupStatus.style.color = 'var(--text-muted)';
      
      const res = await fetch('/api/auth/mfa-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: tempMfaSecret, code })
      });
      
      if (res.ok) {
        mfaSetupStatus.textContent = '✓ Verification successful! Click Save to apply.';
        mfaSetupStatus.style.color = 'var(--success)';
        btnVerifyMfaCode.disabled = true;
      } else {
        const err = await res.json();
        mfaSetupStatus.textContent = '✗ ' + (err.error || 'Verification failed');
        mfaSetupStatus.style.color = 'var(--danger)';
      }
    } catch (err) {
      mfaSetupStatus.textContent = '✗ Connection error: ' + err.message;
      mfaSetupStatus.style.color = 'var(--danger)';
    }
  });

  // Header Logout Button Action
  btnLogout.addEventListener('click', async () => {
    if (await showAppConfirm('Are you sure you want to sign out?')) {
      try {
        const res = await fetch('/api/auth/logout', { method: 'POST' });
        if (res.ok) {
          window.location.href = '/login.html';
        }
      } catch (err) {
        console.error('Logout failed:', err);
      }
    }
  });
}

// Initialize Multi-profile manager UI events
function initProfileManager() {
  const headerSelector = document.getElementById('header-profile-selector');
  const settingsSelector = document.getElementById('settings-profile-selector');
  const btnAdd = document.getElementById('btn-add-profile');
  const btnRename = document.getElementById('btn-rename-profile');
  const btnDelete = document.getElementById('btn-delete-profile');

  if (headerSelector) {
    headerSelector.addEventListener('change', async () => {
      const newActiveId = headerSelector.value;
      if (!newActiveId) return;

      try {
        const res = await fetch('/api/profiles/active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeProfileId: newActiveId })
        });
        
        if (res.ok) {
          activeProfileId = newActiveId;
          selectedProfileId = newActiveId;
          // Reload config and logs
          await fetchConfig();
          fetchLogs();
          consoleOutput.textContent += `\n[Profile] Switched active connection profile to "${profiles.find(p => p.id === newActiveId).name}".\n`;
        } else {
          const err = await res.json();
          showToast(`Error switching profile: ${err.error}`, 'error');
          headerSelector.value = activeProfileId; // revert
        }
      } catch (err) {
        console.error('Failed to switch profile:', err);
        showToast('Network error switching profile', 'error');
        headerSelector.value = activeProfileId; // revert
      }
    });
  }

  if (settingsSelector) {
    settingsSelector.addEventListener('change', () => {
      const newSelectedId = settingsSelector.value;
      if (!newSelectedId) return;

      // Save form edits into the current profile before switching
      saveSelectedProfileFromForm();
      
      selectedProfileId = newSelectedId;
      loadProfileIntoForm(selectedProfileId);
    });
  }

  if (btnAdd) {
    btnAdd.addEventListener('click', async () => {
      const name = await showAppPrompt('Enter a name for the new connection profile:');
      if (!name || !name.trim()) return;

      const id = 'p_' + Math.random().toString(36).substr(2, 9);
      // Create a template profile config
      const newProfile = {
        id,
        name: name.trim(),
        host: '',
        port: '22',
        login: '',
        pass: '',
        localPushDir: '/local-push',
        remotePullDir: '/remote-pull',
        remotePushDir: '/remote-push',
        localPullDir: '/local-pull',
        nfile: '2',
        nsegment: '16',
        minchunk: '1',
        pushEnabled: true,
        pushCronEnabled: false,
        pushCronSchedule: '0 * * * *',
        pushWatchEnabled: false,
        pullEnabled: true,
        pullCronEnabled: false,
        pullCronSchedule: '0 * * * *',
        throttleEnabled: false,
        throttleDownloadLimit: 1024,
        throttleUploadLimit: 512,
        throttleScheduleStart: '09:00',
        throttleScheduleEnd: '17:00',
        throttleScheduleDays: [1, 2, 3, 4, 5],
        excludePatterns: '',
        includePatterns: '',
        syncDelete: false,
        syncDryRun: false,
        syncOnlyMissing: false
      };

      // Save current edits first
      saveSelectedProfileFromForm();

      profiles.push(newProfile);
      selectedProfileId = id;
      
      renderProfileSelectors();
      loadProfileIntoForm(selectedProfileId);
    });
  }

  if (btnRename) {
    btnRename.addEventListener('click', async () => {
      const currentProfile = profiles.find(p => p.id === selectedProfileId);
      if (!currentProfile) return;

      const newName = await showAppPrompt('Enter new name for profile:', currentProfile.name);
      if (!newName || !newName.trim()) return;

      currentProfile.name = newName.trim();
      renderProfileSelectors();
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener('click', async () => {
      if (profiles.length <= 1) {
        showToast('You must have at least one connection profile.', 'warning');
        return;
      }

      const currentProfile = profiles.find(p => p.id === selectedProfileId);
      if (!currentProfile) return;

      if (!await showAppConfirm(`Are you sure you want to delete profile "${currentProfile.name}"?`, { danger: true })) {
        return;
      }

      const wasActive = selectedProfileId === activeProfileId;
      profiles = profiles.filter(p => p.id !== selectedProfileId);
      selectedProfileId = profiles[0].id;
      // If we just deleted the profile that was actually active, fall back to
      // the first remaining one so the next Save doesn't persist a now-deleted
      // activeProfileId (getActiveConfig() on the server already falls back to
      // profiles[0] in this situation, but keeping client state consistent too).
      if (wasActive) {
        activeProfileId = selectedProfileId;
      }

      renderProfileSelectors();
      loadProfileIntoForm(selectedProfileId);
    });
  }
}

// Check first boot auto-launch
function checkFirstBootHelp() {
  const helpShown = localStorage.getItem('lftp_help_shown');
  if (helpShown !== 'true') {
    toggleHelpModal(true);
  }
}

// Page load initialization
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initChart();
  connectWS();
  initSecuritySettings();
  initProfileManager();
  fetchConfig();
  fetchLogs();
  fetchSSHStatus();
  checkFirstBootHelp();
});

// Register Service Worker for PWA/installability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('[ServiceWorker] Registered successfully:', reg))
      .catch((err) => console.error('[ServiceWorker] Registration failed:', err));
  });
}
