import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
test(
  'Windows console host delivers real console input and a saving exit',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-console-'));
    try {
      const compiler = path.join(
          process.env.WINDIR ?? 'C:\\Windows',
          'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
        ),
        host = path.join(root, 'host.exe'),
        fixture = path.join(root, 'fixture.exe'),
        source = path.join(root, 'fixture.cs');
      await fs.writeFile(
        source,
        'using System;class Fixture{static int Main(){Console.WriteLine("ready");string line="";while(true){char c=Console.ReadKey(true).KeyChar;if(c==\'\\r\'){if(line=="exit"){Console.WriteLine("saved");return 0;}line="";}else line+=c;}}}',
      );
      execFileSync(compiler, ['/nologo', '/out:' + host, path.resolve('native/ConsoleHost.cs')], {
        windowsHide: true,
      });
      execFileSync(compiler, ['/nologo', '/out:' + fixture, source], { windowsHide: true });
      const child = spawn(host, ['--console-input', fixture], { stdio: 'pipe', windowsHide: true });
      let output = '';
      let sent = false;
      const timer = setTimeout(() => child.kill(), 8000);
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        if (!sent && output.includes('ready')) {
          sent = true;
          child.stdin.write('exit\n');
        }
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      clearTimeout(timer);
      assert.equal(code, 0);
      assert.match(output, /saved/);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
);
