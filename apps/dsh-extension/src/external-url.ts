import { spawn } from 'node:child_process';
import process from 'node:process';

export type ExternalUrlLauncher = (url: string) => Promise<void>;

export const launchExternalUrl: ExternalUrlLauncher = url =>
  new Promise((resolve, reject) => {
    const { command, args } = launchCommand(url);
    const child = spawn(command, args, {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          code === null
            ? `${command} exited with signal ${signal ?? 'unknown'}`
            : `${command} exited with status ${code}`,
        ),
      );
    });
  });

export function launchCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === 'darwin') {
    return { command: 'open', args: [url] };
  }
  if (platform === 'win32') {
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  }
  return { command: 'xdg-open', args: [url] };
}
