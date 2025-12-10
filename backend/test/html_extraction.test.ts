
import { extractHtmlFromText } from '../src/generator/utils';

// Simple assertion helper since we might not have a full test runner setup active in this environment context
function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

async function runTests() {
    console.log("Running HTML Extraction Tests...");
    let passed = 0;
    let failed = 0;

    const testCases = [
        {
            name: "Standard Markdown Block",
            input: "```html\n<!DOCTYPE html>\n<html lang=\"en\">\n<body>Standard</body>\n</html>\n```",
            expectedContains: ["<!DOCTYPE html>", "<html", "Standard"]
        },
        {
            name: "Truncated Markdown (No closing ticks)",
            input: "```html\n<!DOCTYPE html>\n<html lang=\"de\" class=\"scroll-smooth\">\n<body>Truncated</body>\n</html>",
            expectedContains: ["<!DOCTYPE html>", "<html", "Truncated"]
        },
        {
            name: "Missing DOCTYPE (should match html tags)",
            input: "<html>\n<body>No Doctype</body>\n</html>",
            expectedContains: ["<html>", "No Doctype"]
        },
        {
            name: "Wrong case HTML tag in markdown",
            input: "```HTML\n<!DOCTYPE html>\n<html lang=\"en\">\n</html>\n```",
            expectedContains: ["<!DOCTYPE html>", "<html"]
        },
        {
            name: "Unknown language identifier",
            input: "```custom-lang\n<!DOCTYPE html>\n<html>Content</html>\n```",
            expectedContains: ["<!DOCTYPE html>", "Content"]
        },
        {
            name: "Malformed text starts with ``` but valid inside",
            input: "```html\n<!DOCTYPE html>\n<html lang=\"de\">...</html>", // No closing ```
            expectedContains: ["<!DOCTYPE html>", "<html"]
        },
        {
            name: "User Snippet (Reconstructed)",
            input: "```html\n<!DOCTYPE html>\n<html lang=\"de\" class=\"scroll-smooth\">\n<head></head>\n<body></body>\n</html>\n```",
            expectedContains: ["<!DOCTYPE html>", "scroll-smooth"]
        }
    ];

    for (const tc of testCases) {
        try {
            console.log(`Test: ${tc.name}`);
            const result = extractHtmlFromText(tc.input);

            // Check if result contains markdown ticks at start, which should be stripped
            if (result.trim().startsWith("```")) {
                throw new Error("Result still starts with markdown content (```)");
            }

            // Check expected content
            for (const expected of tc.expectedContains) {
                if (!result.includes(expected)) {
                    throw new Error(`Result missing expected content: "${expected}". Got: ${result.substring(0, 100)}...`);
                }
            }
            console.log("  PASSED");
            passed++;
        } catch (e: any) {
            console.error(`  FAILED: ${e.message}`);
            failed++;
        }
    }

    console.log("---------------------------------------------------");
    console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
    if (failed > 0) process.exit(1);
}

runTests().catch(console.error);
