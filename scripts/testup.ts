import { bringUp, tearDown, findPod } from '../lib/podops'

const action = process.argv[2] ?? 'up'

async function main() {
  if (action === 'down') {
    for await (const l of tearDown()) console.log(`[${l.level}] ${l.text}`)
    return
  }
  if (action === 'status') {
    console.log(JSON.stringify(await findPod(), null, 2))
    return
  }
  for await (const l of bringUp()) {
    console.log(`${new Date().toISOString().slice(11, 19)} [${l.level}] ${l.text}`)
  }
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
