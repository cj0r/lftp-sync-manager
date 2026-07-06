// State variables
let ws = null;
let speedChart = null;
let currentConfig = null;
let activeWorkflowTab = 'push'; // 'push' or 'pull'
const consoleOutput = document.getElementById('console-output');

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
const btnPushAbort = document.getElementById('btn-push-abort');
const pushLiveSpeedContainer = document.getElementById('push-live-speed-container');
const pushLiveSpeedValue = document.getElementById('push-live-speed-value');

// Pull Status Card UI
const pullSyncBadge = document.getElementById('pull-sync-badge');
const pullStatusDetail = document.getElementById('pull-status-detail');
const btnPullSync = document.getElementById('btn-pull-sync');
const btnPullSyncText = document.getElementById('btn-pull-sync-text');
const btnPullAbort = document.getElementById('btn-pull-abort');
const pullLiveSpeedContainer = document.getElementById('pull-live-speed-container');
const pullLiveSpeedValue = document.getElementById('pull-live-speed-value');

// Metrics UI
const statPushAvgSpeed = document.getElementById('stat-push-avg-speed');
const statPushAvgSpeedMbs = document.getElementById('stat-push-avg-speed-mbs');
const statPullAvgSpeed = document.getElementById('stat-pull-avg-speed');
const statPullAvgSpeedMbs = document.getElementById('stat-pull-avg-speed-mbs');

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

// Console Actions and Tabs
const btnClearConsole = document.getElementById('btn-clear-console');
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
      updateWorkflowStatus('push', data.push.isSyncing, data.push.startTime, data.push.lastCompleted);
      updateWorkflowStatus('pull', data.pull.isSyncing, data.pull.startTime, data.pull.lastCompleted);
      updateMetrics(data.pushAverageSpeed30Days, data.pullAverageSpeed30Days);
      updateChart(data.history);
      break;
      
    case 'status':
      updateWorkflowStatus('push', data.push.isSyncing, data.push.startTime, data.push.lastCompleted);
      updateWorkflowStatus('pull', data.pull.isSyncing, data.pull.startTime, data.pull.lastCompleted);
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
      
    case 'log':
      if (data.workflow === activeWorkflowTab) {
        appendConsole(data.text);
      }
      break;
      
    case 'history_update':
      updateChart(data.history);
      updateMetrics(data.pushAverageSpeed30Days, data.pullAverageSpeed30Days);
      break;
      
    default:
      console.log('Unknown WS message type:', data.type);
  }
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

function toggleHelpModal(open) {
  if (open) {
    helpModal.classList.add('open');
  } else {
    helpModal.classList.remove('open');
    if (chkHelpSuppress.checked) {
      localStorage.setItem('lftp_help_shown', 'true');
    }
  }
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

drawerBackdrop.addEventListener('click', () => {
  toggleDrawer(false);
  toggleLogsDrawer(false);
});

settingsDrawer.addEventListener('click', (e) => {
  if (e.target === settingsDrawer) {
    toggleDrawer(false);
  }
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

  const fields = [
    'host', 'port', 'login', 'pass',
    'localPushDir', 'remotePullDir', 'remotePushDir', 'localPullDir',
    'nfile', 'nsegment', 'minchunk', 'maxLogLines',
    'pushCronSchedule', 'pullCronSchedule'
  ];
  fields.forEach(field => {
    const element = document.getElementById(field);
    if (element) {
      element.value = config[field] || '';
    }
  });
  
  pushEnabled.checked = !!config.pushEnabled;
  pullEnabled.checked = !!config.pullEnabled;
  pushCronEnabled.checked = !!config.pushCronEnabled;
  pushWatchEnabled.checked = !!config.pushWatchEnabled;
  pullCronEnabled.checked = !!config.pullCronEnabled;
  
  toggleWorkflowFields();
  togglePushCronField();
  togglePullCronField();
}

// Toggle Workflow settings sections based on enabled states
function toggleWorkflowFields() {
  if (pushEnabled.checked) {
    pushSettingsFields.style.display = 'flex';
    document.getElementById('localPushDir').setAttribute('required', 'true');
    document.getElementById('remotePullDir').setAttribute('required', 'true');
  } else {
    pushSettingsFields.style.display = 'none';
    document.getElementById('localPushDir').removeAttribute('required');
    document.getElementById('remotePullDir').removeAttribute('required');
  }

  if (pullEnabled.checked) {
    pullSettingsFields.style.display = 'flex';
    document.getElementById('remotePushDir').setAttribute('required', 'true');
    document.getElementById('localPullDir').setAttribute('required', 'true');
  } else {
    pullSettingsFields.style.display = 'none';
    document.getElementById('remotePushDir').removeAttribute('required');
    document.getElementById('localPullDir').removeAttribute('required');
  }
}

function togglePushCronField() {
  if (pushCronEnabled.checked) {
    pushCronScheduleGroup.style.display = 'flex';
    pushCronSchedule.setAttribute('required', 'true');
  } else {
    pushCronScheduleGroup.style.display = 'none';
    pushCronSchedule.removeAttribute('required');
  }
}

function togglePullCronField() {
  if (pullCronEnabled.checked) {
    pullCronScheduleGroup.style.display = 'flex';
    pullCronSchedule.setAttribute('required', 'true');
  } else {
    pullCronScheduleGroup.style.display = 'none';
    pullCronSchedule.removeAttribute('required');
  }
}

pushEnabled.addEventListener('change', toggleWorkflowFields);
pullEnabled.addEventListener('change', toggleWorkflowFields);
pushCronEnabled.addEventListener('change', togglePushCronField);
pullCronEnabled.addEventListener('change', togglePullCronField);


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

// Save Config Form Submission
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const isPush = pushEnabled.checked;
  const isPull = pullEnabled.checked;



  const localPushVal = document.getElementById('localPushDir').value.trim();
  const remotePullVal = document.getElementById('remotePullDir').value.trim();
  const remotePushVal = document.getElementById('remotePushDir').value.trim();
  const localPullVal = document.getElementById('localPullDir').value.trim();

  // Validate directory configurations match enabled workflows
  if (isPush) {
    if (!localPushVal || !remotePullVal) {
      alert('Error: You must configure both Local Upload Folder and Remote Download Folder for Upload workflow.');
      return;
    }
  }
  if (isPull) {
    if (!remotePushVal || !localPullVal) {
      alert('Error: You must configure both Remote Upload Folder and Local Download Folder for Download workflow.');
      return;
    }
  }

  const payload = {
    host: document.getElementById('host').value.trim(),
    port: document.getElementById('port').value.trim(),
    login: document.getElementById('login').value.trim(),
    pushEnabled: isPush,
    pullEnabled: isPull,
    localPushDir: localPushVal,
    remotePullDir: remotePullVal,
    remotePushDir: remotePushVal,
    localPullDir: localPullVal,
    nfile: parseInt(document.getElementById('nfile').value, 10),
    nsegment: parseInt(document.getElementById('nsegment').value, 10),
    minchunk: parseInt(document.getElementById('minchunk').value, 10),
    maxLogLines: parseInt(document.getElementById('maxLogLines').value, 10),
    pushCronEnabled: pushCronEnabled.checked,
    pushCronSchedule: pushCronSchedule.value.trim(),
    pushWatchEnabled: pushWatchEnabled.checked,
    pullCronEnabled: pullCronEnabled.checked,
    pullCronSchedule: pullCronSchedule.value.trim()
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

// Update Pulsing Status Badges by Workflow
function updateWorkflowStatus(workflow, isSyncing, startTime, lastCompleted) {
  const syncBadge = (workflow === 'push' ? pushSyncBadge : pullSyncBadge);
  const btnSync = (workflow === 'push' ? btnPushSync : btnPullSync);
  const btnSyncText = (workflow === 'push' ? btnPushSyncText : btnPullSyncText);
  const btnAbort = (workflow === 'push' ? btnPushAbort : btnPullAbort);
  const statusDetail = (workflow === 'push' ? pushStatusDetail : pullStatusDetail);
  const liveSpeedContainer = (workflow === 'push' ? pushLiveSpeedContainer : pullLiveSpeedContainer);

  if (isSyncing) {
    if (syncBadge) {
      syncBadge.className = 'pulse-badge syncing';
      syncBadge.textContent = 'Syncing';
    }
    if (btnSync) {
      btnSync.setAttribute('disabled', 'true');
      btnSyncText.textContent = 'Running...';
    }
    if (btnAbort) {
      btnAbort.removeAttribute('disabled');
    }
    
    const startStr = startTime ? new Date(startTime).toLocaleTimeString() : new Date().toLocaleTimeString();
    if (statusDetail) {
      statusDetail.textContent = `${workflow === 'push' ? 'Upload' : 'Download'} sync started at ${startStr}. Checking files and transferring...`;
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
        statusDetail.textContent = `Last sync completed at ${endStr} with status: ${lastCompleted.status}`;
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

// Trigger Manual Push (Upload) Sync
if (btnPushSync) {
  btnPushSync.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/sync/start/push', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error starting Upload sync: ${err.error}`);
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
        alert(`Error starting Download sync: ${err.error}`);
      }
    } catch (err) {
      console.error('Error starting Download sync:', err);
    }
  });
}

// Abort Active Push (Upload) Sync
if (btnPushAbort) {
  btnPushAbort.addEventListener('click', async () => {
    if (confirm('Are you sure you want to abort the Upload sync process?')) {
      try {
        const res = await fetch('/api/sync/stop/push', { method: 'POST' });
        if (!res.ok) {
          const err = await res.json();
          alert(`Error aborting Upload sync: ${err.error}`);
        }
      } catch (err) {
        console.error('Error aborting Upload sync:', err);
      }
    }
  });
}

// Abort Active Pull (Download) Sync
if (btnPullAbort) {
  btnPullAbort.addEventListener('click', async () => {
    if (confirm('Are you sure you want to abort the Download sync process?')) {
      try {
        const res = await fetch('/api/sync/stop/pull', { method: 'POST' });
        if (!res.ok) {
          const err = await res.json();
          alert(`Error aborting Download sync: ${err.error}`);
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
          display: true,
          labels: {
            color: '#fff',
            font: { family: 'Outfit', size: 12 }
          }
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
        sshPublicKey.value = data.publicKey;
      } else {
        sshKeyStatus.textContent = 'Not Configured';
        sshKeyStatus.style.background = 'rgba(239, 68, 68, 0.1)';
        sshKeyStatus.style.color = '#ef4444';
        btnSshAuthorize.setAttribute('disabled', 'true');
        sshPubkeyWrapper.style.display = 'none';
        sshPublicKey.value = '';
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
        alert(data.message || 'SSH Key-Pair generated successfully.');
        await fetchSSHStatus();
      } else {
        alert(`Error: ${data.error || 'Failed to generate SSH key-pair'}`);
      }
    } catch (e) {
      alert('Failed to generate SSH key-pair.');
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
      alert('Please fill out Host, Username, and Password to authorize the SSH key on the remote server.');
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
        alert(data.message || 'SSH Key authorized successfully! You can now clear the Password field in connection settings.');
      } else {
        alert(`Error: ${data.error || 'Failed to authorize SSH key'}`);
      }
    } catch (e) {
      alert('Failed to authorize SSH key.');
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
    if (sshPublicKey.value) {
      sshPublicKey.select();
      navigator.clipboard.writeText(sshPublicKey.value)
        .then(() => alert('Public key copied to clipboard!'))
        .catch(err => alert('Failed to copy public key to clipboard'));
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
  fetchConfig();
  fetchLogs();
  fetchSSHStatus();
  checkFirstBootHelp();
});
