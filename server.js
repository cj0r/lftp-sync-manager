const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const helmet = require('helmet');
const chokidar = require('chokidar');

// Core application and server initialization
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 9342;
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');
const PUSH_LOG_FILE = path.join(CONFIG_DIR, 'push-sync.log');
const PULL_LOG_FILE = path.join(CONFIG_DIR, 'pull-sync.log');

// Ensure directories and default files exist
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

const defaultConfig = {
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
  maxLogLines: 5000,
  logLevel: 2,
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
  syncIgnoreTime: false,
  syncOnlyMissing: false
};

if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
}

if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(PUSH_LOG_FILE)) {
  fs.writeFileSync(PUSH_LOG_FILE, '');
}

if (!fs.existsSync(PULL_LOG_FILE)) {
  fs.writeFileSync(PULL_LOG_FILE, '');
}

let pushState = {
  isSyncing: false,
  activeProcess: null,
  startTime: null,
  lastCompleted: null,
  pendingRun: false
};

let pullState = {
  isSyncing: false,
  activeProcess: null,
  startTime: null,
  lastCompleted: null
};

let pushTransfers = {};
let pullTransfers = {};

function formatBytes(bytes) {
  if (isNaN(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function parseProgressLine(line) {
  const cleanLine = line.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim();
  if (!cleanLine) return null;
  

  
  const pattern1 = /\[(.+?)\]\s+([\d\w./]+)(?:\/([\d\w./]+))?\s+\((\d+)%\)\s+([\d\w./]+)\s+eta:(\w+)/i;
  let match = cleanLine.match(pattern1);
  if (match) {
    return {
      filename: match[1],
      transferred: match[2],
      total: match[3] || 'Unknown',
      percent: parseInt(match[4], 10),
      speed: match[5],
      eta: match[6]
    };
  }
  
  const pattern2 = /[`'\\]+(.+?)[`']+(?:\s+at\s+|,\s+got\s+)([\d\w./]+)(?:\/|\s+of\s+)([\d\w./]+)\s+\((\d+)%\)(?:\s+([\d\w./]+))?(?:\s+eta:(\w+))?/i;
  match = cleanLine.match(pattern2);
  if (match) {
    let transferred = match[2];
    let total = match[3];
    if (/^\d+$/.test(transferred)) {
      transferred = formatBytes(parseInt(transferred, 10));
    }
    if (/^\d+$/.test(total)) {
      total = formatBytes(parseInt(total, 10));
    }
    return {
      filename: match[1],
      transferred: transferred,
      total: total || 'Unknown',
      percent: parseInt(match[4], 10),
      speed: match[5] || 'Unknown',
      eta: match[6] || 'Unknown'
    };
  }

  const pattern3 = /(?:\[(.+?)\]|(.+?):)\s+(\d+)%\s+\|[^|]*\|\s+([\d\w./]+)\s+([\d\w./]+)\s+([\d\w.:]+)/i;
  match = cleanLine.match(pattern3);
  if (match) {
    return {
      filename: match[1] || match[2],
      transferred: match[4],
      total: 'Unknown',
      percent: parseInt(match[3], 10),
      speed: match[5],
      eta: match[6]
    };
  }
  
  return null;
}

function updateActiveTransfer(workflow, progress) {
  const transfers = workflow === 'push' ? pushTransfers : pullTransfers;
  transfers[progress.filename] = {
    ...progress,
    lastUpdate: Date.now()
  };
}

function broadcastTransfers(workflow) {
  const transfers = workflow === 'push' ? pushTransfers : pullTransfers;
  const now = Date.now();
  for (const [key, val] of Object.entries(transfers)) {
    if (now - val.lastUpdate > 3000) {
      delete transfers[key];
    }
  }
  broadcast({
    type: 'active_transfers',
    workflow,
    transfers: Object.values(transfers)
  });
}

setInterval(() => {
  if (pushState.isSyncing) {
    broadcastTransfers('push');
  } else if (Object.keys(pushTransfers).length > 0) {
    pushTransfers = {};
    broadcastTransfers('push');
  }
  
  if (pullState.isSyncing) {
    broadcastTransfers('pull');
  } else if (Object.keys(pullTransfers).length > 0) {
    pullTransfers = {};
    broadcastTransfers('pull');
  }
}, 1000);

let pushCronJob = null;
let pullCronJob = null;
let pushWatcher = null;
let pushWatchDebounceTimeout = null;

try {
  const historyOnStart = getHistory();
  const pushRuns = historyOnStart.filter(r => r.workflow === 'push');
  if (pushRuns.length > 0) {
    pushState.lastCompleted = {
      timestamp: pushRuns[0].timestamp,
      status: pushRuns[0].status
    };
  }
  const pullRuns = historyOnStart.filter(r => r.workflow === 'pull' || !r.workflow);
  if (pullRuns.length > 0) {
    pullState.lastCompleted = {
      timestamp: pullRuns[0].timestamp,
      status: pullRuns[0].status
    };
  }
} catch (e) {
  console.error('Failed to initialize lastCompleted states:', e);
}

// Escape function to prevent command injections in LFTP scripts
function escapeLftpArg(val) {
  if (val === undefined || val === null) return '';
  const str = String(val);
  const noNewlines = str.replace(/[\r\n]/g, '');
  return noNewlines.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function filterLogText(text, logLevel) {
  if (logLevel === 3) {
    return text;
  }
  if (logLevel === 2) {
    return text;
  }
  
  const lines = text.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    
    if (trimmed.includes('%') || line.includes('\r')) return false;
    if (/eta:/i.test(trimmed)) return false;
    if (/\b\d+(\.\d+)?[BKMGT]\/s\b/.test(trimmed)) return false;
    if (/\b\d+(\.\d+)?\s?[BKMGT]iB\/s\b/.test(trimmed)) return false;
    
    if (/copied:|moved:|transferring|failed|error|total:|skip/i.test(trimmed)) {
      return true;
    }
    
    if (trimmed.includes('====') || trimmed.includes('Sync started') || trimmed.includes('Sync completed') || trimmed.includes('[Info]') || trimmed.includes('[Checking]')) {
      return true;
    }
    
    return false;
  });
  
  if (filteredLines.length === 0) return null;
  return filteredLines.join('\n') + '\n';
}

// Read config helper
function getConfig() {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(data);
    
    let migrated = false;
    const merged = { ...defaultConfig, ...parsed };
    
    if (parsed.remoteDir) {
      if (!parsed.remotePushDir) {
        merged.remotePushDir = parsed.remoteDir;
        migrated = true;
      }
      if (!parsed.remotePullDir) {
        merged.remotePullDir = parsed.remoteDir;
        migrated = true;
      }
    }
    if (parsed.localDir) {
      if (!parsed.localPushDir) {
        merged.localPushDir = parsed.localDir;
        migrated = true;
      }
      if (!parsed.localPullDir) {
        merged.localPullDir = parsed.localDir;
        migrated = true;
      }
    }

    if (migrated) {
      try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
        console.log('[Migration] Migrated v1 config.json successfully to v2');
      } catch (saveErr) {
        console.error('[Migration] Failed to save migrated config:', saveErr);
      }
    }
    
    return merged;
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

// Calculate 30-day average speed of actual transfers
function getAverageSpeed30Days(workflow) {
  const history = getHistory();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  // Filter for actual transfers within 30 days
  const activeRuns = history.filter(run => {
    const isMatchingWorkflow = workflow === 'push' ? run.workflow === 'push' : (run.workflow === 'pull' || !run.workflow);
    return run.bytesTransferred > 0 && new Date(run.timestamp) >= thirtyDaysAgo && isMatchingWorkflow;
  });
  
  if (activeRuns.length === 0) {
    return { speedMbps: 0, speedMBs: 0 };
  }
  
  const sumMbps = activeRuns.reduce((sum, run) => sum + (run.speedMbps || 0), 0);
  const sumMBs = activeRuns.reduce((sum, run) => sum + (run.speedMBs || 0), 0);
  
  return {
    speedMbps: parseFloat((sumMbps / activeRuns.length).toFixed(2)),
    speedMBs: parseFloat((sumMBs / activeRuns.length).toFixed(2))
  };
}

// Append log helper
function appendLog(workflow, text) {
  const logFile = workflow === 'push' ? PUSH_LOG_FILE : PULL_LOG_FILE;
  try {
    fs.appendFileSync(logFile, text);
  } catch (err) {
    console.error(`Error appending to ${workflow} log file:`, err);
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
function trimLogFile(workflow, maxLines = 5000) {
  const logFile = workflow === 'push' ? PUSH_LOG_FILE : PULL_LOG_FILE;
  try {
    if (!fs.existsSync(logFile)) return;
    const data = fs.readFileSync(logFile, 'utf8');
    const lines = data.split('\n');
    if (lines.length > maxLines) {
      const keepLinesCount = maxLines - 500;
      const keptLines = lines.slice(-keepLinesCount);
      const header = `--- Log trimmed at ${new Date().toISOString().replace('T', ' ').substring(0, 19)} (kept last ${keepLinesCount} lines) ---`;
      fs.writeFileSync(logFile, [header, ...keptLines].join('\n'));
      broadcast(JSON.stringify({ type: 'log', workflow, text: `\n${header}\n` }));
    }
  } catch (err) {
    console.error(`Error trimming ${workflow} log file:`, err);
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

function validatePushConfig(config) {
  if (!config.localPushDir || !config.localPushDir.trim()) {
    return { valid: false, error: 'Local Push Folder is required for Push workflow.' };
  }
  if (!config.remotePullDir || !config.remotePullDir.trim()) {
    return { valid: false, error: 'Remote Pull Folder is required for Push workflow.' };
  }
  return { valid: true };
}

function validatePullConfig(config) {
  if (!config.remotePushDir || !config.remotePushDir.trim()) {
    return { valid: false, error: 'Remote Push Folder is required for Pull workflow.' };
  }
  if (!config.localPullDir || !config.localPullDir.trim()) {
    return { valid: false, error: 'Local Pull Folder is required for Pull workflow.' };
  }
  return { valid: true };
}

function isThrottleActive(config) {
  if (!config.throttleEnabled) return false;

  const now = new Date();
  const currentDay = now.getDay();

  const enabledDays = (config.throttleScheduleDays || []).map(d => parseInt(d, 10));
  if (enabledDays.length > 0 && !enabledDays.includes(currentDay)) {
    return false;
  }

  const startParts = (config.throttleScheduleStart || '09:00').split(':');
  const endParts = (config.throttleScheduleEnd || '17:00').split(':');

  const startHour = parseInt(startParts[0], 10);
  const startMin = parseInt(startParts[1], 10);
  const endHour = parseInt(endParts[0], 10);
  const endMin = parseInt(endParts[1], 10);

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

function runPushSync() {
  if (pushState.isSyncing) {
    console.log('[Push] Sync already in progress. Skipping...');
    return;
  }

  const config = getConfig();
  const validation = validatePushConfig(config);
  if (!validation.valid) {
    const errorMsg = `\n[Validation Error] Push Sync failed to start: ${validation.error}\n`;
    console.error(validation.error);
    appendLog('push', errorMsg);
    broadcast({ type: 'log', workflow: 'push', text: errorMsg });
    pushState.lastCompleted = {
      timestamp: new Date().toISOString(),
      status: 'failed (validation error)'
    };
    broadcast({
      type: 'status',
      push: {
        isSyncing: pushState.isSyncing,
        startTime: pushState.startTime,
        lastCompleted: pushState.lastCompleted
      },
      pull: {
        isSyncing: pullState.isSyncing,
        startTime: pullState.startTime,
        lastCompleted: pullState.lastCompleted
      }
    });
    return;
  }

  pushState.isSyncing = true;
  pushState.startTime = new Date();
  broadcast({
    type: 'status',
    push: {
      isSyncing: pushState.isSyncing,
      startTime: pushState.startTime,
      lastCompleted: pushState.lastCompleted
    },
    pull: {
      isSyncing: pullState.isSyncing,
      startTime: pullState.startTime,
      lastCompleted: pullState.lastCompleted
    }
  });

  const startMsg = `\n=============================================\nPush Sync started manually at: ${pushState.startTime.toLocaleString()}\n=============================================\n`;
  appendLog('push', startMsg);
  broadcast({ type: 'log', workflow: 'push', text: startMsg });

  const args = ['-q', '-e', '-f', '/dev/null', '-c', 'lftp'];
  pushState.activeProcess = spawn('script', args);
  let processBuffer = '';
  let pushStdoutRemainder = '';
  let pushStderrRemainder = '';


  pushState.activeProcess.on('error', (err) => {
    console.error('Failed to start push sync process:', err);
    appendLog('push', `[Error] Failed to start sync process: ${err.message}\n`);
    broadcast({ type: 'log', workflow: 'push', text: `[Error] Failed to start sync process: ${err.message}\n` });
    pushState.isSyncing = false;
    pushState.activeProcess = null;
    pushState.lastCompleted = {
      timestamp: new Date().toISOString(),
      status: 'failed'
    };
    broadcast({
      type: 'status',
      push: {
        isSyncing: pushState.isSyncing,
        startTime: pushState.startTime,
        lastCompleted: pushState.lastCompleted
      },
      pull: {
        isSyncing: pullState.isSyncing,
        startTime: pullState.startTime,
        lastCompleted: pullState.lastCompleted
      }
    });
  });

  const host = escapeLftpArg(config.host);
  const port = parseInt(config.port, 10) || 22;
  const login = escapeLftpArg(config.login);
  const hasKey = fs.existsSync('/config/id_rsa');
  const pass = config.pass ? escapeLftpArg(config.pass) : (hasKey ? 'dummy' : '');
  const minchunk = parseInt(config.minchunk, 10) || 1;
  const nsegment = parseInt(config.nsegment, 10) || 16;
  const nfile = parseInt(config.nfile, 10) || 2;

  let lftpCommands = '';
  if (hasKey) {
    lftpCommands += `set sftp:connect-program "ssh -a -x -o StrictHostKeyChecking=accept-new -i /config/id_rsa"\n`;
  }
  
  lftpCommands += `open -p "${port}" -u "${login},${pass}" sftp://${host}
set cmd:interactive yes
set cmd:show-status yes
set cmd:status-interval 1s
set ftp:list-options -a
set sftp:auto-confirm yes
set pget:min-chunk-size ${minchunk}
set pget:default-n ${nsegment}
set mirror:use-pget-n ${nsegment}
set mirror:parallel-transfer-count ${nfile}
set mirror:parallel-directories yes
set xfer:use-temp-file yes
set xfer:temp-file-name *.lftp
`;

  if (isThrottleActive(config)) {
    const downLimitBytes = (parseInt(config.throttleDownloadLimit, 10) || 1024) * 1024;
    const upLimitBytes = (parseInt(config.throttleUploadLimit, 10) || 512) * 1024;
    lftpCommands += `set net:limit-download ${downLimitBytes}\n`;
    lftpCommands += `set net:limit-upload ${upLimitBytes}\n`;
    
    const limitMsg = `[Throttle] Bandwidth limits active: Download ${config.throttleDownloadLimit} KB/s, Upload ${config.throttleUploadLimit} KB/s\n`;
    appendLog('push', limitMsg);
    broadcast({ type: 'log', workflow: 'push', text: limitMsg });
  }

  const localPush = config.localPushDir || '/local-push';
  const remotePull = config.remotePullDir || '/remote-pull';
  const pushSrc = localPush.endsWith('/') ? localPush : `${localPush}/`;
  const escapedPushSrc = escapeLftpArg(pushSrc);
  const escapedRemotePull = escapeLftpArg(remotePull);

  let mirrorFlags = '-R -c -v';
  if (!config.syncDryRun) {
    mirrorFlags += ' --loop';
  }
  mirrorFlags += ' --Remove-source-files';
  if (config.syncDelete) {
    mirrorFlags += ' --delete';
  }
  if (config.syncDryRun) {
    mirrorFlags += ' --dry-run';
  }
  if (config.syncIgnoreTime) {
    mirrorFlags += ' --ignore-time';
  }
  if (config.syncOnlyMissing) {
    mirrorFlags += ' --only-missing';
  }

  if (config.excludePatterns) {
    const excludes = config.excludePatterns.split(',').map(p => p.replace(/"/g, '').trim()).filter(Boolean);
    excludes.forEach(pat => {
      mirrorFlags += ` -X "${pat}"`;
    });
  }
  if (config.includePatterns) {
    const includes = config.includePatterns.split(',').map(p => p.replace(/"/g, '').trim()).filter(Boolean);
    includes.forEach(pat => {
      mirrorFlags += ` -I "${pat}"`;
    });
  }

  lftpCommands += `
mkdir -f "${escapedRemotePull}"
mirror ${mirrorFlags} "${escapedPushSrc}" "${escapedRemotePull}"
quit
`;

  const logLevel = config.logLevel || 2;
  if (logLevel === 3) {
    let maskedCommands = lftpCommands;
    if (pass && pass !== 'dummy') {
      maskedCommands = maskedCommands.replace(new RegExp(pass, 'g'), '***');
    }
    const dbgMsg = `\n[DEBUG] Executing LFTP script:\n-------------------------------------\n${maskedCommands}\n-------------------------------------\n`;
    appendLog('push', dbgMsg);
    broadcast({ type: 'log', workflow: 'push', text: dbgMsg });
  }

  if (pushState.activeProcess.stdin) {
    pushState.activeProcess.stdin.on('error', (err) => {
      console.error('push activeProcess.stdin error:', err);
    });
    try {
      pushState.activeProcess.stdin.write(lftpCommands);
      pushState.activeProcess.stdin.end();
    } catch (e) {
      console.error('Error writing to push activeProcess.stdin:', e);
    }
  }

  if (pushState.activeProcess.stdout) {
    pushState.activeProcess.stdout.on('error', (err) => {
      console.error('push activeProcess.stdout error:', err);
    });
    pushState.activeProcess.stdout.on('data', (data) => {
      const text = data.toString();
      processBuffer += text;
      
      const filtered = filterLogText(text, logLevel);
      if (filtered) {
        appendLog('push', filtered);
        broadcast({ type: 'log', workflow: 'push', text: filtered });
      }

      const currentSpeed = extractCurrentSpeed(text);
      if (currentSpeed !== null) {
        broadcast({ type: 'current_speed', workflow: 'push', speedMbps: currentSpeed });
      }

      const lines = (pushStdoutRemainder + text).split(/[\r\n]+/);
      pushStdoutRemainder = lines.pop();
      for (const line of lines) {
        const progress = parseProgressLine(line);
        if (progress) {
          updateActiveTransfer('push', progress);
        }
      }
    });
  }

  if (pushState.activeProcess.stderr) {
    pushState.activeProcess.stderr.on('error', (err) => {
      console.error('push activeProcess.stderr error:', err);
    });
    pushState.activeProcess.stderr.on('data', (data) => {
      const text = data.toString();
      processBuffer += text;
      
      const filtered = filterLogText(text, logLevel);
      if (filtered) {
        appendLog('push', filtered);
        broadcast({ type: 'log', workflow: 'push', text: filtered });
      }

      const currentSpeed = extractCurrentSpeed(text);
      if (currentSpeed !== null) {
        broadcast({ type: 'current_speed', workflow: 'push', speedMbps: currentSpeed });
      }

      const lines = (pushStderrRemainder + text).split(/[\r\n]+/);
      pushStderrRemainder = lines.pop();
      for (const line of lines) {
        const progress = parseProgressLine(line);
        if (progress) {
          updateActiveTransfer('push', progress);
        }
      }
    });
  }

  pushState.activeProcess.on('close', (code) => {
    const endTime = new Date();
    pushState.isSyncing = false;
    pushState.activeProcess = null;

    const stats = parseLftpOutput(processBuffer);
    const durationMs = endTime - pushState.startTime;
    const durationSec = Math.floor(durationMs / 1000);

    let summaryText = '';
    const isSuccess = (code === 0) || (code === 1 && stats && stats.totalBytes > 0);
    const hasTransfer = stats && stats.totalBytes > 0;

    pushState.lastCompleted = {
      timestamp: endTime.toISOString(),
      status: isSuccess ? 'success' : 'failed'
    };

    if (hasTransfer) {
      const historyRecord = {
        timestamp: endTime.toISOString(),
        workflow: 'push',
        durationSeconds: durationSec,
        exitCode: code,
        status: isSuccess ? 'success' : 'failed',
        bytesTransferred: stats.totalBytes,
        speedMbps: stats.speedMbps,
        speedMBs: stats.speedMBs
      };

      summaryText = `\n---------------------------------------------\n` +
                    `Push Transfer Summary:\n` +
                    `  Total Transferred: ${(stats.totalBytes / 1000000).toFixed(2)} MB (${(stats.totalBytes / 1048576).toFixed(2)} MiB)\n` +
                    `  Duration: ${stats.totalSeconds} seconds\n` +
                    `  Average Speed: ${stats.speedMbps} Mbps (${stats.speedMBs} MB/s)\n` +
                    `---------------------------------------------\n`;

      const history = getHistory();
      history.unshift(historyRecord);
      if (history.length > 50) history.pop();
      try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
      } catch (err) {
        console.error('Error saving history file:', err);
      }
    } else {
      summaryText = `\n---------------------------------------------\n` +
                    `No files were transferred or speed could not be calculated.\n` +
                    `---------------------------------------------\n`;
    }

    const endMsg = `${summaryText}Push Sync finished at: ${endTime.toLocaleString()} (Exit code: ${code}, Runtime: ${durationSec}s)\n=============================================\n`;
    appendLog('push', endMsg);
    broadcast({ type: 'log', workflow: 'push', text: endMsg });

    trimLogFile('push', config.maxLogLines);

    broadcast({
      type: 'status',
      push: {
        isSyncing: pushState.isSyncing,
        startTime: null,
        lastCompleted: pushState.lastCompleted
      },
      pull: {
        isSyncing: pullState.isSyncing,
        startTime: pullState.startTime,
        lastCompleted: pullState.lastCompleted
      }
    });

    const puid = process.env.PUID || '99';
    const pgid = process.env.PGID || '100';

    if (localPush && fs.existsSync(localPush)) {
      const permMsg = `[Permissions] Fixing ownership and permissions in ${localPush}...\n`;
      appendLog('push', permMsg);
      broadcast({ type: 'log', workflow: 'push', text: permMsg });

      exec(`chown -R ${puid}:${pgid} "${localPush}" && chmod -R ug+rwX,o+rX "${localPush}"`, (err) => {
        if (err) {
          const errorMsg = `[Permissions] Error fixing permissions: ${err.message}\n`;
          appendLog('push', errorMsg);
          broadcast({ type: 'log', workflow: 'push', text: errorMsg });
        } else {
          const successMsg = `[Permissions] Successfully set owner to ${puid}:${pgid} and permissions to ug+rwX,o+rX.\n`;
          appendLog('push', successMsg);
          broadcast({ type: 'log', workflow: 'push', text: successMsg });
        }
      });
    }

    broadcast({
      type: 'history_update',
      history: getHistory(),
      pushAverageSpeed30Days: getAverageSpeed30Days('push'),
      pullAverageSpeed30Days: getAverageSpeed30Days('pull')
    });

    if (pushState.pendingRun) {
      pushState.pendingRun = false;
      console.log('[Watcher] Triggering pending push sync...');
      setTimeout(() => {
        runPushSync();
      }, 1000);
    }
  });
}

function runPullSync() {
  if (pullState.isSyncing) {
    console.log('[Pull] Sync already in progress. Skipping...');
    return;
  }

  const config = getConfig();
  const validation = validatePullConfig(config);
  if (!validation.valid) {
    const errorMsg = `\n[Validation Error] Pull Sync failed to start: ${validation.error}\n`;
    console.error(validation.error);
    appendLog('pull', errorMsg);
    broadcast({ type: 'log', workflow: 'pull', text: errorMsg });
    pullState.lastCompleted = {
      timestamp: new Date().toISOString(),
      status: 'failed (validation error)'
    };
    broadcast({
      type: 'status',
      push: {
        isSyncing: pushState.isSyncing,
        startTime: pushState.startTime,
        lastCompleted: pushState.lastCompleted
      },
      pull: {
        isSyncing: pullState.isSyncing,
        startTime: pullState.startTime,
        lastCompleted: pullState.lastCompleted
      }
    });
    return;
  }

  pullState.isSyncing = true;
  pullState.startTime = new Date();
  broadcast({
    type: 'status',
    push: {
      isSyncing: pushState.isSyncing,
      startTime: pushState.startTime,
      lastCompleted: pushState.lastCompleted
    },
    pull: {
      isSyncing: pullState.isSyncing,
      startTime: pullState.startTime,
      lastCompleted: pullState.lastCompleted
    }
  });

  const startMsg = `\n=============================================\nPull Sync started manually at: ${pullState.startTime.toLocaleString()}\n=============================================\n`;
  appendLog('pull', startMsg);
  broadcast({ type: 'log', workflow: 'pull', text: startMsg });

  const host = escapeLftpArg(config.host);
  const port = parseInt(config.port, 10) || 22;
  const login = escapeLftpArg(config.login);
  const hasKey = fs.existsSync('/config/id_rsa');
  const pass = config.pass ? escapeLftpArg(config.pass) : (hasKey ? 'dummy' : '');
  const minchunk = parseInt(config.minchunk, 10) || 1;
  const nsegment = parseInt(config.nsegment, 10) || 16;
  const nfile = parseInt(config.nfile, 10) || 2;
  const remotePush = config.remotePushDir || '/remote-push';
  const localPull = config.localPullDir || '/local-pull';
  const escapedRemotePush = escapeLftpArg(remotePush);
  const escapedLocalPull = escapeLftpArg(localPull);

  // Verification step: Check if remote files exist
  const checkMsg = `[Checking] Verifying if remote files exist in ${remotePush}...\n`;
  appendLog('pull', checkMsg);
  broadcast({ type: 'log', workflow: 'pull', text: checkMsg });

  const checkProcess = spawn('lftp');
  let checkCmd = '';
  if (hasKey) {
    checkCmd += `set sftp:connect-program "ssh -a -x -o StrictHostKeyChecking=accept-new -i /config/id_rsa"\n`;
  }
  checkCmd += `open -p "${port}" -u "${login},${pass}" sftp://${host}\n`;
  checkCmd += `set sftp:auto-confirm yes\n`;
  checkCmd += `cls -1 "${escapedRemotePush}"\n`;
  checkCmd += `quit\n`;

  let checkStdout = '';
  let checkStderr = '';

  checkProcess.stdout.on('data', (data) => {
    checkStdout += data.toString();
  });

  checkProcess.stderr.on('data', (data) => {
    checkStderr += data.toString();
  });

  checkProcess.on('error', (err) => {
    console.error('Failed to run remote directory pre-check:', err);
    const errorMsg = `[Error] Remote directory pre-check failed: ${err.message}\n`;
    appendLog('pull', errorMsg);
    broadcast({ type: 'log', workflow: 'pull', text: errorMsg });

    pullState.isSyncing = false;
    pullState.lastCompleted = {
      timestamp: new Date().toISOString(),
      status: 'failed (check error)'
    };
    broadcast({
      type: 'status',
      push: {
        isSyncing: pushState.isSyncing,
        startTime: pushState.startTime,
        lastCompleted: pushState.lastCompleted
      },
      pull: {
        isSyncing: pullState.isSyncing,
        startTime: null,
        lastCompleted: pullState.lastCompleted
      }
    });
  });

  checkProcess.on('close', (code) => {
    const files = checkStdout.split(/[\r\n]+/).map(f => f.trim()).filter(Boolean);
    
    if (code !== 0 || files.length === 0) {
      const skipReason = code !== 0 
        ? `Connection/directory check failed: ${checkStderr.trim() || 'Unknown error'}` 
        : `No remote files found in ${remotePush}`;
      
      const skipMsg = `[Info] Pull Sync skipped: ${skipReason}\n`;
      appendLog('pull', skipMsg);
      broadcast({ type: 'log', workflow: 'pull', text: skipMsg });
      
      const endMsg = `Pull Sync finished at: ${new Date().toLocaleString()} (Skipped - empty)\n=============================================\n`;
      appendLog('pull', endMsg);
      broadcast({ type: 'log', workflow: 'pull', text: endMsg });

      pullState.isSyncing = false;
      pullState.lastCompleted = {
        timestamp: new Date().toISOString(),
        status: code !== 0 ? 'failed (check error)' : 'success (skipped - empty)'
      };
      
      broadcast({
        type: 'status',
        push: {
          isSyncing: pushState.isSyncing,
          startTime: pushState.startTime,
          lastCompleted: pushState.lastCompleted
        },
        pull: {
          isSyncing: pullState.isSyncing,
          startTime: null,
          lastCompleted: pullState.lastCompleted
        }
      });
      return;
    }

    // Remote files exist! Run the main download process.
    startMainPullSync(config, host, port, login, pass, hasKey, minchunk, nsegment, nfile, escapedRemotePush, escapedLocalPull, remotePush, localPull);
  });

  checkProcess.stdin.write(checkCmd);
  checkProcess.stdin.end();
}

function startMainPullSync(config, host, port, login, pass, hasKey, minchunk, nsegment, nfile, escapedRemotePush, escapedLocalPull, remotePush, localPull) {
  const args = ['-q', '-e', '-f', '/dev/null', '-c', 'lftp'];
  pullState.activeProcess = spawn('script', args);
  let processBuffer = '';
  let pullStdoutRemainder = '';
  let pullStderrRemainder = '';


  pullState.activeProcess.on('error', (err) => {
    console.error('Failed to start pull sync process:', err);
    appendLog('pull', `[Error] Failed to start sync process: ${err.message}\n`);
    broadcast({ type: 'log', workflow: 'pull', text: `[Error] Failed to start sync process: ${err.message}\n` });
    pullState.isSyncing = false;
    pullState.activeProcess = null;
    pullState.lastCompleted = {
      timestamp: new Date().toISOString(),
      status: 'failed'
    };
    broadcast({
      type: 'status',
      push: {
        isSyncing: pushState.isSyncing,
        startTime: pushState.startTime,
        lastCompleted: pushState.lastCompleted
      },
      pull: {
        isSyncing: pullState.isSyncing,
        startTime: null,
        lastCompleted: pullState.lastCompleted
      }
    });
  });

  let lftpCommands = '';
  if (hasKey) {
    lftpCommands += `set sftp:connect-program "ssh -a -x -o StrictHostKeyChecking=accept-new -i /config/id_rsa"\n`;
  }
  
  lftpCommands += `open -p "${port}" -u "${login},${pass}" sftp://${host}
set cmd:interactive yes
set cmd:show-status yes
set cmd:status-interval 1s
set ftp:list-options -a
set sftp:auto-confirm yes
set pget:min-chunk-size ${minchunk}
set pget:default-n ${nsegment}
set mirror:use-pget-n ${nsegment}
set mirror:parallel-transfer-count ${nfile}
set mirror:parallel-directories yes
set xfer:use-temp-file yes
set xfer:temp-file-name *.lftp
`;

  if (isThrottleActive(config)) {
    const downLimitBytes = (parseInt(config.throttleDownloadLimit, 10) || 1024) * 1024;
    const upLimitBytes = (parseInt(config.throttleUploadLimit, 10) || 512) * 1024;
    lftpCommands += `set net:limit-download ${downLimitBytes}\n`;
    lftpCommands += `set net:limit-upload ${upLimitBytes}\n`;
    
    const limitMsg = `[Throttle] Bandwidth limits active: Download ${config.throttleDownloadLimit} KB/s, Upload ${config.throttleUploadLimit} KB/s\n`;
    appendLog('pull', limitMsg);
    broadcast({ type: 'log', workflow: 'pull', text: limitMsg });
  }

  let mirrorFlags = '-c -v';
  if (!config.syncDryRun) {
    mirrorFlags += ' --loop';
  }
  mirrorFlags += ' --Move';
  if (config.syncDelete) {
    mirrorFlags += ' --delete';
  }
  if (config.syncDryRun) {
    mirrorFlags += ' --dry-run';
  }
  if (config.syncIgnoreTime) {
    mirrorFlags += ' --ignore-time';
  }
  if (config.syncOnlyMissing) {
    mirrorFlags += ' --only-missing';
  }

  if (config.excludePatterns) {
    const excludes = config.excludePatterns.split(',').map(p => p.replace(/"/g, '').trim()).filter(Boolean);
    excludes.forEach(pat => {
      mirrorFlags += ` -X "${pat}"`;
    });
  }
  if (config.includePatterns) {
    const includes = config.includePatterns.split(',').map(p => p.replace(/"/g, '').trim()).filter(Boolean);
    includes.forEach(pat => {
      mirrorFlags += ` -I "${pat}"`;
    });
  }

  lftpCommands += `
mkdir -f "${escapedRemotePush}"
mv "${escapedRemotePush}" "${escapedRemotePush}_lftp"
mkdir -f "${escapedRemotePush}"
mirror ${mirrorFlags} "${escapedRemotePush}_lftp" "${escapedLocalPull}"
quit
`;

  const logLevel = config.logLevel || 2;
  if (logLevel === 3) {
    let maskedCommands = lftpCommands;
    if (pass && pass !== 'dummy') {
      maskedCommands = maskedCommands.replace(new RegExp(pass, 'g'), '***');
    }
    const dbgMsg = `\n[DEBUG] Executing LFTP script:\n-------------------------------------\n${maskedCommands}\n-------------------------------------\n`;
    appendLog('pull', dbgMsg);
    broadcast({ type: 'log', workflow: 'pull', text: dbgMsg });
  }

  if (pullState.activeProcess.stdin) {
    pullState.activeProcess.stdin.on('error', (err) => {
      console.error('pull activeProcess.stdin error:', err);
    });
    try {
      pullState.activeProcess.stdin.write(lftpCommands);
      pullState.activeProcess.stdin.end();
    } catch (e) {
      console.error('Error writing to pull activeProcess.stdin:', e);
    }
  }

  if (pullState.activeProcess.stdout) {
    pullState.activeProcess.stdout.on('error', (err) => {
      console.error('pull activeProcess.stdout error:', err);
    });
    pullState.activeProcess.stdout.on('data', (data) => {
      const text = data.toString();
      processBuffer += text;
      
      const filtered = filterLogText(text, logLevel);
      if (filtered) {
        appendLog('pull', filtered);
        broadcast({ type: 'log', workflow: 'pull', text: filtered });
      }

      const currentSpeed = extractCurrentSpeed(text);
      if (currentSpeed !== null) {
        broadcast({ type: 'current_speed', workflow: 'pull', speedMbps: currentSpeed });
      }

      const lines = (pullStdoutRemainder + text).split(/[\r\n]+/);
      pullStdoutRemainder = lines.pop();
      for (const line of lines) {
        const progress = parseProgressLine(line);
        if (progress) {
          updateActiveTransfer('pull', progress);
        }
      }
    });
  }

  if (pullState.activeProcess.stderr) {
    pullState.activeProcess.stderr.on('error', (err) => {
      console.error('pull activeProcess.stderr error:', err);
    });
    pullState.activeProcess.stderr.on('data', (data) => {
      const text = data.toString();
      processBuffer += text;
      
      const filtered = filterLogText(text, logLevel);
      if (filtered) {
        appendLog('pull', filtered);
        broadcast({ type: 'log', workflow: 'pull', text: filtered });
      }

      const currentSpeed = extractCurrentSpeed(text);
      if (currentSpeed !== null) {
        broadcast({ type: 'current_speed', workflow: 'pull', speedMbps: currentSpeed });
      }

      const lines = (pullStderrRemainder + text).split(/[\r\n]+/);
      pullStderrRemainder = lines.pop();
      for (const line of lines) {
        const progress = parseProgressLine(line);
        if (progress) {
          updateActiveTransfer('pull', progress);
        }
      }
    });
  }

  pullState.activeProcess.on('close', (code) => {
    const endTime = new Date();
    pullState.isSyncing = false;
    pullState.activeProcess = null;

    cleanupRemotePullDir(config, host, port, login, pass, hasKey, escapedRemotePush);

    const stats = parseLftpOutput(processBuffer);
    const durationMs = endTime - pullState.startTime;
    const durationSec = Math.floor(durationMs / 1000);

    let summaryText = '';
    const isSuccess = (code === 0) || (code === 1 && stats && stats.totalBytes > 0);
    const hasTransfer = stats && stats.totalBytes > 0;

    pullState.lastCompleted = {
      timestamp: endTime.toISOString(),
      status: isSuccess ? 'success' : 'failed'
    };

    if (hasTransfer) {
      summaryText = `\n---------------------------------------------\n` +
                    `Pull Transfer Summary:\n` +
                    `  Total Transferred: ${(stats.totalBytes / 1000000).toFixed(2)} MB (${(stats.totalBytes / 1048576).toFixed(2)} MiB)\n` +
                    `  Duration: ${stats.totalSeconds} seconds\n` +
                    `  Average Speed: ${stats.speedMbps} Mbps (${stats.speedMBs} MB/s)\n` +
                    `---------------------------------------------\n`;

      const history = getHistory();
      const historyRecord = {
        timestamp: endTime.toISOString(),
        workflow: 'pull',
        durationSeconds: durationSec,
        exitCode: code,
        status: isSuccess ? 'success' : 'failed',
        bytesTransferred: stats.totalBytes,
        speedMbps: stats.speedMbps,
        speedMBs: stats.speedMBs
      };

      history.unshift(historyRecord);
      if (history.length > 50) history.pop();
      try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
      } catch (err) {
        console.error('Error saving history file:', err);
      }
    } else {
      summaryText = `\n---------------------------------------------\n` +
                    `No files were transferred or speed could not be calculated.\n` +
                    `---------------------------------------------\n`;
    }

    const endMsg = `${summaryText}Pull Sync finished at: ${endTime.toLocaleString()} (Exit code: ${code}, Runtime: ${durationSec}s)\n=============================================\n`;
    appendLog('pull', endMsg);
    broadcast({ type: 'log', workflow: 'pull', text: endMsg });

    trimLogFile('pull', config.maxLogLines);

    const puid = process.env.PUID || '99';
    const pgid = process.env.PGID || '100';

    if (localPull && fs.existsSync(localPull)) {
      const permMsg = `[Permissions] Fixing ownership and permissions in ${localPull}...\n`;
      appendLog('pull', permMsg);
      broadcast({ type: 'log', workflow: 'pull', text: permMsg });

      exec(`chown -R ${puid}:${pgid} "${localPull}" && chmod -R ug+rwX,o+rX "${localPull}"`, (err) => {
        if (err) {
          const errorMsg = `[Permissions] Error fixing permissions: ${err.message}\n`;
          appendLog('pull', errorMsg);
          broadcast({ type: 'log', workflow: 'pull', text: errorMsg });
        } else {
          const successMsg = `[Permissions] Successfully set owner to ${puid}:${pgid} and permissions to ug+rwX,o+rX.\n`;
          appendLog('pull', successMsg);
          broadcast({ type: 'log', workflow: 'pull', text: successMsg });
        }
      });
    }

    broadcast({
      type: 'status',
      push: {
        isSyncing: pushState.isSyncing,
        startTime: pushState.startTime,
        lastCompleted: pushState.lastCompleted
      },
      pull: {
        isSyncing: pullState.isSyncing,
        startTime: null,
        lastCompleted: pullState.lastCompleted
      }
    });

    broadcast({
      type: 'history_update',
      history: getHistory(),
      pushAverageSpeed30Days: getAverageSpeed30Days('push'),
      pullAverageSpeed30Days: getAverageSpeed30Days('pull')
    });
  });
}

function setupPushWatcher() {
  const config = getConfig();

  if (pushWatcher) {
    pushWatcher.close();
    pushWatcher = null;
    console.log('[Watcher] Closed existing push directory watcher.');
  }

  if (pushWatchDebounceTimeout) {
    clearTimeout(pushWatchDebounceTimeout);
    pushWatchDebounceTimeout = null;
  }

  if (!config.pushWatchEnabled) {
    console.log('[Watcher] Real-time Push directory watcher is disabled.');
    return;
  }

  const watchDir = config.localPushDir || '/local-push';
  if (!fs.existsSync(watchDir)) {
    console.error(`[Watcher] Local Push directory does not exist: ${watchDir}`);
    return;
  }

  console.log(`[Watcher] Initializing real-time watcher on: ${watchDir}`);

  pushWatcher = chokidar.watch(watchDir, {
    ignored: /(^|[\/\\])\..|.*\.lftp$/,
    persistent: true,
    ignoreInitial: true,
    depth: 99
  });

  const triggerDebouncedPush = (filePath, eventType) => {
    console.log(`[Watcher] Event "${eventType}" detected on: ${filePath}`);
    
    if (pushWatchDebounceTimeout) {
      clearTimeout(pushWatchDebounceTimeout);
    }

    pushWatchDebounceTimeout = setTimeout(() => {
      console.log(`[Watcher] Debounce complete. Evaluating push trigger...`);
      pushWatchDebounceTimeout = null;

      if (pushState.isSyncing) {
        console.log('[Watcher] Push sync is already active. Queueing pending run...');
        pushState.pendingRun = true;
      } else {
        console.log('[Watcher] Triggering Push sync...');
        runPushSync();
      }
    }, 5000);
  };

  pushWatcher
    .on('add', (filePath) => triggerDebouncedPush(filePath, 'add'))
    .on('change', (filePath) => triggerDebouncedPush(filePath, 'change'))
    .on('unlink', (filePath) => triggerDebouncedPush(filePath, 'unlink'))
    .on('error', (error) => console.error(`[Watcher] Watch error: ${error}`));
}

// Setup Scheduler
function setupScheduler() {
  const config = getConfig();
  
  if (pushCronJob) {
    pushCronJob.stop();
    pushCronJob = null;
  }
  if (pullCronJob) {
    pullCronJob.stop();
    pullCronJob = null;
  }

  // Setup Push Scheduler
  if (config.pushEnabled && config.pushCronEnabled && config.pushCronSchedule) {
    if (cron.validate(config.pushCronSchedule)) {
      pushCronJob = cron.schedule(config.pushCronSchedule, () => {
        console.log(`[Scheduler] Starting scheduled Push sync...`);
        runPushSync();
      });
      console.log(`[Scheduler] Push scheduled with expression: "${config.pushCronSchedule}"`);
    } else {
      console.error(`[Scheduler] Invalid Push cron expression: "${config.pushCronSchedule}"`);
    }
  } else {
    console.log(`[Scheduler] Push scheduler is currently disabled.`);
  }

  // Setup Pull Scheduler
  if (config.pullEnabled && config.pullCronEnabled && config.pullCronSchedule) {
    if (cron.validate(config.pullCronSchedule)) {
      pullCronJob = cron.schedule(config.pullCronSchedule, () => {
        console.log(`[Scheduler] Starting scheduled Pull sync...`);
        runPullSync();
      });
      console.log(`[Scheduler] Pull scheduled with expression: "${config.pullCronSchedule}"`);
    } else {
      console.error(`[Scheduler] Invalid Pull cron expression: "${config.pullCronSchedule}"`);
    }
  } else {
    console.log(`[Scheduler] Pull scheduler is currently disabled.`);
  }

  // Setup push directory watcher
  setupPushWatcher();
}

// Initialize Scheduler
setupScheduler();

// Express Configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://raw.githubusercontent.com"],
      connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  },
  hsts: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// File Explorer Listing & Deletion Helpers
function getRemoteListing(remotePath, callback) {
  const config = getConfig();
  const host = escapeLftpArg(config.host);
  const port = parseInt(config.port, 10) || 22;
  const login = escapeLftpArg(config.login);
  const hasKey = fs.existsSync('/config/id_rsa');
  const pass = config.pass ? escapeLftpArg(config.pass) : (hasKey ? 'dummy' : '');
  let pathWithSlash = remotePath;
  if (!pathWithSlash.endsWith('/')) {
    pathWithSlash += '/';
  }
  const escapedPath = escapeLftpArg(pathWithSlash);

  const lftpProcess = spawn('lftp');
  let cmd = '';
  if (hasKey) {
    cmd += `set sftp:connect-program "ssh -a -x -o StrictHostKeyChecking=accept-new -i /config/id_rsa"\n`;
  }
  cmd += `open -p "${port}" -u "${login},${pass}" sftp://${host}\n`;
  cmd += `set sftp:auto-confirm yes\n`;
  cmd += `set cache:enable no\n`;
  cmd += `cls -l "${escapedPath}"\n`;
  cmd += `quit\n`;

  let stdout = '';
  let stderr = '';

  lftpProcess.stdout.on('data', (data) => {
    stdout += data.toString();
  });
  lftpProcess.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  lftpProcess.on('close', (code) => {
    if (stderr.trim()) {
      console.log('[Explorer] lftp stderr output:', stderr.trim());
    }
    
    if (code !== 0) {
      return callback(new Error(stderr.trim() || `lftp exited with code ${code}`));
    }
    
    const lines = stdout.split(/[\r\n]+/);
    const files = [];
    const pattern = /^([-d-l][rwx-]{9})\s+.+?\s+(\d+)\s+(\d{4}-\d{2}-\d{2}|[A-Za-z]{3}\s+\d+|\d+\s+[A-Za-z]{3})\s+(\d{2}:\d{2}|\d{4})\s+(.+)$/;

    console.log(`[Explorer] Remote listing stdout lines count: ${lines.length}`);

    for (const line of lines) {
      const cleanLine = line.trim();
      if (!cleanLine) continue;

      let parsed = null;
      const match = cleanLine.match(pattern);
      if (match) {
        const isDirectory = match[1].startsWith('d');
        const size = parseInt(match[2], 10);
        const mtime = `${match[3]} ${match[4]}`;
        let name = match[5];
        
        parsed = { name, isDirectory, size, mtime };
      } else {
        const parts = cleanLine.split(/\s+/);
        if (parts.length >= 4) {
          const perms = parts[0];
          if (/^[-d-l][rwx-]{9}$/.test(perms)) {
            const isDirectory = perms.startsWith('d');
            const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
            let dateIndex = -1;
            
            for (let i = 1; i < parts.length - 1; i++) {
              const part = parts[i].toLowerCase();
              if (/^\d{4}-\d{2}-\d{2}$/.test(part) || months.includes(part)) {
                dateIndex = i;
                break;
              }
            }
            
            if (dateIndex !== -1 && dateIndex + 2 < parts.length) {
              const datePart = parts[dateIndex];
              const dayPart = parts[dateIndex + 1];
              const timePart = parts[dateIndex + 2];
              
              const tokenIndex = cleanLine.indexOf(timePart);
              if (tokenIndex !== -1) {
                let name = cleanLine.substring(tokenIndex + timePart.length).trim();
                
                let size = 0;
                for (let j = dateIndex - 1; j >= 1; j--) {
                  if (/^\d+$/.test(parts[j])) {
                    size = parseInt(parts[j], 10);
                    break;
                  }
                }
                
                parsed = {
                  name,
                  isDirectory,
                  size,
                  mtime: `${datePart} ${dayPart} ${timePart}`
                };
              }
            }
          }
        }
      }

      if (parsed) {
        if (parsed.name === '.' || parsed.name === '..') continue;
        
        if (parsed.name.startsWith('./')) {
          parsed.name = parsed.name.substring(2);
        }
        
        const normPath = remotePath.endsWith('/') ? remotePath : remotePath + '/';
        if (parsed.name.startsWith(normPath)) {
          parsed.name = parsed.name.substring(normPath.length);
        } else {
          const relNorm = remotePath.replace(/^\/+/, '').endsWith('/') 
            ? remotePath.replace(/^\/+/, '') 
            : remotePath.replace(/^\/+/, '') + '/';
          if (parsed.name.startsWith(relNorm)) {
            parsed.name = parsed.name.substring(relNorm.length);
          }
        }
        
        if (parsed.name === '.' || parsed.name === '..') continue;
        if (parsed.isDirectory && parsed.name.endsWith('/')) {
          parsed.name = parsed.name.slice(0, -1);
        }
        files.push(parsed);
      } else {
        if (cleanLine.length > 5 && !cleanLine.startsWith('total')) {
          console.log(`[Explorer] Skip unparseable line: "${cleanLine}"`);
        }
      }
    }

    if (lines.length > 0 && files.length === 0) {
      console.log('[Explorer] WARNING: Parse failed to extract any files. Raw listing output:', stdout);
    }
    
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    callback(null, files);
  });

  lftpProcess.stdin.write(cmd);
  lftpProcess.stdin.end();
}

function deleteRemoteFile(remotePath, callback) {
  const config = getConfig();
  const host = escapeLftpArg(config.host);
  const port = parseInt(config.port, 10) || 22;
  const login = escapeLftpArg(config.login);
  const hasKey = fs.existsSync('/config/id_rsa');
  const pass = config.pass ? escapeLftpArg(config.pass) : (hasKey ? 'dummy' : '');
  const escapedPath = escapeLftpArg(remotePath);

  const lftpProcess = spawn('lftp');
  let cmd = '';
  if (hasKey) {
    cmd += `set sftp:connect-program "ssh -a -x -o StrictHostKeyChecking=accept-new -i /config/id_rsa"\n`;
  }
  cmd += `open -p "${port}" -u "${login},${pass}" sftp://${host}\n`;
  cmd += `set sftp:auto-confirm yes\n`;
  cmd += `rm -r "${escapedPath}"\n`;
  cmd += `quit\n`;

  let stderr = '';
  lftpProcess.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  lftpProcess.on('close', (code) => {
    if (code !== 0) {
      return callback(new Error(stderr.trim() || `lftp exited with code ${code}`));
    }
    callback(null);
  });

  lftpProcess.stdin.write(cmd);
  lftpProcess.stdin.end();
}

function createRemoteDir(remotePath, callback) {
  const config = getConfig();
  const host = escapeLftpArg(config.host);
  const port = parseInt(config.port, 10) || 22;
  const login = escapeLftpArg(config.login);
  const hasKey = fs.existsSync('/config/id_rsa');
  const pass = config.pass ? escapeLftpArg(config.pass) : (hasKey ? 'dummy' : '');
  const escapedPath = escapeLftpArg(remotePath);

  const lftpProcess = spawn('lftp');
  let cmd = '';
  if (hasKey) {
    cmd += `set sftp:connect-program "ssh -a -x -o StrictHostKeyChecking=accept-new -i /config/id_rsa"\n`;
  }
  cmd += `open -p "${port}" -u "${login},${pass}" sftp://${host}\n`;
  cmd += `set sftp:auto-confirm yes\n`;
  cmd += `mkdir -f "${escapedPath}"\n`;
  cmd += `quit\n`;

  let stderr = '';
  lftpProcess.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  lftpProcess.on('close', (code) => {
    if (code !== 0) {
      return callback(new Error(stderr.trim() || `lftp exited with code ${code}`));
    }
    callback(null);
  });

  lftpProcess.stdin.write(cmd);
  lftpProcess.stdin.end();
}

function cleanupRemotePullDir(config, host, port, login, pass, hasKey, escapedRemotePush) {
  console.log('[Pull] Starting remote directory cleanup and file reversion...');
  
  const lftpProcess = spawn('lftp');
  let cmd = '';
  if (hasKey) {
    cmd += `set sftp:connect-program "ssh -a -x -o StrictHostKeyChecking=accept-new -i /config/id_rsa"\n`;
  }
  cmd += `open -p "${port}" -u "${login},${pass}" sftp://${host}\n`;
  cmd += `set sftp:auto-confirm yes\n`;
  cmd += `set cache:enable no\n`;
  // Move files from temp _lftp directory back to remotePushDir
  cmd += `glob -f mv "${escapedRemotePush}_lftp/*" "${escapedRemotePush}/"\n`;
  // Clean up the temp directory (only deletes if empty)
  cmd += `rmdir "${escapedRemotePush}_lftp"\n`;
  cmd += `quit\n`;

  let stderr = '';
  lftpProcess.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  lftpProcess.on('close', (code) => {
    if (code !== 0) {
      console.error('[Pull] Remote directory cleanup failed (exit code:', code, '):', stderr.trim());
    } else {
      console.log('[Pull] Remote directory cleanup and file reversion completed successfully.');
    }
  });

  lftpProcess.stdin.write(cmd);
  lftpProcess.stdin.end();
}

// File Explorer Endpoints
app.get('/api/explorer/local', (req, res) => {
  const config = getConfig();
  const dirType = req.query.type; // 'push' or 'pull'
  const relPath = req.query.path || '/';
  
  let baseDir = '';
  if (dirType === 'push') {
    baseDir = config.localPushDir || '/local-push';
  } else if (dirType === 'pull') {
    baseDir = config.localPullDir || '/local-pull';
  } else {
    return res.status(400).json({ error: 'Invalid directory type parameter' });
  }

  // Security: prevent directory traversal
  const resolvedPath = path.resolve(baseDir, relPath.replace(/^\/+/, ''));
  if (!resolvedPath.startsWith(baseDir)) {
    return res.status(403).json({ error: 'Access denied: Directory traversal detected' });
  }

  if (!fs.existsSync(resolvedPath)) {
    try {
      fs.mkdirSync(resolvedPath, { recursive: true });
    } catch (e) {
      console.error('Failed to create missing local directory:', e);
      return res.status(500).json({ error: 'Failed to create local directory: ' + e.message });
    }
  }

  fs.readdir(resolvedPath, { withFileTypes: true }, (err, dirents) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read local directory: ' + err.message });
    }

    const files = [];
    let completed = 0;
    if (dirents.length === 0) {
      return res.json([]);
    }

    dirents.forEach(dirent => {
      const fullFilePath = path.join(resolvedPath, dirent.name);
      fs.stat(fullFilePath, (statErr, stats) => {
        completed++;
        if (!statErr) {
          files.push({
            name: dirent.name,
            isDirectory: dirent.isDirectory(),
            size: stats.size,
            mtime: stats.mtime.toISOString().replace('T', ' ').substring(0, 16)
          });
        }

        if (completed === dirents.length) {
          files.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
          });
          res.json(files);
        }
      });
    });
  });
});

app.get('/api/explorer/remote', (req, res) => {
  const relPath = req.query.path || '/';
  getRemoteListing(relPath, (err, files) => {
    if (err) {
      console.error('Remote listing error:', err);
      return res.status(500).json({ error: 'Failed to read remote directory: ' + err.message });
    }
    res.json(files);
  });
});

app.post('/api/explorer/local/delete', (req, res) => {
  const config = getConfig();
  const { type: dirType, path: relPath } = req.body;
  if (!dirType || !relPath) {
    return res.status(400).json({ error: 'Directory type and path are required' });
  }

  let baseDir = '';
  if (dirType === 'push') {
    baseDir = config.localPushDir || '/local-push';
  } else if (dirType === 'pull') {
    baseDir = config.localPullDir || '/local-pull';
  } else {
    return res.status(400).json({ error: 'Invalid directory type parameter' });
  }

  const resolvedPath = path.resolve(baseDir, relPath.replace(/^\/+/, ''));
  if (!resolvedPath.startsWith(baseDir)) {
    return res.status(403).json({ error: 'Access denied: Directory traversal detected' });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'File or directory does not exist' });
  }

  fs.rm(resolvedPath, { recursive: true, force: true }, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to delete file: ' + err.message });
    }
    res.json({ success: true });
  });
});

app.post('/api/explorer/remote/delete', (req, res) => {
  const { path: remotePath } = req.body;
  if (!remotePath) {
    return res.status(400).json({ error: 'Remote path is required' });
  }

  deleteRemoteFile(remotePath, (err) => {
    if (err) {
      console.error('Remote deletion error:', err);
      return res.status(500).json({ error: 'Failed to delete remote file: ' + err.message });
    }
    res.json({ success: true });
  });
});

app.post('/api/explorer/remote/create', (req, res) => {
  const { path: remotePath } = req.body;
  if (!remotePath) {
    return res.status(400).json({ error: 'Remote path is required' });
  }

  createRemoteDir(remotePath, (err) => {
    if (err) {
      console.error('Remote directory creation error:', err);
      return res.status(500).json({ error: 'Failed to create remote directory: ' + err.message });
    }
    res.json({ success: true });
  });
});

// Express API Routes
app.get('/api/status', (req, res) => {
  const history = getHistory();
  res.json({
    push: {
      isSyncing: pushState.isSyncing,
      startTime: pushState.startTime,
      lastCompleted: pushState.lastCompleted
    },
    pull: {
      isSyncing: pullState.isSyncing,
      startTime: pullState.startTime,
      lastCompleted: pullState.lastCompleted
    },
    history,
    pushAverageSpeed30Days: getAverageSpeed30Days('push'),
    pullAverageSpeed30Days: getAverageSpeed30Days('pull'),
    config: getConfig()
  });
});

app.get('/api/ssh/status', (req, res) => {
  const privateKeyPath = '/config/id_rsa';
  const publicKeyPath = '/config/id_rsa.pub';
  const exists = fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath);
  let publicKey = '';
  if (exists) {
    try {
      publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
    } catch (e) {
      console.error('Error reading SSH public key:', e);
    }
  }
  res.json({ exists, publicKey });
});

app.post('/api/ssh/generate', (req, res) => {
  const privateKeyPath = '/config/id_rsa';
  const publicKeyPath = '/config/id_rsa.pub';

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    return res.json({ success: true, message: 'SSH key-pair already exists.' });
  }

  exec(`ssh-keygen -t rsa -b 4096 -f "${privateKeyPath}" -N ""`, (err, stdout, stderr) => {
    if (err) {
      console.error('Error generating SSH key-pair:', err, stderr);
      return res.status(500).json({ error: `Failed to generate SSH keys: ${err.message || stderr}` });
    }

    try {
      fs.chmodSync(privateKeyPath, 0o600);
      fs.chmodSync(publicKeyPath, 0o644);
    } catch (e) {
      console.error('Error setting SSH key permissions:', e);
    }

    let publicKey = '';
    try {
      publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
    } catch (e) {
      console.error('Error reading generated public key:', e);
    }

    res.json({ success: true, message: 'SSH key-pair generated successfully.', publicKey });
  });
});

app.post('/api/ssh/authorize', (req, res) => {
  const { host, port, login, pass } = req.body;
  if (!host || !login || !pass) {
    return res.status(400).json({ error: 'Host, login, and password are required to authorize the SSH key.' });
  }

  const privateKeyPath = '/config/id_rsa';
  const publicKeyPath = '/config/id_rsa.pub';

  if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
    return res.status(400).json({ error: 'SSH key-pair does not exist. Please generate keys first.' });
  }

  let pubKeyContent;
  try {
    pubKeyContent = fs.readFileSync(publicKeyPath, 'utf8').trim();
  } catch (err) {
    return res.status(500).json({ error: `Failed to read public key: ${err.message}` });
  }

  const hostVal = escapeLftpArg(host);
  const portVal = parseInt(port, 10) || 22;
  const loginVal = escapeLftpArg(login);
  const passVal = escapeLftpArg(pass);

  const tempAuthKeysPath = '/config/authorized_keys.temp';
  
  if (fs.existsSync(tempAuthKeysPath)) {
    try {
      fs.unlinkSync(tempAuthKeysPath);
    } catch (e) {}
  }

  const authProcess = spawn('lftp');
  let resolved = false;

  const timeoutId = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      authProcess.kill('SIGKILL');
      res.json({ success: false, error: 'Connection timed out during SSH key authorization (15s).' });
    }
  }, 15000);

  let cmd = `open -p "${portVal}" -u "${loginVal},${passVal}" sftp://${hostVal}
set sftp:auto-confirm yes
mkdir -f .ssh
chmod 700 .ssh
get .ssh/authorized_keys -o "${tempAuthKeysPath}"
quit
`;

  authProcess.stdin.write(cmd);
  authProcess.stdin.end();

  let stderrOutput = '';
  authProcess.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  authProcess.on('close', (code) => {
    clearTimeout(timeoutId);
    if (resolved) return;
    resolved = true;

    let existingContent = '';
    if (fs.existsSync(tempAuthKeysPath)) {
      try {
        existingContent = fs.readFileSync(tempAuthKeysPath, 'utf8');
      } catch (err) {
        console.error('Error reading downloaded authorized_keys:', err);
      }
    }

    if (!existingContent.includes(pubKeyContent)) {
      existingContent = existingContent.trim() + '\n' + pubKeyContent + '\n';
    }

    try {
      fs.writeFileSync(tempAuthKeysPath, existingContent);
    } catch (err) {
      return res.status(500).json({ error: `Failed to write temporary authorized_keys: ${err.message}` });
    }

    const uploadProcess = spawn('lftp');
    let uploadResolved = false;

    const uploadTimeoutId = setTimeout(() => {
      if (!uploadResolved) {
        uploadResolved = true;
        uploadProcess.kill('SIGKILL');
        res.json({ success: false, error: 'Upload timeout during SSH key authorization.' });
      }
    }, 15000);

    let uploadCmd = `open -p "${portVal}" -u "${loginVal},${passVal}" sftp://${hostVal}
set sftp:auto-confirm yes
put "${tempAuthKeysPath}" -o .ssh/authorized_keys
chmod 600 .ssh/authorized_keys
quit
`;

    uploadProcess.stdin.write(uploadCmd);
    uploadProcess.stdin.end();

    let uploadStderr = '';
    uploadProcess.stderr.on('data', (data) => {
      uploadStderr += data.toString();
    });

    uploadProcess.on('close', (uploadCode) => {
      clearTimeout(uploadTimeoutId);
      if (uploadResolved) return;
      uploadResolved = true;

      try {
        if (fs.existsSync(tempAuthKeysPath)) {
          fs.unlinkSync(tempAuthKeysPath);
        }
      } catch (e) {
        console.error('Error deleting temp authorized_keys file:', e);
      }

      if (uploadCode === 0) {
        const currentConfig = getConfig();
        currentConfig.pass = '';
        saveConfig(currentConfig);
        res.json({ success: true, message: 'SSH public key has been successfully installed and authorized on the remote server! Connection password has been cleared.' });
      } else {
        res.json({ success: false, error: uploadStderr.trim() || `Upload failed with exit code ${uploadCode}` });
      }
    });
  });
});

app.get('/api/config', (req, res) => {
  res.json(getConfig());
});

app.post('/api/config', (req, res) => {
  const newConfig = { ...getConfig(), ...req.body };
  
  if (!newConfig.host || !newConfig.login) {
    return res.status(400).json({ error: 'Host and login credentials are required' });
  }

  const cleanHost = String(newConfig.host).trim();
  const cleanLogin = String(newConfig.login).trim();
  if (/[\r\n]/.test(cleanHost) || /[\r\n]/.test(cleanLogin)) {
    return res.status(400).json({ error: 'Host and Login cannot contain newlines.' });
  }

  const portVal = parseInt(newConfig.port, 10);
  if (isNaN(portVal) || portVal < 1 || portVal > 65535) {
    return res.status(400).json({ error: 'Port must be a valid integer between 1 and 65535.' });
  }

  if (newConfig.pushCronEnabled && newConfig.pushCronSchedule) {
    if (!cron.validate(newConfig.pushCronSchedule)) {
      return res.status(400).json({ error: 'Invalid Push Cron Schedule.' });
    }
  }
  if (newConfig.pullCronEnabled && newConfig.pullCronSchedule) {
    if (!cron.validate(newConfig.pullCronSchedule)) {
      return res.status(400).json({ error: 'Invalid Pull Cron Schedule.' });
    }
  }

  newConfig.host = cleanHost;
  newConfig.login = cleanLogin;
  newConfig.port = String(portVal);

  if (newConfig.pushEnabled) {
    const pushVal = validatePushConfig(newConfig);
    if (!pushVal.valid) {
      return res.status(400).json({ error: pushVal.error });
    }
  }

  if (newConfig.pullEnabled) {
    const pullVal = validatePullConfig(newConfig);
    if (!pullVal.valid) {
      return res.status(400).json({ error: pullVal.error });
    }
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

  const hostVal = escapeLftpArg(host);
  const portVal = parseInt(port, 10) || 22;
  const loginVal = escapeLftpArg(login);
  const hasKey = fs.existsSync('/config/id_rsa');
  const passVal = pass ? escapeLftpArg(pass) : (hasKey ? 'dummy' : '');

  const testProcess = spawn('lftp');
  let resolved = false;

  const timeoutId = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      testProcess.kill('SIGKILL');
      res.json({ success: false, error: 'Connection timed out (10s)' });
    }
  }, 10000);

  let cmd = '';
  if (hasKey) {
    cmd += `set sftp:connect-program "ssh -a -x -o StrictHostKeyChecking=accept-new -i /config/id_rsa"\n`;
  }
  cmd += `open -p "${portVal}" -u "${loginVal},${passVal}" sftp://${hostVal}\n`;
  cmd += `set sftp:auto-confirm yes\nls; quit\n`;

  testProcess.stdin.write(cmd);
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

app.post('/api/sync/start/:workflow', (req, res) => {
  const { workflow } = req.params;
  if (workflow === 'push') {
    if (pushState.isSyncing) {
      return res.status(400).json({ error: 'Push Sync is already running' });
    }
    setTimeout(runPushSync, 0);
    return res.json({ success: true, message: 'Push Sync started' });
  } else if (workflow === 'pull') {
    if (pullState.isSyncing) {
      return res.status(400).json({ error: 'Pull Sync is already running' });
    }
    setTimeout(runPullSync, 0);
    return res.json({ success: true, message: 'Pull Sync started' });
  } else {
    return res.status(400).json({ error: 'Invalid workflow parameter' });
  }
});

app.post('/api/sync/stop/:workflow', (req, res) => {
  const { workflow } = req.params;
  if (workflow === 'push') {
    if (!pushState.isSyncing || !pushState.activeProcess) {
      return res.status(400).json({ error: 'Push Sync is not running' });
    }
    pushState.activeProcess.kill('SIGTERM');
    const killMsg = `\n[System] Push Sync execution aborted by user.\n`;
    appendLog('push', killMsg);
    broadcast({ type: 'log', workflow: 'push', text: killMsg });
    return res.json({ success: true, message: 'Push termination signal sent' });
  } else if (workflow === 'pull') {
    if (!pullState.isSyncing || !pullState.activeProcess) {
      return res.status(400).json({ error: 'Pull Sync is not running' });
    }
    pullState.activeProcess.kill('SIGTERM');
    const killMsg = `\n[System] Pull Sync execution aborted by user.\n`;
    appendLog('pull', killMsg);
    broadcast({ type: 'log', workflow: 'pull', text: killMsg });
    return res.json({ success: true, message: 'Pull termination signal sent' });
  } else {
    return res.status(400).json({ error: 'Invalid workflow parameter' });
  }
});

app.get('/api/logs/:workflow', (req, res) => {
  const { workflow } = req.params;
  const logFile = workflow === 'push' ? PUSH_LOG_FILE : PULL_LOG_FILE;
  try {
    if (!fs.existsSync(logFile)) {
      return res.send('');
    }
    const data = fs.readFileSync(logFile, 'utf8');
    const lines = data.split('\n');
    const limit = parseInt(req.query.lines, 10) || 500;
    res.send(lines.slice(-limit).join('\n'));
  } catch (err) {
    res.status(500).send('Error reading logs');
  }
});

app.post('/api/logs/:workflow/clear', (req, res) => {
  const { workflow } = req.params;
  if (workflow !== 'push' && workflow !== 'pull') {
    return res.status(400).json({ error: 'Invalid workflow parameter' });
  }
  const logFile = workflow === 'push' ? PUSH_LOG_FILE : PULL_LOG_FILE;
  try {
    fs.writeFileSync(logFile, '');
    broadcast({ type: 'clear_logs', workflow });
    return res.json({ success: true, message: `Logs for ${workflow} cleared on server.` });
  } catch (err) {
    console.error('Error clearing logs:', err);
    return res.status(500).json({ error: 'Failed to clear logs on server.' });
  }
});

// WebSocket Server Handler
wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  
  // Send current status on connect
  const history = getHistory();
  ws.send(JSON.stringify({
    type: 'init',
    push: {
      isSyncing: pushState.isSyncing,
      startTime: pushState.startTime,
      lastCompleted: pushState.lastCompleted
    },
    pull: {
      isSyncing: pullState.isSyncing,
      startTime: pullState.startTime,
      lastCompleted: pullState.lastCompleted
    },
    pushTransfers: Object.values(pushTransfers),
    pullTransfers: Object.values(pullTransfers),
    history,
    pushAverageSpeed30Days: getAverageSpeed30Days('push'),
    pullAverageSpeed30Days: getAverageSpeed30Days('pull')
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
