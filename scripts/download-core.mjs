/**
 * 下载 mihomo 内核二进制到 apps/electron/resources/core/<平台>-<架构>/
 * 用法: pnpm core:download [版本号]   （缺省自动取 GitHub 最新 release）
 *
 * 产物文件名约定（与 main/index.ts coreFileName 一致）:
 *   mihomo-windows-x64.exe / mihomo-darwin-arm64 / mihomo-linux-x64 ...
 *
 * 注: mihomo v1.19+ release 资产格式按平台不同:
 *   windows-* 为 .zip（内含 mihomo-windows-amd64.exe），linux/darwin-* 为 .gz 单文件。
 */

import { createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'

const OWNER = 'MetaCubeX'
const REPO = 'mihomo'
const TARGET_DIR = path.resolve('apps/electron/resources/core')

const platformMap = {
  win32: 'windows',
  darwin: 'darwin',
  linux: 'linux'
}
const archMap = {
  x64: 'amd64',
  arm64: 'arm64',
  ia32: '386'
}

function assetName(platform, arch) {
  const os = platformMap[platform]
  const cpu = archMap[arch]
  if (!os || !cpu) throw new Error(`不支持的平台/架构: ${platform}/${arch}`)
  return os === 'windows' ? `windows-${cpu}` : `${os}-${cpu}`
}

/** GitHub API 请求带 token（CI 中 runner 出口 IP 无 token 易被限流 403） */
function ghHeaders() {
  const token = process.env['GH_TOKEN'] || process.env['GITHUB_TOKEN']
  return token ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } : {}
}

async function latestTag() {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, { headers: ghHeaders() })
  if (!res.ok) throw new Error(`查询最新版本失败: HTTP ${res.status}`)
  return (await res.json()).tag_name
}

async function unzip(zipPath, outDir) {
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${outDir}'`],
      { stdio: 'inherit' }
    )
    if (r.status !== 0) throw new Error('powershell Expand-Archive 解压失败')
  } else {
    const r = spawnSync('unzip', ['-o', zipPath, '-d', outDir], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('unzip 解压失败')
  }
}

async function main() {
  const finalName = `mihomo-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`
  const finalDest = path.join(TARGET_DIR, finalName)
  if (await fs.access(finalDest).then(() => true, () => false)) {
    console.log(`[download-core] 内核已存在 (${finalName})，跳过下载`)
  } else {
    const tag = process.argv[2] ?? (await latestTag())
    await fs.mkdir(TARGET_DIR, { recursive: true })

    const baseName = `mihomo-${assetName(process.platform, process.arch)}-${tag}`
    const url = `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${baseName}.${process.platform === 'win32' ? 'zip' : 'gz'}`
    console.log(`[download-core] 目标: ${tag}`)
    console.log(`[download-core] 下载: ${url}`)

    const res = await fetch(url)
    if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`)
    const data = Buffer.from(await res.arrayBuffer())

    if (process.platform === 'win32') {
      const zipPath = path.join(TARGET_DIR, `${baseName}.zip`)
      await fs.writeFile(zipPath, data)
      await unzip(zipPath, TARGET_DIR)
      await fs.rm(zipPath, { force: true })
      // zip 内文件形如 mihomo-windows-amd64.exe
      const src = path.join(TARGET_DIR, `mihomo-${assetName(process.platform, process.arch)}.exe`)
      try {
        await fs.rename(src, finalDest)
      } catch {
        await fs.copyFile(src, finalDest)
      }
    } else {
      let bin
      try {
        bin = gunzipSync(data)
      } catch (e) {
        throw new Error(`gzip 解压失败: ${e instanceof Error ? e.message : String(e)}`)
      }
      await fs.writeFile(finalDest, bin)
      await fs.chmod(finalDest, 0o755)
    }
    console.log(`[download-core] 完成: ${finalDest} (${data.length} bytes 压缩)`)
  }

  await downloadGeo()
  await downloadWintun()
}

/** 下载 geoip/geosite 数据到 resources/core（mihomo 规则 GEOIP/GEOSITE 依赖） */
async function downloadGeo() {
  const GEO_REPO = 'MetaCubeX/meta-rules-dat'
  for (const name of ['geoip.dat', 'geosite.dat']) {
    const dest = path.join(TARGET_DIR, name)
    if (await fs.access(dest).then(() => true, () => false)) {
      console.log(`[download-core] ${name} 已存在，跳过`)
      continue
    }
    const url = `https://github.com/${GEO_REPO}/releases/download/latest/${name}`
    console.log(`[download-core] 下载 geo 数据: ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${name} 下载失败: HTTP ${res.status}`)
    const file = createWriteStream(dest)
    for await (const chunk of res.body) {
      file.write(chunk)
    }
    file.end()
    await new Promise((r) => file.on('finish', r))
    console.log(`[download-core] ${name} 完成`)
  }
}

/** 下载 wintun 驱动到 resources/core（Windows TUN 模式需要，best-effort） */
async function downloadWintun() {
  if (process.platform !== 'win32') return
  const dest = path.join(TARGET_DIR, 'wintun.dll')
  if (await fs.access(dest).then(() => true, () => false)) {
    console.log('[download-core] wintun.dll 已存在，跳过')
    return
  }
  try {
    const url = 'https://www.wintun.net/builds/wintun-0.14.1.zip'
    console.log(`[download-core] 下载 wintun: ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const zipPath = path.join(TARGET_DIR, 'wintun.zip')
    const file = createWriteStream(zipPath)
    for await (const chunk of res.body) file.write(chunk)
    file.end()
    await new Promise((r) => file.on('finish', r))
    await unzip(zipPath, path.join(TARGET_DIR, 'wintun-tmp'))
    await fs.copyFile(path.join(TARGET_DIR, 'wintun-tmp', 'amd64', 'wintun.dll'), dest)
    await fs.rm(zipPath, { force: true })
    await fs.rm(path.join(TARGET_DIR, 'wintun-tmp'), { recursive: true, force: true })
    console.log('[download-core] wintun.dll 完成')
  } catch (e) {
    console.warn(`[download-core] wintun.dll 下载失败（可稍后手动放置）: ${e instanceof Error ? e.message : String(e)}`)
  }
}

main().catch((e) => {
  console.error(`[download-core] 失败: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})