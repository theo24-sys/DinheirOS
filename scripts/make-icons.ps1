# Generates web and Android brand assets from public/brand-logo.jpg.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'public\brand-logo.jpg'
$iconDir = Join-Path $root 'public\icons'
$androidRes = Join-Path $root 'android\app\src\main\res'

if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Brand image not found: $sourcePath"
}

New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
$source = [System.Drawing.Image]::FromFile($sourcePath)

function Draw-BrandIcon([string]$path, [int]$size, [double]$scale) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::White)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  # Crop the cloud-and-wallet mark, leaving the wordmark in the master artwork.
  $crop = New-Object System.Drawing.Rectangle(104, 92, 560, 402)
  $drawWidth = [single]($size * $scale)
  $drawHeight = [single]($drawWidth * $crop.Height / $crop.Width)
  $destination = New-Object System.Drawing.RectangleF(
    [single](($size - $drawWidth) / 2),
    [single](($size - $drawHeight) / 2),
    $drawWidth,
    $drawHeight
  )
  $graphics.DrawImage($source, $destination, $crop, [System.Drawing.GraphicsUnit]::Pixel)
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $graphics.Dispose()
  $bitmap.Dispose()
}

function Draw-BrandSplash([string]$path, [int]$width, [int]$height) {
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::White)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $side = [single]([Math]::Min($width, $height) * 0.82)
  $destination = New-Object System.Drawing.RectangleF(
    [single](($width - $side) / 2),
    [single](($height - $side) / 2),
    $side,
    $side
  )
  $graphics.DrawImage($source, $destination)
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $graphics.Dispose()
  $bitmap.Dispose()
}

try {
  foreach ($size in 32, 64, 96, 180, 192, 512) {
    $name = if ($size -le 64) { "favicon-$size.png" } else { "icon-$size.png" }
    Draw-BrandIcon (Join-Path $iconDir $name) $size 0.94
  }
  Draw-BrandIcon (Join-Path $iconDir 'icon-maskable-512.png') 512 0.76

  $mipmapSizes = @{
    'mdpi' = 48
    'hdpi' = 72
    'xhdpi' = 96
    'xxhdpi' = 144
    'xxxhdpi' = 192
  }
  foreach ($density in $mipmapSizes.Keys) {
    $mipmapDir = Join-Path $androidRes "mipmap-$density"
    New-Item -ItemType Directory -Force -Path $mipmapDir | Out-Null
    $size = $mipmapSizes[$density]
    Draw-BrandIcon (Join-Path $mipmapDir 'ic_launcher.png') $size 0.94
    Draw-BrandIcon (Join-Path $mipmapDir 'ic_launcher_round.png') $size 0.94
    Draw-BrandIcon (Join-Path $mipmapDir 'ic_launcher_foreground.png') ($size * 2.25) 0.76
    foreach ($name in 'ic_launcher.webp', 'ic_launcher_round.webp', 'ic_launcher_foreground.webp') {
      Remove-Item -LiteralPath (Join-Path $mipmapDir $name) -Force -ErrorAction SilentlyContinue
    }
  }

  Draw-BrandIcon (Join-Path $root 'android\app\src\main\ic_launcher-playstore.png') 512 0.94

  $splashAssets = @{
    'drawable\splash.png' = @(480, 320)
    'drawable-land-hdpi\splash.png' = @(800, 480)
    'drawable-land-mdpi\splash.png' = @(480, 320)
    'drawable-land-xhdpi\splash.png' = @(1280, 720)
    'drawable-land-xxhdpi\splash.png' = @(1600, 960)
    'drawable-land-xxxhdpi\splash.png' = @(1920, 1280)
    'drawable-port-hdpi\splash.png' = @(480, 800)
    'drawable-port-mdpi\splash.png' = @(320, 480)
    'drawable-port-xhdpi\splash.png' = @(720, 1280)
    'drawable-port-xxhdpi\splash.png' = @(960, 1600)
    'drawable-port-xxxhdpi\splash.png' = @(1280, 1920)
  }
  foreach ($entry in $splashAssets.GetEnumerator()) {
    $path = Join-Path $androidRes $entry.Key
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    Draw-BrandSplash $path $entry.Value[0] $entry.Value[1]
  }
}
finally {
  $source.Dispose()
}

Write-Host "Brand assets generated from $sourcePath"
