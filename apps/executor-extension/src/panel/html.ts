import { PANEL_CSS } from './styles.js';

export function buildHtml(args: { scriptUri: string; nonce: string }): string {
  const { scriptUri, nonce } = args;
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude</title>
<style nonce="${nonce}">${PANEL_CSS}</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
