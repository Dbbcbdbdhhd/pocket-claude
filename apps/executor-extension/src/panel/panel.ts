import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { PanelHost } from './remote-host.js';
import { buildHtml } from './html.js';
import { parseIntent, type HostToWebview } from './protocol.js';

const VIEW_TYPE = 'pocketClaude.panel';
const POST_INTERVAL_MS = 40;

export class PanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  private postTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly host: PanelHost,
  ) {
    this.unsubscribe = host.onChange(() => this.schedulePost());
  }

  toggle(): void {
    if (this.panel?.visible) {
      this.panel.dispose();
      return;
    }
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.open();
  }

  dispose(): void {
    this.unsubscribe();
    this.panel?.dispose();
  }

  private open(): void {
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Claude', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [dist],
    });
    this.panel = panel;
    this.ready = false;
    panel.webview.html = buildHtml({
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js')).toString(),
      nonce: randomBytes(16).toString('base64url'),
    });
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      const intent = parseIntent(raw);
      if (!intent) return;
      if (intent.type === 'ready') this.ready = true;
      this.host.handle(intent);
      if (intent.type === 'ready') this.post();
    });
    panel.onDidDispose(() => {
      if (this.postTimer) clearTimeout(this.postTimer);
      this.postTimer = undefined;
      this.panel = undefined;
      this.ready = false;
    });
  }

  private schedulePost(): void {
    if (!this.panel || !this.ready || this.postTimer) return;
    this.postTimer = setTimeout(() => {
      this.postTimer = undefined;
      this.post();
    }, POST_INTERVAL_MS);
  }

  private post(): void {
    if (!this.panel || !this.ready) return;
    const msg: HostToWebview = { type: 'state', state: this.host.panelState };
    void this.panel.webview.postMessage(msg);
  }
}
