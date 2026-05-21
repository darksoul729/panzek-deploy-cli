import path from 'path';

export const allowedActions = new Set([
  'deploy-laravel',
  'setup-nginx',
  'setup-cloudflare',
  'update-project',
  'setup-server',
  'fix-permissions',
  'preflight',
  'exit'
]);
export const allowedThemes = new Set(['amber', 'ocean', 'mono', 'auto']);
export const allowedOutputModes = new Set(['table', 'json']);

export function parseRuntimeOptions(argv = process.argv.slice(2)) {
  const options = {
    action: null,
    dryRun: false,
    mode: '',
    assumeYes: false,
    showBanner: true,
    showHelp: false,
    nonInteractive: false,
    configPath: path.resolve('panzek.config.json'),
    reportJsonPath: '',
    maxRetries: 3,
    theme: 'amber',
    previewTheme: false,
    noColor: false,
    output: 'table'
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      options.showHelp = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      options.mode = 'dry-run';
      continue;
    }

    if (arg === '--mode') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Flag --mode membutuhkan nilai: normal atau dry-run.');
      }
      if (!['normal', 'dry-run'].includes(value)) {
        throw new Error(`Mode tidak valid: ${value}`);
      }
      options.mode = value;
      options.dryRun = value === 'dry-run';
      i += 1;
      continue;
    }

    if (arg === '--max-retries') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Flag --max-retries membutuhkan angka >= 0.');
      }
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        throw new Error('Nilai --max-retries harus angka bulat >= 0.');
      }
      options.maxRetries = parsed;
      i += 1;
      continue;
    }
    if (arg === '--theme') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Flag --theme membutuhkan nilai: amber, ocean, mono, atau auto.');
      }
      if (!allowedThemes.has(value)) {
        throw new Error(`Theme tidak valid: ${value}`);
      }
      options.theme = value;
      i += 1;
      continue;
    }
    if (arg === '--preview-theme') {
      options.previewTheme = true;
      continue;
    }
    if (arg === '--output') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Flag --output membutuhkan nilai: table atau json.');
      }
      if (!allowedOutputModes.has(value)) {
        throw new Error(`Output tidak valid: ${value}`);
      }
      options.output = value;
      i += 1;
      continue;
    }
    if (arg === '--no-color') {
      options.noColor = true;
      continue;
    }

    if (arg === '--yes' || arg === '-y') {
      options.assumeYes = true;
      continue;
    }

    if (arg === '--no-banner') {
      options.showBanner = false;
      continue;
    }

    if (arg === '--non-interactive') {
      options.nonInteractive = true;
      continue;
    }

    if (arg === '--config') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Flag --config membutuhkan nilai path file JSON.');
      }
      options.configPath = path.resolve(value);
      i += 1;
      continue;
    }

    if (arg === '--report-json') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Flag --report-json membutuhkan path output JSON.');
      }
      options.reportJsonPath = path.resolve(value);
      i += 1;
      continue;
    }

    if (arg === '--action' || arg === '-a') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Flag --action membutuhkan nilai.');
      }
      if (!allowedActions.has(value)) {
        throw new Error(`Action tidak valid: ${value}`);
      }
      options.action = value;
      i += 1;
      continue;
    }

    throw new Error(`Argumen tidak dikenal: ${arg}`);
  }

  return options;
}
