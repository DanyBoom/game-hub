import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
test('supervisor streams a real child process and requests a saving stop', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-process-'));
  let worker: ReturnType<typeof fork> | undefined;
  try {
    const runner = path.join(dir, 'runner.cjs');
    await build({
      entryPoints: ['electron/runner.ts'],
      outfile: runner,
      bundle: true,
      platform: 'node',
    });
    const fixture = path.join(dir, 'fixture.cjs');
    await fs.writeFile(
      fixture,
      "process.stdout.write('ready\\n');process.stdin.on('data',chunk=>{if(chunk.toString().trim()==='stop'){require('fs').writeFileSync('saved.txt','saved');process.stdout.write('saved\\n');process.exit(0);}});",
    );
    worker = fork(runner, [], {
      env: { ...process.env, GAMEHUB_STOP: 'stop' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const messages: any[] = [];
    let stopSent = false;
    const exited = new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Child timed out')), 10000);
      worker!.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      worker!.on('message', (message: any) => {
        messages.push(message);
        if (message.type === 'log' && message.text.includes('ready') && !stopSent) {
          stopSent = true;
          worker!.send({ type: 'stop' });
        }
      });
    });
    worker.send({ type: 'start', executable: process.execPath, args: [fixture], cwd: dir });
    assert.equal(await exited, 0);
    assert.ok(messages.some((m) => m.type === 'pid' && m.pid > 0));
    assert.equal(await fs.readFile(path.join(dir, 'saved.txt'), 'utf8'), 'saved');
  } finally {
    if (worker && !worker.killed) worker.kill();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
