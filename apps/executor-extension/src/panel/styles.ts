export const PANEL_CSS = `
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
button, select, textarea { font: inherit; color: inherit; }
#app { display: flex; flex-direction: column; height: 100%; }
.bar {
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent));
}
.bar .grow { flex: 1; min-width: 0; }
.picker { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.picker select {
  flex: 1; min-width: 0; max-width: 360px; padding: 3px 4px;
  background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border, transparent); border-radius: 2px;
}
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-disabledForeground); flex: none; }
.dot.on, .dot.idle { background: var(--vscode-testing-iconPassed, #3fb950); }
.dot.running { background: var(--vscode-charts-blue, #3794ff); }
.dot.waiting_permission { background: var(--vscode-charts-yellow, #cca700); }
.dot.ended { background: var(--vscode-disabledForeground); }
.status { display: flex; align-items: center; gap: 4px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
.btn {
  background: transparent; border: 1px solid transparent; border-radius: 2px; padding: 2px 8px; cursor: pointer;
  color: var(--vscode-foreground);
}
.btn:hover { background: var(--vscode-toolbar-hoverBackground); }
.btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn.primary:hover { background: var(--vscode-button-hoverBackground); }
.btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn.danger { color: var(--vscode-errorForeground); }
.btn:disabled { opacity: 0.5; cursor: default; }
.banner {
  display: flex; align-items: center; gap: 8px; padding: 4px 10px;
  color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground, transparent);
  border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, transparent);
}
.banner span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
#thread { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.empty { margin: auto; color: var(--vscode-descriptionForeground); text-align: center; }
.msg-user {
  align-self: flex-end; max-width: 85%; padding: 6px 10px; border-radius: 8px;
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.msg-assistant { align-self: flex-start; max-width: 100%; overflow-wrap: anywhere; }
.msg-assistant p { margin: 0 0 8px; white-space: pre-wrap; }
.msg-assistant p:last-child { margin-bottom: 0; }
code, pre { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92em; }
p code { background: var(--vscode-textCodeBlock-background); padding: 0 4px; border-radius: 3px; }
pre.block {
  margin: 0 0 8px; padding: 8px; overflow-x: auto; border-radius: 4px;
  background: var(--vscode-textCodeBlock-background);
}
.caret::after { content: ''; display: inline-block; width: 6px; height: 1em; margin-left: 2px; vertical-align: text-bottom; background: currentColor; animation: blink 1s steps(2, start) infinite; }
@keyframes blink { to { visibility: hidden; } }
details.tool { border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent)); border-radius: 4px; }
details.tool > summary {
  display: flex; align-items: center; gap: 8px; padding: 3px 8px; cursor: pointer; list-style: none;
  color: var(--vscode-descriptionForeground);
}
details.tool > summary::-webkit-details-marker { display: none; }
details.tool > summary::before { content: '\\25B8'; font-size: 0.8em; }
details.tool[open] > summary::before { content: '\\25BE'; }
.tool-name { font-weight: 600; color: var(--vscode-foreground); flex: none; }
.tool-sum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92em; }
details.tool.err { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); }
details.tool.err .tool-name, details.tool.err > summary { color: var(--vscode-errorForeground); }
.tool-body { padding: 4px 8px 8px; display: flex; flex-direction: column; gap: 6px; }
.tool-body .label { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
.tool-body pre { margin: 0; max-height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.tool-body pre.err { color: var(--vscode-errorForeground); }
.meta { align-self: center; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
.error-item { color: var(--vscode-errorForeground); white-space: pre-wrap; overflow-wrap: anywhere; }
#perms { display: flex; flex-direction: column; gap: 6px; padding: 0 10px; }
.perm {
  padding: 8px; border-radius: 4px; display: flex; flex-direction: column; gap: 6px;
  border: 1px solid var(--vscode-charts-yellow, #cca700); background: var(--vscode-editorWidget-background);
}
.perm .title { font-weight: 600; }
.diff-add { color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b); }
.diff-del { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }
.perm pre { margin: 0; max-height: 220px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.perm .actions { display: flex; gap: 6px; flex-wrap: wrap; }
.composer { display: flex; align-items: flex-end; gap: 6px; padding: 8px 10px; }
.composer textarea {
  flex: 1; resize: none; max-height: 200px; padding: 6px 8px; border-radius: 2px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
}
.composer textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.unpaired { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--vscode-descriptionForeground); }
`;
