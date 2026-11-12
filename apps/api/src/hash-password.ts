import { hashPassword } from './auth';

const pw = process.argv[2];
if (!pw) {
  console.error("Usage: pnpm --filter @aeonic/api hash-password '<password>'");
  process.exit(1);
}
console.log(hashPassword(pw));
