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
  spinner as createSpinner,
  text as clackText
} from '@clack/prompts';
import chalk from 'chalk';
import boxen from 'boxen';
import { execSync, spawnSync } from 'child_process';
import Table from 'cli-table3';
import fs from 'fs';
import gradient from 'gradient-string';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const brandGradient = gradient(['#ff7a18', '#ffb347', '#ffd166']);
const panelBorder = '#f59e0b';
const successBorder = '#22c55e';
const errorBorder = '#ef4444';
const infoBorder = '#38bdf8';
const textMuted = '#94a3b8';

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

function getPanelAppearance(borderColor) {
  if (borderColor === successBorder) {
    return {
      borderStyle: 'round',
      titleColor: '#86efac',
      padding: { top: 0, right: 1, bottom: 0, left: 1 },
      margin: { top: 1, right: 0, bottom: 1, left: 0 }
    };
  }

  if (borderColor === errorBorder) {
    return {
      borderStyle: 'double',
      titleColor: '#fca5a5',
      padding: { top: 0, right: 1, bottom: 0, left: 1 },
      margin: { top: 1, right: 0, bottom: 1, left: 0 }
    };
  }

  if (borderColor === infoBorder) {
    return {
      borderStyle: 'round',
      titleColor: '#7dd3fc',
      padding: { top: 0, right: 1, bottom: 0, left: 1 },
      margin: { top: 1, right: 0, bottom: 1, left: 0 }
    };
  }

  return {
    borderStyle: 'round',
    titleColor: '#fcd34d',
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
    margin: { top: 1, right: 0, bottom: 1, left: 0 }
  };
}

function renderBanner() {
  const ascii = `
██████╗  █████╗ ███╗   ██╗███████╗███████╗██╗  ██╗
██╔══██╗██╔══██╗████╗  ██║╚══███╔╝██╔════╝██║ ██╔╝
██████╔╝███████║██╔██╗ ██║  ███╔╝ █████╗  █████╔╝ 
██╔═══╝ ██╔══██║██║╚██╗██║ ███╔╝  ██╔══╝  ██╔═██╗ 
██║     ██║  ██║██║ ╚████║███████╗███████╗██║  ██╗ 
╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝╚═╝  ╚═╝ 

██████╗ ███████╗██████╗ ██╗      ██████╗ ██╗   ██╗
██╔══██╗██╔════╝██╔══██╗██║     ██╔═══██╗╚██╗ ██╔╝
██║  ██║█████╗  ██████╔╝██║     ██║   ██║ ╚████╔╝ 
██║  ██║██╔══╝  ██╔═══╝ ██║     ██║   ██║  ╚██╔╝  
██████╔╝███████╗██║     ███████╗╚██████╔╝   ██║   
╚═════╝ ╚══════╝╚═╝     ╚══════╝ ╚═════╝    ╚═╝   
`.trim();

  const body = [
    brandGradient.multiline(ascii),
    '',
    chalk.gray('Deploy Laravel, siapkan database, atur Nginx, dan publish tunnel dari satu CLI.')
  ].join('\n');

  console.log(
    boxen(body, {
      title: chalk.hex('#ffd166')('Panzek Deploy CLI'),
      titleAlignment: 'center',
      borderStyle: 'round',
      borderColor: panelBorder,
      padding: { top: 0, right: 2, bottom: 0, left: 2 },
      margin: { top: 0, right: 0, bottom: 2, left: 0 }
    })
  );
}

function renderPanel(title, message, borderColor = panelBorder) {
  const appearance = getPanelAppearance(borderColor);

  console.log(
    boxen(message, {
      title: chalk.hex(appearance.titleColor).bold(title),
      titleAlignment: 'left',
      borderStyle: appearance.borderStyle,
      borderColor,
      padding: appearance.padding,
      margin: appearance.margin
    })
  );
}

function renderSummary(title, rows, borderColor = panelBorder) {
  const table = new Table({
    style: {
      head: [],
      border: ['gray'],
      compact: true,
      'padding-left': 1,
      'padding-right': 1
    },
    chars: {
      top: '',
      'top-mid': '',
      'top-left': '',
      'top-right': '',
      bottom: '',
      'bottom-mid': '',
      'bottom-left': '',
      'bottom-right': '',
      left: '',
      'left-mid': '',
      mid: '',
      'mid-mid': '',
      right: '',
      'right-mid': '',
      middle: '  '
    }
  });

  for (const [label, value] of rows) {
    table.push([chalk.hex(textMuted)(label), chalk.white(String(value))]);
  }

  renderPanel(title, table.toString(), borderColor);
}

function renderSteps(title, steps) {
  const body = steps
    .map((step, index) => `${chalk.hex('#fbbf24').bold(String(index + 1).padStart(2, '0'))}  ${chalk.white(step)}`)
    .join('\n');

  renderPanel(title, body, infoBorder);
}

function renderProjectCatalog(title, projects) {
  const table = new Table({
    head: [
      chalk.gray('No'),
      chalk.gray('Project'),
      chalk.gray('Tipe'),
      chalk.gray('Branch'),
      chalk.gray('Status'),
      chalk.gray('Path')
    ],
    style: {
      head: [],
      border: ['gray'],
      compact: true
    },
    wordWrap: true,
    colWidths: [4, 20, 12, 18, 18, 44]
  });

  projects.forEach((project, index) => {
    table.push([
      chalk.hex('#fbbf24').bold(String(index + 1).padStart(2, '0')),
      chalk.white(project.name),
      chalk.cyan(project.profile.category),
      chalk.white(formatBranchLabel(project.branch)),
      project.dirty ? chalk.hex('#fb7185')('Ada perubahan lokal') : chalk.hex('#4ade80')('Bersih'),
      chalk.hex(textMuted)(shortenPath(project.path, 42))
    ]);
  });

  renderPanel(title, table.toString(), infoBorder);
}

function promptCancelled() {
  clackCancel('Workflow dibatalkan.');
  process.exit(0);
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
  const input = String(value || '').trim();
  const hostnameRegex = /^(?:\*\.)?(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/;
  const ipv4Regex = /^(?:\d{1,3}\.){3}\d{1,3}$/;

  if (!input) {
    return 'Domain wajib diisi';
  }

  if (/[\/\s]/.test(input)) {
    return 'Domain tidak boleh mengandung spasi atau slash';
  }

  if (!hostnameRegex.test(input) && !ipv4Regex.test(input)) {
    return 'Format domain tidak valid';
  }

  return undefined;
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
    `${chalk.gray('Tahap')}      ${context.title}`,
    `${chalk.gray('Command')}    ${result.command}`,
    `${chalk.gray('Folder')}     ${result.cwd}`,
    `${chalk.gray('Exit Code')}  ${result.code ?? '-'}`,
    context.phase ? `${chalk.gray('Fase')}       ${context.phase}` : null
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
  if (dryRun) {
    log.info(chalk.yellow(`[dry-run] (${cwd}) ${command}`));
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

  const spinner = createSpinner();
  spinner.start(`Menjalankan: ${command}`);

  if (options.interactive) {
    try {
      execSync(command, {
        cwd,
        stdio: 'inherit',
        shell: true
      });
      spinner.stop(chalk.green(`Berhasil: ${command}`));
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
      spinner.error(chalk.red(`Gagal: ${command}`));
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

  spinner.clear();

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
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
    spinner.stop(chalk.green(`Berhasil: ${command}`));
  } else {
    spinner.error(chalk.red(`Gagal: ${command}`));
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
  while (true) {
    const resolvedCommand = typeof command === 'function' ? command() : command;
    const result = executeCommand(resolvedCommand, cwd, dryRun, { interactive });

    if (result.ok) {
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
        { value: 'retry', label: 'Coba lagi', hint: 'ulang langkah ini' },
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
      continue;
    }

    const extraAction = extraActions.find((item) => item.value === action);
    if (extraAction) {
      await extraAction.handler(result);
      continue;
    }

    if (action === 'exit') {
      outro('Sampai jumpa.');
      process.exit(1);
    }

    return result;
  }
}

function commandExists(command) {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
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
    command: `sudo chown -R ${username}:${groupName} "${appPath}"`,
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
      ? `sudo git clone -b ${branch} ${repo} "${resolvedTarget}"`
      : `git clone -b ${branch} ${repo} "${resolvedTarget}"`;

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
    log.error(`Folder target ada tapi bukan repository git: ${resolvedTarget}`);
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
    command: `git checkout ${branch}`,
    cwd: resolvedTarget,
    dryRun: false,
    phase: 'repository',
    message: `Gagal checkout ke branch ${branch}.`
  });
  if (!result.ok) return { ok: false, cwd: resolvedTarget };

  result = await runCommandWithHandling({
    title: 'Pull Repository',
    command: `git pull origin ${branch}`,
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
    log.info(chalk.yellow(`[dry-run] cek/generate .env di ${envPath}`));
    return true;
  }

  try {
    if (!fs.existsSync(envPath) && fs.existsSync(exampleEnvPath)) {
      fs.copyFileSync(exampleEnvPath, envPath);
      log.success('.env dibuat dari .env.example');
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
    log.info(chalk.yellow(`[dry-run] set ${key}="${value}" di ${envPath}`));
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
          log.info(chalk.yellow(`[dry-run] buat folder ${fullPath}`));
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
  const input = String(value || '').trim();

  if (!input) {
    return 'Nama tunnel wajib diisi';
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input)) {
    return 'Nama tunnel hanya boleh berisi huruf, angka, titik, underscore, atau dash';
  }

  return undefined;
}

function validateUrl(value, label = 'URL') {
  const input = String(value || '').trim();

  if (!input) {
    return `${label} wajib diisi`;
  }

  try {
    const parsed = new URL(input);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return `${label} harus memakai http:// atau https://`;
    }
  } catch {
    return `${label} tidak valid`;
  }

  return undefined;
}

function validateCloudflareHostname(value) {
  const domainValidation = validateDomain(value);
  if (domainValidation) {
    return domainValidation;
  }

  const input = String(value || '').trim();
  if (!input.includes('.')) {
    return 'Hostname publik harus berupa subdomain atau domain penuh';
  }

  return undefined;
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
      log.error('mysql/mariadb client belum terinstall.');
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
    log.error(`Gagal membuat file config sementara: ${error.message}`);
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

    log.success(`Config Nginx aktif di ${availablePath}`);
    return true;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function askRunMode() {
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
  log.info('Masukkan langkah custom. Kosongkan input untuk selesai.');

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
    command: `cloudflared tunnel create ${info.tunnelName}`,
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
  if (!commandExists('cloudflared')) {
    renderPanel(
      'Dependency Belum Tersedia',
      'cloudflared belum terinstall. Install cloudflared terlebih dahulu sebelum membuat Cloudflare Tunnel.',
      errorBorder
    );
    return;
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

  const confirmed = await askConfirm({
    message: 'Lanjut setup Cloudflare Tunnel?',
    initialValue: true
  });

  if (!confirmed) {
    log.warn('Setup Cloudflare Tunnel dibatalkan.');
    return;
  }

  if (info.runLogin) {
    const loginOk = await ensureCloudflaredLogin(dryRun);
    if (!loginOk) {
      log.error('Login Cloudflare Tunnel gagal.');
      return;
    }
  }

  const tunnelData = await createCloudflareTunnel(info, dryRun);
  if (!tunnelData.ok) {
    log.error('Cloudflare Tunnel tidak berhasil dibuat.');
    return;
  }

  const configOk = writeCloudflaredConfig(info, tunnelData, dryRun);
  if (!configOk) {
    log.error('Config cloudflared tidak berhasil ditulis.');
    return;
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
    log.error('Validasi ingress cloudflared gagal.');
    return;
  }

  const dnsOk = await runCommandWithHandling({
    title: 'Membuat DNS Route Tunnel',
    command: `cloudflared tunnel route dns ${tunnelData.tunnelId} ${info.hostname}`,
    cwd: process.cwd(),
    dryRun,
    phase: 'cloudflare',
    message: 'DNS route untuk hostname tunnel gagal dibuat.'
  });

  if (!dnsOk.ok) {
    log.error('DNS route Cloudflare Tunnel gagal.');
    return;
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
      log.error('Install service cloudflared gagal.');
      return;
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
      log.error('Start service cloudflared gagal.');
      return;
    }
  }

  renderSummary('Cloudflare Tunnel Siap', [
    ['Nama Tunnel', info.tunnelName],
    ['Tunnel ID', tunnelData.tunnelId],
    ['Hostname', info.hostname],
    ['Service Lokal', info.serviceUrl],
    ['Path Config', info.configPath],
    ['Command Manual', `cloudflared tunnel --config "${info.configPath}" run ${tunnelData.tunnelId}`]
  ], successBorder);

  note(
    [
      'Tunnel ini tidak membutuhkan IPv4 publik.',
      info.installService
        ? 'cloudflared sudah diinstall dan dijalankan sebagai service.'
        : `Jalankan manual: cloudflared tunnel --config "${info.configPath}" run ${tunnelData.tunnelId}`
    ].join('\n'),
    'Cloudflare Tunnel'
  );
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
    log.error('Ownership project belum berhasil disiapkan.');
    return false;
  }

  if (project.profile.hasArtisan) {
    const envReady = prepareLaravelEnv(appPath, dryRun);
    if (!envReady) {
      log.error('File .env belum berhasil disiapkan.');
      return false;
    }
  }

  for (let i = 0; i < gitCommands.length; i++) {
    log.step(`Sinkronisasi Git ${i + 1}/${gitCommands.length}: ${gitCommands[i]}`);
    const result = await runCommandWithHandling({
      title: `Sinkronisasi Git ${i + 1}/${gitCommands.length}`,
      command: gitCommands[i],
      cwd: appPath,
      dryRun,
      phase: 'repository',
      message: 'Sinkronisasi repository belum berhasil dijalankan.'
    });

    if (!result.ok) {
      log.error(`Update repository berhenti di langkah: ${gitCommands[i]}`);
      return false;
    }
  }

  for (let i = 0; i < project.profile.installSteps.length; i++) {
    const step = project.profile.installSteps[i];
    log.step(`Langkah update ${i + 1}/${project.profile.installSteps.length}: ${step}`);

    const result = await runCommandWithHandling({
      title: `Langkah Update ${i + 1}/${project.profile.installSteps.length}`,
      command: step,
      cwd: appPath,
      dryRun,
      phase: 'update',
      message: 'Langkah update project ini belum berhasil dijalankan.'
    });

    if (!result.ok) {
      log.error(`Update project berhenti di langkah: ${step}`);
      return false;
    }
  }

  for (let i = 0; i < project.profile.postSteps.length; i++) {
    const step = project.profile.postSteps[i];
    log.step(`Tahap akhir ${i + 1}/${project.profile.postSteps.length}: ${step}`);

    const result = await runCommandWithHandling({
      title: `Tahap Akhir ${i + 1}/${project.profile.postSteps.length}`,
      command: step,
      cwd: appPath,
      dryRun,
      phase: 'post-update',
      message: 'Tahap akhir project ini belum berhasil dijalankan.'
    });

    if (!result.ok) {
      log.error(`Tahap akhir project gagal dijalankan: ${step}`);
      return false;
    }
  }

  if (project.profile.hasArtisan || project.profile.hasLaravelDirs) {
    const permissionOk = await applyLaravelPermissions(appPath, dryRun);
    if (!permissionOk) {
      log.error('Permission Laravel belum berhasil diterapkan.');
      return false;
    }
  }

  renderSummary('Update Project Selesai', [
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
  const projects = findManagedProjects();
  const searchRoots = getProjectSearchRoots();

  if (projects.length === 0) {
    renderPanel(
      'Project Belum Ditemukan',
      `Belum ada project git yang terdeteksi.\n\nLokasi yang dicek:\n${searchRoots.join('\n')}`,
      infoBorder
    );
    return;
  }

  renderSummary('Sumber Pencarian Project', [
    ['Jumlah Project', projects.length],
    ['Lokasi Scan', searchRoots.join(', ')],
    ['Mode', formatModeLabel(dryRun)]
  ], infoBorder);

  const selectedPath = await askProjectToUpdate(projects);
  const project = projects.find((item) => item.path === selectedPath);

  if (!project) {
    log.error('Project yang dipilih tidak ditemukan lagi.');
    return;
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
    note(
      'Project ini punya perubahan lokal yang belum bersih. Jika update gagal saat pull, rapikan commit atau stash lebih dulu.',
      'Perhatian'
    );
  }

  const confirmed = await askConfirm({
    message: 'Lanjut update project ini?',
    initialValue: true
  });

  if (!confirmed) {
    log.warn('Update project dibatalkan.');
    return;
  }

  await updateGitProject(project, dryRun);
}

async function deployLaravel() {
  const mode = await askRunMode();
  const dryRun = mode === 'dry-run';
  const info = await askLaravelInfo();
  const steps = await askUseDefaultSteps(getLaravelDefaultSteps());
  const dbSetup = await askDatabaseSetup(info.targetDir);

  if (steps.length === 0) {
    log.error('Tidak ada langkah deploy. Workflow dibatalkan.');
    return;
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

  const confirmed = await askConfirm({
    message: 'Lanjut deploy Laravel?',
    initialValue: true
  });

  if (!confirmed) {
    log.warn('Deploy Laravel dibatalkan.');
    return;
  }

  const repoSetup = await ensureGitRepo(info.repo, info.branch, info.targetDir, dryRun);
  if (!repoSetup.ok) {
    log.error('Repository belum berhasil disiapkan.');
    return;
  }

  const appPath = repoSetup.cwd;

  const envReady = prepareLaravelEnv(appPath, dryRun);
  if (!envReady) {
    log.error('File .env belum berhasil disiapkan.');
    return;
  }

  for (let i = 0; i < steps.length; i++) {
    log.step(`Langkah ${i + 1}/${steps.length}: ${steps[i]}`);

    const result = await runCommandWithHandling({
      title: `Langkah ${i + 1}/${steps.length}`,
      command: steps[i],
      cwd: appPath,
      dryRun,
      phase: 'deploy',
      message: 'Langkah deploy Laravel ini belum berhasil dijalankan.'
    });

    if (!result.ok) {
      log.error(`Deploy berhenti di langkah ${i + 1}: ${steps[i]}`);
      return;
    }
  }

  if (dbSetup.enabled) {
    if (!getMysqlClientCommand()) {
      log.error('Client mysql/mariadb belum tersedia, jadi setup database tidak bisa dilanjutkan.');
      return;
    }

    log.step('Menyiapkan database MySQL/MariaDB...');

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
      log.error('Database atau user MySQL belum berhasil dibuat.');
      return;
    }

    const envDbOk = updateLaravelDbEnv(appPath, dbSetup, dryRun);
    if (!envDbOk) {
      log.error('Konfigurasi database di .env belum berhasil diperbarui.');
      return;
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
    log.step(`Tahap akhir ${i + 1}/${postSteps.length}: ${postSteps[i]}`);
    const result = await runCommandWithHandling({
      title: `Tahap Akhir ${i + 1}/${postSteps.length}`,
      command: postSteps[i],
      cwd: appPath,
      dryRun,
      phase: 'post-deploy',
      message: 'Tahap akhir Laravel ini belum berhasil dijalankan.'
    });
    if (!result.ok) {
      log.error(`Tahap akhir Laravel gagal dijalankan: ${postSteps[i]}`);
      return;
    }
  }

  const permissionOk = await applyLaravelPermissions(appPath, dryRun);
  if (!permissionOk) {
    log.error('Permission Laravel belum berhasil diterapkan.');
    return;
  }

  renderSummary('Deploy Laravel Selesai', [
    ['Folder Aplikasi', appPath],
    ['Nginx Root', path.join(appPath, 'public')],
    ['Mode', formatModeLabel(dryRun)]
  ], successBorder);

  if (dbSetup.enabled) {
    renderSummary('Kredensial Database', [
      ['Database', dbSetup.dbName],
      ['Username', dbSetup.dbUser],
      ['Password', dbSetup.dbPassword],
      ['Host', dbSetup.dbHost],
      ['Port', dbSetup.dbPort]
    ], successBorder);
    note('Simpan kredensial ini dengan aman sebelum lanjut ke server produksi.', 'Catatan');
  }
}

async function setupNginx() {
  const mode = await askRunMode();
  const dryRun = mode === 'dry-run';
  const info = await askNginxInfo();

  renderSummary('Ringkasan Setup Nginx', [
    ['Domain', info.domain],
    ['Path App', path.resolve(info.appPath)],
    ['Nginx Root', path.join(path.resolve(info.appPath), 'public')],
    ['PHP-FPM', info.phpVersion],
    ['Mode', formatModeLabel(dryRun)]
  ]);

  const confirmed = await askConfirm({
    message: 'Lanjut setup Nginx?',
    initialValue: true
  });

  if (!confirmed) {
    log.warn('Setup Nginx dibatalkan.');
    return;
  }

  const ok = await setupNginxConfig(info, dryRun);
  if (!ok) {
    log.error('Setup Nginx belum berhasil diselesaikan.');
    return;
  }

  renderSummary('Setup Nginx Selesai', [
    ['Domain', info.domain],
    ['Config', `/etc/nginx/sites-available/${info.domain}`],
    ['Root', path.join(path.resolve(info.appPath), 'public')]
  ], successBorder);
}

async function setupCloudflare() {
  const mode = await askRunMode();
  const dryRun = mode === 'dry-run';

  const workflow = await askSelect({
    message: 'Pilih workflow Cloudflare',
    initialValue: 'tunnel',
    options: [
      { value: 'tunnel', label: 'Cloudflare Tunnel', hint: 'publish service tanpa IPv4 publik' },
      { value: 'back', label: 'Kembali' }
    ]
  });

  if (workflow === 'back') {
    return;
  }

  await setupCloudflareTunnel(dryRun);
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
      { value: 'exit', label: 'Keluar' }
    ]
  });
}

async function main() {
  if (!commandExists('git')) {
    renderPanel('Dependency Belum Tersedia', 'git belum terinstall di server ini.', errorBorder);
    process.exit(1);
  }

  while (true) {
    renderBanner();

    const action = await mainMenu();

    if (action === 'deploy-laravel') {
      await deployLaravel();
    } else if (action === 'setup-nginx') {
      await setupNginx();
    } else if (action === 'setup-cloudflare') {
      await setupCloudflare();
    } else if (action === 'update-project') {
      await updateProject();
    } else {
      outro('Sampai jumpa.');
      process.exit(0);
    }

    const again = await askConfirm({
      message: 'Balik ke menu utama?',
      initialValue: true
    });

    if (!again) {
      outro('Sampai jumpa.');
      process.exit(0);
    }
  }
}

main().catch((error) => {
  renderPanel('Unhandled Error', error.message, errorBorder);
  process.exit(1);
});
