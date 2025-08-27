// Compute file:// URLs for runtime assets when executing inside a Node worker (Vercel serverless).
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function serverlessAssetsBaseURL(): string {
  // In Vercel, your deployment bundle contains /public. We resolve from this file toward ../../public/runtimes.
  // Adjust if your build output structure differs (works with Next.js app dir).
  const root = path.join(process.cwd(), 'public', 'runtimes');
  return pathToFileURL(root).toString().replace(/\/$/, '');
}
