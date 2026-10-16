# run-tests.ps1 —— 用 Node 内置测试框架跑 tests/*.test.js（无需 npm install）
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-tests.ps1
# 完整结果与失败明细写入 tools/test-output.txt（UTF-8）
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$out = & node --test "tests/*.test.js" 2>&1 | Out-String

# Node 的 test reporter 在不同版本里用「# tests 61」或「ℹ tests 61」，两种都抓。
$summary = ([regex]::Matches($out, '(?m)^[#\u2139]\s*(tests|suites|pass|fail|cancelled|skipped|todo)\s+\d+.*')).Value -join "`n"
# 失败明细：TAP 的「not ok」行，或 spec reporter 里 ✖ 开头且不是「failing tests」汇总的行。
$failing = ([regex]::Matches($out, '(?m)^(?:not ok |\u2716 )(?!failing tests).*')).Value -join "`n"
$tail = $out.Substring([Math]::Max(0, $out.Length - 6000))
$body = $summary + "`n--- failing lines ---`n" + $failing + "`n--- full tail ---`n" + $tail
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'test-output.txt'), $body, [System.Text.UTF8Encoding]::new($false))

Write-Host $summary
Write-Host 'see tools/test-output.txt for full output'
