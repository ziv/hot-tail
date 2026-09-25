// Fills the privacy policy's contact line from CONTACT_EMAIL (set it in the Vercel project).
import { readFileSync, writeFileSync } from 'node:fs';

export function fillContact(file) {
  const email = process.env.CONTACT_EMAIL;
  const html = readFileSync(file, 'utf8').replace(
    '__CONTACT__',
    email ? `<a href="mailto:${email}">${email}</a>` : "via the contact link on the game's project page",
  );
  writeFileSync(file, html);
}
