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
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

const OWNER = 'MetaCubeX'
const REPO = 'mihomo'
const TARGET_DIR = path.resolve('apps/electron/resources/core')

// 完整性校验清单（见 deps.sha256.json）：
//   core[tag][assets]: null 表示未登记哈希，下载跳过严格校验；非 null 则必须匹配
//   geo[name]: 与「当前 latest」对应，仅做一致性提示
const SHA_FILE = new URL('./deps.sha256.json', import.meta.url)
const SHA = JSON.parse(await fs.readFile(SHA_FILE, 'utf8'))

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

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

    // 完整性校验（针对解压后的 mihomo 可执行文件）
    verifyCore(finalDest, tag)
    console.log(`[download-core] 完成: ${finalDest} (${data.length} bytes 压缩)`)
  }

  await downloadGeo()
  await downloadWintun()
}

/** 校验解压后的内核二进制：清单内存在该版本+平台哈希则必须匹配，否则视为下载损坏中止 */
async function verifyCore(binaryPath, tag) {
  const key = assetName(process.platform, process.arch)
  const expected = SHA.core?.[tag]?.[key]
  if (!expected) {
    console.warn(
      `[download-core] ⚠ 内核 ${tag}/${key} 未登记校验哈希，跳过严格校验（建议 CI 首次下载后补登记 deps.sha256.json）`
    )
    return
  }
  const bin = await fs.readFile(binaryPath)
  const actual = sha256(bin)
  if (actual !== expected) {
    throw new Error(
      `内核完整性校验失败 (${tag}/${key})\n期望 ${expected}\n实际 ${actual}\n可能下载损坏或版本哈希发生变更，请核对后重试`
    )
  }
  console.log(`[download-core] ✓ 内核完整性校验通过 (${key} sha256 前8位 ${actual.slice(0, 8)}…)`)
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
    // 一致性提示：geo 取 meta-rules-dat latest，会随上游更新；仅提示，不强阻断
    const actual = sha256(await fs.readFile(dest))
    const recorded = SHA.geo?.[name]
    if (recorded) {
      if (actual === recorded) {
        console.log(`[download-core] ✓ ${name} 与清单哈希一致`)
      } else {
        console.warn(
          `[download-core] ⚠ ${name} 哈希与清单不一致（上游可能已更新）。若非手动更新预期，请确认文件未被截断/损坏\n  当前 ${actual.slice(0, 16)}… / 清单 ${recorded.slice(0, 16)}…`
        )
      }
    }
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