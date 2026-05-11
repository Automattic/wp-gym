# Task: Create A Nested Gutenberg Layout

Create or update a WordPress page titled **Nested Layout Page**.

The final `post_content` must be valid Gutenberg block markup with correct block
nesting. Use block comments and inner blocks that WordPress can parse.

Layout requirements:

- A top-level Group block.
- Inside the Group block, a Columns block.
- Inside the Columns block, exactly two Column blocks.
- Each Column block must contain a Heading block and a Paragraph block.

When you're finished, the saved page should parse as
`core/group > core/columns > core/column` nested blocks. Avoid visually similar
raw HTML that skips the requested block structure.
