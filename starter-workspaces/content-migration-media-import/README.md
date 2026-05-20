# Content Migration Media Import Workspace

The `import-package/` directory is the source export for the task. It contains a
small content manifest plus image files from the legacy site.

Agents may inspect these files and use WordPress-friendly import surfaces such as
WP-CLI, REST API calls, direct filesystem staging, or the browser UI. Hidden
grading checks the finished WordPress state, including local attachment records,
files, featured images, editable image blocks, and stale remote media references.
