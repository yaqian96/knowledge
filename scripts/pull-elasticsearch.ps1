# 拉取 Elasticsearch 前请重启 Docker Desktop（修改 daemon.json 镜像加速后必须重启）
# 用法: .\scripts\pull-elasticsearch.ps1

$ErrorActionPreference = 'Stop'
$env:HTTP_PROXY = ''
$env:HTTPS_PROXY = ''
$env:ALL_PROXY = ''

Set-Location (Join-Path $PSScriptRoot '..')

Write-Host 'Registry mirrors:' (docker info 2>$null | Select-String 'Registry Mirrors' -Context 0,3)
Write-Host 'Pulling elasticsearch:8.11.0 ...'

docker pull elasticsearch:8.11.0
if ($LASTEXITCODE -ne 0) {
  Write-Host '直连失败，尝试 DaoCloud 镜像...' -ForegroundColor Yellow
  docker pull docker.m.daocloud.io/library/elasticsearch:8.11.0
  docker tag docker.m.daocloud.io/library/elasticsearch:8.11.0 elasticsearch:8.11.0
}

docker compose up -d elasticsearch
Write-Host '等待 ES 启动...'
Start-Sleep -Seconds 20
Invoke-WebRequest http://localhost:9200 -UseBasicParsing | Select-Object StatusCode, Content
