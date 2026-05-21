import boxen from 'boxen';
import chalk from 'chalk';
import Table from 'cli-table3';
import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import { uiTheme } from './theme.js';

function panelAppearance(borderColor) {
  if (borderColor === uiTheme.border.success) {
    return { borderStyle: 'round', titleColor: '#86efac' };
  }
  if (borderColor === uiTheme.border.error) {
    return { borderStyle: 'double', titleColor: '#fca5a5' };
  }
  if (borderColor === uiTheme.border.info) {
    return { borderStyle: 'round', titleColor: '#7dd3fc' };
  }
  return { borderStyle: 'round', titleColor: '#fcd34d' };
}

function getWrapWidth() {
  const width = process.stdout?.columns || 100;
  return Math.max(40, width - 10);
}

export function renderPanel(title, message, borderColor = uiTheme.border.default) {
  const appearance = panelAppearance(borderColor);
  const wrapped = wrapAnsi(String(message || ''), getWrapWidth(), { hard: false, trim: false });
  console.log(
    boxen(wrapped, {
      title: chalk.hex(appearance.titleColor).bold(title),
      titleAlignment: 'left',
      borderStyle: appearance.borderStyle,
      borderColor,
      padding: uiTheme.panel.padding,
      margin: uiTheme.panel.margin
    })
  );
}

export function renderSummary(title, rows, borderColor = uiTheme.border.default) {
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
    table.push([chalk.hex(uiTheme.text.muted)(String(label)), chalk.white(String(value))]);
  }
  renderPanel(title, table.toString(), borderColor);
}

export function renderSteps(title, steps) {
  const body = steps
    .map((step, index) => `${chalk.hex(uiTheme.text.accent).bold(String(index + 1).padStart(2, '0'))}  ${chalk.white(step)}`)
    .join('\n');
  renderPanel(title, body, uiTheme.border.info);
}

export function renderProjectCatalog(title, projects, { formatBranchLabel, shortenPath } = {}) {
  const width = process.stdout?.columns || 120;
  const pathCol = Math.max(26, Math.min(56, Math.floor(width * 0.34)));
  const table = new Table({
    head: [
      chalk.gray('No'),
      chalk.gray('Project'),
      chalk.gray('Tipe'),
      chalk.gray('Branch'),
      chalk.gray('Status'),
      chalk.gray('Path')
    ],
    style: { head: [], border: ['gray'], compact: true },
    wordWrap: true,
    colWidths: [4, 20, 12, 18, 18, pathCol]
  });

  projects.forEach((project, index) => {
    const branch = formatBranchLabel ? formatBranchLabel(project.branch) : project.branch || '-';
    const shortPath = shortenPath ? shortenPath(project.path, pathCol - 2) : project.path;
    table.push([
      chalk.hex(uiTheme.text.accent).bold(String(index + 1).padStart(2, '0')),
      chalk.white(project.name),
      chalk.cyan(project.profile.category),
      chalk.white(branch),
      project.dirty ? chalk.hex('#fb7185')('Ada perubahan lokal') : chalk.hex('#4ade80')('Bersih'),
      chalk.hex(uiTheme.text.muted)(shortPath)
    ]);
  });
  renderPanel(title, table.toString(), uiTheme.border.info);
}

export function fitInline(text, maxWidth = 64) {
  const input = String(text || '');
  if (stringWidth(input) <= maxWidth) return input;
  return `${input.slice(0, Math.max(0, maxWidth - 3))}...`;
}

export function renderWorkflowHeader(title, metaRows = []) {
  const meta = metaRows
    .map(([k, v]) => `${chalk.hex(uiTheme.text.muted)(k)}: ${chalk.white(String(v))}`)
    .join('  •  ');
  const body = meta ? `${chalk.bold(title)}\n${meta}` : chalk.bold(title);
  renderPanel('Workflow', body, uiTheme.border.info);
}

export function statusBadge(kind = 'info', text = '') {
  const label = String(text || '').trim();
  if (kind === 'success') return chalk.bgGreen.black(` ${label} `);
  if (kind === 'error') return chalk.bgRed.white(` ${label} `);
  if (kind === 'warn') return chalk.bgYellow.black(` ${label} `);
  return chalk.bgBlue.black(` ${label} `);
}
