/** Run this keyless fixture through the guarded tsx CLI. */
import { ownedStorageScenario } from './scenario.ts'
process.stdout.write(await ownedStorageScenario())
