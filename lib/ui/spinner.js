import ora from 'ora';
import chalk from 'chalk';
import logSymbols from 'log-symbols';

export function createTaskSpinner(text) {
  const spinner = ora({
    text,
    discardStdin: false,
    isEnabled: Boolean(process.stdout.isTTY)
  }).start();

  return {
    clear() {
      spinner.stop();
    },
    stopSuccess(message) {
      spinner.succeed(`${logSymbols.success} ${chalk.green(message)}`);
    },
    stopError(message) {
      spinner.fail(`${logSymbols.error} ${chalk.red(message)}`);
    }
  };
}
