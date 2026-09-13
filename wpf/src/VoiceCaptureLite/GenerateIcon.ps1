$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDir = Join-Path $PSScriptRoot 'Assets'
[IO.Directory]::CreateDirectory($assetDir) | Out-Null
$images = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $bitmap = New-Object Drawing.Bitmap $size, $size
    $g = [Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.ScaleTransform($size / 64.0, $size / 64.0)
    $g.Clear([Drawing.Color]::Transparent)
    $path = New-Object Drawing.Drawing2D.GraphicsPath
    $path.AddArc(2,2,18,18,180,90)
    $path.AddArc(44,2,18,18,270,90)
    $path.AddArc(44,44,18,18,0,90)
    $path.AddArc(2,44,18,18,90,90)
    $path.CloseFigure()
    $bg = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#102A43'))
    $g.FillPath($bg,$path)
    $pen = New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml('#38BDF8')), 4
    $pen.StartCap = $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
    $heights = @(9,20,32,23,12)
    for($i=0;$i -lt 5;$i++) { $x=13+$i*8; $h=$heights[$i]; $g.DrawLine($pen,[single]$x,[single](32-$h/2),[single]$x,[single](32+$h/2)) }
    $dot = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#FB7185'))
    $g.FillEllipse($dot,44,6,13,13)
    $stream = New-Object IO.MemoryStream
    $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
    $images += ,@{ Size=$size; Bytes=$stream.ToArray() }
    $stream.Dispose(); $g.Dispose(); $bitmap.Dispose(); $path.Dispose(); $pen.Dispose(); $bg.Dispose(); $dot.Dispose()
}
$file = [IO.File]::Create((Join-Path $assetDir 'Capture.ico'))
$writer = New-Object IO.BinaryWriter $file
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
$offset = 6+16*$images.Count
foreach($entry in $images) {
    $dimension = if($entry.Size -eq 256){0}else{$entry.Size}
    $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
    $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$entry.Bytes.Length); $writer.Write([uint32]$offset)
    $offset += $entry.Bytes.Length
}
foreach($entry in $images) { $writer.Write([byte[]]$entry.Bytes) }
$writer.Dispose(); $file.Dispose()
