param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [Parameter(Mandatory = $true)]
  [double]$CssX,

  [Parameter(Mandatory = $true)]
  [double]$CssY,

  [Parameter(Mandatory = $true)]
  [double]$CssWidth,

  [Parameter(Mandatory = $true)]
  [double]$CssHeight,

  [Parameter(Mandatory = $true)]
  [double]$CssPageX,

  [Parameter(Mandatory = $true)]
  [double]$CssPageY,

  [Parameter(Mandatory = $true)]
  [double]$CssPageWidth,

  [Parameter(Mandatory = $true)]
  [double]$CssPageHeight,

  [string]$ReferencePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
  throw "Source PNG does not exist: $InputPath"
}
if ($CssWidth -le 0 -or $CssHeight -le 0) {
  throw "CSS crop dimensions must be positive"
}
if ($CssPageWidth -le 0 -or $CssPageHeight -le 0) {
  throw "CSS page dimensions must be positive"
}

$resolvedInput = [System.IO.Path]::GetFullPath($InputPath)
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
if ([string]::Equals($resolvedInput, $resolvedOutput, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Source and destination PNG paths must differ"
}

$destinationDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
if (-not [string]::IsNullOrWhiteSpace($destinationDirectory)) {
  [System.IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null
}

Add-Type -AssemblyName System.Drawing

$source = $null
$crop = $null
$referenceSource = $null
$referenceScaled = $null
$referenceGraphics = $null
try {
  $source = [System.Drawing.Bitmap]::new($resolvedInput)
  if ($source.Width -le 0 -or $source.Height -le 0) {
    throw "Source PNG has invalid pixel dimensions"
  }

  $scaleX = $source.Width / $CssPageWidth
  $scaleY = $source.Height / $CssPageHeight
  if ($scaleX -le 0 -or $scaleY -le 0) {
    throw "Unable to derive CSS-to-PNG scale"
  }

  $left = [Math]::Floor(($CssX - $CssPageX) * $scaleX)
  $top = [Math]::Floor(($CssY - $CssPageY) * $scaleY)
  $right = [Math]::Ceiling(($CssX + $CssWidth - $CssPageX) * $scaleX)
  $bottom = [Math]::Ceiling(($CssY + $CssHeight - $CssPageY) * $scaleY)

  $left = [Math]::Max(0, [Math]::Min($source.Width, $left))
  $top = [Math]::Max(0, [Math]::Min($source.Height, $top))
  $right = [Math]::Max(0, [Math]::Min($source.Width, $right))
  $bottom = [Math]::Max(0, [Math]::Min($source.Height, $bottom))

  $pixelWidth = $right - $left
  $pixelHeight = $bottom - $top
  if ($pixelWidth -le 0 -or $pixelHeight -le 0) {
    throw "CSS crop lies outside the captured PNG"
  }

  $rectangle = [System.Drawing.Rectangle]::new(
    [int]$left,
    [int]$top,
    [int]$pixelWidth,
    [int]$pixelHeight
  )
  $crop = $source.Clone($rectangle, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  if ([System.IO.File]::Exists($resolvedOutput)) {
    [System.IO.File]::Delete($resolvedOutput)
  }
  $crop.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)

  $comparison = $null
  if (-not [string]::IsNullOrWhiteSpace($ReferencePath)) {
    if (-not (Test-Path -LiteralPath $ReferencePath -PathType Leaf)) {
      throw "Reference PNG does not exist: $ReferencePath"
    }
    $resolvedReference = [System.IO.Path]::GetFullPath($ReferencePath)
    $referenceSource = [System.Drawing.Bitmap]::new($resolvedReference)
    $comparisonReference = $referenceSource
    if ($referenceSource.Width -ne $crop.Width -or $referenceSource.Height -ne $crop.Height) {
      $referenceScaled = [System.Drawing.Bitmap]::new(
        $crop.Width,
        $crop.Height,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
      )
      $referenceGraphics = [System.Drawing.Graphics]::FromImage($referenceScaled)
      $referenceGraphics.DrawImage(
        $referenceSource,
        [System.Drawing.Rectangle]::new(0, 0, $crop.Width, $crop.Height)
      )
      $comparisonReference = $referenceScaled
    }

    # Focus on the mouth itself rather than the mostly-static neck and cheeks.
    # This makes a closed frame stay near zero while A/E/O/U shapes separate
    # clearly from the initial closed-mouth reference.
    $roiLeft = [Math]::Floor($crop.Width * 0.25)
    $roiRight = [Math]::Ceiling($crop.Width * 0.75)
    $roiTop = [Math]::Floor($crop.Height * 0.15)
    $roiBottom = [Math]::Ceiling($crop.Height * 0.50)
    $roiPixelCount = ($roiRight - $roiLeft) * ($roiBottom - $roiTop)
    $sampleStep = [Math]::Max(1, [Math]::Ceiling([Math]::Sqrt($roiPixelCount / 20000.0)))
    $deltaSum = 0.0
    $changedSamples = 0
    $sampleCount = 0
    $changedDeltaThreshold = 12.0
    for ($y = $roiTop; $y -lt $roiBottom; $y += $sampleStep) {
      for ($x = $roiLeft; $x -lt $roiRight; $x += $sampleStep) {
        $pixel = $crop.GetPixel($x, $y)
        $referencePixel = $comparisonReference.GetPixel($x, $y)
        $delta = ([Math]::Abs([int]$pixel.R - [int]$referencePixel.R) + [Math]::Abs([int]$pixel.G - [int]$referencePixel.G) + [Math]::Abs([int]$pixel.B - [int]$referencePixel.B)) / 3.0
        $deltaSum += $delta
        if ($delta -ge $changedDeltaThreshold) {
          $changedSamples += 1
        }
        $sampleCount += 1
      }
    }
    if ($sampleCount -le 0) {
      throw "Mouth comparison ROI did not contain samples"
    }
    $comparison = [ordered]@{
      referencePixelSize = [ordered]@{
        width = $referenceSource.Width
        height = $referenceSource.Height
      }
      comparisonPixelSize = [ordered]@{
        width = $crop.Width
        height = $crop.Height
      }
      normalizedRoi = [ordered]@{
        x = 0.25
        y = 0.15
        width = 0.50
        height = 0.35
      }
      sampleStep = $sampleStep
      sampleCount = $sampleCount
      changedDeltaThreshold = $changedDeltaThreshold
      meanAbsoluteRgbDelta = $deltaSum / $sampleCount
      changedSampleRatio = $changedSamples / [double]$sampleCount
    }
  }

  [ordered]@{
    ok = $true
    sourcePixelSize = [ordered]@{
      width = $source.Width
      height = $source.Height
    }
    cssPageBounds = [ordered]@{
      x = $CssPageX
      y = $CssPageY
      width = $CssPageWidth
      height = $CssPageHeight
    }
    requestedCssRect = [ordered]@{
      x = $CssX
      y = $CssY
      width = $CssWidth
      height = $CssHeight
    }
    cssToPixelScale = [ordered]@{
      x = $scaleX
      y = $scaleY
    }
    outputPixelRect = [ordered]@{
      x = $left
      y = $top
      width = $pixelWidth
      height = $pixelHeight
    }
    comparison = $comparison
  } | ConvertTo-Json -Compress -Depth 5
} finally {
  if ($null -ne $referenceGraphics) {
    $referenceGraphics.Dispose()
  }
  if ($null -ne $referenceScaled) {
    $referenceScaled.Dispose()
  }
  if ($null -ne $referenceSource) {
    $referenceSource.Dispose()
  }
  if ($null -ne $crop) {
    $crop.Dispose()
  }
  if ($null -ne $source) {
    $source.Dispose()
  }
}
