/**
 * The overlay window: Windows PowerShell 5.1 + WinForms, driven by the agent over stdin/stdout (one JSON object per line).
 * Read-only: it shows the chat and copies text to the clipboard, nothing else. Double-tap Alt toggles it, Esc hides it.
 *
 * Kept as a string so the single-file PocketClipboard.exe can write it next to its state and run it. Because this is a
 * JS template literal the PowerShell must avoid backticks (newlines are $NL) and the dollar-brace interpolation sequence.
 */
export const OVERLAY_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false

Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public class PocketOverlayForm : Form {
    // Showing never steals focus from the editor; WS_EX_TOOLWINDOW keeps it out of Alt+Tab, WS_EX_TOPMOST above everything.
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get { CreateParams cp = base.CreateParams; cp.ExStyle |= 0x80 | 0x8; return cp; }
    }
}

public static class PocketNative {
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}

// Console.In cannot be read without blocking the UI thread, so a background thread queues lines.
public static class PocketStdin {
    static readonly ConcurrentQueue<string> queue = new ConcurrentQueue<string>();
    static volatile bool closed;
    public static bool Closed { get { return closed && queue.IsEmpty; } }
    public static void Start() {
        Thread t = new Thread(delegate() {
            try {
                using (StreamReader r = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false))) {
                    string line;
                    while ((line = r.ReadLine()) != null) queue.Enqueue(line);
                }
            } catch (Exception) { }
            closed = true;
        });
        t.IsBackground = true;
        t.Start();
    }
    public static string Next() { string s; return queue.TryDequeue(out s) ? s : null; }
}
'@

[void][PocketNative]::SetProcessDPIAware()
$NL = [string][char]10

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Rgb($r, $g, $b) { [Drawing.Color]::FromArgb($r, $g, $b) }
$C = @{
  bg = Rgb 17 17 22; panel = Rgb 26 26 34; text = Rgb 230 230 235; muted = Rgb 139 139 150
  accent = Rgb 122 162 247; code = Rgb 32 32 44; codeText = Rgb 214 218 228; inline = Rgb 201 164 255; error = Rgb 237 73 86
}
$F = @{
  text = New-Object Drawing.Font 'Segoe UI', 10
  label = New-Object Drawing.Font 'Segoe UI', 8.5, ([Drawing.FontStyle]::Bold)
  small = New-Object Drawing.Font 'Segoe UI', 8.5
  mono = New-Object Drawing.Font 'Consolas', 9.5
  title = New-Object Drawing.Font 'Segoe UI', 9.5, ([Drawing.FontStyle]::Bold)
}

$form = New-Object PocketOverlayForm
$form.Text = 'Pocket'
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = 'Manual'
$form.BackColor = $C.bg
$form.KeyPreview = $true
$scale = $form.CreateGraphics().DpiX / 96
$wa = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$width = [int](440 * $scale)
$margin = [int](12 * $scale)
$form.Size = New-Object Drawing.Size $width, ($wa.Height - 2 * $margin)
$form.Location = New-Object Drawing.Point ($wa.Right - $width - $margin), ($wa.Top + $margin)

$rtb = New-Object Windows.Forms.RichTextBox
$rtb.Dock = 'Fill'
$rtb.ReadOnly = $true
$rtb.BorderStyle = 'None'
$rtb.BackColor = $C.bg
$rtb.ForeColor = $C.text
$rtb.Font = $F.text
$rtb.ScrollBars = 'Vertical'
$rtb.WordWrap = $true
$rtb.DetectUrls = $false
$rtb.HideSelection = $false
$rtb.Margin = New-Object Windows.Forms.Padding 0
$form.Controls.Add($rtb)

$header = New-Object Windows.Forms.Panel
$header.Dock = 'Top'
$header.Height = [int](34 * $scale)
$header.BackColor = $C.panel
$title = New-Object Windows.Forms.Label
$title.Dock = 'Fill'
$title.TextAlign = 'MiddleLeft'
$title.Padding = New-Object Windows.Forms.Padding ([int](12 * $scale)), 0, 0, 0
$title.ForeColor = $C.text
$title.Font = $F.title
$title.Text = 'Pocket'
$hide = New-Object Windows.Forms.Label
$hide.Dock = 'Right'
$hide.Width = [int](36 * $scale)
$hide.TextAlign = 'MiddleCenter'
$hide.ForeColor = $C.muted
$hide.Font = $F.text
$hide.Text = [string][char]0x2715
$hide.Cursor = [Windows.Forms.Cursors]::Hand
$header.Controls.Add($title)
$header.Controls.Add($hide)
$form.Controls.Add($header)

$bar = New-Object Windows.Forms.Panel
$bar.Dock = 'Bottom'
$bar.Height = [int](40 * $scale)
$bar.BackColor = $C.panel
function Make-Button($text) {
  $b = New-Object Windows.Forms.Button
  $b.Text = $text
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderColor = $C.muted
  $b.ForeColor = $C.text
  $b.BackColor = $C.panel
  $b.Font = $F.small
  $b.Dock = 'Right'
  $b.Width = [int](90 * $scale)
  $b.TabStop = $false
  $b
}
$copyReply = Make-Button 'Copy reply'
$copyCode = Make-Button 'Copy code'
$status = New-Object Windows.Forms.Label
$status.Dock = 'Fill'
$status.TextAlign = 'MiddleLeft'
$status.Padding = New-Object Windows.Forms.Padding ([int](12 * $scale)), 0, 0, 0
$status.ForeColor = $C.muted
$status.Font = $F.small
$bar.Controls.Add($status)
$bar.Controls.Add($copyReply)
$bar.Controls.Add($copyCode)
$form.Controls.Add($bar)

$script:hint = 'Esc hides  |  Alt Alt toggles  |  double-click code to copy'
$script:messages = New-Object System.Collections.ArrayList
$script:starts = @{}
$script:codeBlocks = New-Object System.Collections.ArrayList
$status.Text = $script:hint

function Append([string]$text, $font, $color, $back) {
  $rtb.SelectionStart = $rtb.TextLength
  $rtb.SelectionLength = 0
  $rtb.SelectionFont = $font
  $rtb.SelectionColor = $color
  $rtb.SelectionBackColor = $back
  $rtb.AppendText($text)
}

function Append-Blocks($m, $color) {
  foreach ($b in @($m.blocks)) {
    if ($null -eq $b) { continue }
    if ($b.type -eq 'code') {
      if ($b.lang) { Append ('[' + $b.lang + ']' + $NL) $F.small $C.muted $C.bg }
      $s = $rtb.TextLength
      Append ($b.text + $NL) $F.mono $C.codeText $C.code
      [void]$script:codeBlocks.Add(@{ start = $s; length = $b.text.Length; text = $b.text })
      Append $NL $F.text $color $C.bg
    } else {
      foreach ($run in @($b.inline)) {
        if ($null -eq $run) { continue }
        if ($run.code) { Append $run.text $F.mono $C.inline $C.bg } else { Append $run.text $F.text $color $C.bg }
      }
      Append ($NL + $NL) $F.text $color $C.bg
    }
  }
}

function Render-Message($m) {
  $script:starts[$m.id] = $rtb.TextLength
  switch ($m.role) {
    'user' {
      Append ('You' + $NL) $F.label $C.muted $C.bg
      Append-Blocks $m $C.muted
      if ($m.note) { Append ('+ ' + $m.note + $NL + $NL) $F.small $C.muted $C.bg }
    }
    'assistant' {
      Append ('Claude' + $NL) $F.label $C.accent $C.bg
      Append-Blocks $m $C.text
      if ($m.streaming) { Append ([string][char]0x258D + $NL + $NL) $F.text $C.accent $C.bg }
    }
    'tool' {
      $line = [string][char]0x2699 + ' ' + $m.text
      if ($m.streaming) { $line += ' ...' }
      if ($m.note) { $line += ' (' + $m.note + ')' }
      Append ($line + $NL + $NL) $F.small $C.muted $C.bg
    }
    'error' { Append ($m.text + $NL + $NL) $F.text $C.error $C.bg }
  }
}

function At-Bottom {
  if ($rtb.TextLength -eq 0) { return $true }
  $p = $rtb.GetPositionFromCharIndex($rtb.TextLength - 1)
  return $p.Y -lt $rtb.ClientSize.Height
}

function Redraw-All {
  $rtb.Clear()
  $script:starts = @{}
  $script:codeBlocks.Clear()
  foreach ($m in $script:messages) { Render-Message $m }
}

function Update-Window([scriptblock]$change) {
  $bottom = At-Bottom
  [void][PocketNative]::SendMessage($rtb.Handle, 0x0B, [IntPtr]::Zero, [IntPtr]::Zero)
  try { & $change } finally {
    [void][PocketNative]::SendMessage($rtb.Handle, 0x0B, [IntPtr]1, [IntPtr]::Zero)
    $rtb.Invalidate()
  }
  if ($bottom) {
    $rtb.SelectionStart = $rtb.TextLength
    $rtb.SelectionLength = 0
    $rtb.ScrollToCaret()
  }
}

function Index-Of($id) {
  for ($i = 0; $i -lt $script:messages.Count; $i++) { if ($script:messages[$i].id -eq $id) { return $i } }
  return -1
}

function Handle-Op($op) {
  switch ($op.op) {
    'reset' {
      $title.Text = $op.title
      Update-Window {
        $script:messages = New-Object System.Collections.ArrayList
        foreach ($m in @($op.messages)) { if ($null -ne $m) { [void]$script:messages.Add($m) } }
        Redraw-All
      }
    }
    'upsert' {
      $m = $op.message
      $i = Index-Of $m.id
      Update-Window {
        if ($i -lt 0) {
          [void]$script:messages.Add($m)
          Render-Message $m
        } elseif ($i -eq $script:messages.Count - 1) {
          # Streaming: redraw only the tail.
          $script:messages[$i] = $m
          $start = $script:starts[$m.id]
          $rtb.Select($start, $rtb.TextLength - $start)
          $rtb.SelectedText = ''
          for ($k = $script:codeBlocks.Count - 1; $k -ge 0; $k--) { if ($script:codeBlocks[$k].start -ge $start) { $script:codeBlocks.RemoveAt($k) } }
          Render-Message $m
        } else {
          $script:messages[$i] = $m
          Redraw-All
        }
      }
    }
    'title' { $title.Text = $op.title }
    'status' {
      if ($op.text) { $script:hint = $op.text } else { $script:hint = 'Esc hides  |  Alt Alt toggles  |  double-click code to copy' }
      $status.Text = $script:hint
    }
    'quit' { [Windows.Forms.Application]::Exit() }
  }
}

$flash = New-Object Windows.Forms.Timer
$flash.Interval = 1500
$flash.add_Tick({ $flash.Stop(); $status.Text = $script:hint })
function Flash($text) { $status.Text = $text; $flash.Stop(); $flash.Start() }

function Copy-Text($text, $what) {
  if (-not $text) { Flash ('Nothing to copy'); return }
  [Windows.Forms.Clipboard]::SetText($text)
  Flash ('Copied ' + $what)
  Emit @{ ev = 'copied'; what = $what }
}

function Code-At($pos) {
  foreach ($b in $script:codeBlocks) { if ($pos -ge $b.start -and $pos -le $b.start + $b.length) { return $b } }
  return $null
}

function Show-Overlay { if (-not $form.Visible) { $form.Show(); Emit @{ ev = 'visible'; visible = $true } } }
function Hide-Overlay { if ($form.Visible) { $form.Hide(); Emit @{ ev = 'visible'; visible = $false } } }
function Toggle-Overlay { if ($form.Visible) { Hide-Overlay } else { Show-Overlay } }

$copyCode.add_Click({
  $b = Code-At $rtb.SelectionStart
  if (-not $b -and $script:codeBlocks.Count -gt 0) { $b = $script:codeBlocks[$script:codeBlocks.Count - 1] }
  if ($b) { Copy-Text $b.text 'code' } else { Flash 'No code in this chat' }
})
$copyReply.add_Click({
  $last = $null
  foreach ($m in $script:messages) { if ($m.role -eq 'assistant') { $last = $m } }
  if ($last) { Copy-Text $last.text 'reply' } else { Flash 'No reply yet' }
})
$rtb.add_MouseDoubleClick({
  $b = Code-At $rtb.SelectionStart
  if ($b) {
    $rtb.Select($b.start, $b.length)
    Copy-Text $b.text 'code'
  }
})
$hide.add_Click({ Hide-Overlay })
$header.add_MouseDown({
  [void][PocketNative]::ReleaseCapture()
  [void][PocketNative]::SendMessage($form.Handle, 0xA1, [IntPtr]2, [IntPtr]::Zero)
})
$title.add_MouseDown({
  [void][PocketNative]::ReleaseCapture()
  [void][PocketNative]::SendMessage($form.Handle, 0xA1, [IntPtr]2, [IntPtr]::Zero)
})
$form.add_KeyDown({
  if ($_.KeyCode -eq [Windows.Forms.Keys]::Escape) { Hide-Overlay; $_.Handled = $true }
})

# Double-tap detection: two short Alt presses, no other key in between, within 450 ms.
$script:altDown = $false
$script:altSince = 0
$script:altCombo = $false
$script:lastTap = 0
$comboKeys = @(0x09, 0x0D, 0x1B, 0x20, 0x10, 0x11, 0x5B, 0x73) + (0x30..0x5A)
$keys = New-Object Windows.Forms.Timer
$keys.Interval = 25
$keys.add_Tick({
  $now = [Environment]::TickCount
  $down = ([PocketNative]::GetAsyncKeyState(0x12) -band 0x8000) -ne 0
  if ($down) {
    if (-not $script:altDown) { $script:altDown = $true; $script:altSince = $now; $script:altCombo = $false }
    if (-not $script:altCombo) {
      foreach ($vk in $comboKeys) { if (([PocketNative]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { $script:altCombo = $true; break } }
    }
  } elseif ($script:altDown) {
    $script:altDown = $false
    if (-not $script:altCombo -and ($now - $script:altSince) -lt 350) {
      if (($now - $script:lastTap) -lt 450) { $script:lastTap = 0; Toggle-Overlay } else { $script:lastTap = $now }
    } else { $script:lastTap = 0 }
  }
})

$io = New-Object Windows.Forms.Timer
$io.Interval = 30
$io.add_Tick({
  for ($n = 0; $n -lt 50; $n++) {
    $line = [PocketStdin]::Next()
    if ($null -eq $line) {
      if ([PocketStdin]::Closed) { [Windows.Forms.Application]::Exit() }
      break
    }
    try { Handle-Op ($line | ConvertFrom-Json) } catch { Emit @{ ev = 'error'; message = $_.Exception.Message } }
  }
})

[PocketStdin]::Start()
$keys.Start()
$io.Start()
Emit @{ ev = 'ready' }
[Windows.Forms.Application]::Run()
`;
