import { spawn } from 'child_process';

export class OpenCodeService {
    /**
     * Runs an OpenCode agent task in the specified working directory.
     * @param task The natural language task description.
     * @param cwd The directory where the agent should operate.
     * @returns The stdout output of the agent.
     */
    static async runTask(task: string, cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            console.log(`[OpenCode] Starting task in ${cwd}: "${task}"`);

            const model = process.env.OPENCODE_MODEL ? ['--model', process.env.OPENCODE_MODEL] : [];
            // Construct arguments: run "task" --model ...
            const args = ['run', task, ...model];

            const child = spawn('opencode', args, {
                cwd,
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe'] // Ignore stdin, pipe stdout/stderr
            });

            let stdout = '';
            let stderr = '';

            if (child.stdout) {
                child.stdout.on('data', (data) => {
                    const chunk = data.toString();
                    stdout += chunk;
                    // Stream to console
                    process.stdout.write(`[OpenCode Output] ${chunk}`);
                });
            }

            if (child.stderr) {
                child.stderr.on('data', (data) => {
                    const chunk = data.toString();
                    stderr += chunk;
                    // Stream to console
                    process.stderr.write(`[OpenCode Error] ${chunk}`);
                });
            }

            child.on('error', (error) => {
                console.error(`[OpenCode] Spawn error:`, error);
                reject(new Error(`Failed to start opencode process: ${error.message}`));
            });

            child.on('close', (code) => {
                console.log(`[OpenCode] Process exited with code ${code}`);
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`OpenCode task failed with exit code ${code}. Stderr: ${stderr}`));
                }
            });
        });
    }
}
