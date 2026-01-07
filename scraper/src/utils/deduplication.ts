/**
 * Removes blocks of text from newText that already exist in baseText.
 * Useful for removing repeated headers/footers/navigation between pages.
 */
export function removeDuplicateContent(
  baseText: string,
  newText: string,
  minBlockLines: number = 3
): string {
  const baseLines = baseText.split("\n").map((line) => line.trim());
  const newLines = newText.split("\n");

  const linesToRemove = new Set<number>();

  for (let i = 0; i <= newLines.length - minBlockLines; i++) {
    const blockToMatch = newLines
      .slice(i, i + minBlockLines)
      .map((line) => line.trim());

    if (blockToMatch.every((line) => line === "")) continue;

    if (hasSequence(baseLines, blockToMatch)) {
      for (let j = 0; j < minBlockLines; j++) {
        linesToRemove.add(i + j);
      }
    }
  }

  const resultLines: string[] = [];
  let lastWasEmpty = false;

  for (let i = 0; i < newLines.length; i++) {
    if (linesToRemove.has(i)) continue;

    const line = newLines[i];
    const isEmpty = line.trim() === "";

    if (isEmpty && lastWasEmpty) {
      if (
        resultLines.length > 0 &&
        resultLines[resultLines.length - 1].trim() === ""
      ) {
        continue;
      }
    }

    resultLines.push(line);
    lastWasEmpty = isEmpty;
  }

  return resultLines.join("\n");
}

function hasSequence(baseLines: string[], sequence: string[]): boolean {
  if (sequence.length === 0) return false;

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

