# Notices

Claude Split is licensed under the MIT License (see [LICENSE](LICENSE)).

## claude-counter

The technique used by the browser extension to observe Claude's official usage
numbers — wrapping `window.fetch` / SSE handling in the page context to read
responses from claude.ai's `/api/organizations/{orgId}/usage` endpoint and the
live `message_limit` SSE events — originates from the open-source project
**claude-counter** by **she-llac**:

- https://github.com/she-llac/claude-counter

Claude Split reimplements the technique; no claude-counter source code is
vendored in this repository. In the spirit of the MIT license under which
claude-counter is published, its copyright and license notice is reproduced
below:

```
MIT License

Copyright (c) she-llac (claude-counter contributors)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
