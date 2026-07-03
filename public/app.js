// State variables
let ws = null;
let speedChart = null;
let currentConfig = null;
const consoleOutput = document.getElementById('console-output');

// WS Status UI
const wsStatusDot = document.querySelector('#ws-status .status-dot');
const wsStatusText = document.getElementById('ws-status-text');

// Settings Drawer UI
const btnSettingsToggle = document.getElementById('btn-settings-toggle');
const btnSettingsClose = document.getElementById('btn-settings-close');
const settingsDrawer = document.getElementById('settings-drawer');
const drawerBackdrop = document.getElementById('drawer-backdrop');

// Status Card UI
const syncBadge = document.getElementById('sync-badge');
const statusDetail = document.getElementById('status-detail');
const btnSync = document.getElementById('btn-sync');
const btnSyncText = document.getElementById('btn-sync-text');
const btnAbort = document.getElementById('btn-abort');

// Live Speed UI
const liveSpeedContainer = document.getElementById('live-speed-container');
const liveSpeedValue = document.getElementById('live-speed-value');

// Metrics UI
const statSpeed = document.getElementById('stat-speed');
const statSpeedMbs = document.getElementById('stat-speed-mbs');
const statTransferred = document.getElementById('stat-transferred');
const statTransferredMib = document.getElementById('stat-transferred-mib');
const statDuration = document.getElementById('stat-duration');
const statTimestamp = document.getElementById('stat-timestamp');

// Settings Form UI
const settingsForm = document.getElementById('settings-form');
const cronEnabled = document.getElementById('cronEnabled');
const cronScheduleGroup = document.getElementById('cron-schedule-group');
const btnTestConnection = document.getElementById('btn-test-connection');
const btnBrowseRemote = document.getElementById('btn-browse-remote');
const inputCustomFolder = document.getElementById('input-custom-folder');
const btnAddCustomFolder = document.getElementById('btn-add-custom-folder');

// Remote Browser Modal UI
const browserModal = document.getElementById('browser-modal');
const btnBrowserClose = document.getElementById('btn-browser-close');
const btnBrowserDone = document.getElementById('btn-browser-done');
const browserList = document.getElementById('browser-list');
const browserBreadcrumbs = document.getElementById('browser-breadcrumbs');
const browserLoading = document.getElementById('browser-loading');
const browserError = document.getElementById('browser-error');
const browserErrorMsg = document.getElementById('browser-error-msg');

// Console Actions
const btnClearConsole = document.getElementById('btn-clear-console');
const btnLogsClose = document.getElementById('btn-logs-close');

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
      updateStatus(data.isSyncing, data.syncStartTime, data.lastRun);
      updateMetrics(data.lastRun);
      updateChart(data.history);
      loadConfigToForm(data.history[0]?.config || null);
      break;
      
    case 'status':
      updateStatus(data.isSyncing, data.syncStartTime, data.lastRun);
      if (data.lastRun) {
        updateMetrics(data.lastRun);
      }
      break;
      
    case 'current_speed':
      if (liveSpeedContainer && liveSpeedValue) {
        liveSpeedContainer.style.display = 'flex';
        liveSpeedValue.textContent = `${data.speedMbps.toFixed(2)} Mbps`;
      }
      break;
      
    case 'log':
      appendConsole(data.text);
      break;
      
    case 'history_update':
      updateChart(data.history);
      if (data.history && data.history.length > 0) {
        updateMetrics(data.history[0]);
      }
      break;
      
    default:
      console.log('Unknown WS message type:', data.type);
  }
}

// Logs Drawer UI Elements
const btnLogsToggle = document.getElementById('btn-logs-toggle');
const logsDrawer = document.getElementById('logs-drawer');

// Toggle Drawer Panels
function toggleDrawer(open) {
  if (open) {
    settingsDrawer.classList.add('open');
    drawerBackdrop.classList.add('open');
  } else {
    settingsDrawer.classList.remove('open');
    drawerBackdrop.classList.remove('open');
  }
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
}

btnSettingsToggle.addEventListener('click', () => toggleDrawer(true));
btnSettingsClose.addEventListener('click', () => toggleDrawer(false));
btnLogsToggle.addEventListener('click', () => toggleLogsDrawer(true));
btnLogsClose.addEventListener('click', () => toggleLogsDrawer(false));

drawerBackdrop.addEventListener('click', () => {
  toggleDrawer(false);
  toggleLogsDrawer(false);
});

// Load Initial Config via HTTP
async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const config = await res.json();
      loadConfigToForm(config);
    }
  } catch (err) {
    console.error('Error fetching config:', err);
  }
}

function loadConfigToForm(config) {
  if (!config) return;
  currentConfig = config;

  const fields = ['host', 'port', 'login', 'pass', 'remoteDir', 'localDir', 'subdirs', 'nfile', 'nsegment', 'minchunk', 'maxLogLines', 'cronSchedule'];
  fields.forEach(field => {
    const element = document.getElementById(field);
    if (element) {
      element.value = config[field] || '';
    }
  });
  
  cronEnabled.checked = !!config.cronEnabled;
  toggleCronField();

  // Load Dashboard Selections
  updateSyncModeUI(config.syncMode || 'all');
  renderSubfolderCheckboxes(config);
}

// Toggle Cron Scheduler Inputs
function toggleCronField() {
  if (cronEnabled.checked) {
    cronScheduleGroup.style.display = 'flex';
    document.getElementById('cronSchedule').setAttribute('required', 'true');
  } else {
    cronScheduleGroup.style.display = 'none';
    document.getElementById('cronSchedule').removeAttribute('required');
  }
}

cronEnabled.addEventListener('change', toggleCronField);

// Render target folders list dynamically with delete buttons
function renderSubfolderCheckboxes(config) {
  const container = document.getElementById('sync-folders-list');
  if (!container) return;
  container.innerHTML = '';
  
  const subdirs = config.subdirs ? config.subdirs.split(',').map(s => s.trim()).filter(Boolean) : [];
  const activeDirs = Array.isArray(config.activeSubdirs) ? config.activeSubdirs : [];
  
  if (subdirs.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 1.5rem; text-align: center; background: rgba(255,255,255,0.01); border: 1px dashed var(--card-border); border-radius: 0.5rem;">No folders added. Click "Browse Remote..." to add folders.</div>';
    return;
  }

  subdirs.forEach(dir => {
    const item = document.createElement('div');
    item.className = 'sync-folder-item';

    const label = document.createElement('label');
    label.className = 'checkbox-label';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = dir;
    input.checked = activeDirs.includes(dir);
    input.addEventListener('change', () => {
      saveSelectionState();
    });

    const span = document.createElement('span');
    span.className = 'folder-path-display';
    span.textContent = dir;

    label.appendChild(input);
    label.appendChild(span);
    item.appendChild(label);

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-folder btn btn-icon-only btn-danger-light btn-xs';
    deleteBtn.title = 'Remove folder';
    deleteBtn.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteBtn.addEventListener('click', () => {
      removeFolderFromSync(dir);
    });

    item.appendChild(deleteBtn);
    container.appendChild(item);
  });

  // Re-generate icons
  lucide.createIcons();
}

async function removeFolderFromSync(dir) {
  if (!currentConfig) return;

  const subdirs = currentConfig.subdirs ? currentConfig.subdirs.split(',').map(s => s.trim()).filter(Boolean) : [];
  const activeDirs = Array.isArray(currentConfig.activeSubdirs) ? currentConfig.activeSubdirs : [];

  const newSubdirs = subdirs.filter(s => s !== dir);
  const newActiveDirs = activeDirs.filter(s => s !== dir);

  currentConfig.subdirs = newSubdirs.join(', ');
  currentConfig.activeSubdirs = newActiveDirs;

  const subdirsInput = document.getElementById('subdirs');
  if (subdirsInput) {
    subdirsInput.value = currentConfig.subdirs;
  }

  await saveSelectionState();
  renderSubfolderCheckboxes(currentConfig);
}

// Update Sync Mode Radios UI
function updateSyncModeUI(syncMode) {
  const radios = document.querySelectorAll('input[name="syncMode"]');
  radios.forEach(radio => {
    if (radio.value === syncMode) {
      radio.checked = true;
    }
  });
  
  const listContainer = document.getElementById('subfolders-list-container');
  if (listContainer) {
    listContainer.style.display = syncMode === 'selected' ? 'block' : 'none';
  }
}

// Save selections to backend immediately
async function saveSelectionState() {
  if (!currentConfig) return;
  
  const activeDirs = [];
  const checkboxes = document.querySelectorAll('#sync-folders-list input[type="checkbox"]');
  checkboxes.forEach(cb => {
    if (cb.checked) {
      activeDirs.push(cb.value);
    }
  });
  
  const syncModeRadio = document.querySelector('input[name="syncMode"]:checked');
  const syncMode = syncModeRadio ? syncModeRadio.value : 'all';
  
  currentConfig.syncMode = syncMode;
  currentConfig.activeSubdirs = activeDirs;
  
  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        syncMode,
        activeSubdirs: activeDirs
      })
    });
  } catch (err) {
    console.error('Error auto-saving selections:', err);
  }
}

// Hook radio selection events
document.querySelectorAll('input[name="syncMode"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    updateSyncModeUI(e.target.value);
    saveSelectionState();
  });
});

// Test connection handler
btnTestConnection.addEventListener('click', async () => {
  const host = document.getElementById('host').value;
  const port = document.getElementById('port').value;
  const login = document.getElementById('login').value;
  const pass = document.getElementById('pass').value;

  if (!host || !login) {
    alert('Please enter Host IP/Domain and Username before testing connection.');
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
      alert('SFTP Connection Successful!');
    } else {
      alert(`SFTP Connection Failed:\n${result.error || 'Unknown Error'}`);
    }
  } catch (err) {
    alert('SFTP Connection Failed: Network error trying to contact connection test API.');
  } finally {
    btnTestConnection.removeAttribute('disabled');
    btnTestConnection.innerHTML = origHTML;
    lucide.createIcons();
  }
});

// Remote Folder Browser interaction
let currentBrowsedPath = '';

if (btnBrowseRemote) {
  btnBrowseRemote.addEventListener('click', () => {
    browserModal.style.display = 'flex';

    const host = document.getElementById('host').value;
    const login = document.getElementById('login').value;
    const remoteDir = document.getElementById('remoteDir').value;

    if (!host || !login || !remoteDir) {
      alert('Please enter your connection details (Host, Username, Remote Directory Root) in Settings first.');
      browserModal.style.display = 'none';
      toggleDrawer(true); // Open settings drawer
      return;
    }

    currentBrowsedPath = remoteDir;
    loadRemoteDirectory(currentBrowsedPath);
  });
}

if (btnBrowserClose) {
  btnBrowserClose.addEventListener('click', () => {
    browserModal.style.display = 'none';
  });
}

if (btnBrowserDone) {
  btnBrowserDone.addEventListener('click', () => {
    browserModal.style.display = 'none';
  });
}

async function loadRemoteDirectory(targetPath) {
  const host = document.getElementById('host').value;
  const port = document.getElementById('port').value;
  const login = document.getElementById('login').value;
  const pass = document.getElementById('pass').value;
  const remoteDir = document.getElementById('remoteDir').value;

  browserLoading.style.display = 'flex';
  browserError.style.display = 'none';
  browserList.innerHTML = '';
  browserBreadcrumbs.innerHTML = '';

  try {
    const res = await fetch('/api/browse-remote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host,
        port,
        login,
        pass,
        remoteDir,
        currentPath: targetPath
      })
    });

    const result = await res.json();

    if (res.ok && result.success) {
      currentBrowsedPath = result.currentPath;
      renderBreadcrumbs(result.currentPath, remoteDir);
      renderBrowserList(result.folders);
    } else {
      browserErrorMsg.textContent = result.error || 'Failed to list directory contents.';
      browserError.style.display = 'flex';
    }
  } catch (err) {
    browserErrorMsg.textContent = 'Network error communicating with the server.';
    browserError.style.display = 'flex';
  } finally {
    browserLoading.style.display = 'none';
  }
}

function renderBreadcrumbs(currentPath, basePath) {
  browserBreadcrumbs.innerHTML = '';

  const rootSpan = document.createElement('span');
  rootSpan.className = 'breadcrumb-item';
  rootSpan.textContent = 'Remote Root';
  rootSpan.addEventListener('click', () => {
    loadRemoteDirectory(basePath);
  });
  browserBreadcrumbs.appendChild(rootSpan);

  if (currentPath === basePath) {
    rootSpan.className = 'breadcrumb-item breadcrumb-active';
    lucide.createIcons();
    return;
  }

  const relative = currentPath.substring(basePath.length);
  const parts = relative.split('/').filter(Boolean);

  let accumulatedPath = basePath;
  parts.forEach((part, index) => {
    const separator = document.createElement('span');
    separator.className = 'breadcrumb-separator';
    separator.textContent = ' / ';
    browserBreadcrumbs.appendChild(separator);

    accumulatedPath += '/' + part;

    const span = document.createElement('span');
    span.textContent = part;

    if (index === parts.length - 1) {
      span.className = 'breadcrumb-item breadcrumb-active';
    } else {
      span.className = 'breadcrumb-item';
      const pathToGo = accumulatedPath;
      span.addEventListener('click', () => {
        loadRemoteDirectory(pathToGo);
      });
    }

    browserBreadcrumbs.appendChild(span);
  });
}

function renderBrowserList(folders) {
  browserList.innerHTML = '';

  if (folders.length === 0) {
    browserList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; padding: 2rem; text-align: center;">This directory contains no subfolders.</div>';
    return;
  }

  const currentSubdirs = currentConfig.subdirs ? currentConfig.subdirs.split(',').map(s => s.trim()).filter(Boolean) : [];

  folders.forEach(folder => {
    const item = document.createElement('div');
    item.className = 'browser-item';

    const left = document.createElement('div');
    left.className = 'browser-item-left';

    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'folder');
    icon.className = 'browser-item-icon';
    left.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'browser-item-name';
    name.textContent = folder.name;
    left.appendChild(name);

    item.appendChild(left);

    const actions = document.createElement('div');
    actions.className = 'browser-item-actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-secondary btn-xs btn-icon-text';
    openBtn.innerHTML = '<i data-lucide="folder-open"></i><span>Open</span>';
    openBtn.addEventListener('click', () => {
      loadRemoteDirectory(folder.absolutePath);
    });
    actions.appendChild(openBtn);

    const addBtn = document.createElement('button');
    const isAdded = currentSubdirs.includes(folder.relativePath);

    if (isAdded) {
      addBtn.className = 'btn btn-success btn-xs btn-icon-text';
      addBtn.setAttribute('disabled', 'true');
      addBtn.innerHTML = '<i data-lucide="check"></i><span>Added</span>';
    } else {
      addBtn.className = 'btn btn-primary btn-xs btn-icon-text';
      addBtn.innerHTML = '<i data-lucide="plus"></i><span>Add</span>';
      addBtn.addEventListener('click', () => {
        addFolderToSync(folder.relativePath, addBtn);
      });
    }

    actions.appendChild(addBtn);
    item.appendChild(actions);
    browserList.appendChild(item);
  });

  lucide.createIcons();
}

async function addFolderToSync(relativePath, buttonElement) {
  if (!currentConfig) return;

  const subdirs = currentConfig.subdirs ? currentConfig.subdirs.split(',').map(s => s.trim()).filter(Boolean) : [];
  const activeDirs = Array.isArray(currentConfig.activeSubdirs) ? currentConfig.activeSubdirs : [];

  if (!subdirs.includes(relativePath)) {
    subdirs.push(relativePath);
  }
  if (!activeDirs.includes(relativePath)) {
    activeDirs.push(relativePath);
  }

  currentConfig.subdirs = subdirs.join(', ');
  currentConfig.activeSubdirs = activeDirs;

  const subdirsInput = document.getElementById('subdirs');
  if (subdirsInput) {
    subdirsInput.value = currentConfig.subdirs;
  }

  buttonElement.className = 'btn btn-success btn-xs btn-icon-text';
  buttonElement.setAttribute('disabled', 'true');
  buttonElement.innerHTML = '<i data-lucide="check"></i><span>Added</span>';
  lucide.createIcons();

  await saveSelectionState();
  renderSubfolderCheckboxes(currentConfig);
}

// Manual Add Folder handler
if (btnAddCustomFolder && inputCustomFolder) {
  const handleManualAdd = async () => {
    const rawVal = inputCustomFolder.value.trim();
    if (!rawVal) return;

    // Clean up path by removing leading/trailing slashes and double slashes
    const folderPath = rawVal.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
    if (!folderPath) return;

    if (!currentConfig) {
      currentConfig = { subdirs: '', activeSubdirs: [] };
    }

    const subdirs = currentConfig.subdirs ? currentConfig.subdirs.split(',').map(s => s.trim()).filter(Boolean) : [];
    const activeDirs = Array.isArray(currentConfig.activeSubdirs) ? currentConfig.activeSubdirs : [];

    if (!subdirs.includes(folderPath)) {
      subdirs.push(folderPath);
    }
    if (!activeDirs.includes(folderPath)) {
      activeDirs.push(folderPath);
    }

    currentConfig.subdirs = subdirs.join(', ');
    currentConfig.activeSubdirs = activeDirs;

    const subdirsInput = document.getElementById('subdirs');
    if (subdirsInput) {
      subdirsInput.value = currentConfig.subdirs;
    }

    inputCustomFolder.value = ''; // clear input

    await saveSelectionState();
    renderSubfolderCheckboxes(currentConfig);
  };

  btnAddCustomFolder.addEventListener('click', handleManualAdd);
  inputCustomFolder.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleManualAdd();
    }
  });
}

// Save Config Form Submission
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const syncModeRadio = document.querySelector('input[name="syncMode"]:checked');
  const syncMode = syncModeRadio ? syncModeRadio.value : 'all';
  
  const activeDirs = [];
  const checkboxes = document.querySelectorAll('#sync-folders-list input[type="checkbox"]');
  checkboxes.forEach(cb => {
    if (cb.checked) {
      activeDirs.push(cb.value);
    }
  });

  const payload = {
    host: document.getElementById('host').value,
    port: document.getElementById('port').value,
    login: document.getElementById('login').value,
    remoteDir: document.getElementById('remoteDir').value,
    localDir: document.getElementById('localDir').value,
    subdirs: document.getElementById('subdirs').value,
    nfile: parseInt(document.getElementById('nfile').value, 10),
    nsegment: parseInt(document.getElementById('nsegment').value, 10),
    minchunk: parseInt(document.getElementById('minchunk').value, 10),
    maxLogLines: parseInt(document.getElementById('maxLogLines').value, 10),
    cronEnabled: cronEnabled.checked,
    cronSchedule: document.getElementById('cronSchedule').value,
    syncMode,
    activeSubdirs: activeDirs
  };

  const passValue = document.getElementById('pass').value;
  if (passValue) {
    payload.pass = passValue;
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      alert('Configuration saved successfully.');
      toggleDrawer(false); // Close settings drawer on successful save
      fetchConfig();
    } else {
      const err = await res.json();
      alert(`Error: ${err.error}`);
    }
  } catch (err) {
    alert('Failed to save configuration');
  }
});

// Update Pulsing Status Badges
function updateStatus(isSyncing, startTime, lastRun) {
  if (isSyncing) {
    syncBadge.className = 'pulse-badge syncing';
    syncBadge.textContent = 'Syncing';
    btnSync.setAttribute('disabled', 'true');
    btnSyncText.textContent = 'Running...';
    btnAbort.removeAttribute('disabled');
    
    const startStr = startTime ? new Date(startTime).toLocaleTimeString() : new Date().toLocaleTimeString();
    statusDetail.textContent = `Sync started at ${startStr}. Checking files and transferring...`;
  } else {
    syncBadge.className = 'pulse-badge idle';
    syncBadge.textContent = 'Idle';
    btnSync.removeAttribute('disabled');
    btnSyncText.textContent = 'Sync Now';
    btnAbort.setAttribute('disabled', 'true');
    
    // Hide live speed indicator when idle
    if (liveSpeedContainer) {
      liveSpeedContainer.style.display = 'none';
    }
    
    if (lastRun) {
      const endStr = new Date(lastRun.timestamp).toLocaleString();
      statusDetail.textContent = `Last sync completed at ${endStr} with status: ${lastRun.status}`;
    } else {
      statusDetail.textContent = 'Ready to start synchronization.';
    }
  }
}

// Update Last Run Metrics UI
function updateMetrics(lastRun) {
  if (!lastRun) return;
  
  const speedMbps = lastRun.speedMbps || 0;
  const speedMBs = lastRun.speedMBs || 0;
  statSpeed.textContent = `${speedMbps.toFixed(2)} Mbps`;
  statSpeedMbs.textContent = `${speedMBs.toFixed(2)} MB/s`;
  
  const bytes = lastRun.bytesTransferred || 0;
  const mb = bytes / 1000000;
  const mib = bytes / 1048576;
  statTransferred.textContent = `${mb.toFixed(2)} MB`;
  statTransferredMib.textContent = `${mib.toFixed(2)} MiB`;
  
  const secs = lastRun.durationSeconds || 0;
  if (secs >= 3600) {
    statDuration.textContent = `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m ${secs%60}s`;
  } else if (secs >= 60) {
    statDuration.textContent = `${Math.floor(secs/60)}m ${secs%60}s`;
  } else {
    statDuration.textContent = `${secs}s`;
  }
  
  const dateObj = new Date(lastRun.timestamp);
  statTimestamp.textContent = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Console Functions
function appendConsole(text) {
  consoleOutput.textContent += text;
  if (consoleOutput.textContent.length > 200000) {
    consoleOutput.textContent = consoleOutput.textContent.substring(consoleOutput.textContent.length - 100000);
  }
  consoleOutput.parentElement.scrollTop = consoleOutput.parentElement.scrollHeight;
}

btnClearConsole.addEventListener('click', () => {
  consoleOutput.textContent = '';
});

// Trigger Manual Sync
btnSync.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/sync/start', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      alert(`Error starting sync: ${err.error}`);
    }
  } catch (err) {
    console.error('Error starting sync:', err);
  }
});

// Abort Active Sync
btnAbort.addEventListener('click', async () => {
  if (confirm('Are you sure you want to abort the current sync process?')) {
    try {
      const res = await fetch('/api/sync/stop', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error aborting sync: ${err.error}`);
      }
    } catch (err) {
      console.error('Error aborting sync:', err);
    }
  }
});

// Load Initial Logs from Server
async function fetchLogs() {
  try {
    const res = await fetch('/api/logs?lines=300');
    if (res.ok) {
      const logs = await res.text();
      if (logs) {
        consoleOutput.textContent = logs;
        consoleOutput.parentElement.scrollTop = consoleOutput.parentElement.scrollHeight;
      }
    }
  } catch (err) {
    console.error('Error fetching logs:', err);
  }
}

// Initialize Chart.js Graph
function initChart() {
  const ctx = document.getElementById('speedChart').getContext('2d');
  
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(99, 102, 241, 0.45)');
  gradient.addColorStop(1, 'rgba(99, 102, 241, 0.01)');

  speedChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Transfer Speed (Mbps)',
        data: [],
        borderColor: '#6366f1',
        borderWidth: 3,
        backgroundColor: gradient,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#8b5cf6',
        pointBorderColor: '#fff',
        pointHoverRadius: 7
      }]
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
          displayColors: false,
          callbacks: {
            label: function(context) {
              return `Speed: ${context.parsed.y.toFixed(2)} Mbps`;
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
}

// Update Chart Data
function updateChart(history) {
  if (!speedChart || !history) return;
  
  const dataPoints = history.slice(0, 15).reverse();
  
  const labels = dataPoints.map(p => {
    const d = new Date(p.timestamp);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  });
  
  const speeds = dataPoints.map(p => p.speedMbps || 0);
  
  speedChart.data.labels = labels;
  speedChart.data.datasets[0].data = speeds;
  speedChart.update();
}

// Page load initialization
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initChart();
  connectWS();
  fetchConfig();
  fetchLogs();
});
