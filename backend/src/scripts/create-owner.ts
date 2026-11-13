// Creates the first Owner account. There is no default password anywhere in the code:
// run `npm run create-owner` once and type the details when asked. Add `-- --remote` for the live database.
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { createOwner } from '../auth/owner.js';
import { connect } from './connect.js';

function ask(question: string, hidden = false): Promise<string> {
  // A muted output stream keeps a typed password off the screen.
  const output = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: stdin, output: hidden && stdin.isTTY ? output : stdout, terminal: stdin.isTTY });
  stdout.write(question);
  return new Promise((resolve) => {
    rl.once('line', (answer) => {
      rl.close();
      if (hidden && stdin.isTTY) stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  // Non-interactive use reads the same details from the environment.
  const name = process.env.OWNER_NAME ?? (await ask('Full name: '));
  const email = process.env.OWNER_EMAIL ?? (await ask('Email: '));
  const password = process.env.OWNER_PASSWORD ?? (await ask('Password (hidden): ', true));
  if (!process.env.OWNER_PASSWORD && (await ask('Repeat password (hidden): ', true)) !== password) {
    throw new Error('The passwords don’t match.');
  }
  const owner = await createOwner({ name, email, password });
  console.log(`Owner created: ${owner.staffNo} (${owner.email})`);
}

const connection = await connect();
try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await connection.close();
}
