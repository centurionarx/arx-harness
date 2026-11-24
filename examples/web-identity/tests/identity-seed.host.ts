/**
 * Seeds one identity and owner-storage root for the HTTP browser fixture's USER
 * and admin starts: MASTER bootstrap and two ready users, the password hashing that
 * dominates a fixture start. The parent passes the empty root as argv[2] and
 * receives the credentials only over private IPC after the harness closed.
 */
import { storageHarness } from '../../../packages/identity/project-storage/tests/harness.ts'

const root = process.argv[2]
if (root === undefined || process.send === undefined) throw new Error('identity seed requires a root and private IPC')
const harness = await storageHarness({ http: true, root, initialize: true, readyUsers: 2 })
const seed = { type: 'seed', root, masterPassword: harness.passwords.master,
  users: harness.users.map(user => ({ userId: user.userId, username: user.username, password: user.password })) }
await harness.close(false)
process.send(seed)
