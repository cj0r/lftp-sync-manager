// State variables
let ws = null;
let speedChart = null;
const consoleOutput = document.getElementById('console-output');

// WS Status UI
const wsStatusDot = document.querySelector('#ws-status .status-dot');
const wsStatusText = document.getElementById('ws-status-text');

// Status Card UI
const syncBadge = document.getElementById('sync-badge');
const statusDetail = document.getElementById('status-detail');
const btnSync = document.getElementById('btn-sync');
const btnSyncText = document.getElementById('btn-sync-text');
const btnAbort = document.getElementById('btn-abort');

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

// Console Actions
const btnClearConsole = document.getElementById('btn-clear-console');

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
      // Direct log stream is text, not JSON
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
      loadConfigToForm(data.history[0]?.config || null); // fallback if needed
      break;
      
    case 'status':
      updateStatus(data.isSyncing, data.syncStartTime, data.lastRun);
      if (data.lastRun) {
        updateMetrics(data.lastRun);
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
  const fields = ['host', 'port', 'login', 'pass', 'remoteDir', 'localDir', 'nfile', 'nsegment', 'minchunk', 'maxLogLines', 'cronSchedule'];
  fields.forEach(field => {
    const element = document.getElementById(field);
    if (element) {
      element.value = config[field] || '';
    }
  });
  
  cronEnabled.checked = !!config.cronEnabled;
  toggleCronField();
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

// Save Config Form Submission
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const payload = {
    host: document.getElementById('host').value,
    port: document.getElementById('port').value,
    login: document.getElementById('login').value,
    remoteDir: document.getElementById('remoteDir').value,
    localDir: document.getElementById('localDir').value,
    nfile: parseInt(document.getElementById('nfile').value, 10),
    nsegment: parseInt(document.getElementById('nsegment').value, 10),
    minchunk: parseInt(document.getElementById('minchunk').value, 10),
    maxLogLines: parseInt(document.getElementById('maxLogLines').value, 10),
    cronEnabled: cronEnabled.checked,
    cronSchedule: document.getElementById('cronSchedule').value
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
  
  // Format speed
  const speedMbps = lastRun.speedMbps || 0;
  const speedMBs = lastRun.speedMBs || 0;
  statSpeed.textContent = `${speedMbps.toFixed(2)} Mbps`;
  statSpeedMbs.textContent = `${speedMBs.toFixed(2)} MB/s`;
  
  // Format size
  const bytes = lastRun.bytesTransferred || 0;
  const mb = bytes / 1000000;
  const mib = bytes / 1048576;
  statTransferred.textContent = `${mb.toFixed(2)} MB`;
  statTransferredMib.textContent = `${mib.toFixed(2)} MiB`;
  
  // Format duration
  const secs = lastRun.durationSeconds || 0;
  if (secs >= 3600) {
    statDuration.textContent = `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m ${secs%60}s`;
  } else if (secs >= 60) {
    statDuration.textContent = `${Math.floor(secs/60)}m ${secs%60}s`;
  } else {
    statDuration.textContent = `${secs}s`;
  }
  
  // Timestamp
  const dateObj = new Date(lastRun.timestamp);
  statTimestamp.textContent = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Console Functions
function appendConsole(text) {
  consoleOutput.textContent += text;
  // Limit buffer size in browser tab to avoid memory bloom
  if (consoleOutput.textContent.length > 200000) {
    consoleOutput.textContent = consoleOutput.textContent.substring(consoleOutput.textContent.length - 100000);
  }
  // Auto scroll to bottom
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
  
  // Create gradient
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
  
  // Extract last 15 entries and reverse to show chronological order
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
