// Isolated supervisor: the server never receives Electron's renderer IPC.
// On parent loss, request the game's normal save/stop procedure.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
let server: ChildProcessWithoutNullStreams | undefined;
let stopping = false;
const systemKeys = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'SYSTEMDRIVE',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'COMMONPROGRAMFILES',
  'COMSPEC',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
]);
function stop() {
  if (!server || stopping) return;
  stopping = true;
  server.stdin.write(
    `${process.env.GAMEHUB_STOP === 'native' ? '__GAMEHUB_STOP__' : process.env.GAMEHUB_STOP === 'stop' ? 'stop' : 'exit'}\n`,
  );
}
process.on(
  'message',
  (message: {
    type: string;
    executable?: string;
    args?: string[];
    cwd?: string;
    command?: string;
  }) => {
    if (message.type === 'start' && !server) {
      const gameEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => systemKeys.has(key.toUpperCase())),
      );
      server = spawn(message.executable!, message.args!, {
        cwd: message.cwd,
        windowsHide: true,
        shell: false,
        stdio: 'pipe',
        env: gameEnv,
      });
      const send = (msg: unknown) => {
        if (process.connected) process.send?.(msg);
      };
      server.once('spawn', () => {
        if (process.env.GAMEHUB_STOP !== 'native') send({ type: 'pid', pid: server!.pid });
      });
      for (const [streamName, stream] of [
        ['out', server.stdout],
        ['error', server.stderr],
      ] as const) {
        const decoder = new StringDecoder('utf8');
        let pending = '';
        let suppress = false;
        const consume = (text: string) => {
          for (const part of text.split(/(?<=\n)/)) {
            if (!suppress) pending += part;
            if (pending.length > 65536) {
              pending = '';
              suppress = true;
            }
            if (part.endsWith('\n')) {
              if (
                process.env.GAMEHUB_STOP === 'native' &&
                /^__GAMEHUB_PID__\d+\s*$/.test(pending)
              ) {
                send({ type: 'pid', pid: Number(pending.slice(15).trim()) });
                pending = '';
                suppress = false;
                continue;
              }
              send({
                type: 'log',
                stream: streamName,
                text: suppress ? '[oversized log line suppressed]' : pending,
              });
              pending = '';
              suppress = false;
            }
          }
        };
        stream.on('data', (chunk) => consume(decoder.write(chunk)));
        stream.on('end', () => {
          consume(decoder.end());
          if (pending && !suppress) send({ type: 'log', stream: streamName, text: pending });
        });
      }
      server.stdin.on('error', () => {});
      server.once('error', () => {
        send({ type: 'failed' });
        process.exitCode = 1;
      });
      server.once('close', (code) => {
        send({ type: 'exit', code });
        process.exit(code ?? 1);
      });
    } else if (message.type === 'stop') stop();
    else if (message.type === 'command' && server && !stopping)
      server.stdin.write(message.command + '\n');
  },
);
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
