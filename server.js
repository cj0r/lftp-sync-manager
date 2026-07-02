const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 9342;
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');
const LOG_FILE = path.join(CONFIG_DIR, 'transfer.log');

// Ensure directories and default files exist
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

const defaultConfig = {
  host: '',
  port: '22',
  login: '',
  pass: '',
  remoteDir: '',
  localDir: '/local-share',
  nfile: '2',
  nsegment: '16',
  minchunk: '1',
  cronSchedule: '0 * * * *', // hourly
  cronEnabled: false,
  maxLogLines: 5000,
  subdirs: 'tv-uhd, tv, movies, movies-uhd, games, extracted, misc',
  syncMode: 'all',
  activeSubdirs: []
};

if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
}

if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, '');
}

// Memory State
let isSyncing = false;
let activeLftpProcess = null;
let syncStartTime = null;
let currentCronJob = null;

// Read config helper
function getConfig() {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading config file:', err);
    return defaultConfig;
  }
}

// Write config helper
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    console.error('Error saving config file:', err);
    return false;
  }
}

// Read history helper
function getHistory() {
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading history file:', err);
    return [];
  }
}

// Append log helper
function appendLog(text) {
  try {
    fs.appendFileSync(LOG_FILE, text);
  } catch (err) {
    console.error('Error appending to log file:', err);
  }
}

// Broadcast helper for WS clients
function broadcast(data) {
  const message = typeof data === 'string' ? data : JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Trim log helper
function trimLogFile(maxLines = 5000) {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const data = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = data.split('\n');
    if (lines.length > maxLines) {
      const keepLinesCount = maxLines - 500;
      const keptLines = lines.slice(-keepLinesCount);
      const header = `--- Log trimmed at ${new Date().toISOString().replace('T', ' ').substring(0, 19)} (kept last ${keepLinesCount} lines) ---`;
      fs.writeFileSync(LOG_FILE, [header, ...keptLines].join('\n'));
      broadcast(JSON.stringify({ type: 'log', text: `\n${header}\n` }));
    }
  } catch (err) {
    console.error('Error trimming log file:', err);
  }
}

// Parse speed stats from lftp logs
function parseLftpOutput(output) {
  const regex = /(\d+)\s+bytes\s+transferred\s+in\s+([\d.]+)\s+seconds?/gi;
  let match;
  let totalBytes = 0;
  let totalSeconds = 0;
  
  while ((match = regex.exec(output)) !== null) {
    totalBytes += parseInt(match[1], 10);
    let secs = parseFloat(match[2]);
    if (secs === 0) secs = 1;
    totalSeconds += secs;
  }
  
  if (totalBytes > 0) {
    const mbps = (totalBytes * 8) / (totalSeconds * 1000000);
    const mb_s = totalBytes / (totalSeconds * 1000000);
    const mib_s = totalBytes / (totalSeconds * 1048576);
    return {
      totalBytes,
      totalSeconds,
      speedMbps: parseFloat(mbps.toFixed(2)),
      speedMBs: parseFloat(mb_s.toFixed(2)),
      speedMiBs: parseFloat(mib_s.toFixed(2))
    };
  }
  return null;
}

// Extract current speed in real-time from chunks of console output
function extractCurrentSpeed(chunk) {
  // Matches speed indicators in lftp stdout/stderr progress output (e.g. "4.54 MiB/s", "12.3M/s", "120 B/s")
  const regex = /(\d+(?:\.\d+)?)\s*([BKMGTbkmgt])(i?B)?\/s/g;
  let match;
  let lastSpeedMbps = null;
  
  while ((match = regex.exec(chunk)) !== null) {
    const val = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    let bytesPerSecond = val;
    if (unit === 'K') bytesPerSecond = val * 1024;
    else if (unit === 'M') bytesPerSecond = val * 1024 * 1024;
    else if (unit === 'G') bytesPerSecond = val * 1024 * 1024 * 1024;
    else if (unit === 'T') bytesPerSecond = val * 1024 * 1024 * 1024 * 1024;
    
    const mbps = (bytesPerSecond * 8) / 1000000;
    lastSpeedMbps = parseFloat(mbps.toFixed(2));
  }
  return lastSpeedMbps;
}

// Core Sync Function
function runSync() {
  if (isSyncing) {
    console.log('Sync already in progress. Skipping...');
    return;
  }

  isSyncing = true;
  syncStartTime = new Date();
  broadcast({ type: 'status', isSyncing, syncStartTime });

  const config = getConfig();
  
  const startMsg = `\n=============================================\nSync started manually at: ${syncStartTime.toLocaleString()}\n=============================================\n`;
  appendLog(startMsg);
  broadcast({ type: 'log', text: startMsg });

  // Prepare lftp command arguments
  const args = [
    '-p', config.port,
    '-u', `${config.login},${config.pass}`,
    `sftp://${config.host}`
  ];

  // Spawn lftp process
  activeLftpProcess = spawn('lftp', args);
  let processBuffer = '';

  // LFTP Script commands
  let lftpCommands = `
set cmd:interactive yes
set cmd:show-status yes
set cmd:status-interval 1s
set ftp:list-options -a
set sftp:auto-confirm yes
set pget:min-chunk-size ${config.minchunk}
set pget:default-n ${config.nsegment}
set mirror:use-pget-n ${config.nsegment}
set mirror:parallel-transfer-count ${config.nfile}
set mirror:parallel-directories yes
set xfer:use-temp-file yes
set xfer:temp-file-name *.lftp
`;

  if (config.syncMode === 'selected') {
    const activeDirs = Array.isArray(config.activeSubdirs) ? config.activeSubdirs : [];
    if (activeDirs.length === 0) {
      lftpCommands += `quit\n`;
    } else {
      activeDirs.forEach(dir => {
        lftpCommands += `
mkdir -p "${config.remoteDir}/${dir}"
mv "${config.remoteDir}/${dir}" "${config.remoteDir}/${dir}_lftp"
mkdir -p "${config.remoteDir}/${dir}"
mirror -c -v --loop --Move "${config.remoteDir}/${dir}_lftp" "${config.localDir}/${dir}"
`;
      });
      lftpCommands += `quit\n`;
    }
  } else {
    // Mode 'all'
    const subdirs = config.subdirs ? config.subdirs.split(',').map(s => s.trim()).filter(Boolean) : [];
    const mkdirCommands = subdirs.map(dir => `mkdir -p "${config.remoteDir}/${dir}"`).join('\n');
    lftpCommands += `
mkdir -p "${config.remoteDir}"
mv "${config.remoteDir}" "${config.remoteDir}_lftp"
mkdir -p "${config.remoteDir}"
${mkdirCommands}
mirror -c -v --loop --Move "${config.remoteDir}_lftp" "${config.localDir}"
quit
`;
  }

  // Write commands to stdin
  activeLftpProcess.stdin.write(lftpCommands);
  activeLftpProcess.stdin.end();

  // Read stdout and stderr
  activeLftpProcess.stdout.on('data', (data) => {
    const text = data.toString();
    processBuffer += text;
    appendLog(text);
    broadcast({ type: 'log', text });

    const currentSpeed = extractCurrentSpeed(text);
    if (currentSpeed !== null) {
      broadcast({ type: 'current_speed', speedMbps: currentSpeed });
    }
  });

  activeLftpProcess.stderr.on('data', (data) => {
    const text = data.toString();
    processBuffer += text;
    appendLog(text);
    broadcast({ type: 'log', text });

    const currentSpeed = extractCurrentSpeed(text);
    if (currentSpeed !== null) {
      broadcast({ type: 'current_speed', speedMbps: currentSpeed });
    }
  });

  // Handle process completion
  activeLftpProcess.on('close', (code) => {
    const endTime = new Date();
    isSyncing = false;
    activeLftpProcess = null;

    const stats = parseLftpOutput(processBuffer);
    const durationMs = endTime - syncStartTime;
    const durationSec = Math.floor(durationMs / 1000);

    let summaryText = '';
    const historyRecord = {
      timestamp: endTime.toISOString(),
      durationSeconds: durationSec,
      exitCode: code,
      status: code === 0 ? 'success' : 'failed',
      bytesTransferred: 0,
      speedMbps: 0,
      speedMBs: 0
    };

    if (stats) {
      historyRecord.bytesTransferred = stats.totalBytes;
      historyRecord.speedMbps = stats.speedMbps;
      historyRecord.speedMBs = stats.speedMBs;

      summaryText = `\n---------------------------------------------\n` +
                    `Transfer Summary:\n` +
                    `  Total Transferred: ${(stats.totalBytes / 1000000).toFixed(2)} MB (${(stats.totalBytes / 1048576).toFixed(2)} MiB)\n` +
                    `  Duration: ${stats.totalSeconds} seconds\n` +
                    `  Average Speed: ${stats.speedMbps} Mbps (${stats.speedMBs} MB/s)\n` +
                    `---------------------------------------------\n`;
    } else {
      summaryText = `\n---------------------------------------------\n` +
                    `No files were transferred or speed could not be calculated.\n` +
                    `---------------------------------------------\n`;
    }

    const endMsg = `${summaryText}Sync finished at: ${endTime.toLocaleString()} (Exit code: ${code}, Runtime: ${durationSec}s)\n=============================================\n`;
    appendLog(endMsg);
    broadcast({ type: 'log', text: endMsg });

    // Save history
    const history = getHistory();
    history.unshift(historyRecord);
    // Keep max 50 history entries
    if (history.length > 50) history.pop();
    try {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (err) {
      console.error('Error saving history file:', err);
    }

    // Trim log file
    trimLogFile(config.maxLogLines);

    // Broadcast update
    broadcast({ type: 'status', isSyncing, syncStartTime: null, lastRun: historyRecord });

    // Fix permissions on local share recursively
    const localDir = config.localDir || '/local-share';
    const puid = process.env.PUID || '99';
    const pgid = process.env.PGID || '100';
    const permMsg = `[Permissions] Fixing ownership and permissions in ${localDir}...\n`;
    appendLog(permMsg);
    broadcast({ type: 'log', text: permMsg });

    exec(`chown -R ${puid}:${pgid} "${localDir}" && chmod -R ug+rwX,o+rX "${localDir}"`, (err) => {
      if (err) {
        const errorMsg = `[Permissions] Error fixing permissions: ${err.message}\n`;
        appendLog(errorMsg);
        broadcast({ type: 'log', text: errorMsg });
      } else {
        const successMsg = `[Permissions] Successfully set owner to ${puid}:${pgid} and permissions to ug+rwX,o+rX.\n`;
        appendLog(successMsg);
        broadcast({ type: 'log', text: successMsg });
      }
    });
    broadcast({ type: 'history_update', history });
  });
}

// Setup Scheduler
function setupScheduler() {
  const config = getConfig();
  
  if (currentCronJob) {
    currentCronJob.stop();
    currentCronJob = null;
  }

  if (config.cronEnabled && config.cronSchedule) {
    if (cron.validate(config.cronSchedule)) {
      currentCronJob = cron.schedule(config.cronSchedule, () => {
        console.log(`[Scheduler] Starting scheduled transfer sync...`);
        runSync();
      });
      console.log(`[Scheduler] Sync scheduled with expression: "${config.cronSchedule}"`);
    } else {
      console.error(`[Scheduler] Invalid cron expression: "${config.cronSchedule}"`);
    }
  } else {
    console.log(`[Scheduler] Auto-scheduler is currently disabled.`);
  }
}

// Initialize Scheduler
setupScheduler();

// Express Configuration
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Express API Routes
app.get('/api/status', (req, res) => {
  const history = getHistory();
  res.json({
    isSyncing,
    syncStartTime,
    lastRun: history[0] || null,
    config: getConfig()
  });
});

app.get('/api/config', (req, res) => {
  res.json(getConfig());
});

app.post('/api/config', (req, res) => {
  const newConfig = { ...getConfig(), ...req.body };
  
  // Basic validation
  if (!newConfig.host || !newConfig.login) {
    return res.status(400).json({ error: 'Host and login credentials are required' });
  }

  if (saveConfig(newConfig)) {
    setupScheduler();
    res.json({ success: true, config: newConfig });
  } else {
    res.status(500).json({ error: 'Failed to write configuration file' });
  }
});

app.post('/api/test-connection', (req, res) => {
  const { host, port, login, pass } = req.body;
  if (!host || !login) {
    return res.status(400).json({ error: 'Host and login are required to test connection.' });
  }

  const args = [
    '-p', port || '22',
    '-u', `${login},${pass || ''}`,
    `sftp://${host}`
  ];

  const testProcess = spawn('lftp', args);
  let resolved = false;

  const timeoutId = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      testProcess.kill('SIGKILL');
      res.json({ success: false, error: 'Connection timed out (10s)' });
    }
  }, 10000);

  testProcess.stdin.write('ls; quit\n');
  testProcess.stdin.end();

  let stderrOutput = '';
  testProcess.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  let stdoutOutput = '';
  testProcess.stdout.on('data', (data) => {
    stdoutOutput += data.toString();
  });

  testProcess.on('close', (code) => {
    clearTimeout(timeoutId);
    if (resolved) return;
    resolved = true;

    if (code === 0) {
      res.json({ success: true });
    } else {
      const errMsg = stderrOutput || stdoutOutput || `Failed with exit code ${code}`;
      res.json({ success: false, error: errMsg.trim() });
    }
  });
});

app.get('/api/history', (req, res) => {
  res.json(getHistory());
});

app.post('/api/sync/start', (req, res) => {
  if (isSyncing) {
    return res.status(400).json({ error: 'Sync is already running' });
  }
  // Run asynchronously
  setTimeout(runSync, 0);
  res.json({ success: true, message: 'Sync started' });
});

app.post('/api/sync/stop', (req, res) => {
  if (!isSyncing || !activeLftpProcess) {
    return res.status(400).json({ error: 'Sync is not running' });
  }

  // Kill the process group or process
  activeLftpProcess.kill('SIGTERM');
  const killMsg = `\n[System] Sync execution aborted by user.\n`;
  appendLog(killMsg);
  broadcast({ type: 'log', text: killMsg });
  res.json({ success: true, message: 'Termination signal sent' });
});

app.get('/api/logs', (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return res.send('');
    }
    const data = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = data.split('\n');
    const limit = parseInt(req.query.lines, 10) || 500;
    res.send(lines.slice(-limit).join('\n'));
  } catch (err) {
    res.status(500).send('Error reading logs');
  }
});

// WebSocket Server Handler
wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  
  // Send current status on connect
  const history = getHistory();
  ws.send(JSON.stringify({
    type: 'init',
    isSyncing,
    syncStartTime,
    lastRun: history[0] || null,
    history
  }));

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(`LFTP Transfer Manager GUI running on port ${PORT}`);
  console.log(`Config Directory: ${CONFIG_DIR}`);
  console.log(`=============================================`);
});
