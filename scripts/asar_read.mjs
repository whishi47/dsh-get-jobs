// Minimal offline asar reader: list / extract one file. No deps.
import fs from 'node:fs'

const [, , cmd, archive, target] = process.argv
const buf = fs.readFileSync(archive)

function pickleIt(buf, off) {
  return { payloadLen: buf.readUInt32LE(off) }
}

const p1 = pickleIt(buf, 0) // first pickle: payload length 4, value = header pickle size
const headerPickleSize = buf.readUInt32LE(4)
const headerStart = 8
const headerPayloadLen = buf.readUInt32LE(headerStart)
const strLen = buf.readUInt32LE(headerStart + 4)
const jsonStart = headerStart + 8
const header = JSON.parse(buf.toString('utf8', jsonStart, jsonStart + strLen))
const dataBase = headerStart + headerPickleSize

function walk(node, path, out) {
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) walk(child, path ? `${path}/${name}` : name, out)
  } else if (!node.link) {
    out.push({ path, size: node.size, offset: node.offset, unpacked: !!node.unpacked })
  }
}

const files = []
walk(header, '', files)

if (cmd === 'list') {
  const needle = (target || '').toLowerCase()
  for (const f of files) {
    if (!needle || f.path.toLowerCase().includes(needle)) console.log(`${f.unpacked ? 'U' : ' '} ${f.size}\t${f.path}`)
  }
} else if (cmd === 'extract') {
  const f = files.find((x) => x.path === target)
  if (!f) {
    console.error('not found: ' + target)
    process.exit(1)
  }
  if (f.unpacked) {
    const up = archive.replace(/\.asar$/, '.unpacked') + '/' + target
    process.stdout.write(fs.readFileSync(up))
  } else {
    const off = dataBase + Number(f.offset)
    process.stdout.write(buf.subarray(off, off + f.size))
  }
}
