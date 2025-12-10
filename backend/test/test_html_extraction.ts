import { extractHtmlFromText } from '../src/generator/utils';
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

        it('should extract HTML when DOCTYPE is missing', () => {
                const input = `Some text
<html>
  <body>
    <h1>No DOCTYPE</h1>
  </body>
</html>
Some footer text`;
                const expected = `<html>
  <body>
    <h1>No DOCTYPE</h1>
  </body>
</html>`;
                expect(extractHtmlFromText(input).trim()).to.equal(expected);
        });

        it('should extract HTML with malformed DOCTYPE if we prioritize html tag', () => {
                // If the policy is to capture DOCTYPE if present, but fallback to html tag if DOCTYPE match fails
                // or if we want to capture everything from start of DOCTYPE (even if malformed?)
                // The user said: "match everything inbetweeen <DOCTYPE .. and the closing html tag"
                // "but it seems to fail when this DOCTYPE is missing - can we maybe then just try matching everythign between the opening html tag and the closing one?"

                // So if DOCTYPE is missing, we match <html>...</html>.

                const input = `Pre text
<html lang="en">
<body>Content</body>
</html>
Post text`;
                const expected = `<html lang="en">
<body>Content</body>
</html>`;
                expect(extractHtmlFromText(input).trim()).to.equal(expected);
        });

        it('should extract HTML including DOCTYPE if present', () => {
                const input = `Pre text
<!DOCTYPE html>
<html lang="en">
<body>Content</body>
</html>
Post text`;
                const expected = `<!DOCTYPE html>
<html lang="en">
<body>Content</body>
</html>`;
                expect(extractHtmlFromText(input).trim()).to.equal(expected);
        });
});
