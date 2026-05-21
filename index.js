#!/usr/bin/env node

import {
  cancel as clackCancel,
  confirm as clackConfirm,
  isCancel,
  log,
  note,
  outro,
  password as clackPassword,
  select as clackSelect,
  text as clackText
} from '@clack/prompts';
import chalk from 'chalk';
import boxen from 'boxen';
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import gradient from 'gradient-string';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { parseRuntimeOptions } from './lib/runtime-options.js';
import {
  validateDomain as validateDomainInput,
  validateUrl as validateUrlInput,
  validateCloudflareHostname as validateCloudflareHostnameInput,
  validateTunnelName as validateTunnelNameInput
} from './lib/cloudflare-validators.js';
import { canOfferRetry } from './lib/retry-policy.js';
import { setUiThemePreset, uiTheme, themePresets, resolveThemeName } from './lib/ui/theme.js';
import {
  renderPanel as uiRenderPanel,
  renderSummary as uiRenderSummary,
  renderSteps as uiRenderSteps,
  renderProjectCatalog as uiRenderProjectCatalog,
  renderWorkflowHeader as uiRenderWorkflowHeader,
  statusBadge
} from './lib/ui/renderer.js';
import { createTaskSpinner } from './lib/ui/spinner.js';

const brandGradient = gradient(['#ff7a18', '#ffb347', '#ffd166']);
let panelBorder = uiTheme.border.default;
let successBorder = uiTheme.border.success;
let errorBorder = uiTheme.border.error;
let infoBorder = uiTheme.border.info;
const EXIT_CODE_SUCCESS = 0;
const EXIT_CODE_RUNTIME_ERROR = 1;
const EXIT_CODE_VALIDATION_ERROR = 2;
const EXIT_CODE_DEPENDENCY_ERROR = 3;
const EXIT_CODE_ACTION_FAILED = 4;
const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
let outputMode = 'table';

function getSessionLogPath() {
  return path.join(os.tmpdir(), 'panzek', 'logs', `panzek-${sessionId}.log`);
}

const sessionLogPath = getSessionLogPath();

function ensureSessionLogReady() {
  ensureDirSync(path.dirname(sessionLogPath));
}

function appendSessionLog(message) {
  try {
    ensureSessionLogReady();
    fs.appendFileSync(sessionLogPath, `${new Date().toISOString()} ${maskSensitiveText(message)}\n`);
  } catch {
    // ignore log write failures to keep CLI workflow running
  }
}

function writeExecutionReport() {
  executionReport.finishedAt = new Date().toISOString();
  executionReport.durationMs = new Date(executionReport.finishedAt).getTime() - new Date(executionReport.startedAt).getTime();

  if (!runtimeOptions.reportJsonPath) {
    return;
  }

  try {
    ensureDirSync(path.dirname(runtimeOptions.reportJsonPath));
    fs.writeFileSync(runtimeOptions.reportJsonPath, `${JSON.stringify(getSanitizedExecutionReport(), null, 2)}\n`);
    appendSessionLog(`[report] wrote ${runtimeOptions.reportJsonPath}`);
  } catch (error) {
    appendSessionLog(`[report:error] ${error.message}`);
  }
}

function maskSensitiveText(value) {
  let text = String(value ?? '');
  const masks = [
    /(password\s*[:=]\s*)([^\s\n]+)/gi,
    /(db_password\s*[:=]\s*)([^\s\n]+)/gi,
    /(PANZEK_DB_PASSWORD\s*[:=]\s*)([^\s\n]+)/gi,
    /(Authorization:\s*Bearer\s+)([^\s\n]+)/gi
  ];

  for (const pattern of masks) {
    text = text.replace(pattern, (_, prefix) => `${prefix}***`);
  }

  return text;
}

function maskSecretValue(value) {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length <= 4) return '*'.repeat(raw.length);
  return `${'*'.repeat(raw.length - 4)}${raw.slice(-4)}`;
}

function getSanitizedExecutionReport() {
  const safe = { ...executionReport };
  safe.error = maskSensitiveText(safe.error || '');
  return safe;
}

function exitWith(code, reason = '') {
  if (reason) {
    appendSessionLog(`[exit] code=${code} reason=${reason}`);
  } else {
    appendSessionLog(`[exit] code=${code}`);
  }
  process.exit(code);
}

function renderHelp() {
  const body = [
    chalk.white('Panzek Deploy CLI'),
    '',
    chalk.gray('Pemakaian:'),
    '  panzek-deploy [opsi]',
    '',
    chalk.gray('Opsi:'),
    '  -h, --help                 Tampilkan bantuan',
    '  -a, --action <nama>        Jalankan satu workflow langsung',
    '                             Nilai: deploy-laravel | setup-nginx | setup-cloudflare | update-project | setup-server | fix-permissions | preflight',
    '  --mode <normal|dry-run>    Tentukan mode eksekusi tanpa prompt mode',
    '  --theme <amber|ocean|mono|auto> Preset warna tampilan CLI',
    '  --preview-theme            Tampilkan pratinjau semua preset tema lalu keluar',
    '  --output <table|json>      Format output ringkasan CLI',
    '  --no-color                 Matikan warna output terminal',
    '  --dry-run                  Jalankan semua workflow dalam mode pratinjau',
    '  --max-retries <angka>      Batas retry per langkah gagal (default: 3)',
    '  -y, --yes                  Auto-setuju semua prompt konfirmasi',
    '  --non-interactive          Pakai nilai dari config/env tanpa prompt interaktif',
    '  --config <path>            File config JSON (default: ./panzek.config.json)',
    '  --report-json <path>       Simpan ringkasan hasil eksekusi ke JSON',
    '  --no-banner                Sembunyikan banner',
    '',
    chalk.gray('Contoh:'),
    '  panzek-deploy --action update-project --dry-run --yes',
    '  panzek-deploy --action preflight --non-interactive',
    '  panzek-deploy --action deploy-laravel --non-interactive --config ./panzek.config.json --report-json ./report.json',
    '  panzek-deploy -a setup-nginx --yes'
  ].join('\n');

  renderPanel('Bantuan CLI', body, infoBorder);
}

function readJsonFileSafe(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    throw new Error(`Config JSON tidak valid di ${filePath}: ${error.message}`);
  }
}

function applyTheme(themeName) {
  const resolved = resolveThemeName(themeName);
  setUiThemePreset(resolved);
  panelBorder = uiTheme.border.default;
  successBorder = uiTheme.border.success;
  errorBorder = uiTheme.border.error;
  infoBorder = uiTheme.border.info;
  runtimeOptions.theme = resolved;
}

function applyColorPolicy() {
  const ciNoColor = Boolean(process.env.CI);
  const forceNoColor = runtimeOptions.noColor || ciNoColor || parseBoolValue(getEnvValue('PANZEK_NO_COLOR', ''), false);
  if (forceNoColor) {
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '0';
    chalk.level = 0;
    runtimeOptions.noColor = true;
  }
}

function previewThemes() {
  for (const [name] of Object.entries(themePresets)) {
    setUiThemePreset(name);
    panelBorder = uiTheme.border.default;
    successBorder = uiTheme.border.success;
    errorBorder = uiTheme.border.error;
    infoBorder = uiTheme.border.info;
    renderSummary(`Theme: ${name}`, [
      ['Border Default', uiTheme.border.default],
      ['Border Info', uiTheme.border.info],
      ['Text Accent', uiTheme.text.accent]
    ], infoBorder);
  }
}

function getEnvValue(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === null || String(value).trim() === '' ? fallback : String(value).trim();
}

function parseBoolValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function getWorkflowConfig(action) {
  const configWorkflow = runtimeConfig?.workflows?.[action] || {};
  return typeof configWorkflow === 'object' && configWorkflow ? configWorkflow : {};
}

function requiredNonInteractive(action, label, value) {
  if (String(value || '').trim() === '') {
    throw new Error(`[non-interactive] ${label} wajib diisi untuk workflow ${action}.`);
  }
  return String(value).trim();
}

const executionReport = {
  sessionId,
  startedAt: new Date().toISOString(),
  finishedAt: '',
  durationMs: 0,
  action: '',
  mode: '',
  success: false,
  logPath: sessionLogPath,
  error: ''
};

function formatModeLabel(dryRun) {
  return dryRun ? 'Pratinjau' : 'Jalankan langsung';
}

function formatYesNo(value) {
  return value ? 'Ya' : 'Tidak';
}

function formatDirtyLabel(isDirty) {
  return isDirty ? 'Ada perubahan lokal' : 'Bersih';
}

function formatBranchLabel(branch) {
  return branch || 'branch aktif saat ini';
}

function shortenPath(targetPath, maxLength = 54) {
  const input = String(targetPath || '');

  if (input.length <= maxLength) {
    return input;
  }

  return `...${input.slice(-(maxLength - 3))}`;
}

function renderBanner() {
  const user = os.userInfo().username;
  const host = os.hostname();
  const pkg = 'panzek-deploy-cli';
  const appVersion = '1.0.1';
  const modeLabel = runtimeOptions?.dryRun ? 'dry-run' : 'normal';
  const asciiLogo = `
██████╗ ██████╗  ██████╗
██╔══██╗██╔══██╗██╔════╝
██████╔╝██║  ██║██║
██╔═══╝ ██║  ██║██║
██║     ██████╔╝╚██████╗
╚═╝     ╚═════╝  ╚═════╝
`.trim().split('\n');
  const leftLines = [
    ...asciiLogo.map((line) => brandGradient(line)),
    '',
    chalk.hex('#f8fafc')('Panzek Deploy CLI'),
    chalk.hex('#86efac')(`${user}@${host}`),
    chalk.hex('#94a3b8')('Deploy workflow toolkit'),
    '',
    chalk.hex('#fbbf24')('deploy-laravel'),
    chalk.hex('#38bdf8')('setup-nginx'),
    chalk.hex('#22d3ee')('setup-cloudflare'),
    chalk.hex('#4ade80')('preflight-check')
  ];
  const infoLines = [
    `${chalk.hex('#94a3b8')('package')} : ${chalk.white(pkg)} ${chalk.hex('#86efac')(appVersion)}`,
    `${chalk.hex('#94a3b8')('node')}    : ${chalk.white(process.version)}`,
    `${chalk.hex('#94a3b8')('os')}      : ${chalk.white(`${os.platform()} ${os.release()}`)}`,
    `${chalk.hex('#94a3b8')('theme')}   : ${chalk.hex('#38bdf8')(runtimeOptions?.theme || 'amber')}`,
    `${chalk.hex('#94a3b8')('output')}  : ${chalk.hex('#fbbf24')(outputMode)}`,
    `${chalk.hex('#94a3b8')('mode')}    : ${chalk.hex('#22d3ee')(modeLabel)}`
  ];
  const swatches = [
    chalk.bgBlack('   '),
    chalk.bgRed('   '),
    chalk.bgGreen('   '),
    chalk.bgYellow('   '),
    chalk.bgBlue('   '),
    chalk.bgMagenta('   '),
    chalk.bgCyan('   '),
    chalk.bgWhite('   ')
  ].join('');
  infoLines.push('', swatches);
  const leftWidth = Math.max(...leftLines.map((line) => stripAnsi(line).length));
  const maxLines = Math.max(leftLines.length, infoLines.length);
  const joined = [];
  for (let i = 0; i < maxLines; i++) {
    const left = leftLines[i] || '';
    const right = infoLines[i] || '';
    const padding = ' '.repeat(Math.max(2, leftWidth - stripAnsi(left).length + 4));
    joined.push(`${left}${padding}${right}`);
  }
  const body = joined.join('\n');
  const title = chalk.hex('#ffd166')('Panzek Deploy CLI / Fetch Style');
  const rule = chalk.hex('#64748b')('─'.repeat(Math.min(78, Math.max(36, process.stdout.columns ? process.stdout.columns - 8 : 70))));
  console.log(`${title}\n${rule}\n${body}\n${rule}\n`);
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '');
}

function renderPanel(title, message, borderColor = panelBorder) {
  appendSessionLog(`[panel:${title}] ${stripAnsi(message)}`);
  if (outputMode === 'json') {
    console.log(JSON.stringify({ type: 'panel', title, message: stripAnsi(message), borderColor }));
    return;
  }
  uiRenderPanel(title, message, borderColor);
}

function renderSummary(title, rows, borderColor = panelBorder) {
  if (outputMode === 'json') {
    const entries = rows.map(([label, value]) => ({ label: stripAnsi(label), value: stripAnsi(value) }));
    console.log(JSON.stringify({ type: 'summary', title, borderColor, rows: entries }));
    return;
  }
  uiRenderSummary(title, rows, borderColor);
}

function renderSteps(title, steps) {
  if (outputMode === 'json') {
    console.log(JSON.stringify({ type: 'steps', title, steps }));
    return;
  }
  uiRenderSteps(title, steps);
}

function renderWorkflowHeader(title, metaRows = []) {
  if (outputMode === 'json') {
    const meta = metaRows.map(([label, value]) => ({ label: stripAnsi(label), value: stripAnsi(value) }));
    console.log(JSON.stringify({ type: 'workflow', title: stripAnsi(title), meta }));
    return;
  }
  uiRenderWorkflowHeader(title, metaRows);
}

function renderProjectCatalog(title, projects) {
  if (outputMode === 'json') {
    console.log(JSON.stringify({ type: 'catalog', title, projects }));
    return;
  }
  uiRenderProjectCatalog(title, projects, { formatBranchLabel, shortenPath });
}

function promptCancelled() {
  if (outputMode === 'json') {
    console.log(JSON.stringify({ type: 'cancel', message: 'Workflow dibatalkan.' }));
  } else {
    clackCancel('Workflow dibatalkan.');
  }
  exitWith(EXIT_CODE_SUCCESS, 'prompt cancelled');
}

function logEvent(level, message) {
  const text = String(message || '');
  if (outputMode === 'json') {
    console.log(JSON.stringify({ type: 'log', level, message: stripAnsi(text) }));
    return;
  }
  if (level === 'info') log.info(text);
  else if (level === 'warn') log.warn(text);
  else if (level === 'error') log.error(text);
  else if (level === 'success') log.success(text);
  else if (level === 'step') log.step(text);
  else console.log(text);
}

function renderNote(message, title = 'Catatan') {
  const text = String(message || '');
  if (outputMode === 'json') {
    console.log(JSON.stringify({ type: 'note', title: stripAnsi(title), message: stripAnsi(text) }));
    return;
  }
  note(text, title);
}

function renderOutro(message) {
  const text = String(message || '');
  if (outputMode === 'json') {
    console.log(JSON.stringify({ type: 'outro', message: stripAnsi(text) }));
    return;
  }
  outro(text);
}

function unwrapPrompt(value) {
  if (isCancel(value)) {
    promptCancelled();
  }

  return value;
}

async function askText({ message, initialValue, placeholder, validate }) {
  return unwrapPrompt(
    await clackText({
      message,
      initialValue,
      placeholder,
      validate
    })
  );
}

async function askPassword({ message, mask = '*', validate }) {
  return unwrapPrompt(
    await clackPassword({
      message,
      mask,
      validate
    })
  );
}

async function askSelect({ message, options, initialValue }) {
  return unwrapPrompt(
    await clackSelect({
      message,
      options,
      initialValue
    })
  );
}

async function askConfirm({ message, initialValue = true, active = 'Ya', inactive = 'Tidak' }) {
  if (runtimeOptions.assumeYes) {
    logEvent("info", chalk.yellow(`[auto-yes] ${message}`));
    return true;
  }

  return unwrapPrompt(
    await clackConfirm({
      message,
      initialValue,
      active,
      inactive
    })
  );
}

function validateRequired(label) {
  return (value) => (String(value || '').trim() !== '' ? undefined : `${label} wajib diisi`);
}

function validateDomain(value) {
  return validateDomainInput(value);
}

function validatePhpVersion(value) {
  const input = String(value || '').trim();

  if (!input) {
    return 'Versi PHP-FPM wajib diisi';
  }

  if (!/^\d+(?:\.\d+){0,2}$/.test(input)) {
    return 'Versi PHP-FPM harus berupa angka, misalnya 8.3';
  }

  return undefined;
}

function validateLaravelAppPath(value) {
  const input = String(value || '').trim();
  const resolved = path.resolve(input);
  const publicPath = path.join(resolved, 'public');

  if (!input) {
    return 'Path project wajib diisi';
  }

  if (!fs.existsSync(resolved)) {
    return 'Path project tidak ditemukan';
  }

  if (!fs.existsSync(publicPath)) {
    return 'Folder public Laravel tidak ditemukan di path tersebut';
  }

  return undefined;
}

function sanitizeFilename(value) {
  return String(value).replace(/[^a-zA-Z0-9.-]/g, '_');
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function replaceObject(target, source) {
  for (const key of Object.keys(target)) {
    delete target[key];
  }

  Object.assign(target, source);
  return target;
}

function analyzeCommandFailure(result, context = {}) {
  const text = [result.errorMessage, result.stderr, result.stdout]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  const causes = [];
  const actions = [];

  if (text.includes('access denied')) {
    causes.push('Kredensial, host autentikasi, atau metode login ditolak oleh service database.');
    actions.push('Periksa username, password, host, dan port admin database.');
    actions.push('Pastikan user admin punya izin CREATE DATABASE dan CREATE USER.');
  }

  if (text.includes('ssl is required') || text.includes('tls/ssl error')) {
    causes.push('Konfigurasi SSL client tidak cocok dengan kemampuan server database.');
    actions.push('Coba ganti mode login admin antara normal dan SSL off.');
    actions.push('Periksa apakah service MariaDB/MySQL lokal memang butuh atau justru menolak SSL.');
  }

  if (text.includes('permission denied') || text.includes('eacces')) {
    causes.push('Permission filesystem atau ownership folder belum sesuai.');
    actions.push('Periksa owner/group target path, terutama untuk folder di bawah /var atau /etc.');
  }

  if (text.includes('command not found')) {
    causes.push('Binary yang dipanggil belum terinstall atau tidak ada di PATH.');
    actions.push('Install dependency yang dibutuhkan lalu coba ulang langkah ini.');
  }

  if (text.includes('not a git repository')) {
    causes.push('Folder target ada, tetapi bukan repository git yang valid.');
    actions.push('Gunakan folder target lain atau hapus folder yang salah lalu retry.');
  }

  if (text.includes('connection refused')) {
    causes.push('Service tujuan belum berjalan atau host/port salah.');
    actions.push('Pastikan service database/web server aktif dan menerima koneksi di host/port tersebut.');
  }

  if (text.includes('could not resolve host') || text.includes('name or service not known')) {
    causes.push('Hostname atau domain tidak bisa di-resolve.');
    actions.push('Periksa nama host/domain dan koneksi jaringan server.');
  }

  if (text.includes('already exists')) {
    causes.push('Resource yang ingin dibuat sudah ada dan konflik dengan langkah sekarang.');
    actions.push('Periksa file, symlink, database, atau user yang sudah terbentuk sebelumnya.');
  }

  if (causes.length === 0) {
    causes.push('Command gagal dijalankan, tetapi penyebab spesifik belum terdeteksi otomatis.');
  }

  if (actions.length === 0) {
    actions.push('Baca potongan output terakhir lalu perbaiki konfigurasi sebelum retry.');
  }

  if (context.phase === 'database') {
    actions.push('Jika error ada di login admin DB, pakai opsi edit koneksi admin tanpa mengulang wizard penuh.');
  }

  return { causes, actions };
}

function getCommandOutputSnippet(result, maxLines = 12) {
  const raw = [result.errorMessage, result.stderr, result.stdout]
    .filter(Boolean)
    .join('\n')
    .replace(/\r/g, '\n');

  const lines = raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');

  return lines.slice(-maxLines).join('\n');
}

function renderCommandErrorCard(result, context) {
  const snippet = getCommandOutputSnippet(result);
  const analysis = analyzeCommandFailure(result, context);
  const lines = [
    chalk.red(context.message || 'Langkah ini belum berhasil dijalankan.'),
    '',
    `Tahap      : ${context.title}`,
    `Command    : ${result.command}`,
    `Folder     : ${result.cwd}`,
    `Exit Code  : ${result.code ?? '-'}`,
    context.phase ? `Fase       : ${context.phase}` : null
  ].filter(Boolean);

  lines.push(
    '',
    chalk.yellow('Kemungkinan penyebab:'),
    ...analysis.causes.map((item, index) => `${index + 1}. ${item}`),
    '',
    chalk.cyan('Yang bisa dicoba:'),
    ...analysis.actions.map((item, index) => `${index + 1}. ${item}`)
  );

  if (snippet) {
    lines.push('', chalk.yellow('Potongan output terakhir:'), snippet);
  }

  renderPanel(`Langkah Bermasalah: ${context.title}`, lines.join('\n'), errorBorder);
}

function executeCommand(command, cwd = process.cwd(), dryRun = false, options = {}) {
  appendSessionLog(`[command:start] cwd="${cwd}" dryRun=${dryRun} interactive=${Boolean(options.interactive)} cmd=${command}`);
  if (outputMode === 'json') {
    console.log(JSON.stringify({ type: 'command_start', command, cwd, dryRun, interactive: Boolean(options.interactive) }));
  }

  if (dryRun) {
    logEvent("info", `[dry-run] (${cwd}) ${command}`);
    appendSessionLog('[command:dry-run] skipped');
    return {
      ok: true,
      command,
      cwd,
      code: 0,
      stdout: '',
      stderr: '',
      errorMessage: '',
      dryRun: true
    };
  }

  const spinner = outputMode === 'json' ? null : createTaskSpinner(`Menjalankan: ${command}`);

  if (options.interactive) {
    try {
      execSync(command, {
        cwd,
        stdio: 'inherit',
        shell: true
      });
      if (spinner) spinner.stopSuccess(`Berhasil: ${command}`);
      appendSessionLog('[command:done] status=0');
      return {
        ok: true,
        command,
        cwd,
        code: 0,
        stdout: '',
        stderr: '',
        errorMessage: '',
        dryRun: false
      };
    } catch (error) {
      if (spinner) spinner.stopError(`Gagal: ${command}`);
      appendSessionLog(`[command:done] status=${error.status ?? 1} error=${error.message || ''}`);
      return {
        ok: false,
        command,
        cwd,
        code: error.status ?? 1,
        stdout: '',
        stderr: '',
        errorMessage: error.message || '',
        dryRun: false
      };
    }
  }

  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024
  });

  if (spinner) spinner.clear();

  if (result.stdout) {
    if (outputMode === 'json') {
      console.log(JSON.stringify({ type: 'command_stdout', command, cwd, output: result.stdout }));
    } else {
      process.stdout.write(result.stdout);
    }
    appendSessionLog(`[command:stdout]\n${result.stdout.replace(/\x1b\[[0-9;]*m/g, '')}`);
  }

  if (result.stderr) {
    if (outputMode === 'json') {
      console.log(JSON.stringify({ type: 'command_stderr', command, cwd, output: result.stderr }));
    } else {
      process.stderr.write(result.stderr);
    }
    appendSessionLog(`[command:stderr]\n${result.stderr.replace(/\x1b\[[0-9;]*m/g, '')}`);
  }

  const commandResult = {
    ok: result.status === 0 && !result.error,
    command,
    cwd,
    code: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    errorMessage: result.error?.message || '',
    dryRun: false
  };

  if (commandResult.ok) {
    if (spinner) spinner.stopSuccess(`Berhasil: ${command}`);
    appendSessionLog('[command:done] status=0');
  } else {
    if (spinner) spinner.stopError(`Gagal: ${command}`);
    appendSessionLog(`[command:done] status=${commandResult.code} error=${commandResult.errorMessage || ''}`);
  }
  if (outputMode === 'json') {
    console.log(JSON.stringify({
      type: 'command_done',
      command,
      cwd,
      ok: commandResult.ok,
      code: commandResult.code,
      errorMessage: commandResult.errorMessage || ''
    }));
  }

  return commandResult;
}

async function runCommandWithHandling({
  title,
  command,
  cwd = process.cwd(),
  dryRun = false,
  message,
  phase,
  extraActions = [],
  interactive = false
}) {
  let retryCount = 0;

  while (true) {
    const resolvedCommand = typeof command === 'function' ? command() : command;
    const result = executeCommand(resolvedCommand, cwd, dryRun, { interactive });

    if (result.ok) {
      return result;
    }

    if (!canOfferRetry({
      nonInteractive: runtimeOptions.nonInteractive,
      retryCount,
      maxRetries: runtimeOptions.maxRetries
    })) {
      return result;
    }

    renderCommandErrorCard(result, {
      title,
      message,
      phase
    });

    const action = await askSelect({
      message: 'Pilih tindakan untuk langkah ini',
      initialValue: 'retry',
      options: [
        { value: 'retry', label: 'Coba lagi', hint: `ulang langkah ini (${retryCount + 1}/${runtimeOptions.maxRetries})` },
        ...extraActions.map((action) => ({
          value: action.value,
          label: action.label,
          hint: action.hint
        })),
        { value: 'abort', label: 'Batalkan workflow ini', hint: 'progress sebelumnya tetap dibiarkan' },
        { value: 'exit', label: 'Keluar aplikasi' }
      ]
    });

    if (action === 'retry') {
      retryCount += 1;
      continue;
    }

    const extraAction = extraActions.find((item) => item.value === action);
    if (extraAction) {
      await extraAction.handler(result);
      continue;
    }

    if (action === 'exit') {
      renderOutro('Sampai jumpa.');
      exitWith(EXIT_CODE_ACTION_FAILED, 'user chose exit after failed step');
    }

    return result;
  }
}

function commandExists(command) {
  try {
    execSync(`command -v ${quoteShellArg(command)}`, { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

function detectLinuxPackageManager() {
  if (commandExists('apt-get')) return 'apt';
  if (commandExists('dnf')) return 'dnf';
  if (commandExists('yum')) return 'yum';
  if (commandExists('apk')) return 'apk';
  if (commandExists('pacman')) return 'pacman';
  return '';
}

function getServerDependencyCatalog() {
  return [
    {
      key: 'git',
      label: 'Git',
      command: 'git',
      packages: { apt: ['git'], dnf: ['git'], yum: ['git'], apk: ['git'], pacman: ['git'] }
    },
    {
      key: 'curl',
      label: 'cURL',
      command: 'curl',
      packages: { apt: ['curl'], dnf: ['curl'], yum: ['curl'], apk: ['curl'], pacman: ['curl'] }
    },
    {
      key: 'unzip',
      label: 'Unzip',
      command: 'unzip',
      packages: { apt: ['unzip'], dnf: ['unzip'], yum: ['unzip'], apk: ['unzip'], pacman: ['unzip'] }
    },
    {
      key: 'nginx',
      label: 'Nginx',
      command: 'nginx',
      packages: { apt: ['nginx'], dnf: ['nginx'], yum: ['nginx'], apk: ['nginx'], pacman: ['nginx'] }
    },
    {
      key: 'php',
      label: 'PHP CLI',
      command: 'php',
      packages: { apt: ['php'], dnf: ['php'], yum: ['php'], apk: ['php'], pacman: ['php'] }
    },
    {
      key: 'php-fpm',
      label: 'PHP-FPM',
      command: 'php-fpm8.3',
      packages: { apt: ['php8.3-fpm', 'php-fpm'], dnf: ['php-fpm'], yum: ['php-fpm'], apk: ['php-fpm'], pacman: ['php-fpm'] }
    },
    {
      key: 'php-mysql',
      label: 'PHP MySQL Extension',
      command: 'php',
      packages: { apt: ['php8.3-mysql', 'php-mysql'], dnf: ['php-mysqlnd'], yum: ['php-mysqlnd'], apk: ['php-mysqli'], pacman: ['php'] }
    },
    {
      key: 'composer',
      label: 'Composer',
      command: 'composer',
      packages: { apt: ['composer'], dnf: ['composer'], yum: ['composer'], apk: ['composer'], pacman: ['composer'] }
    },
    {
      key: 'node',
      label: 'Node.js',
      command: 'node',
      packages: { apt: ['nodejs'], dnf: ['nodejs'], yum: ['nodejs'], apk: ['nodejs'], pacman: ['nodejs'] }
    },
    {
      key: 'npm',
      label: 'npm',
      command: 'npm',
      packages: { apt: ['npm'], dnf: ['npm'], yum: ['npm'], apk: ['npm'], pacman: ['npm'] }
    },
    {
      key: 'mysql-client',
      label: 'MySQL/MariaDB Client',
      command: 'mysql',
      packages: {
        apt: ['default-mysql-client', 'mariadb-client'],
        dnf: ['mariadb'],
        yum: ['mariadb'],
        apk: ['mariadb-client'],
        pacman: ['mariadb-clients']
      }
    },
    {
      key: 'cloudflared',
      label: 'Cloudflared (Opsional)',
      command: 'cloudflared',
      packages: { apt: ['cloudflared'], dnf: ['cloudflared'], yum: ['cloudflared'], apk: ['cloudflared'], pacman: ['cloudflared'] },
      optional: true
    }
  ];
}

function checkServerDependencies() {
  const catalog = getServerDependencyCatalog();

  return catalog.map((item) => {
    let installed = commandExists(item.command);

    if (item.key === 'php-mysql' && commandExists('php')) {
      const modules = readCommandOutput('php -m');
      installed = /pdo_mysql|mysqli/i.test(modules);
    }

    if (item.key === 'php-fpm' && !installed && commandExists('php-fpm')) {
      installed = true;
    }

    return {
      ...item,
      installed
    };
  });
}

async function installSystemPackages(packageManager, packages, dryRun = false) {
  const unique = [...new Set(packages.filter(Boolean))];
  if (unique.length === 0) return true;

  let result;
  if (packageManager === 'apt') {
    result = await runCommandWithHandling({
      title: 'Update Apt Index',
      command: 'sudo apt-get update',
      cwd: process.cwd(),
      dryRun,
      phase: 'bootstrap',
      message: 'Gagal update apt index.'
    });
    if (!result.ok) return false;

    result = await runCommandWithHandling({
      title: 'Install Dependency Server',
      command: `sudo apt-get install -y ${unique.map(quoteShellArg).join(' ')}`,
      cwd: process.cwd(),
      dryRun,
      phase: 'bootstrap',
      message: 'Install dependency server gagal.'
    });
  } else if (packageManager === 'dnf') {
    result = await runCommandWithHandling({
      title: 'Install Dependency Server',
      command: `sudo dnf install -y ${unique.map(quoteShellArg).join(' ')}`,
      cwd: process.cwd(),
      dryRun,
      phase: 'bootstrap',
      message: 'Install dependency server gagal.'
    });
  } else if (packageManager === 'yum') {
    result = await runCommandWithHandling({
      title: 'Install Dependency Server',
      command: `sudo yum install -y ${unique.map(quoteShellArg).join(' ')}`,
      cwd: process.cwd(),
      dryRun,
      phase: 'bootstrap',
      message: 'Install dependency server gagal.'
    });
  } else if (packageManager === 'apk') {
    result = await runCommandWithHandling({
      title: 'Update Apk Index',
      command: 'sudo apk update',
      cwd: process.cwd(),
      dryRun,
      phase: 'bootstrap',
      message: 'Gagal update apk index.'
    });
    if (!result.ok) return false;
    result = await runCommandWithHandling({
      title: 'Install Dependency Server',
      command: `sudo apk add ${unique.map(quoteShellArg).join(' ')}`,
      cwd: process.cwd(),
      dryRun,
      phase: 'bootstrap',
      message: 'Install dependency server gagal.'
    });
  } else if (packageManager === 'pacman') {
    result = await runCommandWithHandling({
      title: 'Install Dependency Server',
      command: `sudo pacman -Sy --noconfirm ${unique.map(quoteShellArg).join(' ')}`,
      cwd: process.cwd(),
      dryRun,
      phase: 'bootstrap',
      message: 'Install dependency server gagal.'
    });
  } else {
    return false;
  }

  return result.ok;
}

async function setupServerDependencies() {
  const mode = await askRunMode();
  const dryRun = mode === 'dry-run';
  const packageManager = detectLinuxPackageManager();

  if (!packageManager) {
    renderPanel(
      'OS Belum Didukung Otomatis',
      'Installer otomatis belum mendeteksi package manager yang didukung (apt/dnf/yum/apk/pacman).',
      errorBorder
    );
    return false;
  }

  const checks = checkServerDependencies();
  const missing = checks.filter((item) => !item.installed && !item.optional);
  const missingOptional = checks.filter((item) => !item.installed && item.optional);

  renderSummary('Preflight Dependency Server', [
    ['Package Manager', packageManager],
    ['Terpasang', checks.filter((item) => item.installed).length],
    ['Wajib Belum Ada', missing.length],
    ['Opsional Belum Ada', missingOptional.length],
    ['Mode', formatModeLabel(dryRun)]
  ], infoBorder);

  renderSteps(
    'Dependency Wajib',
    checks
      .filter((item) => !item.optional)
      .map((item) => `${item.label}: ${item.installed ? 'sudah terinstall' : 'belum terinstall'}`)
  );

  const includeOptional = runtimeOptions.nonInteractive
    ? parseBoolValue(getEnvValue('PANZEK_SETUP_SERVER_INCLUDE_OPTIONAL', ''), false)
    : await askConfirm({
        message: 'Install juga dependency opsional (cloudflared) jika belum ada?',
        initialValue: false
      });

  const packages = [];
  for (const item of missing) packages.push(...(item.packages?.[packageManager] || []));
  if (includeOptional) {
    for (const item of missingOptional) packages.push(...(item.packages?.[packageManager] || []));
  }

  if (packages.length === 0) {
    renderPanel('Server Sudah Siap', 'Semua dependency utama sudah tersedia.', successBorder);
    return true;
  }

  renderSummary('Rencana Install Dependency', [
    ['Total Package Kandidat', [...new Set(packages)].length],
    ['Daftar', [...new Set(packages)].join(', ')]
  ], infoBorder);

  const confirmed = runtimeOptions.nonInteractive
    ? true
    : await askConfirm({
        message: 'Lanjut install dependency server?',
        initialValue: true
      });

  if (!confirmed) {
    logEvent("warn", 'Bootstrap server dibatalkan.');
    return false;
  }

  const ok = await installSystemPackages(packageManager, packages, dryRun);
  if (!ok) return false;

  if (dryRun) {
    renderPanel(
      'Pratinjau Bootstrap Server Selesai',
      'Semua command install berhasil dipetakan. Jalankan tanpa dry-run untuk eksekusi nyata.',
      successBorder
    );
    return true;
  }

  const postChecks = checkServerDependencies();
  const remaining = postChecks.filter((item) => !item.installed && !item.optional);

  renderSummary('Hasil Bootstrap Server', [
    ['Dependency Wajib Belum Ada', remaining.length],
    ['Cloudflared', commandExists('cloudflared') ? 'Tersedia' : 'Belum tersedia']
  ], remaining.length === 0 ? successBorder : errorBorder);

  return remaining.length === 0;
}

function checkSudoNonInteractiveAccess() {
  const result = spawnSync('sudo -n true', {
    shell: true,
    encoding: 'utf-8'
  });
  return result.status === 0;
}

async function runPreflight() {
  renderWorkflowHeader('Preflight Check', [['Mode', runtimeOptions.dryRun ? 'Pratinjau' : 'Normal']]);
  const packageManager = detectLinuxPackageManager();
  const checks = checkServerDependencies();
  const missingRequired = checks.filter((item) => !item.optional && !item.installed);
  const missingOptional = checks.filter((item) => item.optional && !item.installed);
  const sudoReady = checkSudoNonInteractiveAccess();
  const configExists = fs.existsSync(runtimeOptions.configPath);

  renderSummary('Preflight Ringkas', [
    ['Status', missingRequired.length === 0 ? statusBadge('success', 'READY') : statusBadge('warn', 'NEEDS ATTENTION')],
    ['Config Path', runtimeOptions.configPath],
    ['Config Ada', formatYesNo(configExists)],
    ['Package Manager', packageManager || 'Tidak terdeteksi'],
    ['Sudo Non-Interactive', sudoReady ? 'Siap' : 'Belum siap'],
    ['Dependency Wajib Hilang', String(missingRequired.length)],
    ['Dependency Opsional Hilang', String(missingOptional.length)]
  ], missingRequired.length === 0 ? successBorder : errorBorder);

  renderSteps(
    'Dependency Wajib',
    checks
      .filter((item) => !item.optional)
      .map((item) => `${item.label}: ${item.installed ? 'sudah terinstall' : 'belum terinstall'}`)
  );

  if (missingOptional.length > 0) {
    renderSteps('Dependency Opsional', missingOptional.map((item) => `${item.label}: belum terinstall`));
  }

  if (!sudoReady) {
    renderNote('Sebagian workflow butuh sudo. Jalankan dengan user yang punya akses sudo tanpa hambatan policy.', 'Catatan Sudo');
  }

  return missingRequired.length === 0;
}

function readCommandOutput(command, cwd = process.cwd()) {
  try {
    return execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: true
    }).trim();
  } catch {
    return '';
  }
}

function isDirectory(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function getProjectSearchRoots() {
  return [...new Set(['/var/www', process.cwd()].map((dir) => path.resolve(dir)))].filter(isDirectory);
}

function readPackageScripts(appPath) {
  const packageJsonPath = path.join(appPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return parsed?.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {};
  } catch {
    return {};
  }
}

function getProjectProfile(appPath) {
  const hasGit = fs.existsSync(path.join(appPath, '.git'));
  const hasComposer = fs.existsSync(path.join(appPath, 'composer.json'));
  const hasPackageJson = fs.existsSync(path.join(appPath, 'package.json'));
  const hasArtisan = fs.existsSync(path.join(appPath, 'artisan'));
  const hasLaravelDirs =
    fs.existsSync(path.join(appPath, 'storage')) && fs.existsSync(path.join(appPath, 'bootstrap', 'cache'));
  const packageScripts = readPackageScripts(appPath);

  const installSteps = [];
  const postSteps = [];

  if (hasComposer) {
    installSteps.push('composer install --no-dev --optimize-autoloader');
  }

  if (hasPackageJson) {
    installSteps.push('npm install');
  }

  if (hasPackageJson && packageScripts.build) {
    installSteps.push('npm run build');
  }

  if (hasArtisan) {
    postSteps.push(
      'php artisan storage:link',
      'php artisan migrate --force',
      'php artisan optimize:clear',
      'php artisan optimize'
    );
  }

  let category = 'Git Project';
  if (hasArtisan && hasComposer) {
    category = 'Laravel';
  } else if (hasPackageJson) {
    category = 'Node';
  } else if (hasComposer) {
    category = 'PHP';
  }

  return {
    hasGit,
    hasComposer,
    hasPackageJson,
    hasArtisan,
    hasLaravelDirs,
    packageScripts,
    installSteps,
    postSteps,
    category
  };
}

function getGitProjectInfo(appPath) {
  if (!fs.existsSync(path.join(appPath, '.git'))) {
    return null;
  }

  const profile = getProjectProfile(appPath);
  if (!profile.hasGit) {
    return null;
  }

  const branch = readCommandOutput('git branch --show-current', appPath) || readCommandOutput('git rev-parse --abbrev-ref HEAD', appPath);
  const repo = readCommandOutput('git config --get remote.origin.url', appPath);
  const dirty = readCommandOutput('git status --short --untracked-files=no', appPath) !== '';

  return {
    name: path.basename(appPath),
    path: appPath,
    branch: branch && branch !== 'HEAD' ? branch : '',
    repo,
    dirty,
    profile
  };
}

function findManagedProjects() {
  const projects = [];
  const seen = new Set();

  for (const root of getProjectSearchRoots()) {
    const candidates = [root];

    try {
      const childDirs = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name));
      candidates.push(...childDirs);
    } catch {
      // ignore unreadable roots
    }

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      const project = getGitProjectInfo(resolved);
      if (project) {
        projects.push(project);
      }
    }
  }

  return projects.sort((a, b) => a.path.localeCompare(b.path));
}

function buildProjectUpdatePlan(project) {
  const gitSteps = ['git fetch origin'];

  if (project.branch) {
    gitSteps.push(`git checkout ${project.branch}`, `git pull origin ${project.branch}`);
  } else {
    gitSteps.push('git pull');
  }

  return [...gitSteps, ...project.profile.installSteps, ...project.profile.postSteps];
}

function pathNeedsSudo(targetPath) {
  const resolved = path.resolve(targetPath);
  return (
    resolved.startsWith('/var/') ||
    resolved.startsWith('/etc/') ||
    resolved.startsWith('/usr/') ||
    resolved.startsWith('/opt/')
  );
}

async function ensureParentDir(targetDir, dryRun = false) {
  const parent = path.dirname(path.resolve(targetDir));

  if (fs.existsSync(parent)) {
    return true;
  }

  const command = pathNeedsSudo(parent)
    ? `sudo mkdir -p "${parent}"`
    : `mkdir -p "${parent}"`;

  const result = await runCommandWithHandling({
    title: 'Membuat Folder Parent',
    command,
    cwd: process.cwd(),
    dryRun,
    phase: 'filesystem',
    message: `Tidak bisa menyiapkan folder parent untuk ${targetDir}.`
  });

  return result.ok;
}

function groupExists(groupName) {
  try {
    execSync(`getent group ${groupName}`, { stdio: 'ignore', shell: true });
    return true;
  } catch {
    try {
      const groupFile = fs.readFileSync('/etc/group', 'utf-8');
      return groupFile.split('\n').some((line) => line.startsWith(`${groupName}:`));
    } catch {
      return false;
    }
  }
}

function getPrimaryGroupName(username) {
  try {
    return execSync(`id -gn ${username}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: true
    }).trim();
  } catch {
    return username;
  }
}

function resolveAppGroup(username = os.userInfo().username) {
  const preferredGroups = ['www-data', 'nginx', 'apache', 'http'];
  return preferredGroups.find(groupExists) || getPrimaryGroupName(username);
}

async function ensureAppOwnership(appPath, dryRun = false) {
  if (!pathNeedsSudo(appPath)) {
    return true;
  }

  const username = os.userInfo().username;
  const groupName = resolveAppGroup(username);
  const result = await runCommandWithHandling({
    title: 'Mengatur Ownership Folder',
    command: `sudo chown -R ${quoteShellArg(`${username}:${groupName}`)} ${quoteShellArg(appPath)}`,
    cwd: process.cwd(),
    dryRun,
    phase: 'filesystem',
    message: 'Ownership folder aplikasi gagal diubah.'
  });

  return result.ok;
}

async function ensureGitRepo(repo, branch, targetDir, dryRun = false) {
  const resolvedTarget = path.resolve(targetDir);
  const exists = fs.existsSync(resolvedTarget);

  if (dryRun) {
    renderSummary('Pratinjau Repository', [
      ['Repo', repo],
      ['Branch', branch],
      ['Target', resolvedTarget],
      ['Aksi', exists ? 'fetch + checkout + pull' : 'clone']
    ], infoBorder);
    return { ok: true, cwd: resolvedTarget };
  }

  if (!exists) {
    const parentReady = await ensureParentDir(resolvedTarget, false);
    if (!parentReady) {
      return { ok: false, cwd: resolvedTarget };
    }

    const cloneCommand = pathNeedsSudo(resolvedTarget)
      ? `sudo git clone -b ${quoteShellArg(branch)} ${quoteShellArg(repo)} ${quoteShellArg(resolvedTarget)}`
      : `git clone -b ${quoteShellArg(branch)} ${quoteShellArg(repo)} ${quoteShellArg(resolvedTarget)}`;

    const cloneResult = await runCommandWithHandling({
      title: 'Clone Repository',
      command: cloneCommand,
      cwd: process.cwd(),
      dryRun: false,
      phase: 'repository',
      message: 'Repository gagal di-clone ke target folder.'
    });

    if (!cloneResult.ok) {
      return { ok: false, cwd: resolvedTarget };
    }

    const ownershipOk = await ensureAppOwnership(resolvedTarget, false);
    return { ok: ownershipOk, cwd: resolvedTarget };
  }

  if (!fs.existsSync(path.join(resolvedTarget, '.git'))) {
    logEvent("error", `Folder target ada tapi bukan repository git: ${resolvedTarget}`);
    return { ok: false, cwd: resolvedTarget };
  }

  const ownershipOk = await ensureAppOwnership(resolvedTarget, false);
  if (!ownershipOk) return { ok: false, cwd: resolvedTarget };

  let result = await runCommandWithHandling({
    title: 'Fetch Repository',
    command: 'git fetch origin',
    cwd: resolvedTarget,
    dryRun: false,
    phase: 'repository',
    message: 'Gagal mengambil update terbaru dari origin.'
  });
  if (!result.ok) return { ok: false, cwd: resolvedTarget };

  result = await runCommandWithHandling({
    title: 'Checkout Branch',
    command: `git checkout ${quoteShellArg(branch)}`,
    cwd: resolvedTarget,
    dryRun: false,
    phase: 'repository',
    message: `Gagal checkout ke branch ${branch}.`
  });
  if (!result.ok) return { ok: false, cwd: resolvedTarget };

  result = await runCommandWithHandling({
    title: 'Pull Repository',
    command: `git pull origin ${quoteShellArg(branch)}`,
    cwd: resolvedTarget,
    dryRun: false,
    phase: 'repository',
    message: `Gagal pull branch ${branch} dari origin.`
  });
  if (!result.ok) return { ok: false, cwd: resolvedTarget };

  return { ok: true, cwd: resolvedTarget };
}

function prepareLaravelEnv(appPath, dryRun = false) {
  const envPath = path.join(appPath, '.env');
  const exampleEnvPath = path.join(appPath, '.env.example');

  if (dryRun) {
    logEvent("info", chalk.yellow(`[dry-run] cek/generate .env di ${envPath}`));
    return true;
  }

  try {
    if (!fs.existsSync(envPath) && fs.existsSync(exampleEnvPath)) {
      fs.copyFileSync(exampleEnvPath, envPath);
      logEvent("success", '.env dibuat dari .env.example');
    }
  } catch (error) {
    renderPanel(
      'Peringatan: Persiapan .env Gagal',
      `${chalk.red('File .env belum bisa dibuat dari .env.example.')}\n\n${error.message}\n${chalk.gray(envPath)}`,
      errorBorder
    );
    return false;
  }

  return fs.existsSync(envPath);
}

function setEnvValue(envPath, key, value, dryRun = false) {
  if (dryRun) {
    logEvent("info", chalk.yellow(`[dry-run] set ${key}="${value}" di ${envPath}`));
    return true;
  }

  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  }

  const escapedValue = String(value).replace(/\n/g, '');
  const regex = new RegExp(`^${key}=.*$`, 'm');

  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${escapedValue}`);
  } else {
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += `${key}=${escapedValue}\n`;
  }

  try {
    fs.writeFileSync(envPath, content);
    return true;
  } catch (error) {
    renderPanel(
      'Peringatan: Update Env Gagal',
      `${chalk.red(`Nilai ${key} belum bisa ditulis ke file .env.`)}\n\n${error.message}\n${chalk.gray(envPath)}`,
      errorBorder
    );
    return false;
  }
}

async function applyLaravelPermissions(appPath, dryRun = false) {
  const storagePath = path.join(appPath, 'storage');
  const cachePath = path.join(appPath, 'bootstrap/cache');
  const artisanPath = path.join(appPath, 'artisan');
  const envPath = path.join(appPath, '.env');
  const username = os.userInfo().username;
  const groupName = resolveAppGroup(username);

  // Cross-check standard storage subdirectories (ensure they exist)
  if (fs.existsSync(storagePath)) {
    const storageSubdirs = [
      'app/public',
      'framework/cache/data',
      'framework/sessions',
      'framework/testing',
      'framework/views',
      'logs'
    ];
    for (const subdir of storageSubdirs) {
      const fullPath = path.join(storagePath, subdir);
      if (!fs.existsSync(fullPath)) {
        if (!dryRun) {
          try {
            fs.mkdirSync(fullPath, { recursive: true });
          } catch (e) {
            // ignore errors here, chown/chmod will report if something is really wrong
          }
        } else {
          logEvent("info", chalk.yellow(`[dry-run] buat folder ${fullPath}`));
        }
      }
    }
  }

  // Ensure bootstrap/cache exists if bootstrap exists
  if (fs.existsSync(path.join(appPath, 'bootstrap')) && !fs.existsSync(cachePath)) {
    if (!dryRun) {
      try {
        fs.mkdirSync(cachePath, { recursive: true });
      } catch (e) {}
    }
  }

  const permissionPlan = [
    {
      title: 'Mengatur ownership ke ' + username + ':' + groupName,
      command: `sudo chown -R ${username}:${groupName} "${appPath}"`
    },
    {
      title: 'Mengatur permission folder (755)',
      command: `sudo find "${appPath}" -type d -exec chmod 755 {} +`
    },
    {
      title: 'Mengatur permission file (644)',
      command: `sudo find "${appPath}" -type f -exec chmod 644 {} +`
    }
  ];

  if (fs.existsSync(artisanPath)) {
    permissionPlan.push({
      title: 'Mengatur executable pada file artisan',
      command: `sudo chmod +x "${artisanPath}"`
    });
  }

  const writablePaths = [];
  if (fs.existsSync(storagePath)) writablePaths.push(storagePath);
  if (fs.existsSync(cachePath)) writablePaths.push(cachePath);

  if (writablePaths.length > 0) {
    const pathsStr = writablePaths.map(p => `"${p}"`).join(' ');
    permissionPlan.push({
      title: 'Mengatur write permission pada storage & cache (775)',
      command: `sudo chmod -R 775 ${pathsStr}`
    });
    permissionPlan.push({
      title: 'Mengatur sticky group agar folder baru otomatis punya group yang sama',
      command: `sudo find ${pathsStr} -type d -exec chmod g+s {} +`
    });
  }

  if (fs.existsSync(envPath)) {
    permissionPlan.push({
      title: 'Mengamankan file .env (640)',
      command: `sudo chmod 640 "${envPath}"`
    });
  }

  for (const step of permissionPlan) {
    const result = await runCommandWithHandling({
      title: 'Permission Laravel: ' + step.title,
      command: step.command,
      cwd: appPath,
      dryRun,
      phase: 'permission',
      message: `${step.title} gagal diterapkan.`
    });
    if (!result.ok) return false;
  }

  return true;
}

async function runLaravelHealthCheck(appPath, dryRun = false) {
  const workflowConfig = getWorkflowConfig('deploy-laravel');
  const targetUrl = getEnvValue('PANZEK_HEALTH_URL', workflowConfig.healthUrl || '');
  const checks = [
    { title: 'Cek PHP CLI', command: 'php -v', phase: 'health' },
    { title: 'Cek Artisan', command: 'php artisan --version', phase: 'health' },
    { title: 'Cek Nginx Config', command: 'sudo nginx -t', phase: 'health' }
  ];

  if (targetUrl) {
    checks.push({
      title: 'Cek HTTP Endpoint',
      command: `curl -I -sS --max-time 12 ${quoteShellArg(targetUrl)}`,
      phase: 'health'
    });
  }

  for (const step of checks) {
    const result = await runCommandWithHandling({
      title: step.title,
      command: step.command,
      cwd: appPath,
      dryRun,
      phase: step.phase,
      message: `${step.title} gagal.`
    });
    if (!result.ok) return false;
  }

  renderPanel('Health Check Selesai', 'Pemeriksaan utama deploy berhasil dijalankan.', successBorder);
  return true;
}

async function fixPermissionsWorkflow() {
  const mode = await askRunMode();
  const dryRun = mode === 'dry-run';
  renderWorkflowHeader('Fix Permissions', [['Mode', formatModeLabel(dryRun)]]);
  const workflowConfig = getWorkflowConfig('fix-permissions');
  const appPathInput = runtimeOptions.nonInteractive
    ? requiredNonInteractive(
        'fix-permissions',
        'appPath',
        getEnvValue('PANZEK_FIX_PERMISSIONS_PATH', workflowConfig.appPath || '')
      )
    : await askText({
        message: 'Path project Laravel untuk normalisasi permission',
        initialValue: '/var/www/laravel-app',
        validate: validateLaravelAppPath
      });
  const appPath = path.resolve(appPathInput);

  renderSummary('Fix Permissions', [
    ['Status', statusBadge('info', 'IN PROGRESS')],
    ['Path App', appPath],
    ['Mode', formatModeLabel(dryRun)]
  ], infoBorder);

  const confirmed = runtimeOptions.nonInteractive
    ? true
    : await askConfirm({
        message: 'Lanjut normalisasi permission Laravel?',
        initialValue: true
      });
  if (!confirmed) return false;

  return applyLaravelPermissions(appPath, dryRun);
}

function getLaravelDefaultSteps() {
  return [
    'composer install --no-dev --optimize-autoloader',
    'npm install',
    'npm run build'
  ];
}

function generateRandomPassword(length = 20) {
  return crypto.randomBytes(length).toString('base64').slice(0, length);
}

function sanitizeDbName(name) {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

function getMysqlClientCommand() {
  if (commandExists('mariadb')) {
    return 'mariadb';
  }

  if (commandExists('mysql')) {
    return 'mysql';
  }

  return null;
}

function getCloudflaredCertPath() {
  return path.join(os.homedir(), '.cloudflared', 'cert.pem');
}

function getDefaultCloudflaredConfigPath(tunnelName) {
  return path.join(os.homedir(), '.cloudflared', 'panzek', `${sanitizeFilename(tunnelName)}.yml`);
}

function validateTunnelName(value) {
  return validateTunnelNameInput(value);
}

function validateUrl(value, label = 'URL') {
  return validateUrlInput(value, label);
}

function validateCloudflareHostname(value) {
  return validateCloudflareHostnameInput(value);
}

function parseTunnelCreateResult(result) {
  const combined = [result.stdout, result.stderr, result.errorMessage].filter(Boolean).join('\n');
  const idMatch = combined.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  const credentialsMatch = combined.match(/([/~.\w-]+\/[0-9a-f-]+\.json)/i);

  return {
    tunnelId: idMatch?.[1] || null,
    credentialsFile: credentialsMatch?.[1] || null
  };
}

function createCloudflaredConfig({ tunnelId, credentialsFile, hostname, serviceUrl }) {
  return [
    `tunnel: ${tunnelId}`,
    `credentials-file: ${credentialsFile}`,
    '',
    'ingress:',
    `  - hostname: ${hostname}`,
    `    service: ${serviceUrl}`,
    '  - service: http_status:404',
    ''
  ].join('\n');
}

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function expandHomePath(filePath) {
  if (!filePath) {
    return filePath;
  }

  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function getDatabaseUserHosts(dbHost) {
  const hosts = new Set(['localhost', '%']);
  const normalizedHost = String(dbHost || '').trim();

  if (normalizedHost && normalizedHost !== 'localhost') {
    hosts.add(normalizedHost);
  }

  return [...hosts];
}

async function askAdminAccessConfig(initialConfig = {}) {
  const adminMode = await askSelect({
    message: 'Metode akses admin MySQL',
    initialValue: initialConfig.mode || 'socket',
    options: [
      { value: 'socket', label: 'Pakai sudo socket login', hint: 'tanpa password admin CLI' },
      { value: 'login', label: 'Login pakai user/password admin' },
      { value: 'login-ssl-off', label: 'Login pakai user/password admin (SSL off)' }
    ]
  });

  let adminConfig = { mode: adminMode };

  if (adminMode === 'login' || adminMode === 'login-ssl-off') {
    adminConfig = {
      user: await askText({
        message: 'Username admin MySQL',
        initialValue: initialConfig.user || 'root',
        validate: validateRequired('Username admin')
      }),
      password: await askPassword({
        message: 'Password admin MySQL',
        validate: (value) => (value !== '' ? undefined : 'Password admin wajib diisi')
      }),
      host: await askText({
        message: 'Host admin MySQL',
        initialValue: initialConfig.host || '127.0.0.1',
        validate: validateRequired('Host admin')
      }),
      port: await askText({
        message: 'Port admin MySQL',
        initialValue: initialConfig.port || '3306',
        validate: validateRequired('Port admin')
      }),
      mode: adminMode
    };
  }

  return adminConfig;
}

async function createMysqlDatabaseAndUser({ dbName, dbUser, dbPassword, dbHost, adminConfig }, dryRun = false) {
  const safeDbName = sanitizeDbName(dbName);
  const safeDbUser = sanitizeDbName(dbUser);
  const safePassword = sqlEscape(dbPassword);
  const userHosts = getDatabaseUserHosts(dbHost);
  const currentAdminConfig = { ...adminConfig };

  const sqlStatements = [
    `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  ];

  for (const host of userHosts) {
    sqlStatements.push(`CREATE USER IF NOT EXISTS '${safeDbUser}'@'${host}' IDENTIFIED BY '${safePassword}';`);
    sqlStatements.push(`ALTER USER '${safeDbUser}'@'${host}' IDENTIFIED BY '${safePassword}';`);
    sqlStatements.push(`GRANT ALL PRIVILEGES ON \`${safeDbName}\`.* TO '${safeDbUser}'@'${host}';`);
  }

  sqlStatements.push('FLUSH PRIVILEGES;');
  const sql = sqlStatements.join(' ');

  if (dryRun) {
    renderSummary('Pratinjau Setup Database', [
      ['Database', safeDbName],
      ['User', safeDbUser],
      ['Hosts', userHosts.join(', ')],
      ['Mode Admin', adminConfig?.mode || 'socket']
    ], infoBorder);
    return true;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panzek-mysql-'));
  const tempSqlPath = path.join(tempDir, 'setup.sql');
  const mysqlClient = getMysqlClientCommand();

  try {
    if (!mysqlClient) {
      logEvent("error", 'mysql/mariadb client belum terinstall.');
      return false;
    }

    fs.writeFileSync(tempSqlPath, `${sql}\n`);

    const defaultsPath = path.join(tempDir, 'client.cnf');
    const result = await runCommandWithHandling({
      title: 'Membuat Database dan User',
      command: () => {
        if (currentAdminConfig?.mode === 'login' || currentAdminConfig?.mode === 'login-ssl-off') {
          const lines = [
            '[client]',
            `user=${currentAdminConfig.user}`,
            `password=${currentAdminConfig.password}`,
            `host=${currentAdminConfig.host}`,
            `port=${currentAdminConfig.port}`
          ];
          const sslFlag = currentAdminConfig.mode === 'login-ssl-off' ? ' --ssl=off' : '';

          fs.writeFileSync(defaultsPath, `${lines.join('\n')}\n`, { mode: 0o600 });
          return `${mysqlClient} --defaults-extra-file="${defaultsPath}"${sslFlag} < "${tempSqlPath}"`;
        }

        return `sudo ${mysqlClient} < "${tempSqlPath}"`;
      },
      cwd: process.cwd(),
      dryRun: false,
      phase: 'database',
      message: 'Setup database gagal dijalankan dengan mode login admin yang aktif.',
      extraActions: [
        {
          value: 'edit-admin',
          label: 'Ubah koneksi admin DB',
          hint: 'edit mode login, host, port, user, dan password',
          handler: async () => {
            const updated = await askAdminAccessConfig(currentAdminConfig);
            replaceObject(currentAdminConfig, updated);
            replaceObject(adminConfig, updated);
          }
        }
      ]
    });
    return result.ok;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function updateLaravelDbEnv(appPath, dbConfig, dryRun = false) {
  const envPath = path.join(appPath, '.env');

  const updates = [
    ['DB_CONNECTION', 'mysql'],
    ['DB_HOST', dbConfig.dbHost],
    ['DB_PORT', dbConfig.dbPort],
    ['DB_DATABASE', dbConfig.dbName],
    ['DB_USERNAME', dbConfig.dbUser],
    ['DB_PASSWORD', dbConfig.dbPassword]
  ];

  for (const [key, value] of updates) {
    const ok = setEnvValue(envPath, key, value, dryRun);
    if (!ok) return false;
  }

  return true;
}

function generateNginxConfig({ domain, appPath, phpVersion }) {
  return `server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    root ${path.join(appPath, 'public')};
    index index.php index.html;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    charset utf-8;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php${phpVersion}-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`;
}

function getNginxRollbackState(availablePath, enabledPath, tempDir) {
  const state = {
    hadAvailable: fs.existsSync(availablePath),
    availableBackupPath: path.join(tempDir, 'available.backup.conf'),
    enabledExists: fs.existsSync(enabledPath),
    enabledIsSymlink: false,
    enabledTarget: null,
    enabledBackupPath: path.join(tempDir, 'enabled.backup.conf')
  };

  if (state.hadAvailable) {
    fs.copyFileSync(availablePath, state.availableBackupPath);
  }

  if (state.enabledExists) {
    const stat = fs.lstatSync(enabledPath);
    state.enabledIsSymlink = stat.isSymbolicLink();

    if (state.enabledIsSymlink) {
      state.enabledTarget = fs.readlinkSync(enabledPath);
    } else {
      fs.copyFileSync(enabledPath, state.enabledBackupPath);
    }
  }

  return state;
}

function rollbackNginxFiles(rollbackState, availablePath, enabledPath) {
  const commands = [];

  if (rollbackState.hadAvailable) {
    commands.push(`sudo cp "${rollbackState.availableBackupPath}" "${availablePath}"`);
  } else {
    commands.push(`sudo rm -f "${availablePath}"`);
  }

  if (rollbackState.enabledExists) {
    if (rollbackState.enabledIsSymlink) {
      commands.push(`sudo ln -sfn "${rollbackState.enabledTarget}" "${enabledPath}"`);
    } else {
      commands.push(`sudo cp "${rollbackState.enabledBackupPath}" "${enabledPath}"`);
    }
  } else {
    commands.push(`sudo rm -f "${enabledPath}"`);
  }

  let rollbackFailed = false;

  for (const command of commands) {
    const result = executeCommand(command, process.cwd(), false);
    if (!result.ok) {
      rollbackFailed = true;
    }
  }

  if (rollbackFailed) {
    renderPanel(
      'Rollback Nginx Perlu Perhatian',
      'Sebagian rollback config Nginx tidak berhasil. Periksa isi sites-available dan sites-enabled secara manual.',
      errorBorder
    );
  } else {
    renderPanel(
      'Rollback Nginx Selesai',
      'Config Nginx yang gagal tadi sudah dikembalikan ke kondisi sebelumnya.',
      infoBorder
    );
  }
}

async function setupNginxConfig({ domain, appPath, phpVersion }, dryRun = false) {
  const resolvedAppPath = path.resolve(appPath);
  const publicPath = path.join(resolvedAppPath, 'public');
  const pathValidationError = validateLaravelAppPath(resolvedAppPath);

  if (pathValidationError) {
    renderPanel('Path Laravel Belum Valid', pathValidationError, errorBorder);
    return false;
  }

  const configContent = generateNginxConfig({ domain, appPath: resolvedAppPath, phpVersion });
  const availablePath = `/etc/nginx/sites-available/${domain}`;
  const enabledPath = `/etc/nginx/sites-enabled/${domain}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panzek-nginx-'));
  const tempPath = path.join(tempDir, `${sanitizeFilename(domain)}.nginx.conf`);

  if (dryRun) {
    renderSummary('Pratinjau Setup Nginx', [
      ['Domain', domain],
      ['Path App', resolvedAppPath],
      ['Path Public', publicPath],
      ['Config Sementara', tempPath],
      ['Sites Available', availablePath],
      ['Sites Enabled', enabledPath]
    ], infoBorder);
    return true;
  }

  let rollbackState;

  try {
    fs.writeFileSync(tempPath, configContent);
    rollbackState = getNginxRollbackState(availablePath, enabledPath, tempDir);
  } catch (error) {
    logEvent("error", `Gagal membuat file config sementara: ${error.message}`);
    fs.rmSync(tempDir, { recursive: true, force: true });
    return false;
  }

  try {
    let result = await runCommandWithHandling({
      title: 'Menyalin Config Nginx',
      command: `sudo cp "${tempPath}" "${availablePath}"`,
      cwd: process.cwd(),
      dryRun: false,
      phase: 'nginx',
      message: 'File config Nginx gagal disalin ke sites-available.'
    });
    if (!result.ok) return false;

    result = await runCommandWithHandling({
      title: 'Mengaktifkan Site Nginx',
      command: `sudo ln -sf "${availablePath}" "${enabledPath}"`,
      cwd: process.cwd(),
      dryRun: false,
      phase: 'nginx',
      message: 'Symlink config Nginx gagal dibuat.'
    });
    if (!result.ok) return false;

    result = await runCommandWithHandling({
      title: 'Validasi Config Nginx',
      command: 'sudo nginx -t',
      cwd: process.cwd(),
      dryRun: false,
      phase: 'nginx',
      message: 'Konfigurasi Nginx tidak valid.'
    });
    if (!result.ok) {
      rollbackNginxFiles(rollbackState, availablePath, enabledPath);
      return false;
    }

    result = await runCommandWithHandling({
      title: 'Reload Nginx',
      command: 'sudo systemctl reload nginx',
      cwd: process.cwd(),
      dryRun: false,
      phase: 'nginx',
      message: 'Nginx gagal di-reload setelah config diperbarui.'
    });
    if (!result.ok) {
      rollbackNginxFiles(rollbackState, availablePath, enabledPath);
      return false;
    }

    logEvent("success", `Config Nginx aktif di ${availablePath}`);
    return true;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function askRunMode() {
  if (runtimeOptions.mode === 'dry-run' || runtimeOptions.dryRun) {
    return 'dry-run';
  }
  if (runtimeOptions.mode === 'normal') {
    return 'normal';
  }
  if (runtimeOptions.nonInteractive) {
    return 'normal';
  }

  return askSelect({
    message: 'Pilih mode eksekusi',
    initialValue: 'normal',
    options: [
      { value: 'normal', label: 'Jalankan langsung', hint: 'eksekusi semua command' },
      { value: 'dry-run', label: 'Pratinjau', hint: 'cek alur tanpa eksekusi command' }
    ]
  });
}

async function askLaravelInfo() {
  return {
    repo: await askText({
      message: 'Masukkan URL repo GitHub',
      placeholder: 'https://github.com/user/repo.git',
      validate: validateRequired('Repo')
    }),
    branch: await askText({
      message: 'Masukkan branch',
      initialValue: 'main',
      validate: validateRequired('Branch')
    }),
    targetDir: await askText({
      message: 'Masukkan folder target clone',
      initialValue: '/var/www/laravel-app',
      validate: validateRequired('Folder target')
    })
  };
}

async function askUseDefaultSteps(defaultSteps) {
  renderSteps('Langkah Bawaan Laravel', defaultSteps);

  const useDefault = await askConfirm({
    message: 'Pakai step bawaan ini?',
    initialValue: true
  });

  if (useDefault) {
    return defaultSteps;
  }

  const steps = [];
  logEvent("info", 'Masukkan langkah custom. Kosongkan input untuk selesai.');

  while (true) {
    const step = await askText({
      message: `Masukkan command untuk langkah ke-${steps.length + 1}`,
      placeholder: 'composer install --no-dev'
    });

    if (!step || !step.trim()) break;
    steps.push(step.trim());
  }

  return steps;
}

async function askDatabaseSetup(defaultTargetDir) {
  const suggestedName = sanitizeDbName(path.basename(defaultTargetDir || 'laravel_app'));
  const setupDb = await askConfirm({
    message: 'Buat database dan user MySQL sekarang?',
    initialValue: true
  });

  if (!setupDb) {
    return { enabled: false };
  }

  const dbName = await askText({
    message: 'Nama database',
    initialValue: suggestedName,
    validate: validateRequired('Nama database')
  });
  const dbUser = await askText({
    message: 'Username database',
    initialValue: suggestedName,
    validate: validateRequired('Username database')
  });
  const passwordMode = await askSelect({
    message: 'Mode password database',
    initialValue: 'auto',
    options: [
      { value: 'auto', label: 'Generate otomatis', hint: 'disarankan' },
      { value: 'manual', label: 'Isi manual' }
    ]
  });
  const dbHost = await askText({
    message: 'Host database',
    initialValue: '127.0.0.1',
    validate: validateRequired('Host database')
  });
  const dbPort = await askText({
    message: 'Port database',
    initialValue: '3306',
    validate: validateRequired('Port database')
  });

  let dbPassword = generateRandomPassword(20);

  if (passwordMode === 'manual') {
    dbPassword = await askPassword({
      message: 'Masukkan password database',
      validate: (value) => (String(value || '').trim() !== '' ? undefined : 'Password wajib diisi')
    });
  }

  const adminConfig = await askAdminAccessConfig();

  return {
    enabled: true,
    dbName: sanitizeDbName(dbName),
    dbUser: sanitizeDbName(dbUser),
    dbPassword,
    dbHost,
    dbPort,
    adminConfig
  };
}

async function askNginxInfo(defaultAppPath = '/var/www/laravel-app') {
  return {
    domain: await askText({
      message: 'Masukkan domain',
      initialValue: 'example.com',
      validate: validateDomain
    }),
    appPath: await askText({
      message: 'Masukkan path project Laravel',
      initialValue: defaultAppPath,
      validate: validateLaravelAppPath
    }),
    phpVersion: await askText({
      message: 'Masukkan versi PHP-FPM',
      initialValue: '8.3',
      validate: validatePhpVersion
    })
  };
}

async function askCloudflareTunnelInfo() {
  if (runtimeOptions.nonInteractive) {
    const workflowConfig = getWorkflowConfig('setup-cloudflare');
    const tunnelName = requiredNonInteractive(
      'setup-cloudflare',
      'tunnelName',
      getEnvValue('PANZEK_CF_TUNNEL_NAME', workflowConfig.tunnelName || '')
    );
    const hostname = requiredNonInteractive(
      'setup-cloudflare',
      'hostname',
      getEnvValue('PANZEK_CF_HOSTNAME', workflowConfig.hostname || '')
    );
    const serviceUrl = requiredNonInteractive(
      'setup-cloudflare',
      'serviceUrl',
      getEnvValue('PANZEK_CF_SERVICE_URL', workflowConfig.serviceUrl || 'http://localhost:80')
    );
    const tunnelNameValidation = validateTunnelName(tunnelName);
    if (tunnelNameValidation) {
      throw new Error(`[non-interactive] tunnelName tidak valid: ${tunnelNameValidation}`);
    }
    const hostnameValidation = validateCloudflareHostname(hostname);
    if (hostnameValidation) {
      throw new Error(`[non-interactive] hostname tidak valid: ${hostnameValidation}`);
    }
    const serviceUrlValidation = validateUrl(serviceUrl, 'URL service lokal');
    if (serviceUrlValidation) {
      throw new Error(`[non-interactive] serviceUrl tidak valid: ${serviceUrlValidation}`);
    }
    return {
      tunnelName,
      hostname,
      serviceUrl,
      configPath: path.resolve(
        getEnvValue('PANZEK_CF_CONFIG_PATH', workflowConfig.configPath || getDefaultCloudflaredConfigPath(tunnelName))
      ),
      installService: parseBoolValue(
        getEnvValue('PANZEK_CF_INSTALL_SERVICE', workflowConfig.installService),
        Boolean(workflowConfig.installService)
      ),
      runLogin: parseBoolValue(
        getEnvValue('PANZEK_CF_RUN_LOGIN', workflowConfig.runLogin),
        Boolean(workflowConfig.runLogin)
      )
    };
  }

  const tunnelName = await askText({
    message: 'Nama tunnel Cloudflare',
    initialValue: 'panzek-tunnel',
    validate: validateTunnelName
  });
  const hostname = await askText({
    message: 'Hostname publik untuk tunnel',
    initialValue: 'app.example.com',
    validate: validateCloudflareHostname
  });
  const serviceUrl = await askText({
    message: 'URL service lokal yang akan di-expose',
    initialValue: 'http://localhost:80',
    validate: (value) => validateUrl(value, 'URL service lokal')
  });
  const configPath = await askText({
    message: 'Path config cloudflared',
    initialValue: getDefaultCloudflaredConfigPath(tunnelName),
    validate: validateRequired('Path config cloudflared')
  });
  const installService = await askConfirm({
    message: 'Install tunnel sebagai service systemd?',
    initialValue: true
  });
  const runLogin = await askConfirm({
    message: fs.existsSync(getCloudflaredCertPath())
      ? 'Jalankan login Cloudflare lagi untuk memilih zone lain?'
      : 'Jalankan login Cloudflare sekarang?',
    initialValue: !fs.existsSync(getCloudflaredCertPath())
  });

  return {
    tunnelName,
    hostname,
    serviceUrl,
    configPath: path.resolve(configPath),
    installService,
    runLogin
  };
}

async function askProjectToUpdate(projects) {
  renderProjectCatalog('Project Terdeteksi', projects);

  return askSelect({
    message: 'Pilih project yang ingin diupdate',
    options: projects.map((project) => ({
      value: project.path,
      label: `${project.name} • ${project.profile.category}`,
      hint: `${formatBranchLabel(project.branch)} • ${formatDirtyLabel(project.dirty)} • ${shortenPath(project.path, 58)}`
    }))
  });
}

async function ensureCloudflaredLogin(dryRun = false) {
  const certPath = getCloudflaredCertPath();

  if (!dryRun && fs.existsSync(certPath)) {
    return true;
  }

  const result = await runCommandWithHandling({
    title: 'Login Cloudflare',
    command: 'cloudflared tunnel login',
    cwd: process.cwd(),
    dryRun,
    phase: 'cloudflare',
    message: 'Login Cloudflare Tunnel belum berhasil. Pastikan autentikasi di browser selesai lebih dulu.',
    interactive: true
  });

  return result.ok;
}

async function createCloudflareTunnel(info, dryRun = false) {
  if (dryRun) {
    return {
      ok: true,
      tunnelId: '00000000-0000-0000-0000-000000000000',
      credentialsFile: path.join(os.homedir(), '.cloudflared', 'dry-run.json')
    };
  }

  const result = await runCommandWithHandling({
    title: 'Membuat Tunnel Cloudflare',
    command: `cloudflared tunnel create ${quoteShellArg(info.tunnelName)}`,
    cwd: process.cwd(),
    dryRun: false,
    phase: 'cloudflare',
    message: 'Cloudflare Tunnel belum berhasil dibuat. Nama tunnel mungkin sudah dipakai atau sesi login belum valid.',
    extraActions: [
      {
        value: 'edit-tunnel-name',
        label: 'Ubah nama tunnel',
        hint: 'ganti nama lalu retry create tunnel',
        handler: async () => {
          info.tunnelName = await askText({
            message: 'Nama tunnel Cloudflare',
            initialValue: info.tunnelName,
            validate: validateTunnelName
          });
        }
      },
      {
        value: 'login-cloudflare',
        label: 'Login Cloudflare sekarang',
        hint: 'jalankan cloudflared tunnel login lalu retry',
        handler: async () => {
          await ensureCloudflaredLogin(false);
        }
      }
    ]
  });

  if (!result.ok) {
    return { ok: false, tunnelId: null, credentialsFile: null };
  }

  const parsed = parseTunnelCreateResult(result);
  if (!parsed.tunnelId || !parsed.credentialsFile) {
    renderPanel(
      'Tunnel Dibuat, Tetapi Output Belum Lengkap',
      'Tunnel kemungkinan sudah terbentuk, tetapi ID atau file credential tidak terbaca dari output cloudflared. Periksa output command di atas.',
      errorBorder
    );
    return { ok: false, tunnelId: null, credentialsFile: null };
  }

  return {
    ok: true,
    tunnelId: parsed.tunnelId,
    credentialsFile: path.isAbsolute(expandHomePath(parsed.credentialsFile))
      ? expandHomePath(parsed.credentialsFile)
      : path.resolve(expandHomePath(parsed.credentialsFile))
  };
}

function writeCloudflaredConfig(info, tunnelData, dryRun = false) {
  const configContent = createCloudflaredConfig({
    tunnelId: tunnelData.tunnelId,
    credentialsFile: tunnelData.credentialsFile,
    hostname: info.hostname,
    serviceUrl: info.serviceUrl
  });

  if (dryRun) {
    renderSummary('Pratinjau Config Cloudflared', [
      ['Tunnel ID', tunnelData.tunnelId],
      ['Hostname', info.hostname],
      ['Service Lokal', info.serviceUrl],
      ['Path Config', info.configPath]
    ], infoBorder);
    return true;
  }

  try {
    ensureDirSync(path.dirname(info.configPath));
    fs.writeFileSync(info.configPath, configContent);
    return true;
  } catch (error) {
    renderPanel(
      'Config Cloudflared Belum Tersimpan',
      `${chalk.red('File config tunnel belum bisa ditulis.')}\n\n${error.message}\n${chalk.gray(info.configPath)}`,
      errorBorder
    );
    return false;
  }
}

async function setupCloudflareTunnel(dryRun = false) {
  renderWorkflowHeader('Setup Cloudflare Tunnel', [['Mode', formatModeLabel(dryRun)]]);
  if (!commandExists('cloudflared')) {
    renderPanel(
      'Dependency Belum Tersedia',
      'cloudflared belum terinstall. Install cloudflared terlebih dahulu sebelum membuat Cloudflare Tunnel.',
      errorBorder
    );
    return false;
  }

  const info = await askCloudflareTunnelInfo();

  renderSummary('Ringkasan Cloudflare Tunnel', [
    ['Nama Tunnel', info.tunnelName],
    ['Hostname', info.hostname],
    ['Service Lokal', info.serviceUrl],
    ['Path Config', info.configPath],
    ['Install Service', formatYesNo(info.installService)],
    ['Jalankan Login', formatYesNo(info.runLogin)],
    ['Mode', formatModeLabel(dryRun)]
  ]);

  const confirmed = runtimeOptions.nonInteractive
    ? true
    : await askConfirm({
        message: 'Lanjut setup Cloudflare Tunnel?',
        initialValue: true
      });

  if (!confirmed) {
    logEvent("warn", 'Setup Cloudflare Tunnel dibatalkan.');
    return false;
  }

  if (info.runLogin) {
    const loginOk = await ensureCloudflaredLogin(dryRun);
    if (!loginOk) {
      logEvent("error", 'Login Cloudflare Tunnel gagal.');
      return false;
    }
  }

  const tunnelData = await createCloudflareTunnel(info, dryRun);
  if (!tunnelData.ok) {
    logEvent("error", 'Cloudflare Tunnel tidak berhasil dibuat.');
    return false;
  }

  const configOk = writeCloudflaredConfig(info, tunnelData, dryRun);
  if (!configOk) {
    logEvent("error", 'Config cloudflared tidak berhasil ditulis.');
    return false;
  }

  const validateOk = await runCommandWithHandling({
    title: 'Validasi Ingress Cloudflared',
    command: `cloudflared tunnel --config "${info.configPath}" ingress validate`,
    cwd: process.cwd(),
    dryRun,
    phase: 'cloudflare',
    message: 'Config ingress cloudflared tidak valid.'
  });

  if (!validateOk.ok) {
    logEvent("error", 'Validasi ingress cloudflared gagal.');
    return false;
  }

  const dnsOk = await runCommandWithHandling({
    title: 'Membuat DNS Route Tunnel',
    command: `cloudflared tunnel route dns ${quoteShellArg(tunnelData.tunnelId)} ${quoteShellArg(info.hostname)}`,
    cwd: process.cwd(),
    dryRun,
    phase: 'cloudflare',
    message: 'DNS route untuk hostname tunnel gagal dibuat.'
  });

  if (!dnsOk.ok) {
    logEvent("error", 'DNS route Cloudflare Tunnel gagal.');
    return false;
  }

  if (info.installService) {
    const serviceInstallOk = await runCommandWithHandling({
      title: 'Install Service Cloudflared',
      command: `sudo cloudflared --config "${info.configPath}" service install`,
      cwd: process.cwd(),
      dryRun,
      phase: 'cloudflare',
      message: 'Service cloudflared gagal diinstall.'
    });

    if (!serviceInstallOk.ok) {
      logEvent("error", 'Install service cloudflared gagal.');
      return false;
    }

    const serviceStartOk = await runCommandWithHandling({
      title: 'Start Service Cloudflared',
      command: 'sudo systemctl start cloudflared',
      cwd: process.cwd(),
      dryRun,
      phase: 'cloudflare',
      message: 'Service cloudflared gagal dijalankan setelah install.'
    });

    if (!serviceStartOk.ok) {
      logEvent("error", 'Start service cloudflared gagal.');
      return false;
    }
  }

  renderSummary('Cloudflare Tunnel Siap', [
    ['Status', statusBadge('success', 'DONE')],
    ['Nama Tunnel', info.tunnelName],
    ['Tunnel ID', tunnelData.tunnelId],
    ['Hostname', info.hostname],
    ['Service Lokal', info.serviceUrl],
    ['Path Config', info.configPath],
    ['Command Manual', `cloudflared tunnel --config "${info.configPath}" run ${tunnelData.tunnelId}`]
  ], successBorder);

  renderNote(
    [
      'Tunnel ini tidak membutuhkan IPv4 publik.',
      info.installService
        ? 'cloudflared sudah diinstall dan dijalankan sebagai service.'
        : `Jalankan manual: cloudflared tunnel --config "${info.configPath}" run ${tunnelData.tunnelId}`
    ].join('\n'),
    'Cloudflare Tunnel'
  );
  return true;
}

async function updateGitProject(project, dryRun = false) {
  const appPath = project.path;
  const gitCommands = ['git fetch origin'];

  if (project.branch) {
    gitCommands.push(`git checkout ${project.branch}`, `git pull origin ${project.branch}`);
  } else {
    gitCommands.push('git pull');
  }

  const ownershipOk = await ensureAppOwnership(appPath, dryRun);
  if (!ownershipOk) {
    logEvent("error", 'Ownership project belum berhasil disiapkan.');
    return false;
  }

  if (project.profile.hasArtisan) {
    const envReady = prepareLaravelEnv(appPath, dryRun);
    if (!envReady) {
      logEvent("error", 'File .env belum berhasil disiapkan.');
      return false;
    }
  }

  for (let i = 0; i < gitCommands.length; i++) {
    logEvent("step", `Sinkronisasi Git ${i + 1}/${gitCommands.length}: ${gitCommands[i]}`);
    const result = await runCommandWithHandling({
      title: `Sinkronisasi Git ${i + 1}/${gitCommands.length}`,
      command: gitCommands[i],
      cwd: appPath,
      dryRun,
      phase: 'repository',
      message: 'Sinkronisasi repository belum berhasil dijalankan.'
    });

    if (!result.ok) {
      logEvent("error", `Update repository berhenti di langkah: ${gitCommands[i]}`);
      return false;
    }
  }

  for (let i = 0; i < project.profile.installSteps.length; i++) {
    const step = project.profile.installSteps[i];
    logEvent("step", `Langkah update ${i + 1}/${project.profile.installSteps.length}: ${step}`);

    const result = await runCommandWithHandling({
      title: `Langkah Update ${i + 1}/${project.profile.installSteps.length}`,
      command: step,
      cwd: appPath,
      dryRun,
      phase: 'update',
      message: 'Langkah update project ini belum berhasil dijalankan.'
    });

    if (!result.ok) {
      logEvent("error", `Update project berhenti di langkah: ${step}`);
      return false;
    }
  }

  for (let i = 0; i < project.profile.postSteps.length; i++) {
    const step = project.profile.postSteps[i];
    logEvent("step", `Tahap akhir ${i + 1}/${project.profile.postSteps.length}: ${step}`);

    const result = await runCommandWithHandling({
      title: `Tahap Akhir ${i + 1}/${project.profile.postSteps.length}`,
      command: step,
      cwd: appPath,
      dryRun,
      phase: 'post-update',
      message: 'Tahap akhir project ini belum berhasil dijalankan.'
    });

    if (!result.ok) {
      logEvent("error", `Tahap akhir project gagal dijalankan: ${step}`);
      return false;
    }
  }

  if (project.profile.hasArtisan || project.profile.hasLaravelDirs) {
    const permissionOk = await applyLaravelPermissions(appPath, dryRun);
    if (!permissionOk) {
      logEvent("error", 'Permission Laravel belum berhasil diterapkan.');
      return false;
    }
  }

  renderSummary('Update Project Selesai', [
    ['Status', statusBadge('success', 'DONE')],
    ['Nama Project', project.name],
    ['Tipe', project.profile.category],
    ['Path', appPath],
    ['Branch', formatBranchLabel(project.branch)],
    ['Status Git', formatDirtyLabel(project.dirty)],
    ['Jumlah Langkah', buildProjectUpdatePlan(project).length],
    ['Mode', formatModeLabel(dryRun)]
  ], successBorder);

  return true;
}

async function updateProject() {
  const mode = await askRunMode();
  const dryRun = mode === 'dry-run';
  renderWorkflowHeader('Update Project', [['Mode', formatModeLabel(dryRun)]]);
  const projects = findManagedProjects();
  const searchRoots = getProjectSearchRoots();

  if (projects.length === 0) {
    renderPanel(
      'Project Belum Ditemukan',
      `Belum ada project git yang terdeteksi.\n\nLokasi yang dicek:\n${searchRoots.join('\n')}`,
      infoBorder
    );
    return false;
  }

  renderSummary('Sumber Pencarian Project', [
    ['Jumlah Project', projects.length],
    ['Lokasi Scan', searchRoots.join(', ')],
    ['Mode', formatModeLabel(dryRun)]
  ], infoBorder);

  let selectedPath = '';
  if (runtimeOptions.nonInteractive) {
    const workflowConfig = getWorkflowConfig('update-project');
    selectedPath = requiredNonInteractive(
      'update-project',
      'path project',
      getEnvValue('PANZEK_UPDATE_PROJECT_PATH', workflowConfig.projectPath || '')
    );
  } else {
    selectedPath = await askProjectToUpdate(projects);
  }

  const project = projects.find((item) => item.path === selectedPath);

  if (!project) {
    logEvent("error", 'Project yang dipilih tidak ditemukan lagi.');
    return false;
  }

  const updatePlan = buildProjectUpdatePlan(project);

  renderSummary('Ringkasan Update Project', [
    ['Nama Project', project.name],
    ['Tipe', project.profile.category],
    ['Repo', project.repo || '-'],
    ['Branch', formatBranchLabel(project.branch)],
    ['Path', project.path],
    ['Status Git', formatDirtyLabel(project.dirty)],
    ['Jumlah Langkah', updatePlan.length],
    ['Mode', formatModeLabel(dryRun)]
  ]);

  renderSteps('Rencana Update', updatePlan);

  if (project.dirty) {
    renderNote(
      'Project ini punya perubahan lokal yang belum bersih. Jika update gagal saat pull, rapikan commit atau stash lebih dulu.',
      'Perhatian'
    );
  }

  const confirmed = runtimeOptions.nonInteractive
    ? true
    : await askConfirm({
        message: 'Lanjut update project ini?',
        initialValue: true
      });

  if (!confirmed) {
    logEvent("warn", 'Update project dibatalkan.');
    return false;
  }

  const ok = await updateGitProject(project, dryRun);
  return ok;
}

async function deployLaravel() {
  const mode = await askRunMode();
  const dryRun = mode === 'dry-run';
  renderWorkflowHeader('Deploy Laravel', [['Mode', formatModeLabel(dryRun)]]);
  const workflowConfig = getWorkflowConfig('deploy-laravel');
  const info = runtimeOptions.nonInteractive
    ? {
        repo: requiredNonInteractive(
          'deploy-laravel',
          'repo',
          getEnvValue('PANZEK_DEPLOY_REPO', workflowConfig.repo || '')
        ),
        branch: requiredNonInteractive(
          'deploy-laravel',
          'branch',
          getEnvValue('PANZEK_DEPLOY_BRANCH', workflowConfig.branch || 'main')
        ),
        targetDir: requiredNonInteractive(
          'deploy-laravel',
          'targetDir',
          getEnvValue('PANZEK_DEPLOY_TARGET_DIR', workflowConfig.targetDir || '/var/www/laravel-app')
        )
      }
    : await askLaravelInfo();

  const steps = runtimeOptions.nonInteractive
    ? Array.isArray(workflowConfig.steps) && workflowConfig.steps.length > 0
      ? workflowConfig.steps
      : getLaravelDefaultSteps()
    : await askUseDefaultSteps(getLaravelDefaultSteps());

  const dbSetup = runtimeOptions.nonInteractive
    ? {
        enabled: parseBoolValue(
          getEnvValue('PANZEK_DB_ENABLED', workflowConfig.database?.enabled),
          Boolean(workflowConfig.database?.enabled)
        ),
        dbName: sanitizeDbName(getEnvValue('PANZEK_DB_NAME', workflowConfig.database?.dbName || 'laravel_app')),
        dbUser: sanitizeDbName(getEnvValue('PANZEK_DB_USER', workflowConfig.database?.dbUser || 'laravel_user')),
        dbPassword: getEnvValue('PANZEK_DB_PASSWORD', workflowConfig.database?.dbPassword || generateRandomPassword(20)),
        dbHost: getEnvValue('PANZEK_DB_HOST', workflowConfig.database?.dbHost || '127.0.0.1'),
        dbPort: getEnvValue('PANZEK_DB_PORT', workflowConfig.database?.dbPort || '3306'),
        adminConfig: {
          mode: getEnvValue('PANZEK_DB_ADMIN_MODE', workflowConfig.database?.adminConfig?.mode || 'socket'),
          user: getEnvValue('PANZEK_DB_ADMIN_USER', workflowConfig.database?.adminConfig?.user || 'root'),
          password: getEnvValue('PANZEK_DB_ADMIN_PASSWORD', workflowConfig.database?.adminConfig?.password || ''),
          host: getEnvValue('PANZEK_DB_ADMIN_HOST', workflowConfig.database?.adminConfig?.host || '127.0.0.1'),
          port: getEnvValue('PANZEK_DB_ADMIN_PORT', workflowConfig.database?.adminConfig?.port || '3306')
        }
      }
    : await askDatabaseSetup(info.targetDir);

  if (steps.length === 0) {
    logEvent("error", 'Tidak ada langkah deploy. Workflow dibatalkan.');
    return false;
  }

  const summaryRows = [
    ['Repo', info.repo],
    ['Branch', info.branch],
    ['Target', path.resolve(info.targetDir)],
    ['Mode', formatModeLabel(dryRun)],
    ['Jumlah Langkah', steps.length]
  ];

  if (dbSetup.enabled) {
    summaryRows.push(['Database', dbSetup.dbName], ['User DB', dbSetup.dbUser], ['Host DB', dbSetup.dbHost]);
  }

  renderSummary('Ringkasan Deploy Laravel', summaryRows);
  renderSteps('Rencana Eksekusi', steps);

  const confirmed = runtimeOptions.nonInteractive
    ? true
    : await askConfirm({
        message: 'Lanjut deploy Laravel?',
        initialValue: true
      });

  if (!confirmed) {
    logEvent("warn", 'Deploy Laravel dibatalkan.');
    return false;
  }

  const repoSetup = await ensureGitRepo(info.repo, info.branch, info.targetDir, dryRun);
  if (!repoSetup.ok) {
    logEvent("error", 'Repository belum berhasil disiapkan.');
    return false;
  }

  const appPath = repoSetup.cwd;

  const envReady = prepareLaravelEnv(appPath, dryRun);
  if (!envReady) {
    logEvent("error", 'File .env belum berhasil disiapkan.');
    return false;
  }

  for (let i = 0; i < steps.length; i++) {
    logEvent("step", `Langkah ${i + 1}/${steps.length}: ${steps[i]}`);

    const result = await runCommandWithHandling({
      title: `Langkah ${i + 1}/${steps.length}`,
      command: steps[i],
      cwd: appPath,
      dryRun,
      phase: 'deploy',
      message: 'Langkah deploy Laravel ini belum berhasil dijalankan.'
    });

    if (!result.ok) {
      logEvent("error", `Deploy berhenti di langkah ${i + 1}: ${steps[i]}`);
      return false;
    }
  }

  if (dbSetup.enabled) {
    if (!getMysqlClientCommand()) {
      logEvent("error", 'Client mysql/mariadb belum tersedia, jadi setup database tidak bisa dilanjutkan.');
      return false;
    }

    logEvent("step", 'Menyiapkan database MySQL/MariaDB...');

    const dbOk = await createMysqlDatabaseAndUser(
      {
        dbName: dbSetup.dbName,
        dbUser: dbSetup.dbUser,
        dbPassword: dbSetup.dbPassword,
        dbHost: dbSetup.dbHost,
        adminConfig: dbSetup.adminConfig
      },
      dryRun
    );

    if (!dbOk) {
      logEvent("error", 'Database atau user MySQL belum berhasil dibuat.');
      return false;
    }

    const envDbOk = updateLaravelDbEnv(appPath, dbSetup, dryRun);
    if (!envDbOk) {
      logEvent("error", 'Konfigurasi database di .env belum berhasil diperbarui.');
      return false;
    }
  }

  const postSteps = [
    'php artisan key:generate',
    'php artisan storage:link',
    'php artisan migrate --force',
    'php artisan optimize:clear',
    'php artisan optimize'
  ];

  for (let i = 0; i < postSteps.length; i++) {
    logEvent("step", `Tahap akhir ${i + 1}/${postSteps.length}: ${postSteps[i]}`);
    const result = await runCommandWithHandling({
      title: `Tahap Akhir ${i + 1}/${postSteps.length}`,
      command: postSteps[i],
      cwd: appPath,
      dryRun,
      phase: 'post-deploy',
      message: 'Tahap akhir Laravel ini belum berhasil dijalankan.'
    });
    if (!result.ok) {
      logEvent("error", `Tahap akhir Laravel gagal dijalankan: ${postSteps[i]}`);
      return false;
    }
  }

  const permissionOk = await applyLaravelPermissions(appPath, dryRun);
  if (!permissionOk) {
    logEvent("error", 'Permission Laravel belum berhasil diterapkan.');
    return false;
  }

  const runHealthCheck = runtimeOptions.nonInteractive
    ? parseBoolValue(
        getEnvValue('PANZEK_HEALTH_CHECK', workflowConfig.healthCheck),
        workflowConfig.healthCheck === undefined ? true : Boolean(workflowConfig.healthCheck)
      )
    : await askConfirm({
        message: 'Jalankan health check setelah deploy?',
        initialValue: true
      });
  if (runHealthCheck) {
    const healthOk = await runLaravelHealthCheck(appPath, dryRun);
    if (!healthOk) {
      logEvent("error", 'Health check pasca deploy gagal.');
      return false;
    }
  }

  renderSummary('Deploy Laravel Selesai', [
    ['Status', statusBadge('success', 'DONE')],
    ['Folder Aplikasi', appPath],
    ['Nginx Root', path.join(appPath, 'public')],
    ['Mode', formatModeLabel(dryRun)]
  ], successBorder);

  if (dbSetup.enabled) {
    renderSummary('Kredensial Database', [
      ['Database', dbSetup.dbName],
      ['Username', dbSetup.dbUser],
      ['Password', maskSecretValue(dbSetup.dbPassword)],
      ['Host', dbSetup.dbHost],
      ['Port', dbSetup.dbPort]
    ], successBorder);
    renderNote('Simpan kredensial ini dengan aman sebelum lanjut ke server produksi.', 'Catatan');
  }
  return true;
}

async function setupNginx() {
  const mode = await askRunMode();
  const dryRun = mode === 'dry-run';
  renderWorkflowHeader('Setup Nginx', [['Mode', formatModeLabel(dryRun)]]);
  const workflowConfig = getWorkflowConfig('setup-nginx');
  const info = runtimeOptions.nonInteractive
    ? {
        domain: requiredNonInteractive(
          'setup-nginx',
          'domain',
          getEnvValue('PANZEK_NGINX_DOMAIN', workflowConfig.domain || '')
        ),
        appPath: requiredNonInteractive(
          'setup-nginx',
          'appPath',
          getEnvValue('PANZEK_NGINX_APP_PATH', workflowConfig.appPath || '/var/www/laravel-app')
        ),
        phpVersion: requiredNonInteractive(
          'setup-nginx',
          'phpVersion',
          getEnvValue('PANZEK_NGINX_PHP_VERSION', workflowConfig.phpVersion || '8.3')
        )
      }
    : await askNginxInfo();

  renderSummary('Ringkasan Setup Nginx', [
    ['Domain', info.domain],
    ['Path App', path.resolve(info.appPath)],
    ['Nginx Root', path.join(path.resolve(info.appPath), 'public')],
    ['PHP-FPM', info.phpVersion],
    ['Mode', formatModeLabel(dryRun)]
  ]);

  const confirmed = runtimeOptions.nonInteractive
    ? true
    : await askConfirm({
        message: 'Lanjut setup Nginx?',
        initialValue: true
      });

  if (!confirmed) {
    logEvent("warn", 'Setup Nginx dibatalkan.');
    return false;
  }

  const ok = await setupNginxConfig(info, dryRun);
  if (!ok) {
    logEvent("error", 'Setup Nginx belum berhasil diselesaikan.');
    return false;
  }

  renderSummary('Setup Nginx Selesai', [
    ['Status', statusBadge('success', 'DONE')],
    ['Domain', info.domain],
    ['Config', `/etc/nginx/sites-available/${info.domain}`],
    ['Root', path.join(path.resolve(info.appPath), 'public')]
  ], successBorder);
  return true;
}

async function setupCloudflare() {
  const mode = await askRunMode();
  const dryRun = mode === 'dry-run';
  renderWorkflowHeader('Setup Cloudflare', [['Mode', formatModeLabel(dryRun)]]);

  const workflow = runtimeOptions.nonInteractive
    ? 'tunnel'
    : await askSelect({
        message: 'Pilih workflow Cloudflare',
        initialValue: 'tunnel',
        options: [
          { value: 'tunnel', label: 'Cloudflare Tunnel', hint: 'publish service tanpa IPv4 publik' },
          { value: 'back', label: 'Kembali' }
        ]
      });

  if (workflow === 'back') {
    return false;
  }

  return setupCloudflareTunnel(dryRun);
}

async function mainMenu() {
  return askSelect({
    message: 'Pilih menu utama',
    initialValue: 'deploy-laravel',
    options: [
      { value: 'deploy-laravel', label: 'Deploy Laravel', hint: 'repo + env + DB + artisan' },
      { value: 'setup-nginx', label: 'Setup Nginx', hint: 'buat dan aktifkan virtual host' },
      { value: 'setup-cloudflare', label: 'Setup Cloudflare', hint: 'cloudflared tunnel tanpa IPv4 publik' },
      { value: 'update-project', label: 'Update Project', hint: 'pilih project lalu update otomatis' },
      { value: 'setup-server', label: 'Bootstrap Server', hint: 'install dependency deploy untuk server baru' },
      { value: 'fix-permissions', label: 'Fix Permissions', hint: 'normalisasi permission standar Laravel' },
      { value: 'preflight', label: 'Preflight Check', hint: 'cek readiness tanpa eksekusi perubahan' },
      { value: 'exit', label: 'Keluar' }
    ]
  });
}

async function main() {
  appendSessionLog(`[session:start] cwd="${process.cwd()}" argv=${JSON.stringify(process.argv.slice(2))}`);
  if (outputMode === 'json') {
    renderSummary('Session Log', [
      ['File Log', sessionLogPath],
      ['Theme', runtimeOptions.theme],
      ['Output', outputMode],
      ['Color', runtimeOptions.noColor ? 'off' : 'on']
    ], infoBorder);
  } else {
    const sessionInline = [
      chalk.hex('#94a3b8')('log'),
      chalk.white(sessionLogPath),
      chalk.hex('#64748b')('|'),
      chalk.hex('#94a3b8')('theme'),
      chalk.hex('#38bdf8')(runtimeOptions.theme),
      chalk.hex('#64748b')('|'),
      chalk.hex('#94a3b8')('output'),
      chalk.hex('#fbbf24')(outputMode),
      chalk.hex('#64748b')('|'),
      chalk.hex('#94a3b8')('color'),
      chalk.white(runtimeOptions.noColor ? 'off' : 'on')
    ].join(' ');
    console.log(`${sessionInline}\n`);
  }
  executionReport.mode = runtimeOptions.dryRun ? 'dry-run' : 'normal';

  if (runtimeOptions.showHelp) {
    renderHelp();
    executionReport.success = true;
    appendSessionLog('[session:end] help');
    writeExecutionReport();
    exitWith(EXIT_CODE_SUCCESS, 'help');
  }
  if (runtimeOptions.previewTheme) {
    previewThemes();
    executionReport.success = true;
    appendSessionLog('[session:end] preview theme');
    writeExecutionReport();
    exitWith(EXIT_CODE_SUCCESS, 'preview theme');
  }

  if (runtimeOptions.nonInteractive && !runtimeOptions.action) {
    const message = 'Mode --non-interactive membutuhkan --action agar workflow bisa dijalankan tanpa menu.';
    executionReport.error = message;
    executionReport.success = false;
    writeExecutionReport();
    renderPanel('Argumen Tidak Valid', message, errorBorder);
    exitWith(EXIT_CODE_VALIDATION_ERROR, message);
  }

  if (!commandExists('git')) {
    renderPanel('Dependency Belum Tersedia', 'git belum terinstall di server ini.', errorBorder);
    executionReport.error = 'git belum terinstall';
    appendSessionLog('[session:end] missing dependency git');
    writeExecutionReport();
    exitWith(EXIT_CODE_DEPENDENCY_ERROR, 'missing git');
  }

  const runAction = async (action) => {
    executionReport.action = action;
    if (action === 'deploy-laravel') {
      return deployLaravel();
    }
    if (action === 'setup-nginx') {
      return setupNginx();
    }
    if (action === 'setup-cloudflare') {
      return setupCloudflare();
    }
    if (action === 'update-project') {
      return updateProject();
    }
    if (action === 'setup-server') {
      return setupServerDependencies();
    }
    if (action === 'fix-permissions') {
      return fixPermissionsWorkflow();
    }
    if (action === 'preflight') {
      return runPreflight();
    }
    renderOutro('Sampai jumpa.');
    executionReport.success = true;
    writeExecutionReport();
    exitWith(EXIT_CODE_SUCCESS, 'exit action');
  };

  if (runtimeOptions.action) {
    if (runtimeOptions.showBanner) {
      renderBanner();
    }
    const ok = await runAction(runtimeOptions.action);
    executionReport.success = Boolean(ok);
    renderOutro('Sampai jumpa.');
    appendSessionLog('[session:end] action mode complete');
    writeExecutionReport();
    exitWith(ok ? EXIT_CODE_SUCCESS : EXIT_CODE_ACTION_FAILED, 'action mode complete');
  }

  while (true) {
    if (runtimeOptions.showBanner) {
      renderBanner();
    }

    const action = await mainMenu();

    const ok = await runAction(action);
    executionReport.success = Boolean(ok);

    const again = await askConfirm({
      message: 'Balik ke menu utama?',
      initialValue: true
    });

    if (!again) {
      renderOutro('Sampai jumpa.');
      appendSessionLog('[session:end] user exit');
      writeExecutionReport();
      exitWith(EXIT_CODE_SUCCESS, 'user exit');
    }
  }
}

let runtimeOptions;
let runtimeConfig = {};

try {
  try {
    runtimeOptions = parseRuntimeOptions();
  } catch (error) {
    renderPanel('Argumen Tidak Valid', error.message, errorBorder);
    exitWith(EXIT_CODE_VALIDATION_ERROR, `invalid args: ${error.message}`);
  }
  outputMode = runtimeOptions.output || 'table';
  if (outputMode === 'json') {
    runtimeOptions.showBanner = false;
  }
  applyColorPolicy();
  runtimeConfig = readJsonFileSafe(runtimeOptions.configPath);
} catch (error) {
  renderPanel('Config Tidak Valid', error.message, errorBorder);
  exitWith(EXIT_CODE_VALIDATION_ERROR, `invalid config: ${error.message}`);
}

if (runtimeOptions.nonInteractive) {
  runtimeOptions.assumeYes = true;
}
if (parseBoolValue(getEnvValue('PANZEK_DRY_RUN', ''), false)) {
  runtimeOptions.dryRun = true;
  runtimeOptions.mode = 'dry-run';
}
runtimeOptions.theme = getEnvValue('PANZEK_THEME', runtimeOptions.theme || 'amber');
applyTheme(runtimeOptions.theme);

main().catch((error) => {
  executionReport.error = error.message;
  executionReport.success = false;
  writeExecutionReport();
  appendSessionLog(`[session:crash] ${error.stack || error.message}`);
  renderPanel('Unhandled Error', error.message, errorBorder);
  exitWith(EXIT_CODE_RUNTIME_ERROR, `unhandled: ${error.message}`);
});
