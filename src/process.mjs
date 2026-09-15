import { spawn } from 'node:child_process';

export function run(command, args = [], options = {}) {
  const printable = [command, ...args].map(value => /\s/.test(value) ? JSON.stringify(value) : value).join(' ');
  if (!options.quiet) console.log(`$ ${printable}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      shell: false
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve({ code, stdout, stderr });
      else reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

export async function capture(command, args = [], options = {}) {
  return run(command, args, { ...options, quiet: true, stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
}
