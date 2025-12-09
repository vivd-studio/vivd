// Look ahead to see if the match continues
// (Optimization for extended blocks is handled by next iterations of outer loop)

/**
 * Removes blocks of text from newText that already exist in baseText.
 * This is useful for removing repeated headers, footers, and navigation menus
 * from subpages when aggregating content.
 * 
 * @param baseText The text that has already been processed (e.g., main page).
 * @param newText The new text to be added (e.g., subpage).
 * @param minBlockLines Minimum number of matching lines to consider a block a duplicate.
 * @returns The newText with duplicate blocks removed.
 */
export function removeDuplicateContent(baseText: string, newText: string, minBlockLines: number = 3): string {
    const baseLines = baseText.split('\n').map(l => l.trim());
    const newLines = newText.split('\n'); // Keep original formatting for reconstruction

    // We'll mark lines in newText that should be removed
    const linesToRemove = new Set<number>();

    // Create a set of base lines for fast lookup (optional optimization, but sequence matters)
    // For strict block matching, we need to find sequences.

    // Simple sliding window approach or finding common substrings.
    // Given the structure of web pages, exact line matching in sequence is usually sufficient.

    // Let's try to find blocks of `minBlockLines` in newText that appear in baseText.

    for (let i = 0; i <= newLines.length - minBlockLines; i++) {
        // Construct a block from newLines[i] to newLines[i + minBlockLines]
        // We use trimmed lines for comparison to ignore minor whitespace diffs
        const blockToMatch = newLines.slice(i, i + minBlockLines).map(l => l.trim());

        // Skip blocks that are just empty lines
        if (blockToMatch.every(l => l === '')) continue;

        // Check if this sequence exists in baseLines
        // This is O(N*M) which is fine for typical web page text sizes (few KB)
        if (hasSequence(baseLines, blockToMatch)) {
            // Mark these lines for removal
            for (let j = 0; j < minBlockLines; j++) {
                linesToRemove.add(i + j);
            }

            // Optimization for extended blocks is implicitly handled by the next iterations of the outer loop
            // as we check every position i. If i matches, i+1 might also match as part of next block check.
        }
    }

    // Reconstruct the text, skipping marked lines
    // We also want to avoid leaving huge gaps of newlines.
    const resultLines: string[] = [];
    let lastWasEmpty = false;

    for (let i = 0; i < newLines.length; i++) {
        if (!linesToRemove.has(i)) {
            const line = newLines[i];
            const isEmpty = line.trim() === '';

            // Simple whitespace cleanup: don't add more than 2 empty lines in a row
            if (isEmpty && lastWasEmpty) {
                // Check if we already have enough empty lines at the end of result
                if (resultLines.length > 0 && resultLines[resultLines.length - 1].trim() === '') {
                    continue;
                }
            }

            resultLines.push(line);
            lastWasEmpty = isEmpty;
        }
    }

    return resultLines.join('\n');
}

function hasSequence(baseLines: string[], sequence: string[]): boolean {
    if (sequence.length === 0) return false;

    // Naive search
    for (let i = 0; i <= baseLines.length - sequence.length; i++) {
        let match = true;
        for (let j = 0; j < sequence.length; j++) {
            if (baseLines[i + j] !== sequence[j]) {
                match = false;
                break;
            }
        }
        if (match) return true;
    }
    return false;
}
