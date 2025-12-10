import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class OpenCodeService {
    /**
     * Runs an OpenCode agent task in the specified working directory.
     * @param task The natural language task description.
     * @param cwd The directory where the agent should operate.
     * @returns The stdout output of the agent.
     */
    static async runTask(task: string, cwd: string): Promise<string> {
        try {
            console.log(`[OpenCode] Starting task in ${cwd}: "${task}"`);

            // Escape the task string to prevent shell injection, though basic quotes help.
            // A more robust solution might use spawn or thorough escaping.
            const safeTask = task.replace(/"/g, '\\"');

            const model = process.env.OPENCODE_MODEL ? ` --model ${process.env.OPENCODE_MODEL}` : '';
            const command = `opencode run "${safeTask}"${model}`;

            const { stdout, stderr } = await execAsync(command, {
                cwd,
                env: { ...process.env }, // Pass through env vars just in case
            });

            if (stderr) {
                console.warn(`[OpenCode] Stderr: ${stderr}`);
            }

            console.log(`[OpenCode] Task completed successfully.`);
            return stdout;
        } catch (error: any) {
            console.error(`[OpenCode] Execution failed:`, error);
            throw new Error(`OpenCode task failed: ${error.message}`);
        }
    }
}
