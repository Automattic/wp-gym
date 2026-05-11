# Create Valid Semantic Gutenberg Markup

Create or update a WordPress page titled **Cookout Block Markup**.

The final `post_content` must be valid Gutenberg block markup that parses through
WordPress block APIs. Use real blocks, not superficial HTML.

Content requirements:

- An H2 heading with the text `Summer Cookout Plan`.
- A paragraph describing a small neighborhood cookout.
- A list with exactly three preparation items.
- A Buttons block containing one Button block labeled `View menu`.

When you're finished, WordPress should parse the saved page content into
`core/heading`, `core/paragraph`, `core/list`, `core/list-item`, `core/buttons`,
and `core/button` blocks, with no fallback/raw HTML block and no `core/html`
block.
