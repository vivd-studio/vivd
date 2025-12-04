import { extractHtmlFromText } from '../src/utils';
import { expect } from 'chai';

describe('HTML Extraction', () => {
    it('should extract HTML from markdown code blocks', () => {
        const input = `Here is the code:
\`\`\`html
<!DOCTYPE html>
<html>
<body>
<h1>Hello</h1>
</body>
</html>
\`\`\`
Hope this helps!`;
        const expected = `<!DOCTYPE html>
<html>
<body>
<h1>Hello</h1>
</body>
</html>`;
        expect(extractHtmlFromText(input).trim()).to.equal(expected);
    });

    it('should extract HTML when no code blocks are present but DOCTYPE is found', () => {
        const input = `Sure, here is the HTML:
<!DOCTYPE html>
<html>
<body>
<h1>Hello</h1>
</body>
</html>
Let me know if you need changes.`;
        const expected = `<!DOCTYPE html>
<html>
<body>
<h1>Hello</h1>
</body>
</html>`;
        expect(extractHtmlFromText(input).trim()).to.equal(expected);
    });

    it('should return original text if no HTML structure is found', () => {
        const input = 'Just some random text.';
        expect(extractHtmlFromText(input)).to.equal(input);
    });

    it('should handle case insensitive DOCTYPE', () => {
        const input = `
<!doctype html>
<html>
</html>
`;
        const expected = `<!doctype html>
<html>
</html>`;
        expect(extractHtmlFromText(input).trim()).to.equal(expected);
    });
});
