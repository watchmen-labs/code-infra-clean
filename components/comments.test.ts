// @jest-environment node
// comments-cleaner.test.ts
// Adjust the import path to where your functions live
import {
  detectLanguage,
  clearJsComments,
  clearCommentsAndDocstrings,
} from './utils' 

describe('detectLanguage', () => {
  it('detects JavaScript from common tokens', () => {
    const src = `
      const x = 1;
      // comment
      function foo() {}
    `
    expect(detectLanguage(src)).toBe('javascript')
  })

  it('detects Python from common tokens', () => {
    const src = `
      def foo(x):
          return x  # comment
    `
    expect(detectLanguage(src)).toBe('python')
  })

  it('tie-breaker prefers JS if // or /* present', () => {
    const src = `
      # looks a bit pythonic
      const x = 1; // JS comment
    `
    expect(detectLanguage(src)).toBe('javascript')
  })

  it('tie-breaker prefers Python if # or triple quotes present but no JS markers', () => {
    const src = `
      """Module docstring"""
      value = 1  # python comment
    `
    expect(detectLanguage(src)).toBe('python')
  })
})

describe('clearJsComments', () => {
  it('removes // line comments and keeps code', () => {
    const src = `
      const a = 1; // keep code, drop comment
      const b = 2; // and another
    `
    const expected = `const a = 1;
const b = 2;`
    expect(clearJsComments(src)).toBe(expected)
  })

  it('removes /* block comments */ and keeps code', () => {
    const src = `
      /* header
         banner */
      const x = 42;
      const y = 2 /* inline note */ + 3;
      /* single line */ const z = x + y; /* tail */
    `
    const out = clearJsComments(src)
    expect(out).toContain('const x = 42;')
    expect(out).toContain('const y = 2  + 3;') // comment removed, double space is expected
    expect(out).toContain('const z = x + y;')
    expect(out).not.toMatch(/banner|inline note|single line|tail/)
  })

  it('does not strip comment-like sequences inside strings', () => {
    const src = `
      const url = "http://example.com/path/*not-a-comment*/";
      const msg = 'See // not a comment';
      const tpl = \`Template with // and /* not a comment */ inside\`;
    `
    const out = clearJsComments(src)
    expect(out).toContain('const url = "http://example.com/path/*not-a-comment*/";')
    expect(out).toContain("const msg = 'See // not a comment';")
    expect(out).toContain('const tpl = `Template with // and /* not a comment */ inside`;')
  })

  it('handles regex literals vs division correctly', () => {
    const src = `
      const r = /ab\\/c/i; // regex literal kept
      const a = 10 / 2;    // division kept
    `
    const expected = `const r = /ab\\/c/i;
const a = 10 / 2;`
    expect(clearJsComments(src)).toBe(expected)
  })

  it('trims trailing spaces, removes blank-only lines, and condenses multiple blanks', () => {
    const src = 'const a = 1;   \n   \n\n\nconst b = 2;  \n'
    const expected = 'const a = 1;\n\nconst b = 2;'
    expect(clearJsComments(src)).toBe(expected)
  })
})

describe('clearCommentsAndDocstrings (Python path)', () => {
  const py = `
def add(a, b):
    """Add two numbers.

    Longer description here.
    """
    s = "http://example.com"  # not a comment inside string
    t = 'hash # inside string'
    # drop this whole line
    return a + b  # keep code, drop trailing comment

`

  it('removes docstrings and # comments, keeps strings', () => {
    const cleaned = clearCommentsAndDocstrings(py, 'python')
    // Docstring gone
    expect(cleaned).not.toMatch(/Add two numbers|Longer description/)
    // Inline trailing comment removed
    expect(cleaned).toContain('return a + b')
    // String contents preserved
    expect(cleaned).toContain('s = "http://example.com"')
    expect(cleaned).toContain("t = 'hash # inside string'")
    // Whole-line comment removed
    expect(cleaned).not.toMatch(/drop this whole line/)
  })

  it('applies whitespace tidy (trailing spaces, blank lines)', () => {
    const messy = 'x = 1    \n   \n\n\nprint(x)\n'
    const expected = 'x = 1\n\nprint(x)'
    expect(clearCommentsAndDocstrings(messy, 'python')).toBe(expected)
  })
})

describe('clearCommentsAndDocstrings (JavaScript path)', () => {
  const js = `
/* banner */
const a = 1; // hi
const url = "http://example.com"; // keep string
const r = /a\\\/b/; // keep regex
const tpl = \`Hello // not comment\`;
`

  it('routes to JS cleaner when language forced', () => {
    const out = clearCommentsAndDocstrings(js, 'javascript')
    expect(out).toContain('const a = 1;')
    expect(out).toContain('const url = "http://example.com";')
    expect(out).toContain('const r = /a\\\/b/;')
    expect(out).toContain('const tpl = `Hello // not comment`;')
    expect(out).not.toMatch(/banner|hi/)
  })

  it('auto-detects JS when no language is passed', () => {
    expect(detectLanguage(js)).toBe('javascript')
    const out = clearCommentsAndDocstrings(js)
    expect(out).toContain('const a = 1;')
  })
})

describe('clearCommentsAndDocstrings – robustness', () => {
  it('handles empty and whitespace-only inputs', () => {
    expect(clearCommentsAndDocstrings('')).toBe('')
    expect(clearCommentsAndDocstrings('   \n \n ')).toBe('')
  })

  it('does not throw on mixed content', () => {
    const mixed = `
      # python-ish
      const x = 1; // js-ish
      """triple quoted"""
      /* block */
    `
    expect(() => clearCommentsAndDocstrings(mixed)).not.toThrow()
  })
})
