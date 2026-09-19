import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { launchCommand, launchExternalUrl } from '../src/external-url.js';

const subprocess = vi.hoisted(() => ({
  spawn: vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(),
}));

vi.mock('node:child_process', () => subprocess);

function childProcess(): ChildProcess {
  return new EventEmitter() as ChildProcess;
}

describe('launchExternalUrl', () => {
  beforeEach(() => {
    subprocess.spawn.mockReset();
  });

  it('waits for a successful launcher exit', async () => {
    subprocess.spawn.mockImplementation(() => {
      const child = childProcess();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });

    await expect(launchExternalUrl('https://manifoldcad.org/#model')).resolves.toBeUndefined();
    expect(subprocess.spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), {
      stdio: 'ignore',
      windowsHide: true,
    });
  });

  it('propagates launcher spawn and exit failures', async () => {
    subprocess.spawn.mockImplementationOnce(() => {
      const child = childProcess();
      queueMicrotask(() => child.emit('error', new Error('cannot open')));
      return child;
    });
    await expect(launchExternalUrl('https://manifoldcad.org/#spawn')).rejects.toThrow('cannot open');

    subprocess.spawn.mockImplementationOnce(() => {
      const child = childProcess();
      queueMicrotask(() => child.emit('exit', 4, null));
      return child;
    });
    await expect(launchExternalUrl('https://manifoldcad.org/#exit')).rejects.toThrow(/exited with status 4/);
  });

  it('passes near-limit Windows URLs without command encoding', () => {
    const url = `https://manifoldcad.org/#${'x'.repeat(31_900)}`;

    expect(launchCommand(url, 'win32')).toEqual({
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', url],
    });
  });
});
