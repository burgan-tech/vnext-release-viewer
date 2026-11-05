const { spawn } = require('child_process');

const DEFAULT_PATH = '/usr/local/bin:/usr/bin:/bin';

/**
 * @param {string} root - Working directory for child processes
 * @returns {{ run: Function, runKubectl: Function }}
 */
function createRun(root) {
  // opts.input: child stdin'e yazılır (ör. --password-stdin); diğer opts spawn'a geçer (timeout dahil)
  function run(cmd, args, opts = {}) {
    const { input, ...spawnOpts } = opts;
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd: spawnOpts.cwd || root,
        shell: false,
        env: { ...process.env, PATH: process.env.PATH || DEFAULT_PATH },
        ...spawnOpts,
      });
      // Buffer olarak topla: çok baytlı UTF-8 karakterleri chunk sınırında bozulmasın, büyük çıktıda string birleştirme maliyeti olmasın
      const out = [];
      const err = [];
      proc.stdout.on('data', (d) => { out.push(d); });
      proc.stderr.on('data', (d) => { err.push(d); });
      proc.on('close', (code, signal) => resolve({
        code,
        signal,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      }));
      proc.on('error', reject);
      if (input != null) proc.stdin.end(input);
      else proc.stdin.end();
    });
  }

  function runKubectl(args, opts = {}) {
    return run('kubectl', args, opts);
  }

  return { run, runKubectl };
}

module.exports = { createRun };
