import { spawn } from 'node:child_process';
import process from 'node:process';

export type ExternalUrlLauncher = (url: string) => Promise<void>;

export const launchExternalUrl: ExternalUrlLauncher = url =>
  new Promise((resolve, reject) => {
    const { command, args } = launchCommand(url);
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

function launchCommand(url: string): { command: string; args: string[] } {
  if (process.platform === 'darwin') {
    return { command: 'open', args: [url] };
  }
  if (process.platform === 'win32') {
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  }
  return { command: 'xdg-open', args: [url] };
}
